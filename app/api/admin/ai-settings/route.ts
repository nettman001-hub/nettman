import {
  AI_ENGINE_TIERS,
  AI_ENGINE_TIER_META,
  isAiEngineTier,
  type AiEngineTier,
} from "@/app/_lib/ai-engine-tiers";
import {
  aiSettingsEncryptionConfigured,
  encryptManagedAiApiKey,
  managedAiKeyStatus,
  readManagedAiEngineSettings,
  resolveManagedAiApiKey,
  type ManagedAiEngineSetting,
} from "@/app/_lib/managed-ai-engines";
import {
  aiApiKeyEnvironmentName,
} from "@/app/_lib/admin-ai";
import {
  validateAiApiKey,
  validateAiPreferences,
  type AiPreferences,
} from "@/app/_lib/ai-config";
import {
  forbiddenResponse,
  resolveRequestUser,
  unauthorizedResponse,
} from "@/app/_lib/auth-user";
import { ensureDatabase, getD1 } from "@/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

async function requireAdmin(request: Request) {
  const user = await resolveRequestUser(request);
  if (!user) return { response: unauthorizedResponse() };
  if (!user.isAdmin) {
    return {
      response: forbiddenResponse("AI 엔진 설정은 관리자만 변경할 수 있습니다."),
    };
  }
  return { user };
}

async function responseSettings(
  settings: ManagedAiEngineSetting[],
): Promise<object[]> {
  return Promise.all(
    settings.map(async (setting) => {
      const keyStatus = await managedAiKeyStatus(setting);
      return {
        tier: setting.tier,
        preferences: setting.preferences,
        apiKeyConfigured: keyStatus.configured,
        apiKeySource: keyStatus.source,
        apiKeyEnvironmentName: aiApiKeyEnvironmentName(
          setting.preferences.engine,
        ),
      };
    }),
  );
}

export async function GET(request: Request): Promise<Response> {
  const auth = await requireAdmin(request);
  if ("response" in auth && auth.response) return auth.response;
  const db = getD1();
  if (!db) {
    return json({ error: "AI 엔진 설정 저장소에 연결할 수 없습니다." }, 503);
  }
  try {
    await ensureDatabase(db);
    const settings = await readManagedAiEngineSettings(db);
    return json({
      settings: await responseSettings(settings),
      persistence: "database",
      encryptionConfigured: aiSettingsEncryptionConfigured(),
    });
  } catch {
    return json({ error: "AI 엔진 설정을 불러오지 못했습니다." }, 503);
  }
}

type ParsedSetting = {
  tier: AiEngineTier;
  preferences: AiPreferences;
  apiKey: string | null;
  clearApiKey: boolean;
};

function parseSettings(body: Record<string, unknown>):
  | { ok: true; value: ParsedSetting[] }
  | { ok: false; error: string } {
  if (!Array.isArray(body.settings) || body.settings.length !== AI_ENGINE_TIERS.length) {
    return { ok: false, error: "세 가지 AI 엔진 설정을 모두 입력해 주세요." };
  }
  const parsed: ParsedSetting[] = [];
  const tiers = new Set<AiEngineTier>();
  for (const entry of body.settings) {
    if (!isObject(entry) || !isAiEngineTier(entry.tier)) {
      return { ok: false, error: "AI 엔진 등급을 다시 선택해 주세요." };
    }
    if (tiers.has(entry.tier)) {
      return { ok: false, error: "같은 AI 엔진 등급을 중복 저장할 수 없습니다." };
    }
    tiers.add(entry.tier);
    const preferences = validateAiPreferences(entry);
    if (!preferences.ok) return preferences;

    let apiKey: string | null = null;
    if (entry.apiKey !== undefined && entry.apiKey !== null && entry.apiKey !== "") {
      const validatedKey = validateAiApiKey(entry.apiKey, preferences.value.engine);
      if (!validatedKey.ok) return validatedKey;
      apiKey = validatedKey.value;
    }
    parsed.push({
      tier: entry.tier,
      preferences: preferences.value,
      apiKey,
      clearApiKey: entry.clearApiKey === true,
    });
  }
  return { ok: true, value: parsed };
}

export async function PUT(request: Request): Promise<Response> {
  const auth = await requireAdmin(request);
  if ("response" in auth && auth.response) return auth.response;

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 65_536) {
    return json({ error: "AI 엔진 설정 요청이 너무 큽니다." }, 413);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "AI 엔진 설정 형식을 확인해 주세요." }, 400);
  }
  if (!isObject(body)) {
    return json({ error: "AI 엔진 설정 형식을 확인해 주세요." }, 400);
  }
  const parsed = parseSettings(body);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  if (
    parsed.value.some((setting) => Boolean(setting.apiKey)) &&
    !aiSettingsEncryptionConfigured()
  ) {
    return json({
      error: "API 키 암호화 비밀값이 준비되지 않았습니다. 관리자에게 문의해 주세요.",
    }, 503);
  }

  const db = getD1();
  if (!db) {
    return json({ error: "AI 엔진 설정 저장소에 연결할 수 없습니다." }, 503);
  }

  try {
    await ensureDatabase(db);
    const current = await readManagedAiEngineSettings(db);
    const currentByTier = new Map(current.map((setting) => [setting.tier, setting]));
    const prepared: ManagedAiEngineSetting[] = [];

    for (const setting of parsed.value) {
      const existing = currentByTier.get(setting.tier);
      const engineChanged =
        Boolean(existing) &&
        existing?.preferences.engine !== setting.preferences.engine;
      let encryptedApiKey =
        setting.clearApiKey || engineChanged
          ? null
          : existing?.encryptedApiKey ?? null;
      if (setting.apiKey) {
        encryptedApiKey = await encryptManagedAiApiKey(setting.apiKey);
      }
      const next: ManagedAiEngineSetting = {
        tier: setting.tier,
        preferences: setting.preferences,
        encryptedApiKey,
      };
      const resolvedKey = setting.apiKey ?? await resolveManagedAiApiKey(next);
      if (
        setting.preferences.enabled &&
        setting.preferences.engine !== "custom" &&
        !resolvedKey
      ) {
        return json({
          error: `${AI_ENGINE_TIER_META[setting.tier].label}의 API 키를 등록해 주세요.`,
        }, 409);
      }
      prepared.push(next);
    }

    const now = new Date().toISOString();
    await db.batch(
      prepared.map((setting) =>
        db
          .prepare(
            `INSERT INTO global_ai_settings
              (id, enabled, engine, endpoint, model, reasoning_effort, max_output_tokens,
               api_key_encrypted, updated_by, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
              enabled = excluded.enabled,
              engine = excluded.engine,
              endpoint = excluded.endpoint,
              model = excluded.model,
              reasoning_effort = excluded.reasoning_effort,
              max_output_tokens = excluded.max_output_tokens,
              api_key_encrypted = excluded.api_key_encrypted,
              updated_by = excluded.updated_by,
              updated_at = excluded.updated_at`,
          )
          .bind(
            setting.tier,
            setting.preferences.enabled ? 1 : 0,
            setting.preferences.engine,
            setting.preferences.endpoint,
            setting.preferences.model,
            setting.preferences.reasoningEffort,
            setting.preferences.maxOutputTokens,
            setting.encryptedApiKey,
            auth.user.id,
            now,
          ),
      ),
    );

    const saved = await readManagedAiEngineSettings(db);
    return json({
      settings: await responseSettings(saved),
      persistence: "database",
      encryptionConfigured: aiSettingsEncryptionConfigured(),
    });
  } catch {
    return json({ error: "AI 엔진 설정을 저장하지 못했습니다." }, 503);
  }
}
