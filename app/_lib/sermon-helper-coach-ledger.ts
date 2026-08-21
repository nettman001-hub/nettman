import "server-only";

import {
  SERMON_HELPER_COACH_MAX_PROVIDER_RESPONSE_BYTES,
  classifySermonHelperCoachRetry,
  isSermonHelperCoachMode,
  type SermonHelperCoachPersistedResponse,
  type SermonHelperCoachRequest,
} from "./sermon-helper-coach-contract.ts";
import { isAiEngineTier, type AiEngineTier } from "./ai-engine-tiers.ts";
import { isSermonHelperStepId, type SermonHelperStepId } from "./sermon-helper-types.ts";
import {
  chargeTokenWallet,
  ensureTokenWallet,
  refundTokenWalletCharge,
  type TokenWalletCharge,
} from "./token-wallet.ts";
import { withDatabaseAdvisoryLock } from "@/db";

export const SERMON_HELPER_COACH_LEASE_MS = 3 * 60 * 1_000;
export const SERMON_HELPER_COACH_RESPONSE_RETENTION_MS = 24 * 60 * 60 * 1_000;
export const SERMON_HELPER_COACH_RECONCILE_LIMIT = 8;

export class SermonHelperCoachProjectUnavailableError extends Error {
  constructor() {
    super("Sermon-helper project is unavailable for coaching");
    this.name = "SermonHelperCoachProjectUnavailableError";
  }
}

export type SermonHelperCoachRequestStatus =
  | "pending"
  | "succeeded"
  | "refunded";

type CoachRequestRow = {
  id: string;
  user_id: string;
  project_id: string;
  session_id: string;
  message_id: string;
  request_fingerprint: string;
  tier: string;
  mode: string;
  step_id: string;
  status: string;
  cost: number | string;
  charge_reference_id: string;
  response_json: string | null;
  failure_code: string | null;
  lease_expires_at: string;
  response_expires_at: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  refunded_at: string | null;
};

export type SermonHelperCoachLedgerRecord = {
  id: string;
  userId: string;
  projectId: string;
  sessionId: string;
  messageId: string;
  requestFingerprint: string;
  tier: AiEngineTier;
  mode: SermonHelperCoachRequest["mode"];
  stepId: SermonHelperStepId;
  status: SermonHelperCoachRequestStatus;
  cost: number;
  chargeReferenceId: string;
  leaseExpiresAt: string;
  responseExpiresAt: string | null;
  response: SermonHelperCoachPersistedResponse | null;
};

export type SermonHelperCoachReservation =
  | {
      kind: "reserved";
      record: SermonHelperCoachLedgerRecord;
      charge: TokenWalletCharge;
    }
  | {
      kind: "pending" | "expired" | "response_expired";
      record: SermonHelperCoachLedgerRecord;
    }
  | {
      kind: "succeeded";
      record: SermonHelperCoachLedgerRecord;
      response: SermonHelperCoachPersistedResponse;
    }
  | {
      kind: "refunded" | "conflict";
      record: SermonHelperCoachLedgerRecord;
    };

export type SermonHelperCoachFinalizeResult =
  | { kind: "succeeded"; response: SermonHelperCoachPersistedResponse }
  | { kind: "refunded" | "conflict" | "not_found" };

export type ExistingSermonHelperCoachRequest = Exclude<
  SermonHelperCoachReservation,
  { kind: "reserved" }
>;

export type SermonHelperCoachRefundResult =
  | "refunded"
  | "already_refunded"
  | "succeeded"
  | "not_found"
  | "not_expired";

type AppDatabase = NonNullable<ReturnType<typeof import("@/db").getD1>>;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function advisoryKey(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash | 0;
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function safeTimestamp(value: string): boolean {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function parsePersistedResponse(
  raw: string | null,
  row: Pick<CoachRequestRow, "message_id" | "mode" | "step_id">,
): SermonHelperCoachPersistedResponse | null {
  if (!raw || utf8Length(raw) > SERMON_HELPER_COACH_MAX_PROVIDER_RESPONSE_BYTES) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (
    !isObject(value) ||
    value.messageId !== row.message_id ||
    value.mode !== row.mode ||
    value.stepId !== row.step_id ||
    typeof value.answer !== "string" ||
    !Array.isArray(value.suggestions) ||
    !Array.isArray(value.citations) ||
    !Array.isArray(value.uncertainties) ||
    typeof value.needFurtherInput !== "boolean" ||
    !Array.isArray(value.warnings)
  ) {
    return null;
  }
  return value as SermonHelperCoachPersistedResponse;
}

function recordFromRow(row: CoachRequestRow): SermonHelperCoachLedgerRecord {
  const cost = Number(row.cost);
  const requestIdMatch = /^coach_([a-f0-9]{64})$/.exec(row.id);
  if (
    !requestIdMatch ||
    !row.user_id ||
    !row.project_id ||
    !row.session_id ||
    !row.message_id ||
    !/^[a-f0-9]{64}$/.test(row.request_fingerprint) ||
    !isAiEngineTier(row.tier) ||
    !isSermonHelperCoachMode(row.mode) ||
    !isSermonHelperStepId(row.step_id) ||
    (row.status !== "pending" && row.status !== "succeeded" && row.status !== "refunded") ||
    !Number.isSafeInteger(cost) ||
    cost < 1 ||
    cost > 4 ||
    row.charge_reference_id !== `helper_coach:${requestIdMatch[1]}` ||
    !safeTimestamp(row.lease_expires_at) ||
    (row.response_expires_at !== null && !safeTimestamp(row.response_expires_at))
  ) {
    throw new Error("Stored sermon-helper coach request is invalid");
  }
  const response = row.status === "succeeded"
    ? parsePersistedResponse(row.response_json, row)
    : null;
  if (
    row.status === "succeeded" &&
    !response &&
    row.failure_code !== "response_expired"
  ) {
    throw new Error("Stored sermon-helper coach response is invalid");
  }
  if (row.status === "succeeded" && response && !row.response_expires_at) {
    throw new Error("Stored sermon-helper coach response expiry is invalid");
  }
  return {
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id,
    sessionId: row.session_id,
    messageId: row.message_id,
    requestFingerprint: row.request_fingerprint,
    tier: row.tier,
    mode: row.mode,
    stepId: row.step_id,
    status: row.status,
    cost,
    chargeReferenceId: row.charge_reference_id,
    leaseExpiresAt: row.lease_expires_at,
    responseExpiresAt: row.response_expires_at,
    response,
  };
}

async function requestIdentity(args: {
  userId: string;
  request: SermonHelperCoachRequest;
}): Promise<{
  id: string;
  chargeReferenceId: string;
  fingerprint: string;
  lockKey: number;
}> {
  const idempotencyDigest = await sha256Hex(
    `${args.userId}\u0000${args.request.sessionId}\u0000${args.request.messageId}`,
  );
  const chargeReferenceId = `helper_coach:${idempotencyDigest}`;
  return {
    id: `coach_${idempotencyDigest}`,
    chargeReferenceId,
    fingerprint: await sha256Hex(stableJson(args.request)),
    lockKey: advisoryKey(chargeReferenceId),
  };
}

async function rowForIdentity(
  db: D1Database,
  userId: string,
  sessionId: string,
  messageId: string,
): Promise<CoachRequestRow | null> {
  return db
    .prepare(
      `SELECT id, user_id, project_id, session_id, message_id,
              request_fingerprint, tier, mode, step_id, status, cost,
              charge_reference_id, response_json, failure_code,
              lease_expires_at, response_expires_at,
              created_at, updated_at, completed_at, refunded_at
         FROM sermon_helper_coach_requests
        WHERE user_id = ? AND session_id = ? AND message_id = ?`,
    )
    .bind(userId, sessionId, messageId)
    .first<CoachRequestRow>();
}

export function classifySermonHelperCoachReservation(
  record: SermonHelperCoachLedgerRecord,
  fingerprint: string,
  nowMs: number,
): Exclude<SermonHelperCoachReservation, { kind: "reserved" }> {
  const state = classifySermonHelperCoachRetry({
    requestFingerprint: record.requestFingerprint,
    expectedFingerprint: fingerprint,
    status: record.status,
    leaseExpiresAt: record.leaseExpiresAt,
    responseExpiresAt: record.responseExpiresAt,
    hasResponse: Boolean(record.response),
    nowMs,
  });
  if (state === "succeeded" && record.response) {
    return { kind: state, record, response: record.response };
  }
  return { kind: state as Exclude<typeof state, "succeeded">, record };
}

/**
 * Classifies an existing durable key before checks that authorize a new provider
 * call. Project lifecycle and managed-engine changes must not hide pending,
 * refunded, conflicting, expired, or paid-success states after an HTTP loss.
 */
export async function inspectExistingSermonHelperCoachRequest(args: {
  db: AppDatabase;
  userId: string;
  request: SermonHelperCoachRequest;
  now?: Date;
}): Promise<ExistingSermonHelperCoachRequest | null> {
  const identity = await requestIdentity(args);
  const now = args.now ?? new Date();
  return withDatabaseAdvisoryLock(args.db, identity.lockKey, async (lockedDb) => {
    const row = await rowForIdentity(
      lockedDb,
      args.userId,
      args.request.sessionId,
      args.request.messageId,
    );
    if (!row) return null;
    return classifySermonHelperCoachReservation(
      recordFromRow(row),
      identity.fingerprint,
      now.getTime(),
    );
  });
}

function chargeReferenceIdForRequestId(requestId: string): string | null {
  const match = /^coach_([a-f0-9]{64})$/.exec(requestId);
  return match ? `helper_coach:${match[1]}` : null;
}

export async function reserveSermonHelperCoachRequest(args: {
  db: AppDatabase;
  userId: string;
  request: SermonHelperCoachRequest;
  cost: number;
  now?: Date;
}): Promise<SermonHelperCoachReservation> {
  const identity = await requestIdentity(args);
  const now = args.now ?? new Date();
  const nowIso = now.toISOString();
  const leaseExpiresAt = new Date(now.getTime() + SERMON_HELPER_COACH_LEASE_MS).toISOString();
  await ensureTokenWallet(args.db, args.userId);
  return withDatabaseAdvisoryLock(args.db, identity.lockKey, async (lockedDb) => {
    // Existing identities are already authorized and billed. Classify them
    // before project lifecycle checks so a concurrent completion/deletion
    // cannot make a paid response or pending lease unreachable.
    const existing = await rowForIdentity(
      lockedDb,
      args.userId,
      args.request.sessionId,
      args.request.messageId,
    );
    if (existing) {
      return classifySermonHelperCoachReservation(
        recordFromRow(existing),
        identity.fingerprint,
        now.getTime(),
      );
    }
    // Recheck project authority under the same transaction that creates the
    // ledger row and wallet debit. DELETE takes this row lock first, so either
    // deletion observes the pending request or this reservation observes the
    // deleted/completed project and rolls back before charging.
    const project = await lockedDb
      .prepare(
        `SELECT id, status, deleted_at FROM sermon_helper_projects
          WHERE id = ? AND user_id = ?
          FOR UPDATE`,
      )
      .bind(args.request.projectId, args.userId)
      .first<{ id: string; status: string; deleted_at: string | null }>();
    if (!project || project.status !== "in_progress" || project.deleted_at !== null) {
      throw new SermonHelperCoachProjectUnavailableError();
    }
    const inserted = await lockedDb
      .prepare(
        `INSERT INTO sermon_helper_coach_requests
           (id, user_id, project_id, session_id, message_id,
            request_fingerprint, tier, mode, step_id, status, cost,
            charge_reference_id, response_json, failure_code,
            lease_expires_at, response_expires_at,
            created_at, updated_at, completed_at, refunded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, NULL, NULL, ?, NULL, ?, ?, NULL, NULL)
         ON CONFLICT(user_id, session_id, message_id) DO NOTHING
         RETURNING id, user_id, project_id, session_id, message_id,
                   request_fingerprint, tier, mode, step_id, status, cost,
                   charge_reference_id, response_json, failure_code,
                   lease_expires_at, response_expires_at,
                   created_at, updated_at, completed_at, refunded_at`,
      )
      .bind(
        identity.id,
        args.userId,
        args.request.projectId,
        args.request.sessionId,
        args.request.messageId,
        identity.fingerprint,
        args.request.tier,
        args.request.mode,
        args.request.stepId,
        args.cost,
        identity.chargeReferenceId,
        leaseExpiresAt,
        nowIso,
        nowIso,
      )
      .first<CoachRequestRow>();
    if (!inserted) {
      const raced = await rowForIdentity(
        lockedDb,
        args.userId,
        args.request.sessionId,
        args.request.messageId,
      );
      if (!raced) throw new Error("Coach request reservation disappeared");
      return classifySermonHelperCoachReservation(
        recordFromRow(raced),
        identity.fingerprint,
        now.getTime(),
      );
    }
    const charge = await chargeTokenWallet({
      db: lockedDb as AppDatabase,
      userId: args.userId,
      referenceId: identity.chargeReferenceId,
      kind: "helper_coach",
      cost: args.cost,
      description: `설교도우미 AI 코치 · ${args.request.mode} · ${args.request.tier}`,
      metadata: {
        coachRequestId: identity.id,
        projectId: args.request.projectId,
        sessionId: args.request.sessionId,
        messageId: args.request.messageId,
        stepId: args.request.stepId,
        mode: args.request.mode,
        tier: args.request.tier,
        pricingVersion: 1,
      },
    });
    if (!charge.charged) {
      throw new Error("New coach request did not create its token charge");
    }
    return { kind: "reserved", record: recordFromRow(inserted), charge };
  });
}

export async function finalizeSermonHelperCoachRequest(args: {
  db: AppDatabase;
  userId: string;
  request: SermonHelperCoachRequest;
  response: SermonHelperCoachPersistedResponse;
  now?: Date;
}): Promise<SermonHelperCoachFinalizeResult> {
  const identity = await requestIdentity(args);
  const responseJson = JSON.stringify(args.response);
  if (utf8Length(responseJson) > SERMON_HELPER_COACH_MAX_PROVIDER_RESPONSE_BYTES) {
    throw new Error("Sermon-helper coach response is too large to persist");
  }
  const nowIso = (args.now ?? new Date()).toISOString();
  const responseExpiresAt = new Date(
    Date.parse(nowIso) + SERMON_HELPER_COACH_RESPONSE_RETENTION_MS,
  ).toISOString();
  return withDatabaseAdvisoryLock(args.db, identity.lockKey, async (lockedDb) => {
    const row = await rowForIdentity(
      lockedDb,
      args.userId,
      args.request.sessionId,
      args.request.messageId,
    );
    if (!row) return { kind: "not_found" } as const;
    const record = recordFromRow(row);
    if (record.requestFingerprint !== identity.fingerprint) return { kind: "conflict" } as const;
    if (record.status === "refunded") return { kind: "refunded" } as const;
    if (record.status === "succeeded" && record.response) {
      return { kind: "succeeded", response: record.response } as const;
    }
    const updated = await lockedDb
      .prepare(
        `UPDATE sermon_helper_coach_requests
            SET status = 'succeeded', response_json = ?, failure_code = NULL,
                response_expires_at = ?,
                updated_at = ?, completed_at = ?
          WHERE id = ? AND user_id = ? AND status = 'pending'
            AND request_fingerprint = ?
          RETURNING id`,
      )
      .bind(
        responseJson,
        responseExpiresAt,
        nowIso,
        nowIso,
        record.id,
        args.userId,
        identity.fingerprint,
      )
      .first<{ id: string }>();
    if (!updated) throw new Error("Coach request result was not persisted");
    return { kind: "succeeded", response: args.response } as const;
  });
}

function boundedFailureCode(value: string): string {
  const normalized = value.trim().replace(/[^A-Za-z0-9_.:-]/g, "_");
  return (normalized || "provider_failure").slice(0, 80);
}

export async function refundSermonHelperCoachRequest(args: {
  db: AppDatabase;
  userId: string;
  requestId: string;
  reason: string;
  requireExpired?: boolean;
  now?: Date;
}): Promise<SermonHelperCoachRefundResult> {
  const now = args.now ?? new Date();
  const nowIso = now.toISOString();
  const chargeReferenceId = chargeReferenceIdForRequestId(args.requestId);
  if (!chargeReferenceId) return "not_found";
  return withDatabaseAdvisoryLock(
    args.db,
    // Reservation, finalization, and refund must serialize on the same key.
    // Otherwise an expired-lease refund could race a just-finished provider
    // response and commit both terminal states.
    advisoryKey(chargeReferenceId),
    async (lockedDb) => {
      const row = await lockedDb
        .prepare(
          `SELECT id, user_id, project_id, session_id, message_id,
                  request_fingerprint, tier, mode, step_id, status, cost,
                  charge_reference_id, response_json, failure_code,
                  lease_expires_at, response_expires_at,
                  created_at, updated_at, completed_at, refunded_at
             FROM sermon_helper_coach_requests
            WHERE id = ? AND user_id = ?`,
        )
        .bind(args.requestId, args.userId)
        .first<CoachRequestRow>();
      if (!row) return "not_found";
      const record = recordFromRow(row);
      if (record.status === "succeeded") return "succeeded";
      if (record.status === "refunded") return "already_refunded";
      if (args.requireExpired && Date.parse(record.leaseExpiresAt) > now.getTime()) {
        return "not_expired";
      }

      const sourceCharge = await lockedDb
        .prepare(
          `SELECT reference_id FROM token_transactions
            WHERE user_id = ? AND reference_id = ? AND kind = 'helper_coach'
              AND amount < 0`,
        )
        .bind(args.userId, record.chargeReferenceId)
        .first<{ reference_id: string }>();
      if (sourceCharge) {
        const refunded = await refundTokenWalletCharge({
          db: lockedDb as AppDatabase,
          userId: args.userId,
          chargeReferenceId: record.chargeReferenceId,
          sourceKind: "helper_coach",
          reason: boundedFailureCode(args.reason),
          description: "설교도우미 AI 코치 실패 자동 환불",
        });
        if (!refunded) {
          const priorRefund = await lockedDb
            .prepare(
              `SELECT reference_id FROM token_transactions
                WHERE user_id = ? AND reference_id = ? AND kind = 'refund' AND amount > 0`,
            )
            .bind(args.userId, `refund:${record.chargeReferenceId}`)
            .first<{ reference_id: string }>();
          if (!priorRefund) throw new Error("Coach request token refund did not commit");
        }
      }

      const marked = await lockedDb
        .prepare(
          `UPDATE sermon_helper_coach_requests
              SET status = 'refunded', response_json = NULL, failure_code = ?,
                  response_expires_at = NULL,
                  updated_at = ?, refunded_at = ?
            WHERE id = ? AND user_id = ? AND status = 'pending'
            RETURNING id`,
        )
        .bind(
          boundedFailureCode(args.reason),
          nowIso,
          nowIso,
          record.id,
          args.userId,
        )
        .first<{ id: string }>();
      if (!marked) throw new Error("Coach request refund state was not persisted");
      return "refunded";
    },
  );
}

export async function reconcileExpiredSermonHelperCoachRequests(args: {
  db: AppDatabase;
  userId: string;
  now?: Date;
  limit?: number;
}): Promise<{ refunded: number; expiredResponses: number; failed: number }> {
  const now = args.now ?? new Date();
  const limit = Math.min(
    SERMON_HELPER_COACH_RECONCILE_LIMIT,
    Math.max(1, args.limit ?? SERMON_HELPER_COACH_RECONCILE_LIMIT),
  );
  const rows = await args.db
    .prepare(
      `SELECT id FROM sermon_helper_coach_requests
        WHERE user_id = ? AND status = 'pending' AND lease_expires_at <= ?
        ORDER BY lease_expires_at ASC
        LIMIT ?`,
    )
    .bind(args.userId, now.toISOString(), limit)
    .all<{ id: string }>();
  let refunded = 0;
  let failed = 0;
  for (const row of rows.results) {
    try {
      const result = await refundSermonHelperCoachRequest({
        db: args.db,
        userId: args.userId,
        requestId: row.id,
        reason: "lease_expired",
        requireExpired: true,
        now,
      });
      if (result === "refunded" || result === "already_refunded") refunded += 1;
    } catch {
      failed += 1;
    }
  }
  let expiredResponses = 0;
  try {
    const expired = await args.db
      .prepare(
        `UPDATE sermon_helper_coach_requests
            SET response_json = NULL, failure_code = 'response_expired', updated_at = ?
          WHERE user_id = ? AND status = 'succeeded'
            AND response_json IS NOT NULL AND response_expires_at <= ?
          RETURNING id`,
      )
      .bind(now.toISOString(), args.userId, now.toISOString())
      .all<{ id: string }>();
    expiredResponses = expired.results.length;
  } catch {
    failed += 1;
  }
  return { refunded, expiredResponses, failed };
}
