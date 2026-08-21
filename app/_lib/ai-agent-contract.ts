import {
  AI_ENGINE_TIERS,
  isAiEngineTier,
  type AiEngineTier,
} from "./ai-engine-tiers.ts";
import type { TokenWalletSnapshot } from "./token-wallet.ts";

export const AI_AGENT_SURFACES = [
  "home",
  "sermon",
  "sermon.options",
  "sermon.input",
  "sermon.alternatives",
  "sermon.edit",
  "sermon.complete",
  "history",
  "history.detail",
  "study",
  "critique",
  "ministry",
  "consult",
  "expert",
  "account",
  "notifications",
  "tokens",
  "admin",
] as const;

export type AiAgentSurface = (typeof AI_AGENT_SURFACES)[number];

/**
 * Capabilities are deliberately product-level intents, not arbitrary HTTP or
 * DOM commands. A page may expose only a subset and must still confirm a
 * proposal before executing it.
 */
export const AI_AGENT_CAPABILITIES = [
  "navigate",
  "sermon.options.patch",
  "sermon.input.patch",
  "sermon.alternative.select",
  "sermon.generation.stop",
  "sermon.revision.prepare",
  "resource.form.patch",
  "resource.generate",
  "history.open",
] as const;

export type AiAgentCapability = (typeof AI_AGENT_CAPABILITIES)[number];

export const AI_AGENT_CAPABILITY_ARGUMENT_GUIDE: Record<AiAgentCapability, string> = {
  navigate: '{"href":"/허용된-앱-경로"}',
  "sermon.options.patch":
    '{"patch":{"topic?":"문자열","duration?":10|15|20|25|30,"sermonType?":"강해|주제|내러티브","worshipType?":"문자열","pointCount?":1|2|3|4,"audience?":"문자열","audienceSituation?":"문자열","tone?":"문자열","referenceMode?":"auto|manual","aiTier?":"basic|advanced|reasoning"}}',
  "sermon.input.patch":
    '{"patch":{"scripture?":"문자열","notes?":"문자열","url?":"http(s) URL"}}',
  "sermon.alternative.select": '{"alternativeId":"현재 화면에 있는 대안 ID"}',
  "sermon.generation.stop": "{}",
  "sermon.revision.prepare":
    '{"section":"introduction|body|conclusion|application","instruction":"10~1000자","toneAdjustment?":"100자 이하"}',
  "resource.form.patch":
    'study={"patch":{"scripture?":"문자열","notes?":"문자열","selections?":[],"aiTier?":"등급"}}; critique={"patch":{"manuscript?":"문자열","scripture?":"문자열","aiTier?":"등급"}}; ministry={"patch":{"sermonId?":"ID","selections?":[],"aiTier?":"등급"}}',
  "resource.generate": "{}",
  "history.open": '{"sermonId":"현재 화면에 있는 설교 ID"}',
};

export const AI_AGENT_MESSAGE_COSTS: Record<AiEngineTier, number> = {
  basic: 1,
  advanced: 2,
  reasoning: 4,
};

// Korean UTF-8 text may use three bytes per character. This still caps the
// entire request while allowing the bounded 28k-character sermon snapshot and
// recent conversation to coexist.
export const AI_AGENT_MAX_REQUEST_BYTES = 128 * 1024;
export const AI_AGENT_MAX_PROVIDER_RESPONSE_BYTES = 64 * 1024;
export const AI_AGENT_MAX_MESSAGES = 12;
export const AI_AGENT_MAX_MESSAGE_CHARACTERS = 2_000;

const SURFACE_CAPABILITIES: Record<AiAgentSurface, readonly AiAgentCapability[]> = {
  home: ["navigate", "history.open"],
  sermon: ["navigate", "sermon.generation.stop"],
  "sermon.options": ["navigate", "sermon.options.patch", "sermon.generation.stop"],
  "sermon.input": ["navigate", "sermon.input.patch", "sermon.generation.stop"],
  "sermon.alternatives": [
    "navigate",
    "sermon.alternative.select",
    "sermon.generation.stop",
  ],
  "sermon.edit": ["navigate", "sermon.revision.prepare", "sermon.generation.stop"],
  "sermon.complete": ["navigate", "sermon.revision.prepare"],
  history: ["navigate", "history.open"],
  "history.detail": ["navigate", "history.open", "sermon.revision.prepare"],
  study: ["navigate", "resource.form.patch", "resource.generate", "history.open"],
  critique: ["navigate", "resource.form.patch", "resource.generate", "history.open"],
  ministry: ["navigate", "resource.form.patch", "resource.generate", "history.open"],
  consult: ["navigate", "history.open"],
  expert: ["navigate"],
  account: ["navigate"],
  notifications: ["navigate"],
  tokens: [],
  admin: [],
};

/** Only these top-level page values may leave the browser for each surface. */
const SURFACE_SNAPSHOT_KEYS: Record<AiAgentSurface, readonly string[]> = {
  home: ["summary", "generationStatus", "recentSermons"],
  sermon: ["draftId", "step", "generationStatus"],
  "sermon.options": ["draftId", "options", "completion", "validation", "generationStatus"],
  "sermon.input": ["draftId", "topic", "scripture", "notes", "options", "generationStatus"],
  "sermon.alternatives": [
    "draftId",
    "options",
    "alternatives",
    "selectedAlternativeId",
    "generationStatus",
  ],
  "sermon.edit": [
    "draftId",
    "sermon",
    "options",
    "revisionCount",
    "selectedSection",
    "generationStatus",
  ],
  "sermon.complete": ["draftId", "sermon", "options"],
  history: ["query", "filters", "sermons"],
  "history.detail": ["sermonId", "sermon", "alternatives", "selectedAlternativeId"],
  study: ["form", "source", "result", "selection", "generationStatus"],
  critique: ["form", "source", "result", "selection", "generationStatus"],
  ministry: ["form", "source", "result", "selection", "generationStatus"],
  consult: ["form", "consultations", "selectedConsultation"],
  expert: ["filters", "experts", "selectedExpert"],
  account: ["profileCompletion"],
  notifications: ["preferences"],
  tokens: ["summary"],
  admin: ["summary"],
};

export type AiAgentPageContext = {
  surface: AiAgentSurface;
  title: string;
  resourceId?: string;
  version?: string | number;
  snapshot: Record<string, unknown>;
  capabilities: readonly AiAgentCapability[];
};

export type AiAgentMessageRole = "user" | "assistant";

export type AiAgentMessage = {
  id: string;
  role: AiAgentMessageRole;
  content: string;
  proposal?: AgentActionProposal;
  createdAt?: string;
};

export type AiAgentRequestMessage = Pick<AiAgentMessage, "role" | "content">;

export type AgentActionProposal = {
  id: string;
  capability: AiAgentCapability;
  title: string;
  description: string;
  args: Record<string, unknown>;
  requiresConfirmation: true;
};

export type AiAgentApiRequest = {
  sessionId: string;
  messageId: string;
  tier: AiEngineTier;
  context: AiAgentPageContext;
  messages: AiAgentRequestMessage[];
};

export type AiAgentApiResponse = {
  messageId: string;
  answer: string;
  proposal?: AgentActionProposal;
  wallet: TokenWalletSnapshot;
};

export type AiAgentValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

type JsonObject = Record<string, unknown>;

const FORBIDDEN_CONTEXT_KEY =
  /(?:admin|api.?key|secret|password|credential|access.?token|refresh.?token|authorization|cookie|payment|checkout|email|phone)/i;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function isAiAgentSurface(value: unknown): value is AiAgentSurface {
  return typeof value === "string" && (AI_AGENT_SURFACES as readonly string[]).includes(value);
}

export function isAiAgentCapability(value: unknown): value is AiAgentCapability {
  return typeof value === "string" && (AI_AGENT_CAPABILITIES as readonly string[]).includes(value);
}

function safeIdentifier(value: unknown): value is string {
  // Keeps `agent:<session>:<message>` below the wallet reference limit.
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,80}$/.test(value);
}

function hasUnsafeControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return (code <= 31 && code !== 9 && code !== 10 && code !== 13) || code === 127;
  });
}

function boundedText(value: unknown, max: number, allowEmpty = false): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (
    (!allowEmpty && !normalized) ||
    normalized.length > max ||
    hasUnsafeControlCharacters(normalized)
  ) {
    return null;
  }
  return normalized;
}

function sanitizeJsonValue(value: unknown, depth = 0): unknown | undefined {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") return boundedText(value, 12_000, true) ?? undefined;
  if (depth >= 5) return undefined;
  if (Array.isArray(value)) {
    if (value.length > 40) return undefined;
    const sanitized = value.map((item) => sanitizeJsonValue(item, depth + 1));
    return sanitized.some((item) => item === undefined) ? undefined : sanitized;
  }
  if (!isObject(value) || Object.keys(value).length > 60) return undefined;
  const sanitized: JsonObject = {};
  for (const [key, nested] of Object.entries(value)) {
    if (
      !/^[A-Za-z0-9가-힣._-]{1,64}$/.test(key) ||
      FORBIDDEN_CONTEXT_KEY.test(key)
    ) {
      return undefined;
    }
    const next = sanitizeJsonValue(nested, depth + 1);
    if (next === undefined) return undefined;
    sanitized[key] = next;
  }
  return sanitized;
}

function sanitizeSnapshot(
  surface: AiAgentSurface,
  value: unknown,
): AiAgentValidationResult<Record<string, unknown>> {
  if (!isObject(value)) return { ok: false, error: "현재 화면 정보 형식을 확인해 주세요." };
  const allowed = new Set(SURFACE_SNAPSHOT_KEYS[surface]);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    return { ok: false, error: "현재 화면에서 AI에 전달할 수 없는 정보가 포함되어 있습니다." };
  }
  const sanitized = sanitizeJsonValue(value);
  if (!isObject(sanitized) || JSON.stringify(sanitized).length > 28_000) {
    return { ok: false, error: "현재 화면 정보가 너무 크거나 형식이 올바르지 않습니다." };
  }
  return { ok: true, value: sanitized };
}

export function validateAiAgentRequest(value: unknown): AiAgentValidationResult<AiAgentApiRequest> {
  if (!isObject(value)) return { ok: false, error: "AI 에이전트 요청 형식을 확인해 주세요." };
  if (!safeIdentifier(value.sessionId) || !safeIdentifier(value.messageId)) {
    return { ok: false, error: "AI 에이전트 대화 식별자를 확인해 주세요." };
  }
  if (!isAiEngineTier(value.tier)) {
    return { ok: false, error: "사용할 AI 엔진 등급을 다시 선택해 주세요." };
  }
  if (!isObject(value.context) || !isAiAgentSurface(value.context.surface)) {
    return { ok: false, error: "현재 화면을 AI 에이전트에 연결하지 못했습니다." };
  }
  const surface = value.context.surface;
  const title = boundedText(value.context.title, 120);
  if (!title) return { ok: false, error: "현재 화면 제목을 확인해 주세요." };
  const resourceId = value.context.resourceId === undefined
    ? undefined
    : boundedText(value.context.resourceId, 120);
  if (value.context.resourceId !== undefined && !resourceId) {
    return { ok: false, error: "현재 작업 식별자를 확인해 주세요." };
  }
  const rawVersion = value.context.version;
  const version = rawVersion === undefined
    ? undefined
    : typeof rawVersion === "number" && Number.isSafeInteger(rawVersion)
      ? rawVersion
      : boundedText(rawVersion, 80);
  if (rawVersion !== undefined && version === null) {
    return { ok: false, error: "현재 작업 버전을 확인해 주세요." };
  }
  if (!Array.isArray(value.context.capabilities) || value.context.capabilities.length > 9) {
    return { ok: false, error: "현재 화면에서 허용할 AI 기능을 확인해 주세요." };
  }
  const surfaceAllowed = new Set(SURFACE_CAPABILITIES[surface]);
  const capabilities: AiAgentCapability[] = [];
  for (const capability of value.context.capabilities) {
    if (!isAiAgentCapability(capability) || !surfaceAllowed.has(capability)) {
      return { ok: false, error: "현재 화면에서 허용되지 않은 AI 기능이 포함되어 있습니다." };
    }
    if (!capabilities.includes(capability)) capabilities.push(capability);
  }
  const snapshot = sanitizeSnapshot(surface, value.context.snapshot);
  if (!snapshot.ok) return snapshot;
  if (!Array.isArray(value.messages) || value.messages.length < 1 || value.messages.length > AI_AGENT_MAX_MESSAGES) {
    return { ok: false, error: "AI 에이전트 대화는 최근 메시지만 전송해 주세요." };
  }
  const messages: AiAgentRequestMessage[] = [];
  let totalCharacters = 0;
  for (const message of value.messages) {
    if (!isObject(message) || (message.role !== "user" && message.role !== "assistant")) {
      return { ok: false, error: "AI 에이전트 메시지 형식을 확인해 주세요." };
    }
    const content = boundedText(message.content, AI_AGENT_MAX_MESSAGE_CHARACTERS);
    if (!content) return { ok: false, error: "AI 에이전트 메시지는 2,000자 이하로 입력해 주세요." };
    totalCharacters += content.length;
    messages.push({ role: message.role, content });
  }
  if (messages.at(-1)?.role !== "user" || totalCharacters > 12_000) {
    return { ok: false, error: "마지막 사용자 메시지와 대화 길이를 확인해 주세요." };
  }
  return {
    ok: true,
    value: {
      sessionId: value.sessionId,
      messageId: value.messageId,
      tier: value.tier,
      context: {
        surface,
        title,
        ...(resourceId ? { resourceId } : {}),
        ...(version !== undefined && version !== null ? { version } : {}),
        snapshot: snapshot.value,
        capabilities,
      },
      messages,
    },
  };
}

const FORBIDDEN_ARGUMENT_KEY = /(admin|api.?key|secret|password|credential|payment|checkout|top.?up|delete|webhook|external|email|phone)/i;

function proposalArguments(value: unknown): Record<string, unknown> | null {
  if (!isObject(value) || Object.keys(value).some((key) => FORBIDDEN_ARGUMENT_KEY.test(key))) {
    return null;
  }
  const sanitized = sanitizeJsonValue(value);
  if (!isObject(sanitized) || JSON.stringify(sanitized).length > 6_000) return null;
  return sanitized;
}

function safeNavigationHref(value: unknown): boolean {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return false;
  try {
    const url = new URL(value, "https://app.local");
    if (url.origin !== "https://app.local") return false;
    return !/^\/(?:api|admin|auth|tokens)(?:\/|$)/.test(url.pathname);
  } catch {
    return false;
  }
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function optionalText(value: unknown, max: number): boolean {
  return value === undefined || boundedText(value, max, true) !== null;
}

function validOptionsPatch(args: Record<string, unknown>): boolean {
  if (!hasOnlyKeys(args, ["patch"]) || !isObject(args.patch)) return false;
  const patch = args.patch;
  const keys = [
    "topic",
    "duration",
    "sermonType",
    "worshipType",
    "pointCount",
    "audience",
    "audienceSituation",
    "tone",
    "referenceMode",
    "aiTier",
  ] as const;
  if (!Object.keys(patch).length || !hasOnlyKeys(patch, keys)) return false;
  if (!optionalText(patch.topic, 100)) return false;
  if (patch.duration !== undefined && (typeof patch.duration !== "number" || ![10, 15, 20, 25, 30].includes(patch.duration))) return false;
  if (patch.sermonType !== undefined && !["강해", "주제", "내러티브"].includes(String(patch.sermonType))) return false;
  if (!optionalText(patch.worshipType, 80)) return false;
  if (patch.pointCount !== undefined && (typeof patch.pointCount !== "number" || ![1, 2, 3, 4].includes(patch.pointCount))) return false;
  if (!optionalText(patch.audience, 40) || !optionalText(patch.audienceSituation, 40) || !optionalText(patch.tone, 40)) return false;
  if (patch.referenceMode !== undefined && patch.referenceMode !== "auto" && patch.referenceMode !== "manual") return false;
  return patch.aiTier === undefined || isAiEngineTier(patch.aiTier);
}

function validInputPatch(args: Record<string, unknown>): boolean {
  if (!hasOnlyKeys(args, ["patch"]) || !isObject(args.patch)) return false;
  const patch = args.patch;
  if (!Object.keys(patch).length || !hasOnlyKeys(patch, ["scripture", "notes", "url"])) return false;
  if (!optionalText(patch.scripture, 120) || !optionalText(patch.notes, 12_000)) return false;
  if (patch.url === undefined || patch.url === "") return true;
  if (typeof patch.url !== "string" || patch.url.length > 2_048) return false;
  try {
    const url = new URL(patch.url);
    return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password;
  } catch {
    return false;
  }
}

function validStringArray(value: unknown): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.length <= 12 &&
      value.every((item) => boundedText(item, 80) !== null))
  );
}

function validResourcePatch(
  args: Record<string, unknown>,
  surface?: AiAgentSurface,
): boolean {
  if (!hasOnlyKeys(args, ["patch"]) || !isObject(args.patch) || !Object.keys(args.patch).length) return false;
  const patch = args.patch;
  const allowed = surface === "study"
    ? ["scripture", "notes", "selections", "aiTier"]
    : surface === "critique"
      ? ["manuscript", "scripture", "aiTier"]
      : surface === "ministry"
        ? ["sermonId", "selections", "aiTier"]
        : ["scripture", "notes", "manuscript", "sermonId", "selections", "aiTier"];
  if (!hasOnlyKeys(patch, allowed)) return false;
  if (!optionalText(patch.scripture, 200) || !optionalText(patch.notes, 2_000) || !optionalText(patch.manuscript, 24_000) || !optionalText(patch.sermonId, 120)) return false;
  if (!validStringArray(patch.selections)) return false;
  return patch.aiTier === undefined || isAiEngineTier(patch.aiTier);
}

function validProposalArgs(
  capability: AiAgentCapability,
  args: Record<string, unknown>,
  surface?: AiAgentSurface,
): boolean {
  if (capability === "navigate") return hasOnlyKeys(args, ["href"]) && safeNavigationHref(args.href);
  if (capability === "sermon.options.patch") return validOptionsPatch(args);
  if (capability === "sermon.input.patch") return validInputPatch(args);
  if (capability === "sermon.alternative.select") {
    return hasOnlyKeys(args, ["alternativeId"]) && boundedText(args.alternativeId, 120) !== null;
  }
  if (capability === "sermon.generation.stop" || capability === "resource.generate") {
    return Object.keys(args).length === 0;
  }
  if (capability === "sermon.revision.prepare") {
    return (
      hasOnlyKeys(args, ["section", "instruction", "toneAdjustment"]) &&
      ["introduction", "body", "conclusion", "application"].includes(String(args.section)) &&
      typeof args.instruction === "string" &&
      args.instruction.trim().length >= 10 &&
      args.instruction.trim().length <= 1_000 &&
      optionalText(args.toneAdjustment, 100)
    );
  }
  if (capability === "resource.form.patch") return validResourcePatch(args, surface);
  return (
    capability === "history.open" &&
    hasOnlyKeys(args, ["sermonId"]) &&
    boundedText(args.sermonId, 120) !== null
  );
}

function containsExactString(value: unknown, expected: string, depth = 0): boolean {
  if (typeof value === "string") return value === expected;
  if (depth >= 5) return false;
  if (Array.isArray(value)) {
    return value.some((nested) => containsExactString(nested, expected, depth + 1));
  }
  if (!isObject(value)) return false;
  return Object.values(value).some((nested) =>
    containsExactString(nested, expected, depth + 1),
  );
}

export function validateAiAgentProviderOutput(
  value: unknown,
  requestedCapabilities: readonly AiAgentCapability[],
  context?: Pick<AiAgentPageContext, "surface" | "snapshot" | "resourceId">,
): AiAgentValidationResult<{ answer: string; proposal?: Omit<AgentActionProposal, "id"> }> {
  if (!isObject(value)) return { ok: false, error: "AI 에이전트 응답 형식을 확인하지 못했습니다." };
  const answer = boundedText(value.answer, 4_000);
  if (!answer) return { ok: false, error: "AI 에이전트가 답변을 반환하지 않았습니다." };
  if (value.proposal === undefined || value.proposal === null) {
    return { ok: true, value: { answer } };
  }
  if (!isObject(value.proposal) || !isAiAgentCapability(value.proposal.capability)) {
    return { ok: false, error: "AI 에이전트가 허용되지 않은 작업을 제안했습니다." };
  }
  if (!requestedCapabilities.includes(value.proposal.capability)) {
    return { ok: false, error: "AI 에이전트가 현재 화면에서 허용되지 않은 작업을 제안했습니다." };
  }
  const title = boundedText(value.proposal.title, 80);
  const description = boundedText(value.proposal.description, 300);
  const args = proposalArguments(value.proposal.args);
  if (!title || !description || !args) {
    return { ok: false, error: "AI 에이전트 작업 제안 형식을 확인하지 못했습니다." };
  }
  if (!validProposalArgs(value.proposal.capability, args, context?.surface)) {
    return { ok: false, error: "AI 에이전트가 현재 기능과 맞지 않는 작업 인수를 제안했습니다." };
  }
  const referencedId = value.proposal.capability === "sermon.alternative.select"
    ? args.alternativeId
    : value.proposal.capability === "history.open"
      ? args.sermonId
      : null;
  if (
    typeof referencedId === "string" &&
    context &&
    referencedId !== context.resourceId &&
    !containsExactString(context.snapshot, referencedId)
  ) {
    return { ok: false, error: "AI 에이전트가 현재 화면에 없는 항목을 제안했습니다." };
  }
  return {
    ok: true,
    value: {
      answer,
      proposal: {
        capability: value.proposal.capability,
        title,
        description,
        args,
        requiresConfirmation: true,
      },
    },
  };
}

export const AI_AGENT_SUPPORTED_TIERS = AI_ENGINE_TIERS;
