export const AI_ENGINES = [
  "openai",
  "anthropic",
  "gemini",
  "openrouter",
  "deepseek",
  "custom",
] as const;

export type AiEngine = (typeof AI_ENGINES)[number];

export const AI_REASONING_EFFORTS = [
  "default",
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type AiReasoningEffort = (typeof AI_REASONING_EFFORTS)[number];

export type AiEnginePreset = {
  label: string;
  description: string;
  endpoint: string;
  endpointLabel: string;
  endpointHelp: string;
  defaultModel: string;
  modelSuggestions: readonly string[];
  reasoningEfforts: readonly AiReasoningEffort[];
  defaultReasoningEffort: AiReasoningEffort;
  keyLabel: string;
  keyPlaceholder: string;
};

export const AI_ENGINE_PRESETS: Record<AiEngine, AiEnginePreset> = {
  openai: {
    label: "OpenAI",
    description: "Responses API와 GPT 모델을 사용합니다.",
    endpoint: "https://api.openai.com/v1/responses",
    endpointLabel: "OpenAI Responses API URL",
    endpointHelp: "보안을 위해 OpenAI 공식 Responses API 주소로 고정됩니다.",
    defaultModel: "gpt-5.6",
    modelSuggestions: ["gpt-5.6", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"],
    reasoningEfforts: ["default", "none", "low", "medium", "high", "xhigh", "max"],
    defaultReasoningEffort: "low",
    keyLabel: "OpenAI API 키",
    keyPlaceholder: "현재 세션에서 사용할 OpenAI API 키",
  },
  anthropic: {
    label: "Anthropic Claude",
    description: "Messages API와 Claude 모델을 사용합니다.",
    endpoint: "https://api.anthropic.com/v1/messages",
    endpointLabel: "Anthropic Messages API URL",
    endpointHelp: "보안을 위해 Anthropic 공식 Messages API 주소로 고정됩니다.",
    defaultModel: "claude-sonnet-5",
    modelSuggestions: ["claude-sonnet-5", "claude-opus-5", "claude-haiku-4-5", "claude-fable-5"],
    reasoningEfforts: ["default", "low", "medium", "high", "xhigh", "max"],
    defaultReasoningEffort: "medium",
    keyLabel: "Anthropic API 키",
    keyPlaceholder: "현재 세션에서 사용할 Anthropic API 키",
  },
  gemini: {
    label: "Google Gemini",
    description: "Interactions API와 Gemini 모델을 사용합니다.",
    endpoint: "https://generativelanguage.googleapis.com/v1/interactions",
    endpointLabel: "Gemini Interactions API URL",
    endpointHelp: "보안을 위해 Google 공식 Interactions API 주소로 고정됩니다.",
    defaultModel: "gemini-3.6-flash",
    modelSuggestions: ["gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-pro-latest"],
    reasoningEfforts: ["default", "minimal", "low", "medium", "high"],
    defaultReasoningEffort: "medium",
    keyLabel: "Gemini API 키",
    keyPlaceholder: "현재 세션에서 사용할 Gemini Auth API 키",
  },
  openrouter: {
    label: "OpenRouter",
    description: "여러 공급자의 모델을 하나의 API로 선택합니다.",
    endpoint: "https://openrouter.ai/api/v1/chat/completions",
    endpointLabel: "OpenRouter Chat Completions API URL",
    endpointHelp: "보안을 위해 OpenRouter 공식 Chat Completions API 주소로 고정됩니다.",
    defaultModel: "openai/gpt-5.6",
    modelSuggestions: [
      "openai/gpt-5.6",
      "anthropic/claude-sonnet-5",
      "google/gemini-3.6-flash",
    ],
    reasoningEfforts: ["default", "none", "minimal", "low", "medium", "high", "xhigh", "max"],
    defaultReasoningEffort: "medium",
    keyLabel: "OpenRouter API 키",
    keyPlaceholder: "현재 세션에서 사용할 OpenRouter API 키",
  },
  deepseek: {
    label: "DeepSeek",
    description: "공식 OpenAI 호환 API와 DeepSeek V4 Flash 모델을 사용합니다.",
    endpoint: "https://api.deepseek.com",
    endpointLabel: "DeepSeek API URL",
    endpointHelp: "보안을 위해 DeepSeek 공식 API 기본 주소로 고정됩니다.",
    defaultModel: "deepseek-v4-flash",
    modelSuggestions: ["deepseek-v4-flash", "deepseek-v4-pro"],
    reasoningEfforts: ["default", "high", "max"],
    defaultReasoningEffort: "high",
    keyLabel: "DeepSeek API 키",
    keyPlaceholder: "현재 세션에서 사용할 DeepSeek API 키",
  },
  custom: {
    label: "기타 OpenAI 호환",
    description: "공개 HTTP 또는 HTTPS OpenAI 호환 API를 직접 연결합니다.",
    endpoint: "https://api.openai.com/v1/responses",
    endpointLabel: "OpenAI 호환 API URL",
    endpointHelp: "서버 기본 주소, /v1 기본 주소, Responses 또는 Chat Completions URL을 입력할 수 있습니다.",
    defaultModel: "gpt-5.6",
    modelSuggestions: ["gpt-5.6"],
    reasoningEfforts: ["default", "none", "low", "medium", "high", "xhigh", "max"],
    defaultReasoningEffort: "low",
    keyLabel: "호환 API 키",
    keyPlaceholder: "이 호스트에 전송할 API 키",
  },
};

export type AiPreferences = {
  enabled: boolean;
  engine: AiEngine;
  endpoint: string;
  model: string;
  reasoningEffort: AiReasoningEffort;
};

export type AiRequestConfig = AiPreferences & {
  enabled: true;
  apiKey: string;
};

/**
 * Local LLMs exposed through the user-configured OpenAI-compatible engine are
 * the only providers that need resumable, multi-request sermon generation.
 * Hosted engines can reliably return one complete alternative per request.
 */
export function usesFragmentedSermonGeneration(
  ai: Pick<AiPreferences, "engine"> | null | undefined,
): boolean {
  return ai?.engine === "custom";
}

export function aiUserScope(identity: string): string {
  return encodeURIComponent(identity.trim());
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export const DEFAULT_AI_PREFERENCES: AiPreferences = {
  enabled: false,
  engine: "openai",
  endpoint: AI_ENGINE_PRESETS.openai.endpoint,
  model: AI_ENGINE_PRESETS.openai.defaultModel,
  reasoningEffort: AI_ENGINE_PRESETS.openai.defaultReasoningEffort,
};

export function aiReasoningEffortsForModel(
  engine: AiEngine,
  model: string,
): readonly AiReasoningEffort[] {
  const normalizedModel = model.trim().toLowerCase();
  if (engine === "anthropic" && normalizedModel.startsWith("claude-haiku-4-5")) {
    return ["default"];
  }
  if (
    engine === "gemini" &&
    (normalizedModel === "gemini-pro-latest" || normalizedModel.includes("gemini-3.1-pro"))
  ) {
    return ["default", "low", "medium", "high"];
  }
  return AI_ENGINE_PRESETS[engine].reasoningEfforts;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}

function normalizedHostname(value: string): string {
  return value.toLowerCase().replace(/^\[/, "").replace(/\]$/, "").replace(/\.$/, "");
}

function ipv4Parts(hostname: string): number[] | null {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return null;
  const parts = hostname.split(".").map(Number);
  return parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ? parts
    : null;
}

function isPrivateOrReservedIpv4(parts: number[]): boolean {
  const [a, b, c] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function ipv6Words(hostnameValue: string): number[] | null {
  const hostname = normalizedHostname(hostnameValue);
  if (!hostname.includes(":")) return null;
  const halves = hostname.split("::");
  if (halves.length > 2) return null;

  const parseHalf = (half: string): number[] | null => {
    if (!half) return [];
    const tokens = half.split(":");
    const words: number[] = [];
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (token.includes(".")) {
        if (index !== tokens.length - 1) return null;
        const parts = ipv4Parts(token);
        if (!parts) return null;
        words.push((parts[0] << 8) | parts[1], (parts[2] << 8) | parts[3]);
      } else {
        if (!/^[0-9a-f]{1,4}$/i.test(token)) return null;
        words.push(Number.parseInt(token, 16));
      }
    }
    return words;
  };

  const left = parseHalf(halves[0]);
  const right = parseHalf(halves[1] ?? "");
  if (!left || !right) return null;
  if (halves.length === 1) return left.length === 8 ? left : null;
  const zeroCount = 8 - left.length - right.length;
  if (zeroCount < 1) return null;
  return [...left, ...Array<number>(zeroCount).fill(0), ...right];
}

function isPrivateOrReservedIpv6(words: number[]): boolean {
  if (words.length !== 8) return true;
  const [a, b] = words;
  if (words.every((word) => word === 0)) return true;
  if (words.slice(0, 7).every((word) => word === 0) && words[7] === 1) return true;
  if ((a & 0xfe00) === 0xfc00) return true;
  if ((a & 0xffc0) === 0xfe80 || (a & 0xffc0) === 0xfec0) return true;
  if ((a & 0xff00) === 0xff00) return true;
  if (a === 0x2001 && (b === 0x0db8 || b === 0)) return true;
  if (a === 0x0100 && words.slice(1, 4).every((word) => word === 0)) return true;

  const mappedIpv4 =
    words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff;
  const compatibleIpv4 = words.slice(0, 6).every((word) => word === 0);
  if (mappedIpv4 || compatibleIpv4) {
    return isPrivateOrReservedIpv4([
      words[6] >> 8,
      words[6] & 0xff,
      words[7] >> 8,
      words[7] & 0xff,
    ]);
  }

  if (a === 0x2002) {
    return isPrivateOrReservedIpv4([b >> 8, b & 0xff, words[2] >> 8, words[2] & 0xff]);
  }
  if (a === 0x0064 && b === 0xff9b) {
    return isPrivateOrReservedIpv4([
      words[6] >> 8,
      words[6] & 0xff,
      words[7] >> 8,
      words[7] & 0xff,
    ]);
  }
  return false;
}

export function isPrivateOrReservedNetworkHost(hostnameValue: string): boolean {
  const hostname = normalizedHostname(hostnameValue);
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".lan") ||
    hostname.endsWith(".home") ||
    hostname.endsWith(".onion")
  ) {
    return true;
  }

  const ipv4 = ipv4Parts(hostname);
  if (ipv4) return isPrivateOrReservedIpv4(ipv4);

  if (hostname.includes(":")) {
    const words = ipv6Words(hostname);
    return !words || isPrivateOrReservedIpv6(words);
  }

  return !hostname.includes(".");
}

function isIpLiteral(hostnameValue: string): boolean {
  const hostname = normalizedHostname(hostnameValue);
  return Boolean(ipv4Parts(hostname) || ipv6Words(hostname));
}

export function validateAiEngine(value: unknown): ValidationResult<AiEngine> {
  if (typeof value !== "string" || !(AI_ENGINES as readonly string[]).includes(value)) {
    return { ok: false, error: "AI 엔진을 다시 선택해 주세요." };
  }
  return { ok: true, value: value as AiEngine };
}

export function validateAiEndpoint(
  value: unknown,
  engine: AiEngine = "custom",
): ValidationResult<string> {
  if (typeof value !== "string") {
    return { ok: false, error: "AI API URL을 입력해 주세요." };
  }
  const input = value.trim();
  if (!input || input.length > 2_048 || hasControlCharacters(input)) {
    return { ok: false, error: "AI API URL은 2,048자 이하로 입력해 주세요." };
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, error: "올바른 AI API URL을 입력해 주세요." };
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, error: "API URL은 HTTP 또는 HTTPS 주소만 사용할 수 있습니다." };
  }
  if (url.username || url.password || url.search || url.hash) {
    return { ok: false, error: "API URL에는 계정 정보, 쿼리 또는 해시를 넣을 수 없습니다." };
  }
  if (isIpLiteral(url.hostname)) {
    return { ok: false, error: "API URL에는 IP 주소 대신 공개 도메인 이름을 사용해 주세요." };
  }
  if (isPrivateOrReservedNetworkHost(url.hostname)) {
    return { ok: false, error: "로컬·사설 네트워크 주소는 API URL로 사용할 수 없습니다." };
  }

  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  const normalized = `${url.origin}${pathname}`;
  if (engine !== "custom") {
    const canonical = AI_ENGINE_PRESETS[engine].endpoint;
    const canonicalUrl = new URL(canonical);
    const canonicalPathname = canonicalUrl.pathname.replace(/\/+$/, "") || "/";
    const normalizedCanonical = `${canonicalUrl.origin}${canonicalPathname}`;
    const legacyDeepseekChatEndpoint =
      engine === "deepseek"
        ? `${normalizedCanonical.replace(/\/+$/, "")}/chat/completions`
        : null;
    if (
      normalized.toLowerCase() !== normalizedCanonical.toLowerCase() &&
      normalized.toLowerCase() !== legacyDeepseekChatEndpoint?.toLowerCase()
    ) {
      return {
        ok: false,
        error: `${AI_ENGINE_PRESETS[engine].label} 엔진은 보안을 위해 공식 API URL만 사용할 수 있습니다.`,
      };
    }
    return { ok: true, value: canonical };
  }

  return { ok: true, value: normalized };
}

export function validateAiModel(value: unknown): ValidationResult<string> {
  if (typeof value !== "string") {
    return { ok: false, error: "사용할 모델 ID를 입력해 주세요." };
  }
  const model = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(model)) {
    return {
      ok: false,
      error: "모델 ID는 영문·숫자로 시작하고 영문, 숫자, 점, 밑줄, 콜론, 슬래시, 하이픈만 사용할 수 있습니다.",
    };
  }
  return { ok: true, value: model };
}

export function validateAiPreferences(value: unknown): ValidationResult<AiPreferences> {
  if (!isPlainObject(value)) {
    return { ok: false, error: "AI 연결 설정 형식을 확인해 주세요." };
  }

  // v1 설정에는 엔진 필드가 없었습니다. 공식 OpenAI 주소가 아니면 기존 호환 URL입니다.
  const legacyEngine =
    typeof value.endpoint === "string" &&
    value.endpoint.trim().replace(/\/+$/, "").toLowerCase() !==
      AI_ENGINE_PRESETS.openai.endpoint.toLowerCase()
      ? "custom"
      : "openai";
  const engine = validateAiEngine(value.engine ?? legacyEngine);
  if (!engine.ok) return engine;
  const endpoint = validateAiEndpoint(value.endpoint, engine.value);
  if (!endpoint.ok) return endpoint;
  const model = validateAiModel(value.model);
  if (!model.ok) return model;

  const preset = AI_ENGINE_PRESETS[engine.value];
  const reasoningEfforts = aiReasoningEffortsForModel(engine.value, model.value);
  if (
    typeof value.reasoningEffort !== "string" ||
    !reasoningEfforts.includes(value.reasoningEffort as AiReasoningEffort)
  ) {
    return {
      ok: false,
      error: `${preset.label}에서 지원하는 추론 강도를 다시 선택해 주세요.`,
    };
  }

  return {
    ok: true,
    value: {
      enabled: value.enabled === true,
      engine: engine.value,
      endpoint: endpoint.value,
      model: model.value,
      reasoningEffort: value.reasoningEffort as AiReasoningEffort,
    },
  };
}

export function validateAiApiKey(
  value: unknown,
  engine?: AiEngine,
): ValidationResult<string> {
  if (engine === "custom" && (value === undefined || value === null)) {
    return { ok: true, value: "" };
  }
  if (typeof value !== "string") {
    return { ok: false, error: "API 키를 입력해 주세요." };
  }
  const apiKey = value.trim();
  if (engine === "custom" && !apiKey) {
    return { ok: true, value: "" };
  }
  if (!apiKey || apiKey.length > 512 || /\s/.test(apiKey) || hasControlCharacters(apiKey)) {
    return { ok: false, error: "API 키 형식을 확인해 주세요." };
  }
  return { ok: true, value: apiKey };
}

export function validateAiRequestConfig(value: unknown): ValidationResult<AiRequestConfig> {
  const preferences = validateAiPreferences(value);
  if (!preferences.ok) return preferences;
  if (!preferences.value.enabled) {
    return { ok: false, error: "AI 엔진이 활성화되지 않았습니다." };
  }
  const apiKey = validateAiApiKey(
    (value as Record<string, unknown>).apiKey,
    preferences.value.engine,
  );
  if (!apiKey.ok) return apiKey;
  return {
    ok: true,
    value: { ...preferences.value, enabled: true, apiKey: apiKey.value },
  };
}
