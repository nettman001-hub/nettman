import {
  validateAiRequestConfig,
  type AiPreferences,
  type AiRequestConfig,
} from "./ai-config.ts";
import type {
  AiEngineSurface,
  AiEngineTier,
  AiEngineTierAvailability,
} from "./ai-engine-tiers.ts";

export type EvaluatedManagedAiEngine = {
  availability: AiEngineTierAvailability;
  config: (AiRequestConfig & { tier: AiEngineTier }) | undefined;
  signatureConfig:
    | Pick<
        AiRequestConfig,
        "engine" | "endpoint" | "model" | "reasoningEffort" | "maxOutputTokens"
      >
    | undefined;
};

export function failClosedPreferencesForMissingPersistedTier(
  preferences: AiPreferences,
): AiPreferences {
  return { ...preferences, enabled: false };
}

export function managedAiProviderSurfacePolicy(
  preferences: Pick<AiPreferences, "engine">,
): Record<AiEngineSurface, boolean> {
  const isUnrestrictedCustomEndpoint = preferences.engine === "custom";
  return {
    sermon: true,
    resource: true,
    agent: !isUnrestrictedCustomEndpoint,
    coach: !isUnrestrictedCustomEndpoint,
  };
}

export function evaluateManagedAiEngine(args: {
  tier: AiEngineTier;
  preferences: AiPreferences;
  configurationValid: boolean;
  apiKey: string | undefined;
}): EvaluatedManagedAiEngine {
  const parsed = args.configurationValid
    ? validateAiRequestConfig({
        ...args.preferences,
        // Readiness is evaluated independently from the administrator switch.
        enabled: true,
        apiKey: args.apiKey ?? "",
      })
    : { ok: false as const, error: "Invalid persisted configuration" };
  return {
    availability: {
      tier: args.tier,
      enabled: args.preferences.enabled,
      configured: parsed.ok,
      availableFor: managedAiProviderSurfacePolicy(args.preferences),
    },
    config:
      args.preferences.enabled && parsed.ok
        ? { ...parsed.value, tier: args.tier }
        : undefined,
    signatureConfig: args.configurationValid
      ? {
          engine: args.preferences.engine,
          endpoint: args.preferences.endpoint,
          model: args.preferences.model,
          reasoningEffort: args.preferences.reasoningEffort,
          maxOutputTokens: args.preferences.maxOutputTokens,
        }
      : undefined,
  };
}

/**
 * Keeps a broken saved credential isolated to its own tier. A decryption or
 * credential-source failure must never make otherwise healthy tiers disappear
 * from the public availability response.
 */
export async function evaluateManagedAiEngineWithApiKeyResolver(args: {
  tier: AiEngineTier;
  preferences: AiPreferences;
  configurationValid: boolean;
  resolveApiKey: () => Promise<string | undefined>;
}): Promise<EvaluatedManagedAiEngine> {
  try {
    return evaluateManagedAiEngine({
      tier: args.tier,
      preferences: args.preferences,
      configurationValid: args.configurationValid,
      apiKey: await args.resolveApiKey(),
    });
  } catch {
    const evaluated = evaluateManagedAiEngine({
      tier: args.tier,
      preferences: args.preferences,
      configurationValid: args.configurationValid,
      apiKey: undefined,
    });
    return {
      ...evaluated,
      availability: {
        ...evaluated.availability,
        configured: false,
      },
      config: undefined,
    };
  }
}

export async function selectManagedAiSettingsForRuntime<TDatabase, TSetting>(args: {
  db: TDatabase | null;
  production: boolean;
  readStrict: (db: TDatabase) => Promise<TSetting[]>;
  readEnvironment: () => Promise<TSetting[]>;
}): Promise<TSetting[]> {
  if (args.db) return args.readStrict(args.db);
  if (args.production) {
    throw new Error("Managed AI settings database is unavailable");
  }
  return args.readEnvironment();
}
