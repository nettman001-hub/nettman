import {
  SERMON_HELPER_COACH_COSTS,
  SERMON_HELPER_COACH_MAX_REQUEST_BYTES,
  sermonHelperCoachWarnings,
  validateSermonHelperCoachRequest,
  type SermonHelperCoachPersistedResponse,
} from "@/app/_lib/sermon-helper-coach-contract";
import {
  finalizeSermonHelperCoachRequest,
  inspectExistingSermonHelperCoachRequest,
  reconcileExpiredSermonHelperCoachRequests,
  refundSermonHelperCoachRequest,
  reserveSermonHelperCoachRequest,
  SermonHelperCoachProjectUnavailableError,
  type SermonHelperCoachLedgerRecord,
  type SermonHelperCoachReservation,
} from "@/app/_lib/sermon-helper-coach-ledger";
import { generateSermonHelperCoachReply } from "@/app/_lib/sermon-helper-coach-server";
import {
  getRequestUserResponse,
  unauthorizedResponse,
} from "@/app/_lib/auth-user";
import {
  getManagedAiRequestConfigResolution,
  managedAiEngineAccessErrorBody,
} from "@/app/_lib/managed-ai-engines";
import { UserAiProviderError } from "@/app/_lib/openai-sermons";
import { getSiteOrigin } from "@/app/_lib/supabase/config";
import {
  getTokenWallet,
  InsufficientTokensError,
  WELCOME_TOKEN_GRANT,
  type TokenWalletSnapshot,
} from "@/app/_lib/token-wallet";
import {
  ensureDatabase,
  finishAiAgentUsage,
  getD1,
  reserveAiAgentUsage,
  type AiAgentUsageReservation,
} from "@/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The provider has a 60-second deadline. The remaining time is reserved for
// authentication, database contention, lease release, and idempotent refunds.
export const maxDuration = 180;

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE_HEADERS });
}

function sameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();
  if (!origin || (fetchSite && fetchSite !== "same-origin")) return false;
  try {
    const allowed = new Set([
      new URL(request.url).origin,
      getSiteOrigin(request.url),
    ]);
    return allowed.has(new URL(origin).origin);
  } catch {
    return false;
  }
}

async function readLimitedJson(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > SERMON_HELPER_COACH_MAX_REQUEST_BYTES
  ) {
    throw new RangeError("request too large");
  }
  if (!request.body) throw new SyntaxError("missing body");
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let received = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > SERMON_HELPER_COACH_MAX_REQUEST_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new RangeError("request too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(decoder.decode(body)) as unknown;
}

function demoWallet(): TokenWalletSnapshot {
  return {
    balance: WELCOME_TOKEN_GRANT,
    lifetimePurchased: 0,
    lifetimeSpent: 0,
  };
}

async function walletResponseFields(
  db: D1Database,
  userId: string,
): Promise<{ wallet: TokenWalletSnapshot } | { walletRefreshRequired: true }> {
  const wallet = await getTokenWallet(db, userId).catch(() => undefined);
  return wallet ? { wallet } : { walletRefreshRequired: true };
}

async function existingReservationResponse(args: {
  db: D1Database;
  userId: string;
  request: Parameters<typeof inspectExistingSermonHelperCoachRequest>[0]["request"];
  reservation: SermonHelperCoachReservation;
}): Promise<Response | null> {
  const { reservation } = args;
  if (reservation.kind === "reserved") return null;
  if (reservation.kind === "succeeded") {
    return json({
      ...reservation.response,
      ...(await walletResponseFields(args.db, args.userId)),
      replayed: true,
    });
  }
  if (reservation.kind === "expired") {
    let refundResult;
    try {
      refundResult = await refundSermonHelperCoachRequest({
        db: args.db,
        userId: args.userId,
        requestId: reservation.record.id,
        reason: "lease_expired_retry",
        requireExpired: true,
      });
    } catch {
      return json(
        {
          error:
            "이전 AI 코치 요청의 토큰 환불을 확인하고 있습니다. 잠시 후 같은 요청으로 다시 시도해 주세요.",
          code: "coach_refund_pending",
          retryAfterSeconds: 5,
        },
        503,
      );
    }
    if (refundResult === "succeeded") {
      const settled = await inspectExistingSermonHelperCoachRequest({
        db: args.db,
        userId: args.userId,
        request: args.request,
      }).catch(() => null);
      if (settled) {
        return existingReservationResponse({ ...args, reservation: settled });
      }
    }
    if (refundResult === "not_found" || refundResult === "not_expired" || refundResult === "succeeded") {
      return json(
        {
          error:
            "이전 AI 코치 요청의 상태를 확인하고 있습니다. 잠시 후 같은 요청으로 다시 시도해 주세요.",
          code: "coach_refund_pending",
          retryAfterSeconds: 5,
        },
        503,
      );
    }
    return json(
      {
        error:
          "응답 없이 종료된 AI 코치 요청의 토큰을 환불했습니다. 새 요청으로 다시 시도해 주세요.",
        code: "coach_request_refunded",
        ...(await walletResponseFields(args.db, args.userId)),
      },
      409,
    );
  }
  if (reservation.kind === "pending") {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((Date.parse(reservation.record.leaseExpiresAt) - Date.now()) / 1_000),
    );
    return json(
      {
        error: "같은 AI 코치 요청이 아직 처리 중입니다.",
        code: "coach_request_pending",
        retryAfterSeconds,
        ...(await walletResponseFields(args.db, args.userId)),
      },
      409,
    );
  }
  if (reservation.kind === "response_expired") {
    return json(
      {
        error:
          "이 AI 코치 요청의 재생 보관 기간이 지났습니다. 새 요청으로 다시 시도해 주세요.",
        code: "coach_response_expired",
        ...(await walletResponseFields(args.db, args.userId)),
      },
      409,
    );
  }
  if (reservation.kind === "refunded") {
    return json(
      {
        error: "이미 종료되고 환불된 AI 코치 요청입니다. 새 요청으로 다시 시도해 주세요.",
        code: "coach_request_refunded",
        ...(await walletResponseFields(args.db, args.userId)),
      },
      409,
    );
  }
  return json(
    {
      error: "같은 요청 식별자가 서로 다른 내용에 사용되었습니다.",
      code: "coach_request_conflict",
      ...(await walletResponseFields(args.db, args.userId)),
    },
    409,
  );
}

async function ownsProject(
  db: D1Database,
  projectId: string,
  userId: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT id FROM sermon_helper_projects
       WHERE id = ? AND user_id = ? AND deleted_at IS NULL
         AND status = 'in_progress'
       LIMIT 1`,
    )
    .bind(projectId, userId)
    .first<{ id: string }>();
  return Boolean(row?.id);
}

export async function POST(request: Request): Promise<Response> {
  if (!sameOriginRequest(request)) {
    return json({ error: "허용되지 않은 설교도우미 AI 코치 요청입니다." }, 403);
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return json({ error: "설교도우미 AI 코치 요청 형식을 확인해 주세요." }, 415);
  }

  const auth = await getRequestUserResponse(request);
  if ("response" in auth) return auth.response;
  const { user } = auth;
  if (!user) return unauthorizedResponse();
  const authenticatedUser = user;

  let rawInput: unknown;
  try {
    rawInput = await readLimitedJson(request);
  } catch (error) {
    return error instanceof RangeError
      ? json({ error: "설교도우미 AI 코치 요청이 너무 큽니다." }, 413)
      : json({ error: "설교도우미 AI 코치 요청 형식을 확인해 주세요." }, 400);
  }
  const validated = validateSermonHelperCoachRequest(rawInput);
  if (!validated.ok) return json({ error: validated.error }, 400);
  const input = validated.value;

  const db = getD1();
  if (!db && !authenticatedUser.isDemo) {
    return json({ error: "토큰 지갑 저장소에 연결할 수 없습니다." }, 503);
  }
  try {
    if (db) await ensureDatabase(db);
  } catch {
    return json({ error: "설교도우미 AI 코치 저장소를 준비하지 못했습니다." }, 503);
  }
  async function durablePreflightResponse(): Promise<Response | null> {
    if (!db || authenticatedUser.isDemo) return null;
    try {
      const existing = await inspectExistingSermonHelperCoachRequest({
        db,
        userId: authenticatedUser.id,
        request: input,
      });
      return existing
        ? existingReservationResponse({
            db,
            userId: authenticatedUser.id,
            request: input,
            reservation: existing,
          })
        : null;
    } catch {
      return json(
        {
          error: "이전 AI 코치 요청의 저장 상태를 확인하지 못했습니다. 잠시 후 같은 요청으로 다시 시도해 주세요.",
          code: "coach_ledger_unavailable",
        },
        503,
      );
    }
  }

  // Reconcile and classify an existing durable identity before checks that
  // authorize a new provider call. A later project/config change must not hide
  // a paid, pending, refunded, expired, or conflicting request state.
  if (db && !authenticatedUser.isDemo) {
    await reconcileExpiredSermonHelperCoachRequests({
      db,
      userId: authenticatedUser.id,
    }).catch(() => undefined);
  }
  const durableResponse = await durablePreflightResponse();
  if (durableResponse) return durableResponse;

  if (
    db &&
    !authenticatedUser.isDemo &&
    !(await ownsProject(db, input.projectId, authenticatedUser.id).catch(() => false))
  ) {
    const racedResponse = await durablePreflightResponse();
    if (racedResponse) return racedResponse;
    return json({ error: "설교도우미 작업을 찾을 수 없습니다." }, 404);
  }

  let aiResolution;
  try {
    aiResolution = await getManagedAiRequestConfigResolution(db, input.tier, "coach");
  } catch {
    const racedResponse = await durablePreflightResponse();
    if (racedResponse) return racedResponse;
    return json(
      {
        error: "AI 엔진 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.",
        code: "ai_engine_status_unavailable",
      },
      503,
    );
  }
  if (aiResolution.status !== "ready") {
    const racedResponse = await durablePreflightResponse();
    if (racedResponse) return racedResponse;
    return json(managedAiEngineAccessErrorBody(aiResolution), 409);
  }
  const ai = aiResolution.config;
  // The helper sends pastoral notes and source excerpts. Custom endpoints fail
  // closed until outbound traffic uses a DNS-pinning proxy or hostname allowlist.
  if (ai.engine === "custom") {
    const racedResponse = await durablePreflightResponse();
    if (racedResponse) return racedResponse;
    return json(
      {
        error:
          "설교도우미 AI 코치는 현재 공식 관리형 엔진에서만 사용할 수 있습니다.",
        code: "custom_coach_provider_disabled",
      },
      409,
    );
  }

  let activeCoachRequest: SermonHelperCoachLedgerRecord | null = null;
  if (!authenticatedUser.isDemo && db) {
    try {
      const reservation = await reserveSermonHelperCoachRequest({
        db,
        userId: authenticatedUser.id,
        request: input,
        cost: SERMON_HELPER_COACH_COSTS[input.tier],
      });
      const priorResponse = await existingReservationResponse({
        db,
        userId: authenticatedUser.id,
        request: input,
        reservation,
      });
      if (priorResponse) return priorResponse;
      if (reservation.kind !== "reserved") {
        throw new Error("Coach reservation did not reach a billable state");
      }
      activeCoachRequest = reservation.record;
    } catch (error) {
      if (error instanceof SermonHelperCoachProjectUnavailableError) {
        return json({ error: "설교도우미 작업을 찾을 수 없습니다." }, 404);
      }
      if (error instanceof InsufficientTokensError) {
        return json(
          {
            error: error.message,
            code: "insufficient_tokens",
            balance: error.balance,
            required: error.required,
            topUpUrl: "/tokens",
          },
          402,
        );
      }
      return json({ error: "AI 코치 토큰을 차감하지 못했습니다." }, 503);
    }
  }

  async function refund(reason: string): Promise<{
    wallet?: TokenWalletSnapshot;
    refundPending: boolean;
    requestState: "refunded" | "succeeded" | "pending" | "none";
  }> {
    if (activeCoachRequest && db) {
      let settled = false;
      let requestState: "refunded" | "succeeded" | "pending" = "pending";
      for (let attempt = 0; attempt < 2 && !settled; attempt += 1) {
        try {
          const result = await refundSermonHelperCoachRequest({
            db,
            userId: authenticatedUser.id,
            requestId: activeCoachRequest.id,
            reason,
          });
          settled = result !== "not_found" && result !== "not_expired";
          if (result === "refunded" || result === "already_refunded") {
            requestState = "refunded";
          } else if (result === "succeeded") {
            requestState = "succeeded";
          }
        } catch {
          // The same durable request and refund reference make this retry
          // harmless even if the first transaction committed before a network
          // disconnect. If both attempts fail, the lease reconciler will retry.
        }
      }
      const wallet = await getTokenWallet(db, authenticatedUser.id).catch(() => undefined);
      return { wallet, refundPending: !settled, requestState };
    }
    return {
      wallet: db
        ? await getTokenWallet(db, authenticatedUser.id).catch(() => undefined)
        : demoWallet(),
      refundPending: false,
      requestState: "none",
    };
  }

  let usageReservation: Extract<AiAgentUsageReservation, { ok: true }> | null = null;
  if (!authenticatedUser.isDemo && db) {
    let reservation: AiAgentUsageReservation;
    try {
      reservation = await reserveAiAgentUsage(db, authenticatedUser.id);
    } catch {
      const refundResult = await refund("usage_reservation_failed");
      return json(
        {
          error: "AI 코치 사용 순서를 확보하지 못했습니다. 잠시 후 다시 시도해 주세요.",
          code: "usage_reservation_failed",
          ...(refundResult.wallet ? { wallet: refundResult.wallet } : {}),
          ...(refundResult.refundPending ? { refundPending: true } : {}),
          requestState: refundResult.requestState,
        },
        503,
      );
    }
    if (!reservation.ok) {
      const refundResult = await refund(`usage_${reservation.reason}`);
      return json(
        {
          error:
            reservation.reason === "daily_limit"
              ? `오늘 사용할 수 있는 AI 코치 ${reservation.dailyLimit}회를 모두 사용했습니다.`
              : "이미 처리 중인 AI 요청이 있습니다. 완료하거나 중지한 뒤 다시 시도해 주세요.",
          code:
            reservation.reason === "daily_limit"
              ? "coach_daily_limit"
              : "coach_concurrent_request",
          dailyLimit: reservation.dailyLimit,
          remainingToday: reservation.remainingToday,
          ...(refundResult.wallet ? { wallet: refundResult.wallet } : {}),
          ...(refundResult.refundPending ? { refundPending: true } : {}),
          requestState: refundResult.requestState,
        },
        429,
      );
    }
    usageReservation = reservation;
  }

  try {
    const result = await generateSermonHelperCoachReply({
      ai,
      request: input,
      signal: request.signal,
    });
    if (request.signal.aborted) {
      throw new UserAiProviderError(
        "AI 코치 요청이 중단되었습니다.",
        "timeout",
        504,
      );
    }
    const persistedResponse: SermonHelperCoachPersistedResponse = {
      messageId: input.messageId,
      mode: input.mode,
      stepId: input.stepId,
      ...result,
      warnings: sermonHelperCoachWarnings(),
    };
    if (!authenticatedUser.isDemo && db) {
      const finalized = await finalizeSermonHelperCoachRequest({
        db,
        userId: authenticatedUser.id,
        request: input,
        response: persistedResponse,
      });
      if (finalized.kind === "refunded") {
        return json(
          {
            error:
              "중단 처리된 AI 코치 요청에는 늦게 도착한 응답을 적용하지 않았습니다. 새 요청으로 다시 시도해 주세요.",
            code: "coach_request_refunded",
            ...(await walletResponseFields(db, authenticatedUser.id)),
          },
          409,
        );
      }
      if (finalized.kind !== "succeeded") {
        throw new Error(`coach_finalize_${finalized.kind}`);
      }
      return json({
        ...finalized.response,
        ...(await walletResponseFields(db, authenticatedUser.id)),
      });
    }
    const wallet = db && !authenticatedUser.isDemo
      ? await getTokenWallet(db, authenticatedUser.id)
      : demoWallet();
    return json({
      ...persistedResponse,
      wallet,
    });
  } catch (error) {
    const refundResult = await refund(
      error instanceof UserAiProviderError ? error.code : "unexpected_error",
    );
    if (error instanceof UserAiProviderError) {
      return json(
        {
          error: error.message,
          code: error.code,
          ...(refundResult.wallet ? { wallet: refundResult.wallet } : {}),
          ...(refundResult.refundPending ? { refundPending: true } : {}),
          requestState: refundResult.requestState,
        },
        error.httpStatus,
      );
    }
    return json(
      {
        error: "AI 코치 제안을 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.",
        ...(refundResult.wallet ? { wallet: refundResult.wallet } : {}),
        ...(refundResult.refundPending ? { refundPending: true } : {}),
        requestState: refundResult.requestState,
      },
      502,
    );
  } finally {
    if (usageReservation && db) {
      await finishAiAgentUsage(db, usageReservation).catch(() => undefined);
    }
  }
}
