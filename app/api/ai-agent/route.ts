import {
  AI_AGENT_MAX_REQUEST_BYTES,
  AI_AGENT_MESSAGE_COSTS,
  validateAiAgentRequest,
} from "@/app/_lib/ai-agent-contract";
import { generateAiAgentReply } from "@/app/_lib/ai-agent-server";
import {
  getRequestUserResponse,
  unauthorizedResponse,
} from "@/app/_lib/auth-user";
import { getManagedAiRequestConfig } from "@/app/_lib/managed-ai-engines";
import { UserAiProviderError } from "@/app/_lib/openai-sermons";
import { getSiteOrigin } from "@/app/_lib/supabase/config";
import {
  chargeTokenWallet,
  getTokenWallet,
  InsufficientTokensError,
  refundTokenWalletCharge,
  WELCOME_TOKEN_GRANT,
  type TokenCharge,
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
// The provider gets at most 60 seconds. Keep two additional minutes for
// authentication, database contention, lease release, and an idempotent refund.
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
    declaredLength > AI_AGENT_MAX_REQUEST_BYTES
  ) {
    throw new RangeError("request too large");
  }
  if (!request.body) throw new SyntaxError("missing body");
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let raw = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > AI_AGENT_MAX_REQUEST_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new RangeError("request too large");
      }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(raw) as unknown;
}

function demoWallet(): TokenWalletSnapshot {
  return {
    balance: WELCOME_TOKEN_GRANT,
    lifetimePurchased: 0,
    lifetimeSpent: 0,
  };
}

export async function POST(request: Request): Promise<Response> {
  if (!sameOriginRequest(request)) {
    return json({ error: "허용되지 않은 AI 에이전트 요청입니다." }, 403);
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return json({ error: "AI 에이전트 요청 형식을 확인해 주세요." }, 415);
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
      ? json({ error: "AI 에이전트 요청이 너무 큽니다." }, 413)
      : json({ error: "AI 에이전트 요청 형식을 확인해 주세요." }, 400);
  }
  const validated = validateAiAgentRequest(rawInput);
  if (!validated.ok) return json({ error: validated.error }, 400);
  const input = validated.value;

  const db = getD1();
  if (!db && !authenticatedUser.isDemo) {
    return json({ error: "토큰 지갑 저장소에 연결할 수 없습니다." }, 503);
  }
  try {
    if (db) await ensureDatabase(db);
  } catch {
    return json({ error: "AI 에이전트 저장소를 준비하지 못했습니다." }, 503);
  }

  const ai = await getManagedAiRequestConfig(db, input.tier).catch(() => undefined);
  if (!ai) {
    return json(
      { error: "선택한 AI 에이전트 엔진이 아직 관리자가 사용할 수 있도록 설정되지 않았습니다." },
      409,
    );
  }
  // Custom endpoints remain available to the existing sermon features. The
  // server-side agent sends broad page context, so it fails closed until custom
  // traffic uses a DNS-pinning egress proxy or a production hostname allowlist.
  if (ai.engine === "custom") {
    return json(
      {
        error:
          "AI 에이전트는 현재 공식 관리형 엔진에서만 사용할 수 있습니다. 설교 생성의 개인 AI 연결에는 영향이 없습니다.",
        code: "custom_agent_provider_disabled",
      },
      409,
    );
  }

  let charge: TokenCharge | null = null;
  const referenceId = `agent:${input.sessionId}:${input.messageId}`;
  if (!authenticatedUser.isDemo && db) {
    try {
      const walletCharge = await chargeTokenWallet({
        db,
        userId: authenticatedUser.id,
        referenceId,
        kind: "agent",
        cost: AI_AGENT_MESSAGE_COSTS[input.tier],
        description: `AI 에이전트 메시지 · ${input.tier}`,
        metadata: {
          sessionId: input.sessionId,
          messageId: input.messageId,
          surface: input.context.surface,
          tier: input.tier,
          pricingVersion: 1,
        },
      });
      if (!walletCharge.charged) {
        return json(
          {
            error: walletCharge.refunded
              ? "이미 종료된 메시지입니다. 새 메시지로 다시 요청해 주세요."
              : "같은 메시지가 이미 처리 중이거나 처리되었습니다.",
            code: "duplicate_message",
            wallet: await getTokenWallet(db, authenticatedUser.id),
          },
          409,
        );
      }
      charge = walletCharge;
    } catch (error) {
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
      return json({ error: "AI 에이전트 토큰을 차감하지 못했습니다." }, 503);
    }
  }

  async function refund(reason: string): Promise<TokenWalletSnapshot> {
    if (charge?.charged && db) {
      const refundArgs = {
        db,
        userId: authenticatedUser.id,
        chargeReferenceId: charge.referenceId,
        sourceKind: "agent",
        reason,
        description: "AI 에이전트 실패 자동 환불",
      } as const;
      try {
        await refundTokenWalletCharge(refundArgs);
      } catch {
        // One bounded retry covers a transient database connection failure;
        // the refund reference remains idempotent if the first call committed.
        await refundTokenWalletCharge(refundArgs).catch(() => undefined);
      }
    }
    return db ? getTokenWallet(db, authenticatedUser.id).catch(demoWallet) : demoWallet();
  }

  let usageReservation: Extract<AiAgentUsageReservation, { ok: true }> | null = null;
  if (!authenticatedUser.isDemo && db) {
    let reservation: AiAgentUsageReservation;
    try {
      reservation = await reserveAiAgentUsage(db, authenticatedUser.id);
    } catch {
      const wallet = await refund("usage_reservation_failed");
      return json(
        {
          error: "AI 에이전트 사용 순서를 확보하지 못했습니다. 잠시 후 다시 시도해 주세요.",
          code: "usage_reservation_failed",
          wallet,
        },
        503,
      );
    }
    if (!reservation.ok) {
      const wallet = await refund(`usage_${reservation.reason}`);
      return json(
        {
          error:
            reservation.reason === "daily_limit"
              ? `오늘 사용할 수 있는 AI 에이전트 ${reservation.dailyLimit}회를 모두 사용했습니다.`
              : "이미 처리 중인 AI 에이전트 요청이 있습니다. 완료하거나 중지한 뒤 다시 시도해 주세요.",
          code:
            reservation.reason === "daily_limit"
              ? "agent_daily_limit"
              : "agent_concurrent_request",
          dailyLimit: reservation.dailyLimit,
          remainingToday: reservation.remainingToday,
          wallet,
        },
        429,
      );
    }
    usageReservation = reservation;
  }

  try {
    const result = await generateAiAgentReply({
      ai,
      request: input,
      signal: request.signal,
    });
    const wallet = db && !authenticatedUser.isDemo
      ? await getTokenWallet(db, authenticatedUser.id)
      : demoWallet();
    return json({
      messageId: input.messageId,
      answer: result.answer,
      ...(result.proposal ? { proposal: result.proposal } : {}),
      wallet,
    });
  } catch (error) {
    const wallet = await refund(
      error instanceof UserAiProviderError ? error.code : "unexpected_error",
    );
    if (error instanceof UserAiProviderError) {
      return json(
        { error: error.message, code: error.code, wallet },
        error.httpStatus,
      );
    }
    return json(
      { error: "AI 에이전트 답변을 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.", wallet },
      502,
    );
  } finally {
    if (usageReservation && db) {
      // A failed release cannot create unbounded concurrency: the two-minute
      // lease expires. Daily usage intentionally remains counted on every
      // provider-bound attempt, including failure and user cancellation.
      await finishAiAgentUsage(db, usageReservation).catch(() => undefined);
    }
  }
}
