import {
  SERMON_HELPER_COACH_MAX_REQUEST_BYTES,
  validateSermonHelperCoachRequest,
  type SermonHelperCoachRequest,
} from "./sermon-helper-coach-contract.ts";

export const SERMON_HELPER_COACH_RETRY_STORAGE_TTL_MS = 24 * 60 * 60 * 1_000;
export const SERMON_HELPER_COACH_RETRY_STORAGE_PREFIX =
  "sermon-helper-coach-pending:v1";

const MAX_STORED_BYTES = SERMON_HELPER_COACH_MAX_REQUEST_BYTES + 2_048;

export type StoredSermonHelperCoachRetry = {
  version: 1;
  expiresAt: number;
  request: SermonHelperCoachRequest;
};

export type SermonHelperCoachStoredRetryAction = "retain" | "rotate" | "clear";

const TERMINAL_RETRY_CODES = new Set([
  "coach_engine_unavailable",
  "custom_coach_provider_disabled",
  "ai_engine_disabled",
  "ai_engine_unavailable",
  "coach_request_refunded",
  "coach_response_expired",
  "coach_request_conflict",
]);

const ROTATE_AFTER_REFUND_CODES = new Set([
  "coach_daily_limit",
  "coach_concurrent_request",
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

/**
 * Decides whether the exact durable replay key must be retained, replaced after
 * a confirmed refund, or removed. A pending/succeeded server ledger always wins
 * over the HTTP status because the same message ID is still needed to reconcile
 * or replay that outcome.
 */
export function classifyStoredSermonHelperCoachRetryResponse(args: {
  status: number;
  code?: unknown;
  requestState?: unknown;
}): SermonHelperCoachStoredRetryAction {
  const code = typeof args.code === "string" ? args.code : "";
  const requestState = typeof args.requestState === "string"
    ? args.requestState
    : "";
  if (requestState === "pending" || requestState === "succeeded") return "retain";
  if (ROTATE_AFTER_REFUND_CODES.has(code)) {
    return requestState === "refunded" ? "rotate" : "retain";
  }
  if (requestState === "refunded" || TERMINAL_RETRY_CODES.has(code)) return "clear";
  // Authentication/origin failures happen before the durable ledger lookup.
  // Keep the key so a renewed login or corrected request context can replay it.
  if ([400, 404, 413, 415].includes(args.status)) return "clear";
  return "retain";
}

export function sermonHelperCoachRetryStorageKey(
  clientUserScope: string,
  projectId: string,
): string | null {
  if (
    !clientUserScope ||
    clientUserScope.length > 240 ||
    Array.from(clientUserScope).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || codePoint === 127;
    }) ||
    !/^[A-Za-z0-9_-]{1,80}$/.test(projectId)
  ) {
    return null;
  }
  return `${SERMON_HELPER_COACH_RETRY_STORAGE_PREFIX}:${encodeURIComponent(clientUserScope)}:${projectId}`;
}

export function createStoredSermonHelperCoachRetry(args: {
  request: SermonHelperCoachRequest;
  projectId: string;
  nowMs?: number;
}): StoredSermonHelperCoachRetry | null {
  const validated = validateSermonHelperCoachRequest(args.request);
  if (!validated.ok || validated.value.projectId !== args.projectId) return null;
  const nowMs = args.nowMs ?? Date.now();
  const record: StoredSermonHelperCoachRetry = {
    version: 1,
    expiresAt: nowMs + SERMON_HELPER_COACH_RETRY_STORAGE_TTL_MS,
    request: validated.value,
  };
  return utf8Length(JSON.stringify(record)) <= MAX_STORED_BYTES ? record : null;
}

export function parseStoredSermonHelperCoachRetry(args: {
  raw: string;
  projectId: string;
  nowMs?: number;
}): StoredSermonHelperCoachRetry | null {
  if (!args.raw || utf8Length(args.raw) > MAX_STORED_BYTES) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(args.raw) as unknown;
  } catch {
    return null;
  }
  if (
    !isObject(parsed) ||
    !hasExactKeys(parsed, ["version", "expiresAt", "request"]) ||
    parsed.version !== 1 ||
    typeof parsed.expiresAt !== "number" ||
    !Number.isSafeInteger(parsed.expiresAt)
  ) {
    return null;
  }
  const nowMs = args.nowMs ?? Date.now();
  if (
    parsed.expiresAt <= nowMs ||
    parsed.expiresAt > nowMs + SERMON_HELPER_COACH_RETRY_STORAGE_TTL_MS
  ) {
    return null;
  }
  const validated = validateSermonHelperCoachRequest(parsed.request);
  if (!validated.ok || validated.value.projectId !== args.projectId) return null;
  return {
    version: 1,
    expiresAt: parsed.expiresAt,
    request: validated.value,
  };
}
