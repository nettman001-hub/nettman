import {
  ensureDatabase,
  getD1,
  withDatabaseAdvisoryLock,
} from "../../../../../db";
import {
  getRequestUserResponse,
  serviceUnavailableResponse,
  unauthorizedResponse,
} from "../../../../_lib/auth-user";
import {
  completeSermonHelperWithinLock,
  SermonHelperCompletionFailure,
} from "../../../../_lib/sermon-helper-completion";
import { reconcileExpiredSermonHelperCoachRequests } from "../../../../_lib/sermon-helper-coach-ledger";
import {
  readSermonHelperJsonBody,
  sermonHelperBodyErrorResponse,
  sermonHelperConflictResponse,
} from "../../../../_lib/sermon-helper-server";
import { validateCompleteSermonHelperInput } from "../../../../_lib/sermon-helper-types";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;
const HELPER_ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;

function notFoundResponse() {
  return Response.json(
    { error: "설교도우미 작업을 찾을 수 없습니다." },
    { status: 404, headers: NO_STORE_HEADERS },
  );
}

function stableLockKey(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash | 0;
}

function databaseErrorCode(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 3; depth += 1) {
    if (!current || typeof current !== "object") return null;
    const record = current as Record<string, unknown>;
    if (typeof record.code === "string") return record.code;
    current = record.cause;
  }
  return null;
}

function completionFailureResponse(
  error: SermonHelperCompletionFailure,
): Response {
  if (error.kind === "not_found") return notFoundResponse();
  if (error.kind === "conflict" && error.project) {
    return sermonHelperConflictResponse(error.project);
  }
  if (error.kind === "conflict") {
    return Response.json(
      {
        error: "설교도우미 작업 완료 중 다른 변경을 확인했습니다. 최신 내용을 불러와 주세요.",
        code: "version_conflict",
      },
      { status: 409, headers: NO_STORE_HEADERS },
    );
  }
  if (error.kind === "coach_pending") {
    return Response.json(
      {
        error: error.message,
        code: "coach_request_pending",
        retryAfterSeconds: error.retryAfterSeconds ?? 1,
      },
      { status: 409, headers: NO_STORE_HEADERS },
    );
  }
  if (error.kind === "incomplete") {
    const missing = error.missing ?? [];
    return Response.json(
      {
        error: `설교를 완료하려면 다음 항목을 확인해 주세요: ${missing.join(", ")}.`,
        code: "helper_incomplete",
        missing,
      },
      { status: 422, headers: NO_STORE_HEADERS },
    );
  }
  if (error.kind === "project_too_large") {
    return Response.json(
      { error: error.message, code: "project_too_large" },
      { status: 413, headers: NO_STORE_HEADERS },
    );
  }
  return Response.json(
    { error: "완료된 설교의 저장 상태를 확인하지 못했습니다." },
    { status: 503, headers: NO_STORE_HEADERS },
  );
}

export async function POST(
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
  const input = validateCompleteSermonHelperInput(rawInput);
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
  try {
    const result = await withDatabaseAdvisoryLock(
      db,
      stableLockKey(`sermon-helper-complete:${userId}:${id}`),
      (lockedDb) =>
        completeSermonHelperWithinLock(lockedDb, {
          projectId: id,
          userId,
          expectedVersion: input.value.expectedVersion,
          expectedUpdatedAt: input.value.expectedUpdatedAt,
        }),
    );
    return Response.json(
      {
        item: result.project,
        sermon: result.sermon,
        sermonId: result.sermon.id,
        alreadyCompleted: result.alreadyCompleted,
      },
      {
        status: result.alreadyCompleted ? 200 : 201,
        headers: NO_STORE_HEADERS,
      },
    );
  } catch (error) {
    if (error instanceof SermonHelperCompletionFailure) {
      return completionFailureResponse(error);
    }
    if (databaseErrorCode(error) === "23505") {
      return Response.json(
        { error: "완료 설교 식별자가 이미 사용 중입니다." },
        { status: 409, headers: NO_STORE_HEADERS },
      );
    }
    return serviceUnavailableResponse();
  }
}
