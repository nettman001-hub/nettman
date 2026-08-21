import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const validRequest = () => ({
  sessionId: "session-12345678",
  messageId: "message-12345678",
  tier: "advanced",
  context: {
    surface: "sermon.input",
    title: "설교 본문 입력",
    resourceId: "draft-12345678",
    version: 2,
    snapshot: {
      draftId: "draft-12345678",
      topic: "하나님의 사랑",
      scripture: "요한복음 3:16-18",
      notes: "청년 예배",
      options: { duration: 20, pointCount: 3 },
      generationStatus: "idle",
    },
    capabilities: ["navigate", "sermon.input.patch"],
  },
  messages: [{ role: "user", content: "본문 입력에서 빠진 점을 알려줘" }],
});

test("AI agent contract accepts bounded page context and prices every managed tier", async () => {
  const { AI_AGENT_MESSAGE_COSTS, validateAiAgentRequest } = await import(
    "../app/_lib/ai-agent-contract.ts"
  );
  assert.deepEqual(AI_AGENT_MESSAGE_COSTS, {
    basic: 1,
    advanced: 2,
    reasoning: 4,
  });
  const result = validateAiAgentRequest(validRequest());
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.value.context.surface, "sermon.input");
});

test("AI agent contract rejects cross-surface capabilities and unexpected snapshot data", async () => {
  const { validateAiAgentRequest } = await import("../app/_lib/ai-agent-contract.ts");

  const crossSurface = validRequest();
  crossSurface.context.capabilities = ["resource.generate"];
  assert.equal(validateAiAgentRequest(crossSurface).ok, false);

  const secretData = validRequest();
  secretData.context.snapshot.apiKey = "must-never-leave-browser";
  assert.equal(validateAiAgentRequest(secretData).ok, false);

  const tooLong = validRequest();
  tooLong.messages = [{ role: "user", content: "가".repeat(2_001) }];
  assert.equal(validateAiAgentRequest(tooLong).ok, false);

  const noFinalUser = validRequest();
  noFinalUser.messages = [{ role: "assistant", content: "무엇을 도와드릴까요?" }];
  assert.equal(validateAiAgentRequest(noFinalUser).ok, false);
});

test("token and admin surfaces are explicitly read-only and expose no mutation capability", async () => {
  const { validateAiAgentRequest } = await import("../app/_lib/ai-agent-contract.ts");

  const tokens = validRequest();
  tokens.context = {
    surface: "tokens",
    title: "토큰 충전",
    snapshot: {
      summary: {
        mode: "read-only",
        remaining: 180,
        used: 20,
        restriction: "AI 에이전트는 결제나 토큰 충전을 실행하지 않습니다.",
      },
    },
    capabilities: [],
  };
  assert.equal(validateAiAgentRequest(tokens).ok, true);

  const admin = validRequest();
  admin.context = {
    surface: "admin",
    title: "회원 관리",
    snapshot: {
      summary: {
        mode: "read-only",
        restriction: "관리자 변경과 회원 조치를 실행하지 않습니다.",
      },
    },
    capabilities: [],
  };
  assert.equal(validateAiAgentRequest(admin).ok, true);

  tokens.context.capabilities = ["navigate"];
  admin.context.capabilities = ["navigate"];
  assert.equal(validateAiAgentRequest(tokens).ok, false);
  assert.equal(validateAiAgentRequest(admin).ok, false);
});

test("resource page bridge keeps its richest context below the agent snapshot ceiling", async () => {
  const { validateAiAgentRequest } = await import("../app/_lib/ai-agent-contract.ts");
  const snapshot = {
    form: {
      scripture: "요한복음 3:16-18",
      manuscript: "원".repeat(10_000),
      manuscriptTruncated: true,
      aiTier: "basic",
    },
    source: { title: "설교 비평", scripture: "요한복음 3:16-18" },
    result: {
      title: "비평 결과",
      summary: "요".repeat(1_000),
      summaryTruncated: true,
      sections: Array.from({ length: 12 }, (_, index) => ({
        heading: `비평 항목 ${index + 1} ${"제".repeat(100)}`,
        content: "결".repeat(900),
        contentTruncated: true,
      })),
    },
    selection: [],
    generationStatus: "success",
  };
  const request = validRequest();
  request.tier = "basic";
  request.context = {
    surface: "critique",
    title: "설교 원고 비평",
    snapshot,
    capabilities: ["navigate", "resource.form.patch", "resource.generate"],
  };

  assert.ok(JSON.stringify(snapshot).length < 28_000);
  assert.equal(validateAiAgentRequest(request).ok, true);
});

test("AI agent output allows only requested confirmed proposals and safe navigation", async () => {
  const { validateAiAgentProviderOutput } = await import(
    "../app/_lib/ai-agent-contract.ts"
  );
  const proposal = {
    answer: "본문 범위를 보완할 수 있습니다.",
    proposal: {
      capability: "sermon.input.patch",
      title: "본문 범위 보완",
      description: "사용자가 확인하면 입력값을 보완합니다.",
      args: { patch: { scripture: "요한복음 3:16-18" } },
    },
  };
  const allowed = validateAiAgentProviderOutput(proposal, ["sermon.input.patch"]);
  assert.equal(allowed.ok, true);
  assert.equal(allowed.ok && allowed.value.proposal?.requiresConfirmation, true);
  assert.equal(validateAiAgentProviderOutput(proposal, ["navigate"]).ok, false);

  const unsafeNavigation = {
    answer: "관리 화면으로 이동합니다.",
    proposal: {
      capability: "navigate",
      title: "이동",
      description: "관리 화면으로 이동합니다.",
      args: { href: "/admin/ai" },
    },
  };
  assert.equal(validateAiAgentProviderOutput(unsafeNavigation, ["navigate"]).ok, false);

  const unknownHistoryItem = {
    answer: "설교를 엽니다.",
    proposal: {
      capability: "history.open",
      title: "설교 열기",
      description: "선택한 설교를 엽니다.",
      args: { sermonId: "not-on-this-screen" },
    },
  };
  assert.equal(
    validateAiAgentProviderOutput(unknownHistoryItem, ["history.open"], {
      surface: "history",
      snapshot: { sermons: [{ id: "sermon-on-screen" }] },
    }).ok,
    false,
  );
});

test("AI agent proposal arguments follow action-specific schemas", async () => {
  const { validateAiAgentProviderOutput } = await import(
    "../app/_lib/ai-agent-contract.ts"
  );
  const make = (capability, args) => ({
    answer: "변경안을 준비했습니다.",
    proposal: {
      capability,
      title: "변경안",
      description: "확인 후 적용할 변경안입니다.",
      args,
    },
  });
  assert.equal(
    validateAiAgentProviderOutput(
      make("sermon.options.patch", { patch: { duration: 20, pointCount: 3 } }),
      ["sermon.options.patch"],
    ).ok,
    true,
  );
  assert.equal(
    validateAiAgentProviderOutput(
      make("sermon.options.patch", { patch: { duration: "20" } }),
      ["sermon.options.patch"],
    ).ok,
    false,
  );
  assert.equal(
    validateAiAgentProviderOutput(
      make("sermon.generation.stop", { draftId: "draft-12345678" }),
      ["sermon.generation.stop"],
    ).ok,
    false,
  );
  assert.equal(
    validateAiAgentProviderOutput(
      make("resource.form.patch", { patch: { manuscript: "원고" } }),
      ["resource.form.patch"],
      { surface: "study", snapshot: {} },
    ).ok,
    false,
  );
});

test("AI agent route keeps auth, origin, token debit, refund, and managed-provider boundaries", async () => {
  const [route, server, wallet, database] = await Promise.all([
    readFile(new URL("../app/api/ai-agent/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/_lib/ai-agent-server.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/_lib/token-wallet.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/index.ts", import.meta.url), "utf8"),
  ]);

  assert.match(route, /sameOriginRequest\(request\)/);
  assert.match(route, /getRequestUserResponse\(request\)/);
  assert.match(route, /AI_AGENT_MAX_REQUEST_BYTES/);
  assert.match(route, /getManagedAiRequestConfig\(db, input\.tier\)/);
  assert.match(route, /referenceId = `agent:\$\{input\.sessionId\}:\$\{input\.messageId\}`/);
  assert.match(route, /chargeTokenWallet\(/);
  assert.match(route, /refundTokenWalletCharge\(/);
  assert.match(route, /InsufficientTokensError/);
  assert.match(route, /wallet/);
  assert.match(route, /export const maxDuration = 180/);
  assert.match(route, /reserveAiAgentUsage\(db, authenticatedUser\.id\)/);
  assert.match(route, /finishAiAgentUsage\(db, usageReservation\)/);
  assert.match(route, /agent_daily_limit/);
  assert.match(route, /agent_concurrent_request/);
  assert.ok(
    route.indexOf('ai.engine === "custom"') < route.indexOf("chargeTokenWallet({"),
    "custom agent providers must fail closed before token debit",
  );

  assert.match(server, /buildAiProviderRequest\(/);
  assert.match(server, /parseAiProviderResponse\(/);
  assert.match(server, /AbortSignal\.timeout\(PROVIDER_TIMEOUT_MS\)/);
  assert.match(server, /const PROVIDER_TIMEOUT_MS = 60_000/);
  assert.match(server, /args\.ai\.engine === "custom"/);
  assert.doesNotMatch(server, /assertCustomEndpointHasPublicDns/);
  assert.match(server, /nativeStructuredOutput = false/);
  assert.match(server, /결제, 토큰 충전, 관리자 권한·설정 변경, 삭제, 외부 전송/);
  assert.match(server, /request\.context\.surface === "sermon-helper"/);
  assert.match(server, /전체 설교 원고나 연속된 도입·본론·결론을 작성하거나 대필하지 마세요/);
  assert.match(server, /질문, 검토 의견, 연구 방향 또는 짧은 표현 대안만 제공하세요/);
  assert.doesNotMatch(server, /console\.(?:log|warn|error)\(/);

  assert.match(wallet, /export async function chargeTokenWallet/);
  assert.match(wallet, /pg_advisory_xact_lock/);
  assert.match(wallet, /ON CONFLICT\(reference_id\) DO NOTHING/);
  assert.match(wallet, /export async function refundTokenWalletCharge/);

  assert.match(database, /CREATE TABLE IF NOT EXISTS ai_agent_usage/);
  assert.match(database, /export const AI_AGENT_DAILY_LIMIT = 60/);
  assert.match(database, /export async function reserveAiAgentUsage/);
  assert.match(database, /request_count = ai_agent_usage\.request_count \+ 1/);
  assert.match(database, /export async function finishAiAgentUsage/);
  assert.match(database, /Daily usage is intentionally never refunded/);
});

test("workspace shell keeps account tools in the top bar and toggles one accessible agent panel", async () => {
  const [shell, panel, provider] = await Promise.all([
    readFile(new URL("../app/_components/app-shell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/_components/ai-agent-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/_components/ai-agent-provider.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(shell, /aria-controls="ai-agent-panel"/);
  assert.match(shell, /href="\/tokens"/);
  assert.match(shell, /href: "\/my"/);
  assert.match(shell, /href: "\/notifications"/);
  assert.match(shell, /user\.isAdmin/);
  assert.match(shell, /계정과 토큰은 우측 상단에서 관리하세요/);
  assert.doesNotMatch(shell, /SETTINGS_NAV|ADMIN_NAV/);
  assert.match(shell, /min-\[1800px\]:grid-cols-\[minmax\(0,1fr\)_23\.5rem\]/);
  assert.match(shell, /headerIdentityRef\.current/);
  assert.match(shell, /headerStatusRef\.current/);
  assert.match(shell, /headerUtilitiesRef\.current/);
  assert.match(shell, /target\.inert = shouldInert/);

  assert.match(panel, /role=\{docked \? "complementary" : "dialog"\}/);
  assert.match(panel, /aria-modal=\{docked \? undefined : true\}/);
  assert.match(panel, /event\.nativeEvent\.isComposing/);
  assert.match(panel, /stopResponse/);
  assert.match(panel, /AI_AGENT_MESSAGE_COSTS\[tier\]/);
  assert.match(panel, /text-white/);

  assert.match(provider, /activePageRegistration/);
  assert.match(provider, /Object\.keys\(value\.snapshot\)\.length > 0/);
  assert.match(provider, /safeClientNavigationHref/);
  assert.match(provider, /hash \^= snapshot\.charCodeAt/);
});

test("page bridges expose bounded actions while reusing existing generation paths", async () => {
  const [options, input, alternatives, editor, resource, history] = await Promise.all([
    readFile(new URL("../app/_components/sermon-options.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/_components/sermon-input.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/_components/sermon-alternatives.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/_components/sermon-editor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/_components/sermon-resource-tool.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/history/history-client.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(options, /sermon\.options\.patch/);
  assert.match(options, /isSermonOptionsComplete/);
  assert.match(input, /sermon\.input\.patch/);
  assert.match(input, /stopSermonGenerationRun\(\)/);
  assert.match(input, /startSermonGenerationRun\(\{/);
  assert.match(alternatives, /sermon\.alternative\.select/);
  assert.match(alternatives, /draft\.alternatives\.some/);
  assert.match(editor, /sermon\.revision\.prepare/);
  assert.match(editor, /수정 지시를 입력란에 준비했습니다/);
  assert.match(resource, /resource\.form\.patch/);
  assert.match(resource, /await generate\(\)/);
  assert.match(resource, /fetch\("\/api\/sermon-resources"/);
  assert.match(resource, /AI_AGENT_RESOURCE_MANUSCRIPT_LIMIT = 10_000/);
  assert.match(resource, /AI_AGENT_RESOURCE_SECTION_LIMIT = 900/);
  assert.match(history, /history\.open/);
  assert.match(history, /data\.items\.some/);
});

test("user-area page bridges expose bounded context without privileged or outbound actions", async () => {
  const [home, consult, expert, profile, notifications, shell, contract] = await Promise.all([
    readFile(new URL("../app/home/home-recent-sermons.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/consult/consult-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/expert/expert-dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/my/profile-form.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/notifications/notification-preferences-form.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/_components/app-shell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/_lib/ai-agent-contract.ts", import.meta.url), "utf8"),
  ]);

  assert.match(home, /surface: "home"/);
  assert.match(home, /recentSermons/);
  assert.match(home, /item\.status === "complete"/);
  assert.match(home, /HOME_AGENT_DESTINATIONS\.has\(href\)/);

  assert.match(consult, /surface: "consult"/);
  assert.match(consult, /availableSermons: visibleSermons/);
  assert.match(consult, /visibleConsultations\.map/);
  assert.match(consult, /allowedConsultationHrefs\.has\(href\)/);
  assert.doesNotMatch(contract, /consult\.submit|expert\.assign|account\.patch|notifications\.patch/);

  assert.match(expert, /surface: "expert"/);
  assert.match(expert, /visibleItems\.slice|filtered\.slice\(0, 30\)/);
  assert.match(expert, /allowedHrefs\.has\(href\)/);
  assert.doesNotMatch(expert, /capabilities: \[[^\]]*assign/);

  assert.match(profile, /surface: "account"/);
  assert.match(profile, /profileCompletion/);
  assert.match(profile, /missingFields/);
  assert.doesNotMatch(profile, /capabilities: \[[^\]]*(?:save|patch)/);

  assert.match(notifications, /surface: "notifications"/);
  assert.match(notifications, /mailDeliveryEnabled/);
  assert.match(notifications, /browserDeliveryEnabled/);
  assert.doesNotMatch(notifications, /capabilities: \[[^\]]*(?:send|patch)/);

  assert.match(shell, /tokens: \{ title: "토큰 충전", surface: "tokens" \}/);
  assert.match(shell, /"admin-members": \{ title: "회원 관리", surface: "admin" \}/);
  assert.match(shell, /section\.surface === "tokens"/);
  assert.match(shell, /section\.surface === "admin"/);
  assert.match(shell, /capabilities: \[\]/);
});
