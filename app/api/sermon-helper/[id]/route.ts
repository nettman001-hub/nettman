import {
  ensureDatabase,
  getD1,
  withDatabaseAdvisoryLock,
} from "../../../../db";
import {
  getRequestUserResponse,
  serviceUnavailableResponse,
  unauthorizedResponse,
} from "../../../_lib/auth-user";
import {
  mergeSermonHelperPatch,
  readSermonHelperJsonBody,
  redactDeletedSermonHelperProject,
  sermonHelperBodyErrorResponse,
  sermonHelperConflictResponse,
  sermonHelperProjectFromRow,
  sermonHelperProjectStorageBytes,
  type SermonHelperRow,
} from "../../../_lib/sermon-helper-server";
import { reconcileExpiredSermonHelperCoachRequests } from "../../../_lib/sermon-helper-coach-ledger";
import {
  SERMON_HELPER_MAX_PROJECT_BYTES,
  SERMON_HELPER_STEP_IDS,
  type SermonHelperProject,
  validateDeleteSermonHelperInput,
  validatePatchSermonHelperInput,
} from "../../../_lib/sermon-helper-types";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;
const HELPER_ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;

function stableLockKey(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash | 0;
}

async function ownedProject(
  db: D1Database,
  id: string,
  userId: string,
) {
  const row = await db
    .prepare(
      `SELECT id, title, scripture, status, current_step_id, steps_json,
              provenance_json, provenance_mode, completed_sermon_id,
              version, created_at, updated_at
         FROM sermon_helper_projects
        WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    )
    .bind(id, userId)
    .first<SermonHelperRow>();
  return row ? sermonHelperProjectFromRow(row) : null;
}

function notFoundResponse() {
  return Response.json(
    { error: "설교도우미 작업을 찾을 수 없습니다." },
    { status: 404, headers: NO_STORE_HEADERS },
  );
}

function validProvenanceReferences(
  project: NonNullable<ReturnType<typeof sermonHelperProjectFromRow>>,
): boolean {
  const provenanceIds = new Set(project.provenance.map((entry) => entry.id));
  return Object.values(project.steps).every((step) =>
    step.items.every((item) =>
      item.provenanceIds.every((provenanceId) => provenanceIds.has(provenanceId)),
    ),
  );
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await getRequestUserResponse(request);
  if ("response" in auth) return auth.response;
  if (!auth.user) return unauthorizedResponse();
  const { id } = await context.params;
  if (!HELPER_ID_PATTERN.test(id)) return notFoundResponse();

  const db = getD1();
  if (!db) return serviceUnavailableResponse();
  await ensureDatabase(db);
  const project = await ownedProject(db, id, auth.user.id);
  if (!project) return notFoundResponse();
  return Response.json({ item: project }, { headers: NO_STORE_HEADERS });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await getRequestUserResponse(request);
  if ("response" in auth) return auth.response;
  if (!auth.user) return unauthorizedResponse();
  const { id } = await context.params;
  if (!HELPER_ID_PATTERN.test(id)) return notFoundResponse();

  let rawInput: unknown;
  try {
    rawInput = await readSermonHelperJsonBody(request);
  } catch (error) {
    const response = sermonHelperBodyErrorResponse(error);
    if (response) return response;
    throw error;
  }
  const input = validatePatchSermonHelperInput(rawInput);
  if (!input.ok) {
    return Response.json(
      { error: input.error },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const db = getD1();
  if (!db) return serviceUnavailableResponse();
  await ensureDatabase(db);
  const existing = await ownedProject(db, id, auth.user.id);
  if (!existing) return notFoundResponse();
  if (existing.status === "completed") {
    return Response.json(
      {
        error: "내 설교에 저장된 설교도우미 작업은 더 이상 변경할 수 없습니다.",
        code: "project_completed",
        completedSermonId: existing.completedSermonId,
      },
      { status: 409, headers: NO_STORE_HEADERS },
    );
  }
  if (
    existing.version !== input.value.expectedVersion ||
    existing.updatedAt !== input.value.expectedUpdatedAt
  ) {
    return sermonHelperConflictResponse(existing);
  }

  const now = new Date().toISOString();
  const next = mergeSermonHelperPatch(existing, input.value, now);
  if (sermonHelperProjectStorageBytes(next) > SERMON_HELPER_MAX_PROJECT_BYTES) {
    return Response.json(
      {
        error: "설교도우미 작업 전체 저장 용량을 초과했습니다. 긴 자료를 줄여 주세요.",
        code: "project_too_large",
      },
      { status: 413, headers: NO_STORE_HEADERS },
    );
  }
  if (!validProvenanceReferences(next)) {
    return Response.json(
      { error: "단계 내용이 존재하지 않는 출처를 참조하고 있습니다." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  const updated = await db
    .prepare(
      `UPDATE sermon_helper_projects
          SET title = ?, scripture = ?, current_step_id = ?, steps_json = ?,
              provenance_json = ?, completed_step_count = ?,
              version = version + 1, updated_at = ?
        WHERE id = ? AND user_id = ? AND deleted_at IS NULL
          AND status = 'in_progress' AND version = ? AND updated_at = ?
        RETURNING id, title, scripture, status, current_step_id, steps_json,
                  provenance_json, provenance_mode, completed_sermon_id,
                  version, created_at, updated_at`,
    )
    .bind(
      next.title,
      next.scripture,
      next.currentStepId,
      JSON.stringify(next.steps),
      JSON.stringify(next.provenance),
      SERMON_HELPER_STEP_IDS.filter((stepId) => next.steps[stepId].completed).length,
      now,
      id,
      auth.user.id,
      input.value.expectedVersion,
      input.value.expectedUpdatedAt,
    )
    .first<SermonHelperRow>();
  if (!updated) {
    const current = await ownedProject(db, id, auth.user.id);
    if (!current) return notFoundResponse();
    return sermonHelperConflictResponse(current);
  }
  const project = sermonHelperProjectFromRow(updated);
  if (!project) {
    return Response.json(
      { error: "저장된 설교도우미 작업을 읽지 못했습니다." },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
  return Response.json({ item: project }, { headers: NO_STORE_HEADERS });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await getRequestUserResponse(request);
  if ("response" in auth) return auth.response;
  if (!auth.user) return unauthorizedResponse();
  const { id } = await context.params;
  if (!HELPER_ID_PATTERN.test(id)) return notFoundResponse();

  let rawInput: unknown;
  try {
    rawInput = await readSermonHelperJsonBody(request);
  } catch (error) {
    const response = sermonHelperBodyErrorResponse(error);
    if (response) return response;
    throw error;
  }
  const input = validateDeleteSermonHelperInput(rawInput);
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
  await reconcileExpiredSermonHelperCoachRequests({ db, userId }).catch(
    () => undefined,
  );
  let outcome:
    | { kind: "not_found" }
    | { kind: "completed" }
    | { kind: "conflict"; project: SermonHelperProject }
    | { kind: "coach_pending"; retryAfterSeconds: number }
    | { kind: "deleted"; id: string };
  try {
    outcome = await withDatabaseAdvisoryLock(
      db,
      stableLockKey(`sermon-helper-project:${userId}:${id}`),
      async (lockedDb) => {
        const row = await lockedDb
          .prepare(
            `SELECT id, title, scripture, status, current_step_id, steps_json,
                    provenance_json, provenance_mode, completed_sermon_id,
                    version, created_at, updated_at
               FROM sermon_helper_projects
              WHERE id = ? AND user_id = ? AND deleted_at IS NULL
              FOR UPDATE`,
          )
          .bind(id, userId)
          .first<SermonHelperRow>();
        const existing = row ? sermonHelperProjectFromRow(row) : null;
        if (!existing) return { kind: "not_found" } as const;
        if (existing.status === "completed" || existing.completedSermonId) {
          return { kind: "completed" } as const;
        }
        if (
          existing.version !== input.value.expectedVersion ||
          existing.updatedAt !== input.value.expectedUpdatedAt
        ) {
          return { kind: "conflict", project: existing } as const;
        }
        const pendingCoach = await lockedDb
          .prepare(
            `SELECT lease_expires_at
               FROM sermon_helper_coach_requests
              WHERE user_id = ? AND project_id = ? AND status = 'pending'
              ORDER BY lease_expires_at DESC
              LIMIT 1`,
          )
          .bind(userId, id)
          .first<{ lease_expires_at: string }>();
        if (pendingCoach) {
          const retryAfterSeconds = Math.max(
            1,
            Math.ceil(
              (Date.parse(pendingCoach.lease_expires_at) - Date.now()) / 1_000,
            ),
          );
          return { kind: "coach_pending", retryAfterSeconds } as const;
        }

        const deletedAt = new Date().toISOString();
        const tombstone = redactDeletedSermonHelperProject(existing, deletedAt);
        const deleted = await lockedDb
          .prepare(
            `UPDATE sermon_helper_projects
                SET title = ?, scripture = '', current_step_id = 'brief',
                    steps_json = ?, provenance_json = '[]',
                    completed_step_count = 0, deleted_at = ?,
                    version = version + 1, updated_at = ?
              WHERE id = ? AND user_id = ? AND deleted_at IS NULL
                AND status = 'in_progress' AND completed_sermon_id IS NULL
                AND version = ? AND updated_at = ?
              RETURNING id`,
          )
          .bind(
            tombstone.title,
            JSON.stringify(tombstone.steps),
            deletedAt,
            deletedAt,
            id,
            userId,
            input.value.expectedVersion,
            input.value.expectedUpdatedAt,
          )
          .first<{ id: string }>();
        if (!deleted) {
          throw new Error("Sermon-helper soft delete lost its project lock");
        }
        return { kind: "deleted", id: deleted.id } as const;
      },
    );
  } catch {
    return serviceUnavailableResponse();
  }
  if (outcome.kind === "not_found") return notFoundResponse();
  if (outcome.kind === "completed") {
    return Response.json(
      {
        error: "내 설교로 저장된 작업은 준비 목록에서 삭제할 수 없습니다.",
        code: "completed_project_preserved",
      },
      { status: 409, headers: NO_STORE_HEADERS },
    );
  }
  if (outcome.kind === "conflict") {
    return sermonHelperConflictResponse(outcome.project);
  }
  if (outcome.kind === "coach_pending") {
    return Response.json(
      {
        error: "처리 중이거나 환불 확인 중인 AI 코치 요청이 있어 아직 삭제할 수 없습니다.",
        code: "coach_request_pending",
        retryAfterSeconds: outcome.retryAfterSeconds,
      },
      { status: 409, headers: NO_STORE_HEADERS },
    );
  }
  return Response.json(
    { id: outcome.id, deleted: true },
    { headers: NO_STORE_HEADERS },
  );
}
