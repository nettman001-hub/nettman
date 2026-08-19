import {
  aiApiKeyEnvironmentName,
  GLOBAL_AI_SETTINGS_ID,
  readGlobalAiPreferences,
  serverAiApiKey,
} from "@/app/_lib/admin-ai";
import {
  validateAiPreferences,
  type AiPreferences,
} from "@/app/_lib/ai-config";
import {
  forbiddenResponse,
  resolveRequestUserResponse,
  unauthorizedResponse,
} from "@/app/_lib/auth-user";
import { ensureDatabase, getD1 } from "@/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE_HEADERS });
}

async function requireAdmin(request: Request) {
  const auth = await resolveRequestUserResponse(request);
  if ("response" in auth) return auth;
  const { user } = auth;
  if (!user) return { response: unauthorizedResponse() };
  if (!user.isAdmin) {
    return {
      response: forbiddenResponse("AI 엔진 설정은 관리자만 변경할 수 있습니다."),
    };
  }
  return { user };
}

export async function GET(request: Request): Promise<Response> {
  const auth = await requireAdmin(request);
  if ("response" in auth) return auth.response;
  const db = getD1();
  try {
    if (db) await ensureDatabase(db);
    const preferences = await readGlobalAiPreferences(db);
    return json({
      preferences,
      persistence: db ? "database" : "environment",
      apiKeyConfigured: Boolean(serverAiApiKey(preferences.engine)),
      apiKeyEnvironmentName: aiApiKeyEnvironmentName(preferences.engine),
    });
  } catch {
    return json({ error: "전역 AI 설정을 불러오지 못했습니다." }, 503);
  }
}

export async function PUT(request: Request): Promise<Response> {
  const auth = await requireAdmin(request);
  if ("response" in auth) return auth.response;

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 16_384) {
    return json({ error: "AI 엔진 설정 요청이 너무 큽니다." }, 413);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "AI 엔진 설정 형식을 확인해 주세요." }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: "AI 엔진 설정 형식을 확인해 주세요." }, 400);
  }
  if ("apiKey" in body) {
    return json({ error: "API 키는 관리자 화면으로 전송하지 않습니다." }, 400);
  }

  const parsed = validateAiPreferences(body);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const preferences: AiPreferences = parsed.value;
  const apiKeyConfigured = Boolean(serverAiApiKey(preferences.engine));
  if (preferences.enabled && !apiKeyConfigured && preferences.engine !== "custom") {
    return json({
      error: `${aiApiKeyEnvironmentName(preferences.engine)} 서버 비밀값을 먼저 등록해 주세요.`,
    }, 409);
  }

  const db = getD1();
  if (!db) {
    return json({ error: "전역 AI 설정 저장소에 연결할 수 없습니다." }, 503);
  }
  try {
    await ensureDatabase(db);
    const now = new Date().toISOString();
    await db
      .prepare(
        `INSERT INTO global_ai_settings
          (id, enabled, engine, endpoint, model, reasoning_effort, max_output_tokens, updated_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
          enabled = excluded.enabled,
          engine = excluded.engine,
          endpoint = excluded.endpoint,
          model = excluded.model,
          reasoning_effort = excluded.reasoning_effort,
          max_output_tokens = excluded.max_output_tokens,
          updated_by = excluded.updated_by,
          updated_at = excluded.updated_at`,
      )
      .bind(
        GLOBAL_AI_SETTINGS_ID,
        preferences.enabled ? 1 : 0,
        preferences.engine,
        preferences.endpoint,
        preferences.model,
        preferences.reasoningEffort,
        preferences.maxOutputTokens,
        auth.user.id,
        now,
      )
      .run();
    return json({
      preferences,
      persistence: "database",
      apiKeyConfigured,
      apiKeyEnvironmentName: aiApiKeyEnvironmentName(preferences.engine),
    });
  } catch {
    return json({ error: "전역 AI 설정을 저장하지 못했습니다." }, 503);
  }
}
