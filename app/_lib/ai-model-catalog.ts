import {
  AI_ENGINE_PRESETS,
  validateAiModel,
  type AiEngine,
} from "./ai-config.ts";
import { planCustomAiEndpoint } from "./ai-custom-endpoint.ts";
import { assertCustomEndpointHasPublicDns } from "./openai-sermons.ts";

const MODEL_CATALOG_TIMEOUT_MS = 12_000;
const MAX_MODEL_RESPONSE_BYTES = 4_000_000;
const MAX_MODEL_COUNT = 1_000;
const MAX_MODEL_DISPLAY_NAME_CHARACTERS = 160;

export type AiModelCatalogConfig = {
  engine: AiEngine;
  endpoint: string;
  apiKey: string;
};

export type AiModelCatalogEntry = {
  id: string;
  name: string;
};

export class AiModelCatalogError extends Error {
  readonly httpStatus: number;

  constructor(message: string, httpStatus = 502) {
    super(message);
    this.name = "AiModelCatalogError";
    this.httpStatus = httpStatus;
  }
}

type JsonObject = Record<string, unknown>;

type CatalogRequest = {
  endpoint: string;
  headers: Record<string, string>;
};

function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function buildAiModelCatalogRequest(config: AiModelCatalogConfig): CatalogRequest {
  const accept = { Accept: "application/json" };
  if (config.engine === "anthropic") {
    return {
      endpoint: "https://api.anthropic.com/v1/models?limit=1000",
      headers: {
        ...accept,
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
      },
    };
  }
  if (config.engine === "gemini") {
    return {
      endpoint: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000",
      headers: { ...accept, "x-goog-api-key": config.apiKey },
    };
  }
  if (config.engine === "openrouter") {
    return {
      endpoint: "https://openrouter.ai/api/v1/models",
      headers: { ...accept, Authorization: `Bearer ${config.apiKey}` },
    };
  }
  if (config.engine === "deepseek") {
    return {
      endpoint: "https://api.deepseek.com/models",
      headers: { ...accept, Authorization: `Bearer ${config.apiKey}` },
    };
  }
  if (config.engine === "custom") {
    return {
      endpoint: planCustomAiEndpoint(config.endpoint).modelsEndpoint,
      headers: {
        ...accept,
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
    };
  }
  return {
    endpoint: "https://api.openai.com/v1/models",
    headers: { ...accept, Authorization: `Bearer ${config.apiKey}` },
  };
}

async function readLimitedJson(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_MODEL_RESPONSE_BYTES) {
    throw new AiModelCatalogError("AI 제공자의 모델 목록 응답이 너무 큽니다.");
  }
  if (!response.body) {
    throw new AiModelCatalogError("AI 제공자가 빈 모델 목록 응답을 반환했습니다.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let raw = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_MODEL_RESPONSE_BYTES) {
      try {
        await reader.cancel();
      } catch {
        // The size violation remains authoritative if the upstream stream will not cancel.
      }
      throw new AiModelCatalogError("AI 제공자의 모델 목록 응답이 너무 큽니다.");
    }
    raw += decoder.decode(value, { stream: true });
  }
  raw += decoder.decode();

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new AiModelCatalogError("AI 제공자가 올바른 모델 목록을 반환하지 않았습니다.");
  }
}

function providerRecords(engine: AiEngine, payload: unknown): unknown[] {
  if (Array.isArray(payload) && engine === "custom") return payload;
  if (!isObject(payload)) {
    throw new AiModelCatalogError("AI 제공자가 올바른 모델 목록을 반환하지 않았습니다.");
  }
  const records =
    engine === "gemini"
      ? payload.models
      : Array.isArray(payload.data)
        ? payload.data
        : engine === "custom"
          ? payload.models
          : undefined;
  if (!Array.isArray(records)) {
    throw new AiModelCatalogError("AI 제공자가 올바른 모델 목록을 반환하지 않았습니다.");
  }
  return records;
}

function normalizedDisplayName(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().replace(/\s+/gu, " ").normalize("NFC");
  const hasUnsafeCharacter = Array.from(normalized).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return (
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      codePoint === 0x2028 ||
      codePoint === 0x2029
    );
  });
  if (
    !normalized ||
    Array.from(normalized).length > MAX_MODEL_DISPLAY_NAME_CHARACTERS ||
    hasUnsafeCharacter
  ) {
    return fallback;
  }
  return normalized;
}

function modelEntry(engine: AiEngine, value: unknown): AiModelCatalogEntry | null {
  if (engine === "custom" && typeof value === "string") {
    const id = validateAiModel(value);
    return id.ok ? { id: id.value, name: id.value } : null;
  }
  if (!isObject(value)) return null;

  let rawId = value.id ?? (engine === "custom" ? value.model ?? value.name : undefined);
  let rawName = value.name ?? value.display_name ?? value.displayName;
  if (engine === "gemini") {
    rawId = value.baseModelId ?? value.name;
    if (typeof rawId === "string" && rawId.startsWith("models/")) {
      rawId = rawId.slice("models/".length);
    }
    rawName = value.displayName ?? value.display_name ?? rawId;
  }

  const id = validateAiModel(rawId);
  if (!id.ok) return null;
  return {
    id: id.value,
    name: normalizedDisplayName(rawName, id.value),
  };
}

export function parseAiModelCatalog(
  engine: AiEngine,
  payload: unknown,
): AiModelCatalogEntry[] {
  const records = providerRecords(engine, payload);
  const unique = new Map<string, AiModelCatalogEntry>();
  for (const record of records) {
    const entry = modelEntry(engine, record);
    if (!entry) continue;
    const existing = unique.get(entry.id);
    if (!existing || (existing.name === existing.id && entry.name !== entry.id)) {
      unique.set(entry.id, entry);
    }
  }

  return Array.from(unique.values())
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name, "ko", {
          numeric: true,
          sensitivity: "base",
        }) || left.id.localeCompare(right.id),
    )
    .slice(0, MAX_MODEL_COUNT);
}

export async function fetchAiModelCatalog(
  config: AiModelCatalogConfig,
  signal?: AbortSignal,
): Promise<AiModelCatalogEntry[]> {
  const request = buildAiModelCatalogRequest(config);
  const controller = new AbortController();
  const abortFromRequest = () => controller.abort();
  signal?.addEventListener("abort", abortFromRequest, { once: true });
  if (signal?.aborted) controller.abort();
  const timeout = setTimeout(() => controller.abort(), MODEL_CATALOG_TIMEOUT_MS);

  try {
    if (config.engine === "custom") {
      await assertCustomEndpointHasPublicDns(request.endpoint, controller.signal);
    }
    const response = await fetch(request.endpoint, {
      method: "GET",
      headers: request.headers,
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new AiModelCatalogError(
          "API 키가 제공자에게 거부되었습니다. 키와 계정 권한을 확인해 주세요.",
        );
      }
      if (response.status === 429) {
        throw new AiModelCatalogError(
          "AI 제공자의 모델 목록 조회 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.",
          429,
        );
      }
      throw new AiModelCatalogError(
        "AI 제공자의 모델 목록을 불러오지 못했습니다. API URL과 계정 권한을 확인해 주세요.",
      );
    }
    const models = parseAiModelCatalog(config.engine, await readLimitedJson(response));
    if (!models.length) {
      throw new AiModelCatalogError(
        "이 계정에서 선택할 수 있는 모델을 찾지 못했습니다.",
      );
    }
    return models;
  } catch (caught) {
    if (caught instanceof AiModelCatalogError) throw caught;
    if (controller.signal.aborted) {
      throw new AiModelCatalogError(
        "AI 제공자의 모델 목록 응답 시간이 초과되었습니다.",
        504,
      );
    }
    throw new AiModelCatalogError(
      config.engine === "custom"
        ? "사용자 지정 API 호스트의 공개 주소를 확인하거나 모델 목록을 불러오지 못했습니다."
        : `${AI_ENGINE_PRESETS[config.engine].label} 모델 목록을 불러오지 못했습니다.`,
    );
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abortFromRequest);
  }
}
