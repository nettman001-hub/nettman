import {
  AI_ENGINE_PRESETS,
  DEFAULT_AI_PREFERENCES,
  validateAiPreferences,
  validateAiRequestConfig,
  type AiEngine,
  type AiPreferences,
  type AiRequestConfig,
} from "@/app/_lib/ai-config";

type AppDatabase = NonNullable<ReturnType<typeof import("@/db").getD1>>;

export const GLOBAL_AI_SETTINGS_ID = "global";

const API_KEY_ENVIRONMENT: Record<AiEngine, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  gemini: "GEMINI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  custom: "CUSTOM_AI_API_KEY",
};

function runtimeValue(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

export function aiApiKeyEnvironmentName(engine: AiEngine): string {
  return API_KEY_ENVIRONMENT[engine];
}

export function serverAiApiKey(engine: AiEngine): string | undefined {
  return runtimeValue(aiApiKeyEnvironmentName(engine));
}

function environmentPreferences(): AiPreferences {
  const preset = AI_ENGINE_PRESETS.openai;
  const parsed = validateAiPreferences({
    enabled: Boolean(runtimeValue("OPENAI_API_KEY")),
    engine: "openai",
    endpoint: preset.endpoint,
    model: runtimeValue("OPENAI_MODEL") ?? preset.defaultModel,
    reasoningEffort:
      runtimeValue("OPENAI_REASONING_EFFORT") ?? preset.defaultReasoningEffort,
  });
  return parsed.ok ? parsed.value : DEFAULT_AI_PREFERENCES;
}

export async function readGlobalAiPreferences(
  db: AppDatabase | null,
): Promise<AiPreferences> {
  if (!db) return environmentPreferences();
  try {
    const row = await db
      .prepare(
        `SELECT enabled, engine, endpoint, model, reasoning_effort
         FROM global_ai_settings WHERE id = ?`,
      )
      .bind(GLOBAL_AI_SETTINGS_ID)
      .first<{
        enabled: number;
        engine: string;
        endpoint: string;
        model: string;
        reasoning_effort: string;
      }>();
    if (!row) return environmentPreferences();
    const parsed = validateAiPreferences({
      enabled: Boolean(row.enabled),
      engine: row.engine,
      endpoint: row.endpoint,
      model: row.model,
      reasoningEffort: row.reasoning_effort,
    });
    return parsed.ok ? parsed.value : DEFAULT_AI_PREFERENCES;
  } catch {
    return environmentPreferences();
  }
}

export async function getGlobalAiRequestConfig(
  db: AppDatabase | null,
): Promise<AiRequestConfig | undefined> {
  const preferences = await readGlobalAiPreferences(db);
  if (!preferences.enabled) return undefined;
  const apiKey = serverAiApiKey(preferences.engine);
  if (!apiKey && preferences.engine !== "custom") return undefined;
  const parsed = validateAiRequestConfig({ ...preferences, apiKey: apiKey ?? "" });
  return parsed.ok ? parsed.value : undefined;
}
