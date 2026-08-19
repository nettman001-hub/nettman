import {
  AI_ENGINE_PRESETS,
  DEFAULT_AI_PREFERENCES,
  validateAiPreferences,
  validateAiRequestConfig,
  type AiPreferences,
  type AiRequestConfig,
} from "@/app/_lib/ai-config";
import {
  AI_ENGINE_TIERS,
  type AiEngineTier,
} from "@/app/_lib/ai-engine-tiers";
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
};

export type ManagedAiRequestConfig = AiRequestConfig & {
  tier: AiEngineTier;
};

export type ManagedAiRequestConfigs = Record<
  AiEngineTier,
  ManagedAiRequestConfig | undefined
>;

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
  }));
}

function parsedPreferences(
  row: {
    enabled: number;
    engine: string;
    endpoint: string;
    model: string;
    reasoning_effort: string;
    max_output_tokens: number | null;
  } | undefined,
  tier: AiEngineTier,
): AiPreferences {
  if (!row) return defaultPreferencesForTier(tier);
  const parsed = validateAiPreferences({
    enabled: Boolean(row.enabled),
    engine: row.engine,
    endpoint: row.endpoint,
    model: row.model,
    reasoningEffort: row.reasoning_effort,
    maxOutputTokens: row.max_output_tokens,
  });
  return parsed.ok ? parsed.value : defaultPreferencesForTier(tier);
}

export async function readManagedAiEngineSettings(
  db: AppDatabase | null,
): Promise<ManagedAiEngineSetting[]> {
  if (!db) return environmentSettings();
  try {
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
        enabled: number;
        engine: string;
        endpoint: string;
        model: string;
        reasoning_effort: string;
        max_output_tokens: number | null;
        api_key_encrypted: string | null;
      }>();
    const rows = new Map(result.results.map((row) => [row.id, row]));
    const environment = await environmentSettings();
    return AI_ENGINE_TIERS.map((tier, index) => {
      const row = rows.get(tier) ?? (tier === "basic" ? rows.get(LEGACY_GLOBAL_AI_SETTINGS_ID) : undefined);
      return {
        tier,
        preferences: row
          ? parsedPreferences(row, tier)
          : environment[index].preferences,
        encryptedApiKey: row?.api_key_encrypted ?? null,
      };
    });
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

export async function getManagedAiRequestConfigs(
  db: AppDatabase | null,
): Promise<ManagedAiRequestConfigs> {
  const settings = await readManagedAiEngineSettings(db);
  const entries = await Promise.all(
    AI_ENGINE_TIERS.map(async (tier) => {
      const setting = settings.find((item) => item.tier === tier);
      if (!setting?.preferences.enabled) return [tier, undefined] as const;
      const apiKey = await resolveManagedAiApiKey(setting);
      if (!apiKey && setting.preferences.engine !== "custom") {
        return [tier, undefined] as const;
      }
      const parsed = validateAiRequestConfig({
        ...setting.preferences,
        apiKey: apiKey ?? "",
      });
      return [
        tier,
        parsed.ok ? ({ ...parsed.value, tier } satisfies ManagedAiRequestConfig) : undefined,
      ] as const;
    }),
  );
  return Object.fromEntries(entries) as ManagedAiRequestConfigs;
}
