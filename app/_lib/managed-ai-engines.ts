import {
  AI_ENGINE_PRESETS,
  DEFAULT_AI_PREFERENCES,
  validateAiPreferences,
  type AiPreferences,
  type AiRequestConfig,
} from "@/app/_lib/ai-config";
import {
  AI_ENGINE_TIERS,
  type AiEngineSurface,
  type AiEngineTierAvailability,
  type AiEngineTier,
} from "@/app/_lib/ai-engine-tiers";
import {
  evaluateManagedAiEngineWithApiKeyResolver,
  failClosedPreferencesForMissingPersistedTier,
  selectManagedAiSettingsForRuntime,
} from "@/app/_lib/managed-ai-engine-runtime-policy";
import {
  readGlobalAiPreferences,
  serverAiApiKey,
} from "@/app/_lib/admin-ai";
import { ensureDatabase } from "@/db";

type AppDatabase = NonNullable<ReturnType<typeof import("@/db").getD1>>;

export const LEGACY_GLOBAL_AI_SETTINGS_ID = "global";

export type ManagedAiEngineSetting = {
  tier: AiEngineTier;
  preferences: AiPreferences;
  encryptedApiKey: string | null;
  /** False only when a persisted row cannot pass the current provider validator. */
  configurationValid: boolean;
};

export type ManagedAiRequestConfig = AiRequestConfig & {
  tier: AiEngineTier;
};

export type ManagedAiRequestConfigs = Record<
  AiEngineTier,
  ManagedAiRequestConfig | undefined
>;

export type ManagedAiSignatureConfig = Pick<
  ManagedAiRequestConfig,
  "engine" | "endpoint" | "model" | "reasoningEffort" | "maxOutputTokens"
>;

export type ManagedAiSignatureConfigs = Record<
  AiEngineTier,
  ManagedAiSignatureConfig | undefined
>;

export type ManagedAiEngineRuntime = {
  tiers: AiEngineTierAvailability[];
  configs: ManagedAiRequestConfigs;
  /** Provider identity snapshot for durable-run signatures, even while disabled. */
  signatureConfigs: ManagedAiSignatureConfigs;
};

export type ManagedAiRequestConfigResolution =
  | { status: "ready"; tier: AiEngineTier; config: ManagedAiRequestConfig }
  | { status: "disabled"; tier: AiEngineTier }
  | { status: "unavailable"; tier: AiEngineTier };

export type ManagedAiEngineAccessErrorBody = {
  error: string;
  code: "ai_engine_disabled" | "ai_engine_unavailable";
  tier: AiEngineTier;
};

export type ManagedAiKeyStatus = {
  configured: boolean;
  source: "saved" | "environment" | null;
};

function runtimeValue(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

export function aiSettingsEncryptionConfigured(): boolean {
  return (runtimeValue("AI_SETTINGS_ENCRYPTION_KEY")?.length ?? 0) >= 32;
}

function defaultPreferencesForTier(tier: AiEngineTier): AiPreferences {
  if (tier === "basic") return DEFAULT_AI_PREFERENCES;
  const preset = AI_ENGINE_PRESETS.deepseek;
  return {
    enabled: Boolean(serverAiApiKey("deepseek")),
    engine: "deepseek",
    endpoint: preset.endpoint,
    model: tier === "reasoning" ? "deepseek-v4-pro" : preset.defaultModel,
    reasoningEffort: tier === "reasoning" ? "max" : preset.defaultReasoningEffort,
    maxOutputTokens: null,
  };
}

async function environmentSettings(): Promise<ManagedAiEngineSetting[]> {
  const basic = await readGlobalAiPreferences(null);
  return AI_ENGINE_TIERS.map((tier) => ({
    tier,
    preferences: tier === "basic" ? basic : defaultPreferencesForTier(tier),
    encryptedApiKey: null,
    configurationValid: true,
  }));
}

function parsedPreferences(
  row: {
    enabled: number | boolean;
    engine: string;
    endpoint: string;
    model: string;
    reasoning_effort: string;
    max_output_tokens: number | null;
  } | undefined,
  tier: AiEngineTier,
): { preferences: AiPreferences; configurationValid: boolean } {
  if (!row) {
    return {
      preferences: defaultPreferencesForTier(tier),
      configurationValid: true,
    };
  }
  const parsed = validateAiPreferences({
    enabled: Boolean(row.enabled),
    engine: row.engine,
    endpoint: row.endpoint,
    model: row.model,
    reasoningEffort: row.reasoning_effort,
    maxOutputTokens: row.max_output_tokens,
  });
  if (parsed.ok) {
    return { preferences: parsed.value, configurationValid: true };
  }
  // Keep the administrator's switch authoritative even when an old/corrupt
  // provider row no longer passes validation. Runtime resolution will report
  // configured=false instead of silently replacing it with an environment
  // provider and bypassing a saved disable.
  return {
    preferences: {
      ...defaultPreferencesForTier(tier),
      enabled: Boolean(row.enabled),
    },
    configurationValid: false,
  };
}

/**
 * A database-backed runtime treats a missing tier row as an administrator
 * configuration gap, never as permission to reactivate an environment
 * provider. The legacy `global` row is resolved before this helper is used.
 */
export function managedAiEngineSettingForMissingRow(
  tier: AiEngineTier,
): ManagedAiEngineSetting {
  return {
    tier,
    preferences: failClosedPreferencesForMissingPersistedTier(
      defaultPreferencesForTier(tier),
    ),
    encryptedApiKey: null,
    configurationValid: true,
  };
}

/**
 * Reads the persisted settings without hiding storage failures. Administrator
 * reads and writes use this variant so a failed query can never be mistaken
 * for an empty/default configuration.
 */
export async function readManagedAiEngineSettingsStrict(
  db: AppDatabase,
): Promise<ManagedAiEngineSetting[]> {
  await ensureDatabase(db);
  const result = await db
    .prepare(
      `SELECT id, enabled, engine, endpoint, model, reasoning_effort, max_output_tokens, api_key_encrypted
         FROM global_ai_settings
         WHERE id IN (?, ?, ?, ?)`,
    )
    .bind(...AI_ENGINE_TIERS, LEGACY_GLOBAL_AI_SETTINGS_ID)
    .all<{
      id: string;
      enabled: number | boolean;
      engine: string;
      endpoint: string;
      model: string;
      reasoning_effort: string;
      max_output_tokens: number | null;
      api_key_encrypted: string | null;
    }>();
  const rows = new Map(result.results.map((row) => [row.id, row]));
  return AI_ENGINE_TIERS.map((tier) => {
    const row =
      rows.get(tier) ??
      (tier === "basic"
        ? rows.get(LEGACY_GLOBAL_AI_SETTINGS_ID)
        : undefined);
    if (!row) return managedAiEngineSettingForMissingRow(tier);
    const parsed = parsedPreferences(row, tier);
    return {
      tier,
      preferences: parsed.preferences,
      encryptedApiKey: row?.api_key_encrypted ?? null,
      configurationValid: parsed.configurationValid,
    };
  });
}

/**
 * Backward-compatible settings discovery for administrator model lookup only.
 * Provider-bound inference uses getManagedAiEngineRuntime, which is strict.
 */
export async function readManagedAiEngineSettings(
  db: AppDatabase | null,
): Promise<ManagedAiEngineSetting[]> {
  if (!db) return environmentSettings();
  try {
    return await readManagedAiEngineSettingsStrict(db);
  } catch {
    return environmentSettings();
  }
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

async function apiKeyEncryptionKey(): Promise<CryptoKey> {
  const secret = runtimeValue("AI_SETTINGS_ENCRYPTION_KEY");
  if (!secret || secret.length < 32) {
    throw new Error("AI_SETTINGS_ENCRYPTION_KEY is not configured");
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(secret),
  );
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptManagedAiApiKey(apiKey: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: bytesToArrayBuffer(iv) },
    await apiKeyEncryptionKey(),
    new TextEncoder().encode(apiKey),
  );
  return `v1.${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(ciphertext))}`;
}

async function decryptManagedAiApiKey(encrypted: string): Promise<string> {
  const [version, encodedIv, encodedCiphertext] = encrypted.split(".");
  if (version !== "v1" || !encodedIv || !encodedCiphertext) {
    throw new Error("Unsupported encrypted API key");
  }
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bytesToArrayBuffer(base64UrlToBytes(encodedIv)) },
    await apiKeyEncryptionKey(),
    bytesToArrayBuffer(base64UrlToBytes(encodedCiphertext)),
  );
  return new TextDecoder().decode(plaintext);
}

export async function resolveManagedAiApiKey(
  setting: ManagedAiEngineSetting,
): Promise<string | undefined> {
  if (setting.encryptedApiKey) {
    try {
      const decrypted = await decryptManagedAiApiKey(setting.encryptedApiKey);
      if (decrypted) return decrypted;
    } catch {
      // A server environment key remains a safe operational fallback.
    }
  }
  return serverAiApiKey(setting.preferences.engine);
}

export async function managedAiKeyStatus(
  setting: ManagedAiEngineSetting,
): Promise<ManagedAiKeyStatus> {
  if (setting.encryptedApiKey) {
    try {
      if (await decryptManagedAiApiKey(setting.encryptedApiKey)) {
        return { configured: true, source: "saved" };
      }
    } catch {
      // Report the environment fallback below when available.
    }
  }
  return serverAiApiKey(setting.preferences.engine)
    ? { configured: true, source: "environment" }
    : { configured: false, source: null };
}

export async function getManagedAiRequestConfig(
  db: AppDatabase | null,
  tier: AiEngineTier = "basic",
): Promise<ManagedAiRequestConfig | undefined> {
  return (await getManagedAiRequestConfigs(db))[tier];
}

export function managedAiEngineAccessErrorBody(
  resolution: Exclude<ManagedAiRequestConfigResolution, { status: "ready" }>,
): ManagedAiEngineAccessErrorBody {
  return resolution.status === "disabled"
    ? {
        error: "선택한 AI 엔진은 관리자가 비활성화했습니다.",
        code: "ai_engine_disabled",
        tier: resolution.tier,
      }
    : {
        error: "선택한 AI 엔진의 연결 설정이 아직 준비되지 않았습니다.",
        code: "ai_engine_unavailable",
        tier: resolution.tier,
      };
}

export async function getManagedAiRequestConfigResolution(
  db: AppDatabase | null,
  tier: AiEngineTier = "basic",
  surface?: AiEngineSurface,
): Promise<ManagedAiRequestConfigResolution> {
  const runtime = await getManagedAiEngineRuntime(db);
  const availability = runtime.tiers.find((entry) => entry.tier === tier);
  const config = runtime.configs[tier];
  if (config && (!surface || availability?.availableFor[surface])) {
    return { status: "ready", tier, config };
  }
  return availability?.enabled
    ? { status: "unavailable", tier }
    : { status: "disabled", tier };
}

export async function getManagedAiEngineRuntime(
  db: AppDatabase | null,
): Promise<ManagedAiEngineRuntime> {
  // An attached database is the administrator's source of truth. Never fall
  // back to environment defaults after a storage error because that could
  // reactivate a tier the administrator explicitly disabled. DB-less local
  // development/demo remains supported through environment settings.
  const settings = await selectManagedAiSettingsForRuntime({
    db,
    production: process.env.NODE_ENV === "production",
    readStrict: readManagedAiEngineSettingsStrict,
    readEnvironment: environmentSettings,
  });
  const entries = await Promise.all(
    AI_ENGINE_TIERS.map(async (tier) => {
      const setting = settings.find((item) => item.tier === tier);
      if (!setting) {
        return {
          availability: {
            tier,
            enabled: false,
            configured: false,
            availableFor: {
              sermon: false,
              resource: false,
              agent: false,
              coach: false,
            },
          },
          config: undefined,
          signatureConfig: undefined,
        } as const;
      }
      return evaluateManagedAiEngineWithApiKeyResolver({
        tier,
        preferences: setting.preferences,
        configurationValid: setting.configurationValid,
        resolveApiKey: () => resolveManagedAiApiKey(setting),
      });
    }),
  );
  return {
    tiers: entries.map((entry) => entry.availability),
    configs: Object.fromEntries(
      entries.map((entry) => [entry.availability.tier, entry.config]),
    ) as ManagedAiRequestConfigs,
    signatureConfigs: Object.fromEntries(
      entries.map((entry) => [entry.availability.tier, entry.signatureConfig]),
    ) as ManagedAiSignatureConfigs,
  };
}

export async function getManagedAiRequestConfigs(
  db: AppDatabase | null,
): Promise<ManagedAiRequestConfigs> {
  return (await getManagedAiEngineRuntime(db)).configs;
}
