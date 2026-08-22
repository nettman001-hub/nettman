import { aiUserScope } from "@/app/_lib/ai-config";
import { isAiEngineTier } from "@/app/_lib/ai-engine-tiers";
import { getRequestUserResponse } from "@/app/_lib/auth-user";
import {
  getManagedAiRequestConfigResolution,
  managedAiEngineAccessErrorBody,
} from "@/app/_lib/managed-ai-engines";
import {
  normalizeAiScriptureReference,
  UserAiProviderError,
} from "@/app/_lib/openai-sermons";
import {
  createScriptureNormalizationGrant,
  scriptureNormalizationGrantConfigured,
} from "@/app/_lib/scripture-normalization-grant";
import type { NormalizeScriptureRequest } from "@/app/_lib/sermon-types";
import { claimManagedAiQuota, ensureDatabase, getD1 } from "@/db";

export const runtime = "nodejs";
export const maxDuration = 240;

const MAX_BODY_BYTES = 4_096;
const MAX_SCRIPTURE_INPUT_CHARACTERS = 120;

function error(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
}

function isSafeScriptureInput(value: string): boolean {
  const normalized = value.trim();
  return (
    normalized.length >= 2 &&
    normalized.length <= MAX_SCRIPTURE_INPUT_CHARACTERS &&
    ![...normalized].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    })
  );
}

export async function POST(request: Request): Promise<Response> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    return error("성경 본문 입력이 너무 깁니다.", 413);
  }

  let input: Partial<NormalizeScriptureRequest>;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
      return error("성경 본문 입력이 너무 깁니다.", 413);
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return error("성경 본문 확인 요청 형식을 확인해 주세요.");
    }
    input = parsed as Partial<NormalizeScriptureRequest>;
  } catch {
    return error("성경 본문 확인 요청 형식을 확인해 주세요.");
  }

  const auth = await getRequestUserResponse(request);
  if ("response" in auth) return auth.response;
  const { user } = auth;
  const clientUserScope =
    typeof input.clientUserScope === "string" ? input.clientUserScope : undefined;
  if (
    (user && clientUserScope !== aiUserScope(user.id)) ||
    (!user && clientUserScope !== undefined)
  ) {
    return error(
      "로그인 계정이 다른 탭에서 변경되었습니다. 새로고침 후 다시 시도해 주세요.",
      409,
    );
  }

  const scripture = typeof input.scripture === "string" ? input.scripture.trim() : "";
  const draftId = typeof input.draftId === "string" ? input.draftId.trim() : "";
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(draftId)) {
    return error("설교 작업 식별자가 올바르지 않습니다.");
  }
  if (!isSafeScriptureInput(scripture)) {
    return error("책 이름과 장·절을 120자 이하로 입력해 주세요.");
  }
  if (!isAiEngineTier(input.aiTier)) {
    return error("본문을 확인할 AI 엔진을 다시 선택해 주세요.");
  }

  if (!user) {
    return Response.json(
      {
        scripture,
        normalizedByAi: false,
        grant: null,
        grantExpiresAt: null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const db = getD1();
    if (!db && !user.isDemo) {
      return error("AI 본문 표준화를 위한 데이터베이스 연결이 준비되지 않았습니다.", 503);
    }
    if (db) await ensureDatabase(db);
    let aiResolution;
    try {
      aiResolution = await getManagedAiRequestConfigResolution(db, input.aiTier, "sermon");
    } catch {
      return Response.json(
        {
          error: "AI 엔진 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.",
          code: "ai_engine_status_unavailable",
        },
        { status: 503 },
      );
    }
    if (aiResolution.status !== "ready") {
      if (
        process.env.NODE_ENV !== "production" &&
        user.isDemo &&
        input.aiTier === "basic"
      ) {
        return Response.json(
          {
            scripture,
            normalizedByAi: false,
            grant: null,
            grantExpiresAt: null,
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      }
      return Response.json(managedAiEngineAccessErrorBody(aiResolution), { status: 409 });
    }
    const ai = aiResolution.config;
    if (!scriptureNormalizationGrantConfigured(ai.apiKey)) {
      return error(
        "AI 본문 확인 증표를 보호할 서버 비밀키가 설정되지 않았습니다.",
        503,
      );
    }
    if (db && !(await claimManagedAiQuota(db, user.id, 100))) {
      return error(
        "오늘 사용할 수 있는 AI 본문 확인 횟수에 도달했습니다. 내일 다시 시도해 주세요.",
        429,
      );
    }
    const result = await normalizeAiScriptureReference(scripture, ai, request.signal);
    if (!result) {
      return error("AI 엔진이 성경 본문 표기를 확인하지 못했습니다.", 503);
    }
    const decision = result.value;
    if (decision.status === "ambiguous") {
      return error("책 이름과 장·절을 모두 입력해 주세요. 예: 요한복음 3장 16절");
    }
    if (decision.status === "multiple") {
      return error("한 번에 한 개의 연속된 성경 본문 범위만 입력해 주세요.");
    }
    if (decision.status !== "valid" || !decision.canonical) {
      return error("성경에 존재하는 올바른 장·절 범위를 확인해 주세요.");
    }
    const grant = createScriptureNormalizationGrant({
      subject: user.id,
      draftId,
      aiTier: input.aiTier,
      scripture: decision.canonical,
      providerApiKey: ai.apiKey,
    });
    if (!grant) {
      return error("AI 본문 확인 증표를 만들지 못했습니다.", 503);
    }
    return Response.json(
      {
        scripture: decision.canonical,
        normalizedByAi: true,
        grant: grant.token,
        grantExpiresAt: grant.expiresAt,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (caught) {
    if (caught instanceof UserAiProviderError) {
      return error(caught.message, caught.httpStatus);
    }
    return error("성경 본문 표기를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.", 503);
  }
}
