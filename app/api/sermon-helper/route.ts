import {
  ensureDatabase,
  getD1,
  withDatabaseAdvisoryLock,
} from "../../../db";
import {
  getRequestUserResponse,
  serviceUnavailableResponse,
  unauthorizedResponse,
} from "../../_lib/auth-user";
import {
  createNewSermonHelperProject,
  readSermonHelperJsonBody,
  sermonHelperBodyErrorResponse,
  sermonHelperProjectLimit,
  sermonHelperSummaryFromRow,
  type SermonHelperProjectLimit,
  type SermonHelperSummaryRow,
} from "../../_lib/sermon-helper-server";
import { validateCreateSermonHelperInput } from "../../_lib/sermon-helper-types";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

function stableLockKey(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash | 0;
}

export async function GET(request: Request) {
  const auth = await getRequestUserResponse(request);
  if ("response" in auth) return auth.response;
  if (!auth.user) return unauthorizedResponse();

  const url = new URL(request.url);
  const requestedLimit = Number.parseInt(url.searchParams.get("limit") ?? "20", 10);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(50, Math.max(1, requestedLimit))
    : 20;
  const status = url.searchParams.get("status");
  if (status && status !== "in_progress" && status !== "completed") {
    return Response.json(
      { error: "설교도우미 작업 상태를 확인해 주세요." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const db = getD1();
  if (!db) return serviceUnavailableResponse();
  await ensureDatabase(db);
  const statement = status
    ? db
        .prepare(
          `SELECT id, title, scripture, status, current_step_id,
                  provenance_mode, completed_sermon_id, completed_step_count,
                  version, created_at, updated_at
             FROM sermon_helper_projects
            WHERE user_id = ? AND deleted_at IS NULL AND status = ?
            ORDER BY updated_at DESC, id DESC
            LIMIT ?`,
        )
        .bind(auth.user.id, status, limit)
    : db
        .prepare(
          `SELECT id, title, scripture, status, current_step_id,
                  provenance_mode, completed_sermon_id, completed_step_count,
                  version, created_at, updated_at
             FROM sermon_helper_projects
            WHERE user_id = ? AND deleted_at IS NULL
            ORDER BY updated_at DESC, id DESC
            LIMIT ?`,
        )
        .bind(auth.user.id, limit);
  const rows = await statement.all<SermonHelperSummaryRow>();
  const summaries = rows.results.map(sermonHelperSummaryFromRow);
  if (summaries.some((summary) => !summary)) {
    return Response.json(
      { error: "저장된 설교도우미 작업을 읽지 못했습니다." },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
  return Response.json(
    { items: summaries },
    { headers: NO_STORE_HEADERS },
  );
}

export async function POST(request: Request) {
  const auth = await getRequestUserResponse(request);
  if ("response" in auth) return auth.response;
  if (!auth.user) return unauthorizedResponse();

  let rawInput: unknown;
  try {
    rawInput = await readSermonHelperJsonBody(request);
  } catch (error) {
    const response = sermonHelperBodyErrorResponse(error);
    if (response) return response;
    throw error;
  }
  const input = validateCreateSermonHelperInput(rawInput);
  if (!input.ok) {
    return Response.json(
      { error: input.error },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const db = getD1();
  if (!db) return serviceUnavailableResponse();
  await ensureDatabase(db);
  const userId = auth.user.id;
  const nowDate = new Date();
  const now = nowDate.toISOString();
  const project = createNewSermonHelperProject(
    crypto.randomUUID(),
    input.value.title,
    input.value.scripture,
    now,
  );
  const cutoff = new Date(nowDate.getTime() - 24 * 60 * 60 * 1_000).toISOString();
  const tombstoneCutoff = new Date(
    nowDate.getTime() - 30 * 24 * 60 * 60 * 1_000,
  ).toISOString();
  let limit: SermonHelperProjectLimit = null;
  try {
    limit = await withDatabaseAdvisoryLock(
      db,
      stableLockKey(`sermon-helper-create:${userId}`),
      async (lockedDb) => {
        // Deleted in-progress projects retain only an audit tombstone. Purge
        // old user-scoped tombstones before counting so that the table cannot
        // grow forever; coach ledger rows have no project foreign key.
        await lockedDb
          .prepare(
            `DELETE FROM sermon_helper_projects
              WHERE user_id = ? AND status = 'in_progress'
                AND completed_sermon_id IS NULL AND deleted_at IS NOT NULL
                AND deleted_at < ?`,
          )
          .bind(userId, tombstoneCutoff)
          .run();
        const counts = await lockedDb
          .prepare(
            `SELECT SUM(CASE WHEN deleted_at IS NULL THEN 1 ELSE 0 END) AS total_count,
                    SUM(CASE WHEN deleted_at IS NULL AND status = 'in_progress' THEN 1 ELSE 0 END) AS active_count,
                    SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS recent_count
               FROM sermon_helper_projects
              WHERE user_id = ?`,
          )
          .bind(cutoff, userId)
          .first<{
            total_count: number | string;
            active_count: number | string | null;
            recent_count: number | string | null;
          }>();
        const projectLimit = sermonHelperProjectLimit({
          recent: counts?.recent_count,
          active: counts?.active_count,
          total: counts?.total_count,
        });
        if (projectLimit) return projectLimit;
        await lockedDb
          .prepare(
            `INSERT INTO sermon_helper_projects
               (id, user_id, title, scripture, status, current_step_id, steps_json,
                provenance_json, provenance_mode, completed_sermon_id,
                completed_step_count, version, created_at, updated_at, deleted_at)
             VALUES (?, ?, ?, ?, 'in_progress', 'brief', ?, ?, 'pastor_assisted',
                     NULL, 0, 1, ?, ?, NULL)`,
          )
          .bind(
            project.id,
            userId,
            project.title,
            project.scripture,
            JSON.stringify(project.steps),
            JSON.stringify(project.provenance),
            now,
            now,
          )
          .run();
        return null;
      },
    );
  } catch {
    return serviceUnavailableResponse();
  }
  if (limit) {
    const rateLimited = limit === "rate";
    return Response.json(
      {
        error: rateLimited
          ? "짧은 시간에 너무 많은 설교 준비를 만들었습니다. 잠시 후 다시 시도해 주세요."
          : limit === "active"
            ? "진행 중인 설교 준비를 먼저 완료해 주세요."
            : "저장할 수 있는 설교 준비 수에 도달했습니다.",
        code: `helper_${limit}_limit`,
      },
      { status: rateLimited ? 429 : 409, headers: NO_STORE_HEADERS },
    );
  }
  return Response.json(
    { item: project },
    { status: 201, headers: NO_STORE_HEADERS },
  );
}
