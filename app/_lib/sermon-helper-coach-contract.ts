import {
  isAiEngineTier,
  type AiEngineTier,
} from "./ai-engine-tiers.ts";
import {
  isSermonHelperStepId,
  validateSermonHelperStepInput,
  type SermonHelperProvenanceEntry,
  type SermonHelperStepId,
  type SermonHelperStepInput,
} from "./sermon-helper-types.ts";
import type { TokenWalletSnapshot } from "./token-wallet.ts";

export const SERMON_HELPER_COACH_MODES = [
  "question",
  "research",
  "review",
  "refine",
] as const;

export type SermonHelperCoachMode =
  (typeof SERMON_HELPER_COACH_MODES)[number];

export const SERMON_HELPER_COACH_SUGGESTION_KINDS = [
  "question",
  "research_lead",
  "review_note",
  "revision_option",
] as const;

export type SermonHelperCoachSuggestionKind =
  (typeof SERMON_HELPER_COACH_SUGGESTION_KINDS)[number];

export const SERMON_HELPER_COACH_COSTS: Record<AiEngineTier, number> = {
  basic: 1,
  advanced: 2,
  reasoning: 4,
};

export const SERMON_HELPER_COACH_MAX_REQUEST_BYTES = 64 * 1024;
export const SERMON_HELPER_COACH_MAX_PROVIDER_RESPONSE_BYTES = 32 * 1024;
export const SERMON_HELPER_COACH_WRITE_EXCERPT_MAX_CHARACTERS = 2_500;

export const SERMON_HELPER_COACH_WARNINGS = {
  authorship:
    "AI는 질문·연구 방향·점검·부분 표현만 제안하며 전체 설교를 대신 작성하지 않습니다.",
  sources:
    "출처 표시는 사용자가 제공한 자료에만 연결됩니다. 성구·인용·통계·역사 정보는 원문을 직접 확인해 주세요.",
  privacy:
    "실명, 연락처, 상담·심방 내용 등 식별 가능한 개인정보는 입력하지 마세요.",
} as const;

export type SermonHelperCoachWarningCode =
  keyof typeof SERMON_HELPER_COACH_WARNINGS;

export type SermonHelperCoachWarning = {
  code: SermonHelperCoachWarningCode;
  message: string;
};

export type SermonHelperCoachContext = {
  projectTitle?: string;
  scripture?: string;
  audience?: string;
  occasion?: string;
};

export type SermonHelperCoachSource = Omit<
  Pick<
    SermonHelperProvenanceEntry,
    | "id"
    | "stepId"
    | "sourceType"
    | "label"
    | "sourceTitle"
    | "sourceUrl"
    | "excerpt"
    | "verified"
  >,
  "sourceType"
> & {
  sourceType: Exclude<SermonHelperProvenanceEntry["sourceType"], "ai_suggestion">;
};

export type SermonHelperCoachRequest = {
  projectId: string;
  sessionId: string;
  messageId: string;
  tier: AiEngineTier;
  mode: SermonHelperCoachMode;
  stepId: SermonHelperStepId;
  step: SermonHelperStepInput;
  prompt?: string;
  context: SermonHelperCoachContext;
  sources: SermonHelperCoachSource[];
};

export type SermonHelperCoachConfidence = "high" | "medium" | "low";

export type SermonHelperCoachSuggestion = {
  id: string;
  kind: SermonHelperCoachSuggestionKind;
  title: string;
  content: string;
  reason: string;
  confidence: SermonHelperCoachConfidence;
};

export type SermonHelperCoachSourceReference = {
  sourceId: string;
  claim: string;
  confidence: SermonHelperCoachConfidence;
};

export type SermonHelperCoachCitation = SermonHelperCoachSourceReference & {
  label: string;
  sourceTitle?: string;
  sourceUrl?: string;
  verified: boolean;
};

export type SermonHelperCoachProviderOutput = {
  answer: string;
  suggestions: Omit<SermonHelperCoachSuggestion, "id">[];
  sourceReferences: SermonHelperCoachSourceReference[];
  uncertainties: string[];
  needFurtherInput: boolean;
};

export type SermonHelperCoachApiResponse = {
  messageId: string;
  mode: SermonHelperCoachMode;
  stepId: SermonHelperStepId;
  answer: string;
  suggestions: SermonHelperCoachSuggestion[];
  citations: SermonHelperCoachCitation[];
  uncertainties: string[];
  needFurtherInput: boolean;
  warnings: SermonHelperCoachWarning[];
  wallet?: TokenWalletSnapshot;
  walletRefreshRequired?: boolean;
  replayed?: boolean;
};

export type SermonHelperCoachPersistedResponse = Omit<
  SermonHelperCoachApiResponse,
  "wallet" | "walletRefreshRequired" | "replayed"
>;

export type SermonHelperCoachRetryState =
  | "conflict"
  | "succeeded"
  | "response_expired"
  | "pending"
  | "expired"
  | "refunded";

/**
 * Pure retry state machine shared by the durable ledger and behavior tests.
 * Only `succeeded` may replay a response; every other pre-existing state must
 * return without making another provider call for the same message ID.
 */
export function classifySermonHelperCoachRetry(args: {
  requestFingerprint: string;
  expectedFingerprint: string;
  status: "pending" | "succeeded" | "refunded";
  leaseExpiresAt: string;
  responseExpiresAt?: string | null;
  hasResponse: boolean;
  nowMs: number;
}): SermonHelperCoachRetryState {
  if (args.requestFingerprint !== args.expectedFingerprint) return "conflict";
  if (args.status === "succeeded") {
    if (
      !args.hasResponse ||
      (args.responseExpiresAt && Date.parse(args.responseExpiresAt) <= args.nowMs)
    ) {
      return "response_expired";
    }
    return "succeeded";
  }
  if (args.status === "refunded") return "refunded";
  return Date.parse(args.leaseExpiresAt) <= args.nowMs ? "expired" : "pending";
}

export type SermonHelperCoachValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

type JsonObject = Record<string, unknown>;

const MODE_SUGGESTION_KIND: Record<
  SermonHelperCoachMode,
  SermonHelperCoachSuggestionKind
> = {
  question: "question",
  research: "research_lead",
  review: "review_note",
  refine: "revision_option",
};

const SENSITIVE_KEY =
  /(?:admin|api.?key|secret|password|credential|access.?token|refresh.?token|authorization|cookie|payment|checkout|email|phone|resident|ssn)/i;
const SENSITIVE_TEXT =
  /(?:\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|\b01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}\b|\b\d{6}[-.\s]?[1-4]\d{6}\b|\bBearer\s+[A-Za-z0-9._~+-]{12,}\b|\bsk-[A-Za-z0-9_-]{12,}\b)/i;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasOnlyKeys(value: JsonObject, allowedKeys: readonly string[]): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function hasUnsafeControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return (code <= 31 && code !== 9 && code !== 10 && code !== 13) || code === 127;
  });
}

function boundedText(
  value: unknown,
  maxCharacters: number,
  allowEmpty = false,
): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (
    (!allowEmpty && !normalized) ||
    normalized.length > maxCharacters ||
    hasUnsafeControlCharacters(normalized)
  ) {
    return null;
  }
  return normalized;
}

function safeIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 8 &&
    value.length <= 80 &&
    /^[A-Za-z0-9_-]+$/.test(value)
  );
}

export function isSermonHelperCoachMode(
  value: unknown,
): value is SermonHelperCoachMode {
  return (
    typeof value === "string" &&
    (SERMON_HELPER_COACH_MODES as readonly string[]).includes(value)
  );
}

function isConfidence(value: unknown): value is SermonHelperCoachConfidence {
  return value === "high" || value === "medium" || value === "low";
}

function safeSourceUrl(value: unknown): string | null {
  const text = boundedText(value, 2_048);
  if (!text) return null;
  try {
    const url = new URL(text);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password
    ) {
      return null;
    }
    for (const key of url.searchParams.keys()) {
      if (SENSITIVE_KEY.test(key)) return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function containsSensitiveText(value: unknown, depth = 0): boolean {
  if (typeof value === "string") return SENSITIVE_TEXT.test(value);
  if (depth >= 5) return false;
  if (Array.isArray(value)) {
    return value.some((item) => containsSensitiveText(item, depth + 1));
  }
  if (!isObject(value)) return false;
  return Object.entries(value).some(
    ([key, nested]) => SENSITIVE_KEY.test(key) || containsSensitiveText(nested, depth + 1),
  );
}

function validateCoachStep(
  value: unknown,
): SermonHelperCoachValidationResult<SermonHelperStepInput> {
  const base = validateSermonHelperStepInput(value);
  if (!base.ok) return base;
  const step = base.value;
  if (step.notes.length > 8_000 || Object.keys(step.fields).length > 24) {
    return {
      ok: false,
      error: "AI 코치에 보낼 현재 단계 내용은 핵심 부분만 남겨 주세요.",
    };
  }
  const totalFieldCharacters = Object.values(step.fields).reduce(
    (total, field) => total + field.length,
    0,
  );
  if (
    totalFieldCharacters > 12_000 ||
    step.items.length > 16 ||
    step.items.some(
      (item) =>
        item.content.length > SERMON_HELPER_COACH_WRITE_EXCERPT_MAX_CHARACTERS,
    ) ||
    step.items.reduce((total, item) => total + item.title.length + item.content.length, 0) >
      20_000
  ) {
    return {
      ok: false,
      error: "AI 코치에 보낼 현재 단계 항목이 너무 많습니다. 검토할 부분을 줄여 주세요.",
    };
  }
  return { ok: true, value: step };
}

function validateCoachContext(
  value: unknown,
): SermonHelperCoachValidationResult<SermonHelperCoachContext> {
  if (
    !isObject(value) ||
    !hasOnlyKeys(value, ["projectTitle", "scripture", "audience", "occasion"])
  ) {
    return { ok: false, error: "설교도우미 AI 코치 문맥을 확인해 주세요." };
  }
  const limits: Record<keyof SermonHelperCoachContext, number> = {
    projectTitle: 120,
    scripture: 300,
    audience: 300,
    occasion: 300,
  };
  const context: SermonHelperCoachContext = {};
  for (const key of Object.keys(limits) as (keyof SermonHelperCoachContext)[]) {
    const raw = value[key];
    if (raw === undefined) continue;
    const text = boundedText(raw, limits[key], true);
    if (text === null) {
      return { ok: false, error: "설교도우미 AI 코치 문맥이 너무 깁니다." };
    }
    context[key] = text;
  }
  return { ok: true, value: context };
}

function validateCoachSources(
  value: unknown,
): SermonHelperCoachValidationResult<SermonHelperCoachSource[]> {
  if (!Array.isArray(value) || value.length > 8) {
    return { ok: false, error: "AI 코치에 전달할 출처는 8개 이하로 선택해 주세요." };
  }
  const sources: SermonHelperCoachSource[] = [];
  const sourceIds = new Set<string>();
  for (const raw of value) {
    if (
      !isObject(raw) ||
      !hasOnlyKeys(raw, [
        "id",
        "stepId",
        "sourceType",
        "label",
        "sourceTitle",
        "sourceUrl",
        "excerpt",
        "verified",
      ]) ||
      !safeIdentifier(raw.id) ||
      sourceIds.has(raw.id) ||
      !isSermonHelperStepId(raw.stepId) ||
      !["pastor", "scripture", "external_source"].includes(String(raw.sourceType)) ||
      typeof raw.verified !== "boolean"
    ) {
      return { ok: false, error: "AI 코치에 전달할 출처 형식을 확인해 주세요." };
    }
    const label = boundedText(raw.label, 240);
    const sourceTitle = raw.sourceTitle === undefined
      ? undefined
      : boundedText(raw.sourceTitle, 300, true);
    const sourceUrl = raw.sourceUrl === undefined
      ? undefined
      : safeSourceUrl(raw.sourceUrl);
    const excerpt = raw.excerpt === undefined
      ? undefined
      : boundedText(raw.excerpt, 1_000, true);
    if (!label || sourceTitle === null || sourceUrl === null || excerpt === null) {
      return { ok: false, error: "AI 코치 출처의 제목·주소·발췌문을 확인해 주세요." };
    }
    sourceIds.add(raw.id);
    sources.push({
      id: raw.id,
      stepId: raw.stepId,
      sourceType: raw.sourceType as SermonHelperCoachSource["sourceType"],
      label,
      ...(sourceTitle !== undefined ? { sourceTitle } : {}),
      ...(sourceUrl !== undefined ? { sourceUrl } : {}),
      ...(excerpt !== undefined ? { excerpt } : {}),
      verified: raw.verified,
    });
  }
  return { ok: true, value: sources };
}

function hasPastorSeed(
  step: SermonHelperStepInput,
  prompt: string | undefined,
): boolean {
  return Boolean(
    prompt?.trim() ||
      step.notes.trim() ||
      Object.values(step.fields).some((field) => field.trim()) ||
      step.items.some((item) => item.title.trim() || item.content.trim()),
  );
}

export function validateSermonHelperCoachRequest(
  value: unknown,
): SermonHelperCoachValidationResult<SermonHelperCoachRequest> {
  if (
    !isObject(value) ||
    !hasOnlyKeys(value, [
      "projectId",
      "sessionId",
      "messageId",
      "tier",
      "mode",
      "stepId",
      "step",
      "prompt",
      "context",
      "sources",
    ]) ||
    !safeIdentifier(value.projectId) ||
    !safeIdentifier(value.sessionId) ||
    !safeIdentifier(value.messageId) ||
    !isAiEngineTier(value.tier) ||
    !isSermonHelperCoachMode(value.mode) ||
    !isSermonHelperStepId(value.stepId)
  ) {
    return { ok: false, error: "설교도우미 AI 코치 요청 형식을 확인해 주세요." };
  }
  const prompt = value.prompt === undefined
    ? undefined
    : boundedText(value.prompt, 1_000, true);
  if (prompt === null) {
    return { ok: false, error: "AI 코치 요청은 1,000자 이하로 입력해 주세요." };
  }
  const step = validateCoachStep(value.step);
  if (!step.ok) return step;
  if (
    value.stepId === "write" &&
    (
      step.value.notes !== "" ||
      Object.keys(step.value.fields).length !== 0 ||
      step.value.items.length !== 1 ||
      step.value.items[0]?.kind !== "manuscript" ||
      !step.value.items[0].content.trim() ||
      step.value.items[0].content.length >
        SERMON_HELPER_COACH_WRITE_EXCERPT_MAX_CHARACTERS
    )
  ) {
    return {
      ok: false,
      error:
        "직접 쓰기 단계에서는 사용자가 고른 대지의 2,500자 이하 검토 범위 하나만 AI 코치에게 보낼 수 있습니다.",
    };
  }
  const context = validateCoachContext(value.context);
  if (!context.ok) return context;
  const sources = validateCoachSources(value.sources);
  if (!sources.ok) return sources;
  if (sources.value.some((source) => source.stepId !== value.stepId)) {
    return {
      ok: false,
      error: "AI 코치에는 현재 단계에 연결된 출처만 전달할 수 있습니다.",
    };
  }
  if (!hasPastorSeed(step.value, prompt)) {
    return {
      ok: false,
      error: "먼저 현재 단계에 목회자님의 생각을 적거나 AI 코치에게 물을 내용을 입력해 주세요.",
    };
  }
  if (containsSensitiveText({ prompt, step: step.value, context: context.value, sources: sources.value })) {
    return {
      ok: false,
      error: "개인정보나 인증 정보로 보이는 내용을 제거한 뒤 다시 요청해 주세요.",
    };
  }
  return {
    ok: true,
    value: {
      projectId: value.projectId,
      sessionId: value.sessionId,
      messageId: value.messageId,
      tier: value.tier,
      mode: value.mode,
      stepId: value.stepId,
      step: step.value,
      ...(prompt !== undefined ? { prompt } : {}),
      context: context.value,
      sources: sources.value,
    },
  };
}

function validateSuggestions(
  value: unknown,
  mode: SermonHelperCoachMode,
): Omit<SermonHelperCoachSuggestion, "id">[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 4) return null;
  const expectedKind = MODE_SUGGESTION_KIND[mode];
  const suggestions: Omit<SermonHelperCoachSuggestion, "id">[] = [];
  let totalCharacters = 0;
  for (const raw of value) {
    if (
      !isObject(raw) ||
      !hasOnlyKeys(raw, ["kind", "title", "content", "reason", "confidence"]) ||
      raw.kind !== expectedKind ||
      !isConfidence(raw.confidence)
    ) {
      return null;
    }
    const title = boundedText(raw.title, 80);
    const content = boundedText(raw.content, 800);
    const reason = boundedText(raw.reason, 300);
    if (!title || !content || !reason) return null;
    totalCharacters += title.length + content.length + reason.length;
    suggestions.push({ kind: expectedKind, title, content, reason, confidence: raw.confidence });
  }
  return totalCharacters <= 3_600 ? suggestions : null;
}

function validateSourceReferences(
  value: unknown,
  allowedSources: readonly SermonHelperCoachSource[],
): SermonHelperCoachSourceReference[] | null {
  if (!Array.isArray(value) || value.length > 8) return null;
  const allowedIds = new Set(allowedSources.map((source) => source.id));
  const seen = new Set<string>();
  const references: SermonHelperCoachSourceReference[] = [];
  for (const raw of value) {
    if (
      !isObject(raw) ||
      !hasOnlyKeys(raw, ["sourceId", "claim", "confidence"]) ||
      typeof raw.sourceId !== "string" ||
      !allowedIds.has(raw.sourceId) ||
      seen.has(raw.sourceId) ||
      !isConfidence(raw.confidence)
    ) {
      return null;
    }
    const claim = boundedText(raw.claim, 400);
    if (!claim) return null;
    seen.add(raw.sourceId);
    references.push({ sourceId: raw.sourceId, claim, confidence: raw.confidence });
  }
  return references;
}

function validateUncertainties(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 5) return null;
  const uncertainties: string[] = [];
  for (const raw of value) {
    const uncertainty = boundedText(raw, 300);
    if (!uncertainty) return null;
    uncertainties.push(uncertainty);
  }
  return uncertainties;
}

export function validateSermonHelperCoachProviderOutput(
  value: unknown,
  request: Pick<SermonHelperCoachRequest, "mode" | "sources">,
): SermonHelperCoachValidationResult<SermonHelperCoachProviderOutput> {
  if (
    !isObject(value) ||
    !hasOnlyKeys(value, [
      "answer",
      "suggestions",
      "sourceReferences",
      "uncertainties",
      "needFurtherInput",
    ]) ||
    typeof value.needFurtherInput !== "boolean"
  ) {
    return { ok: false, error: "AI 코치 응답 형식을 확인하지 못했습니다." };
  }
  const answer = boundedText(value.answer, 600);
  const suggestions = validateSuggestions(value.suggestions, request.mode);
  const sourceReferences = validateSourceReferences(value.sourceReferences, request.sources);
  const uncertainties = validateUncertainties(value.uncertainties);
  if (!answer || !suggestions || !sourceReferences || !uncertainties) {
    return { ok: false, error: "AI 코치가 안전한 범위의 제안을 반환하지 않았습니다." };
  }
  if (
    request.mode === "research" &&
    sourceReferences.length === 0 &&
    uncertainties.length === 0
  ) {
    return {
      ok: false,
      error: "출처가 없는 연구 제안에는 확인할 불확실성을 표시해야 합니다.",
    };
  }
  return {
    ok: true,
    value: {
      answer,
      suggestions,
      sourceReferences,
      uncertainties,
      needFurtherInput: value.needFurtherInput,
    },
  };
}

export function sermonHelperCoachWarnings(): SermonHelperCoachWarning[] {
  return (Object.entries(SERMON_HELPER_COACH_WARNINGS) as [
    SermonHelperCoachWarningCode,
    string,
  ][]).map(([code, message]) => ({ code, message }));
}
