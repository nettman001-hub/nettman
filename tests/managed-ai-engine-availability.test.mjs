import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("validates the exact public three-tier availability contract", async () => {
  const { isAiEngineTierAvailabilityResponse, isAiEngineTierAvailable } = await import(
    "../app/_lib/ai-engine-tiers.ts"
  );
  const allSurfaces = {
    sermon: true,
    resource: true,
    agent: true,
    coach: true,
  };
  const valid = {
    tiers: [
      { tier: "basic", enabled: true, configured: true, availableFor: allSurfaces },
      { tier: "advanced", enabled: false, configured: true, availableFor: allSurfaces },
      { tier: "reasoning", enabled: true, configured: false, availableFor: allSurfaces },
    ],
  };
  assert.equal(isAiEngineTierAvailabilityResponse(valid), true);
  assert.equal(
    isAiEngineTierAvailabilityResponse({
      tiers: [valid.tiers[0], valid.tiers[0], valid.tiers[2]],
    }),
    false,
    "duplicate tiers must not be accepted",
  );
  assert.equal(
    isAiEngineTierAvailabilityResponse({
      tiers: valid.tiers.map((entry) =>
        entry.tier === "advanced" ? { ...entry, configured: "yes" } : entry,
      ),
    }),
    false,
  );
  assert.equal(isAiEngineTierAvailable(valid.tiers[0], "sermon"), true);
  assert.equal(isAiEngineTierAvailable(valid.tiers[1], "sermon"), false);
  assert.equal(isAiEngineTierAvailable(valid.tiers[2], "sermon"), false);
});

test("resolves persisted switches, credentials, surfaces, and storage fail-closed", async () => {
  const {
    evaluateManagedAiEngine,
    evaluateManagedAiEngineWithApiKeyResolver,
    selectManagedAiSettingsForRuntime,
  } = await import("../app/_lib/managed-ai-engine-runtime-policy.ts");
  const openai = {
    enabled: false,
    engine: "openai",
    endpoint: "https://api.openai.com/v1/responses",
    model: "gpt-5.6",
    reasoningEffort: "low",
    maxOutputTokens: null,
  };
  const disabledWithEnvironmentKey = evaluateManagedAiEngine({
    tier: "basic",
    preferences: openai,
    configurationValid: true,
    apiKey: "environment-key",
  });
  assert.equal(disabledWithEnvironmentKey.availability.enabled, false);
  assert.equal(disabledWithEnvironmentKey.availability.configured, true);
  assert.equal(disabledWithEnvironmentKey.config, undefined);

  const enabledWithoutKey = evaluateManagedAiEngine({
    tier: "advanced",
    preferences: { ...openai, enabled: true },
    configurationValid: true,
    apiKey: undefined,
  });
  assert.equal(enabledWithoutKey.availability.enabled, true);
  assert.equal(enabledWithoutKey.availability.configured, false);
  assert.equal(enabledWithoutKey.config, undefined);

  const custom = evaluateManagedAiEngine({
    tier: "reasoning",
    preferences: {
      enabled: true,
      engine: "custom",
      endpoint: "https://models.example/v1",
      model: "local-model",
      reasoningEffort: "default",
      maxOutputTokens: null,
    },
    configurationValid: true,
    apiKey: undefined,
  });
  assert.deepEqual(custom.availability.availableFor, {
    sermon: true,
    resource: true,
    agent: false,
    coach: false,
  });
  assert.ok(custom.config);

  const [brokenTier, healthyTier] = await Promise.all([
    evaluateManagedAiEngineWithApiKeyResolver({
      tier: "basic",
      preferences: { ...openai, enabled: false },
      configurationValid: true,
      resolveApiKey: async () => {
        throw new Error("stale encrypted credential");
      },
    }),
    evaluateManagedAiEngineWithApiKeyResolver({
      tier: "advanced",
      preferences: { ...openai, enabled: true },
      configurationValid: true,
      resolveApiKey: async () => "healthy-key",
    }),
  ]);
  assert.equal(brokenTier.availability.enabled, false);
  assert.equal(brokenTier.availability.configured, false);
  assert.equal(brokenTier.config, undefined);
  assert.deepEqual(brokenTier.signatureConfig, {
    engine: "openai",
    endpoint: "https://api.openai.com/v1/responses",
    model: "gpt-5.6",
    reasoningEffort: "low",
    maxOutputTokens: null,
  });
  assert.equal(healthyTier.availability.configured, true);
  assert.ok(healthyTier.config);

  let environmentReads = 0;
  await assert.rejects(
    selectManagedAiSettingsForRuntime({
      db: { id: "db" },
      production: false,
      readStrict: async () => {
        throw new Error("database down");
      },
      readEnvironment: async () => {
        environmentReads += 1;
        return ["environment"];
      },
    }),
    /database down/,
  );
  assert.equal(environmentReads, 0, "a DB read failure must never fall back to env");
  await assert.rejects(
    selectManagedAiSettingsForRuntime({
      db: null,
      production: true,
      readStrict: async () => [],
      readEnvironment: async () => ["environment"],
    }),
    /database is unavailable/,
  );
  assert.deepEqual(
    await selectManagedAiSettingsForRuntime({
      db: null,
      production: false,
      readStrict: async () => [],
      readEnvironment: async () => ["development-environment"],
    }),
    ["development-environment"],
  );
});

test("keeps missing persisted tiers disabled even when environment keys exist", async () => {
  const { failClosedPreferencesForMissingPersistedTier } = await import(
    "../app/_lib/managed-ai-engine-runtime-policy.ts"
  );
  const environmentDerivedPreferences = {
    enabled: true,
    engine: "deepseek",
    endpoint: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
    reasoningEffort: "high",
    maxOutputTokens: null,
  };
  const persistedFallback = failClosedPreferencesForMissingPersistedTier(
    environmentDerivedPreferences,
  );
  assert.equal(persistedFallback.enabled, false);
  assert.equal(persistedFallback.engine, "deepseek");
});

test("binds durable generation replay to request content independently of later engine gates", async () => {
  const {
    sermonGenerationLegacySignature,
    sermonGenerationRequestSignature,
    sermonGenerationRunRequestMatches,
    sermonGenerationSignature,
  } = await import("../app/_lib/sermon-generation-signature.ts");
  const request = {
    draftId: "draft-durable-1",
    generationId: "generation-durable-1",
    alternativePosition: 1,
    existingTitles: [],
    scripture: "요한복음 3:16-18",
    options: {
      topic: "하나님의 사랑",
      aiTier: "basic",
      aiTiers: ["basic", "basic", "basic", "basic", "basic"],
      duration: 20,
      targetCharacters: 5_000,
      tone: "위로",
      sermonType: "강해",
      audience: "청장년",
      audienceSituation: "일반",
      worshipType: "주일예배",
      pointCount: 3,
      referenceMode: "auto",
    },
    reference: { url: "", notes: "", file: null },
  };
  const basic = {
    engine: "openai",
    endpoint: "https://api.openai.com/v1/responses",
    model: "gpt-5.6",
    reasoningEffort: "low",
    maxOutputTokens: null,
  };
  const configs = { basic, advanced: undefined, reasoning: undefined };
  const stored = await sermonGenerationSignature(configs, request);
  const legacyStored = await sermonGenerationLegacySignature(configs, request);
  const requestHash = await sermonGenerationRequestSignature(request);
  assert.equal(
    legacyStored,
    "cae93bacca9c40fa60053b822bf3a85bdc161e27a67b9a98bd71a5fb1aa2c56b",
    "legacy replay hash must remain identical to the deployed v1 implementation",
  );
  assert.equal(
    await sermonGenerationLegacySignature(configs, {
      ...request,
      options: { ...request.options, worshipType: "수요예배" },
    }),
    legacyStored,
    "v1 did not include worshipType; only the v2 request identity may bind it",
  );
  assert.equal(sermonGenerationRunRequestMatches(stored, requestHash), true);

  const changedRequestHash = await sermonGenerationRequestSignature({
    ...request,
    scripture: "요한복음 3:16",
  });
  assert.equal(sermonGenerationRunRequestMatches(stored, changedRequestHash), false);
  const changedWorshipTypeHash = await sermonGenerationRequestSignature({
    ...request,
    options: { ...request.options, worshipType: "수요예배" },
  });
  assert.equal(
    sermonGenerationRunRequestMatches(stored, changedWorshipTypeHash),
    false,
  );
  assert.notEqual(
    await sermonGenerationLegacySignature(configs, {
      ...request,
      scripture: "요한복음 3:16",
    }),
    legacyStored,
  );

  const changedProviderSignature = await sermonGenerationSignature(
    { ...configs, basic: { ...basic, model: "gpt-5.6-sol" } },
    request,
  );
  assert.notEqual(changedProviderSignature, stored);
  assert.equal(
    sermonGenerationRunRequestMatches(changedProviderSignature, requestHash),
    true,
    "stored output replay stays bound to the same request even if a later provider gate changes",
  );
});

test("keeps persisted switches authoritative and public status non-secret", async () => {
  const [managed, policy, publicRoute, adminRoute, schema, bootstrap, migration] =
    await Promise.all([
      readFile(new URL("../app/_lib/managed-ai-engines.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/_lib/managed-ai-engine-runtime-policy.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/api/ai-engine-tiers/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/api/admin/ai-settings/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
      readFile(new URL("../db/index.ts", import.meta.url), "utf8"),
      readFile(new URL("../drizzle/0009_handy_james_howlett.sql", import.meta.url), "utf8"),
    ]);

  assert.match(schema, /globalAiSettings[\s\S]*enabled: integer\("enabled"/);
  assert.match(bootstrap, /CREATE TABLE IF NOT EXISTS global_ai_settings[\s\S]*enabled INTEGER NOT NULL DEFAULT 0/);
  assert.match(migration, /`enabled` integer DEFAULT false NOT NULL/);
  assert.match(adminRoute, /typeof entry\.enabled !== "boolean"/);
  assert.match(adminRoute, /enabled = excluded\.enabled/);

  assert.match(
    managed,
    /selectManagedAiSettingsForRuntime\(\{/,
  );
  assert.match(
    managed,
    /if \(!row\) return managedAiEngineSettingForMissingRow\(tier\)/,
  );
  assert.match(policy, /args\.preferences\.enabled && parsed\.ok/);
  assert.match(policy, /agent: !isUnrestrictedCustomEndpoint/);
  assert.match(managed, /code: "ai_engine_disabled"/);
  assert.match(managed, /code: "ai_engine_unavailable"/);

  assert.match(publicRoute, /export async function GET\(\)/);
  assert.match(publicRoute, /Cache-Control": "no-store"/);
  assert.match(publicRoute, /process\.env\.NODE_ENV === "production"/);
  assert.match(publicRoute, /code: "ai_engine_status_unavailable"/);
  assert.doesNotMatch(publicRoute, /getRequestUser|requireAdmin/);
  assert.doesNotMatch(publicRoute, /apiKey|encryptedApiKey|updatedBy/);
});

test("blocks disabled tiers on every authenticated inference boundary", async () => {
  const paths = [
    "../app/api/ai-agent/route.ts",
    "../app/api/sermon-helper/coach/route.ts",
    "../app/api/sermon-resources/route.ts",
    "../app/api/sermons/revise/route.ts",
    "../app/api/sermons/normalize-scripture/route.ts",
  ];
  const routes = await Promise.all(
    paths.map((path) => readFile(new URL(path, import.meta.url), "utf8")),
  );
  for (const route of routes) {
    assert.match(route, /getManagedAiRequestConfigResolution/);
    assert.match(route, /managedAiEngineAccessErrorBody/);
    assert.match(route, /ai_engine_status_unavailable/);
  }

  const generate = await readFile(
    new URL("../app/api/sermons/generate/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(generate, /getManagedAiEngineRuntime/);
  assert.match(generate, /managedAiEngineAccessErrorBody/);
  assert.match(generate, /const allowLocalDemoBasic =/);
  assert.match(generate, /process\.env\.NODE_ENV !== "production"/);
  assert.match(generate, /"sermon_generation_not_fragmented"/);
  assert.doesNotMatch(
    generate,
    /user && selectedAiTier !== "basic" && !managedAiConfigs\[selectedAiTier\]/,
  );

  const revise = routes[3];
  const normalize = routes[4];
  assert.doesNotMatch(revise, /normalizedOptions\.aiTier !== "basic" && !userAi/);
  assert.doesNotMatch(normalize, /if \(input\.aiTier === "basic"\)/);
  assert.match(normalize, /user\.isDemo &&\s*input\.aiTier === "basic"/);
});

test("filters each client surface and fails closed without erasing completed work", async () => {
  const [
    provider,
    panel,
    options,
    resource,
    helper,
    input,
    alternatives,
    editor,
    admin,
  ] = await Promise.all([
    readFile(new URL("../app/_components/ai-agent-provider.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/_components/ai-agent-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/_components/sermon-options.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/_components/sermon-resource-tool.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/sermon-helper/sermon-helper-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/_components/sermon-input.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/_components/sermon-alternatives.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/_components/sermon-editor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/ai/admin-ai-engine-settings-form.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(provider, /fetch\("\/api\/ai-engine-tiers"[\s\S]*cache: "no-store"/);
  assert.match(provider, /const registerWorkspace[\s\S]*void reloadEngineAvailability\(\)/);
  assert.doesNotMatch(
    provider,
    /useEffect\(\(\) => \{\s*void reloadEngineAvailability\(\);\s*\}, \[reloadEngineAvailability\]\)/,
    "the root provider must not query the DB on public pages without AppShell",
  );
  assert.match(provider, /availableEngineTiersFor\("agent"\)/);
  assert.match(panel, /AI_ENGINE_TIERS\.map/);
  assert.match(panel, /disabled=\{!available\}/);
  assert.match(panel, /사용중지/);

  assert.match(options, /availableEngineTiersFor\("sermon", isGuest\)/);
  assert.match(options, /normalizeSermonAiTiers\(\{ aiTier: fallbackTier \}\)/);
  assert.match(options, /AI_ENGINE_TIERS\.map/);
  assert.match(options, /sermon-engine-disabled-badge/);
  assert.match(resource, /availableEngineTiersFor\("resource"\)/);
  assert.match(resource, /AI_ENGINE_TIERS\.map/);
  assert.match(resource, /사용중지/);
  assert.match(resource, /setAiTier\(selectableEngineTiers\[0\]!\)/);
  assert.doesNotMatch(
    resource,
    /setAiTier\(selectableEngineTiers\[0\]!\);\s*setResult\(null\)/,
    "an availability refresh must not erase an already generated result",
  );

  assert.match(helper, /availableEngineTiersFor\("coach"\)/);
  assert.match(helper, /AI_ENGINE_TIERS\.map/);
  assert.match(helper, /if \(!recovered && !newRequestEngineReady\)/);
  assert.match(helper, /disabled=\{!storedRetry && !newRequestEngineReady\}/);
  assert.match(helper, /body\.code === "ai_engine_status_unavailable"[\s\S]*onEngineAvailabilityInvalidated/);

  for (const source of [input, alternatives, editor]) {
    assert.match(source, /isEngineTierAvailableFor\(draft\.options\.aiTier, "sermon", isGuest\)/);
    assert.match(source, /reloadEngineAvailability/);
    assert.match(source, /옵션에서 엔진 선택/);
  }
  assert.match(input, /selectedEngineReady \|\| hasDurableGenerationProgress/);
  assert.match(alternatives, /selectedEngineReady \|\| hasDurableGenerationProgress/);
  assert.doesNotMatch(
    alternatives.match(/const choose = \(\) => \{[\s\S]*?\n {2}\};/)?.[0] ?? "",
    /selectedEngineReady/,
    "an engine switch must not block choosing an already generated sermon",
  );

  assert.match(admin, /role="switch"/);
  assert.match(admin, /사용자에게 제공/);
  assert.match(admin, /비활성화하면 저장 후 사용자 선택 목록에서 숨깁니다/);
  assert.match(admin, /void reloadEngineAvailability\(\)/);
});
