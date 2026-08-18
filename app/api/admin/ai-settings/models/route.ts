import {
  isAiEngineTier,
} from "@/app/_lib/ai-engine-tiers";
import {
  readManagedAiEngineSettings,
  resolveManagedAiApiKey,
} from "@/app/_lib/managed-ai-engines";
import {
  serverAiApiKey,
} from "@/app/_lib/admin-ai";
import {
  validateAiApiKey,
  validateAiEndpoint,
  validateAiEngine,
} from "@/app/_lib/ai-config";
import {
  AiModelCatalogError,
  fetchAiModelCatalog,
} from "@/app/_lib/ai-model-catalog";
import { resolveRequestUser } from "@/app/_lib/auth-user";
import { ensureDatabase, getD1 } from "@/db";

export const runtime = "nodejs";
export const maxDuration = 20;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
  Pragma: "no-cache",
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE_HEADERS });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export async function POST(request: Request): Promise<Response> {
  const user = await resolveRequestUser(request);
  if (!user) return json({ error: "로그인이 필요합니다." }, 401);
  if (!user.isAdmin) {
    return json({ error: "AI 모델 조회는 관리자만 사용할 수 있습니다." }, 403);
  }

  try {
    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (declaredLength > 16_384) {
      return json({ error: "모델 목록 요청이 너무 큽니다." }, 413);
    }
    const body = await request.json();
    if (!isObject(body) || !isAiEngineTier(body.tier)) {
      return json({ error: "AI 엔진 등급을 다시 선택해 주세요." }, 400);
    }
    const engine = validateAiEngine(body.engine);
    if (!engine.ok) return json({ error: engine.error }, 400);
    const endpoint = validateAiEndpoint(body.endpoint, engine.value);
    if (!endpoint.ok) return json({ error: endpoint.error }, 400);

    let apiKey: string | undefined;
    if (Object.hasOwn(body, "apiKey")) {
      const validatedKey = validateAiApiKey(body.apiKey, engine.value);
      if (!validatedKey.ok) return json({ error: validatedKey.error }, 400);
      apiKey = validatedKey.value;
    }

    if (apiKey === undefined) {
      const db = getD1();
      if (db) {
        await ensureDatabase(db);
        const settings = await readManagedAiEngineSettings(db);
        const saved = settings.find((setting) => setting.tier === body.tier);
        if (saved?.preferences.engine === engine.value) {
          apiKey = await resolveManagedAiApiKey(saved);
        }
      }
      apiKey ??= serverAiApiKey(engine.value);
    }

    if (!apiKey && engine.value !== "custom") {
      return json({ error: "이 엔진의 API 키를 먼저 입력해 주세요." }, 409);
    }
    const models = await fetchAiModelCatalog(
      { engine: engine.value, endpoint: endpoint.value, apiKey: apiKey ?? "" },
      request.signal,
    );
    return json({ models });
  } catch (caught) {
    if (caught instanceof AiModelCatalogError) {
      return json({ error: caught.message }, caught.httpStatus);
    }
    return json({ error: "AI 모델 목록을 불러오지 못했습니다." }, 502);
  }
}
