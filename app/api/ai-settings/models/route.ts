import {
  aiApiKeyEnvironmentName,
  serverAiApiKey,
} from "@/app/_lib/admin-ai";
import {
  validateAiEndpoint,
  validateAiEngine,
} from "@/app/_lib/ai-config";
import {
  AiModelCatalogError,
  fetchAiModelCatalog,
} from "@/app/_lib/ai-model-catalog";
import {
  resolveRequestUserResponse,
} from "@/app/_lib/auth-user";

export const runtime = "nodejs";
export const maxDuration = 20;

const MAX_REQUEST_BYTES = 16_384;
const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

class RequestBodyError extends Error {
  readonly httpStatus: number;

  constructor(message: string, httpStatus = 400) {
    super(message);
    this.name = "RequestBodyError";
    this.httpStatus = httpStatus;
  }
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE_HEADERS });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

async function readLimitedJson(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    throw new RequestBodyError("모델 목록 요청이 너무 큽니다.", 413);
  }
  if (!request.body) {
    throw new RequestBodyError("모델 목록 요청 형식을 확인해 주세요.");
  }
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let raw = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_REQUEST_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new RequestBodyError("모델 목록 요청이 너무 큽니다.", 413);
    }
    raw += decoder.decode(value, { stream: true });
  }
  raw += decoder.decode();
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new RequestBodyError("모델 목록 요청 형식을 확인해 주세요.");
  }
}

export async function POST(request: Request): Promise<Response> {
  const auth = await resolveRequestUserResponse(request);
  if ("response" in auth) return auth.response;
  const { user } = auth;
  if (!user) return json({ error: "로그인이 필요합니다." }, 401);
  if (!user.isAdmin) {
    return json({ error: "AI 모델 조회는 관리자만 사용할 수 있습니다." }, 403);
  }

  try {
    const body = await readLimitedJson(request);
    if (!isObject(body)) {
      return json({ error: "모델 목록 요청 형식을 확인해 주세요." }, 400);
    }
    const engine = validateAiEngine(body.engine);
    if (!engine.ok) return json({ error: engine.error }, 400);
    const endpoint = validateAiEndpoint(body.endpoint, engine.value);
    if (!endpoint.ok) return json({ error: endpoint.error }, 400);
    const apiKey = serverAiApiKey(engine.value) ?? "";
    if (!apiKey && engine.value !== "custom") {
      return json({
        error: `${aiApiKeyEnvironmentName(engine.value)} 서버 비밀값을 먼저 등록해 주세요.`,
      }, 409);
    }
    const models = await fetchAiModelCatalog(
      { engine: engine.value, endpoint: endpoint.value, apiKey },
      request.signal,
    );
    return json({ models });
  } catch (caught) {
    if (caught instanceof RequestBodyError) {
      return json({ error: caught.message }, caught.httpStatus);
    }
    if (caught instanceof AiModelCatalogError) {
      return json({ error: caught.message }, caught.httpStatus);
    }
    return json({ error: "AI 모델 목록을 불러오지 못했습니다." }, 502);
  }
}
