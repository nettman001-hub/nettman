import { aiApiKeyEnvironmentName } from "@/app/_lib/admin-ai";
import type { AiEngineTier } from "@/app/_lib/ai-engine-tiers";
import type { AiPreferences } from "@/app/_lib/ai-config";
import {
  aiSettingsEncryptionConfigured,
  managedAiKeyStatus,
  readManagedAiEngineSettingsStrict,
  type ManagedAiEngineSetting,
} from "@/app/_lib/managed-ai-engines";
import { getD1 } from "@/db";

type AppDatabase = NonNullable<ReturnType<typeof getD1>>;

const VIEW_DEADLINE_MS = 15_000;

export type AdminAiSettingView = {
  tier: AiEngineTier;
  preferences: AiPreferences;
  apiKeyConfigured: boolean;
  apiKeySource: "saved" | "environment" | null;
  apiKeyEnvironmentName: string;
};

export type AdminAiSettingsView = {
  settings: AdminAiSettingView[];
  persistence: "database";
  encryptionConfigured: boolean;
};

export type AdminAiSettingsInitialState =
  | { ok: true; view: AdminAiSettingsView }
  | { ok: false; error: string };

/**
 * Builds the administrator-facing allowlist. Encrypted and plaintext API key
 * material is deliberately excluded from this view.
 */
export async function adminAiSettingsViewFromSettings(
  settings: ManagedAiEngineSetting[],
): Promise<AdminAiSettingsView> {
  return {
    settings: await Promise.all(
      settings.map(async (setting) => {
        const keyStatus = await managedAiKeyStatus(setting);
        return {
          tier: setting.tier,
          preferences: {
            enabled: setting.preferences.enabled,
            engine: setting.preferences.engine,
            endpoint: setting.preferences.endpoint,
            model: setting.preferences.model,
            reasoningEffort: setting.preferences.reasoningEffort,
            maxOutputTokens: setting.preferences.maxOutputTokens,
          },
          apiKeyConfigured: keyStatus.configured,
          apiKeySource: keyStatus.source,
          apiKeyEnvironmentName: aiApiKeyEnvironmentName(
            setting.preferences.engine,
          ),
        };
      }),
    ),
    persistence: "database",
    encryptionConfigured: aiSettingsEncryptionConfigured(),
  };
}

export async function loadAdminAiSettingsView(
  db: AppDatabase,
): Promise<AdminAiSettingsView> {
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const load = (async () => {
    return adminAiSettingsViewFromSettings(
      await readManagedAiEngineSettingsStrict(db),
    );
  })();
  try {
    return await Promise.race([
      load,
      new Promise<never>((_resolve, reject) => {
        deadline = setTimeout(
          () => reject(new Error("Admin AI settings view timed out")),
          VIEW_DEADLINE_MS,
        );
      }),
    ]);
  } finally {
    if (deadline) clearTimeout(deadline);
  }
}
