import type {
  GenerateSermonsRequest,
  GenerateSermonsResponse,
  NormalizeScriptureRequest,
  NormalizeScriptureResponse,
  ReviseSermonRequest,
  ReviseSermonResponse,
  SermonAlternative,
  SermonGenerationPart,
} from "./sermon-types.ts";
import { isSermonAlternative } from "./sermon-types.ts";
import { notifyTokenWalletChanged } from "./token-wallet-events.ts";

export const GENERATION_REQUEST_TIMEOUT_MS = 250_000;
export const SCRIPTURE_NORMALIZATION_GRANT_INVALID =
  "scripture_normalization_grant_invalid";
const SERMON_GENERATION_NOT_FRAGMENTED =
  "sermon_generation_not_fragmented";

export class SermonClientError extends Error {
  readonly code: string | null;
  readonly status: number;

  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.name = "SermonClientError";
    this.status = status;
    this.code = code;
  }
}

function throwIfGenerationAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}

function isGenerationPart(value: unknown): value is SermonGenerationPart {
  if (!value || typeof value !== "object") return false;
  const part = value as Partial<SermonGenerationPart>;
  return Boolean(
    Number.isInteger(part.position) &&
      Number(part.position) >= 1 &&
      Number(part.position) <= 5 &&
      Number.isInteger(part.step) &&
      Number(part.step) >= 1 &&
      part.payload &&
      typeof part.payload === "object" &&
      !Array.isArray(part.payload),
  );
}

async function responseError(
  response: Response,
  fallback: string,
): Promise<SermonClientError> {
  try {
    const body = (await response.json()) as { error?: string; code?: string };
    return new SermonClientError(
      body.error || fallback,
      response.status,
      typeof body.code === "string" ? body.code : null,
    );
  } catch {
    return new SermonClientError(fallback, response.status);
  }
}

export async function requestScriptureNormalization(
  request: NormalizeScriptureRequest,
  signal?: AbortSignal,
): Promise<NormalizeScriptureResponse> {
  throwIfGenerationAborted(signal);
  const response = await fetch("/api/sermons/normalize-scripture", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    throw await responseError(
      response,
      "성경 본문 표기를 AI가 확인하지 못했습니다.",
    );
  }
  const body = (await response.json()) as Partial<NormalizeScriptureResponse>;
  if (
    typeof body.scripture !== "string" ||
    !body.scripture.trim() ||
    typeof body.normalizedByAi !== "boolean" ||
    (body.grant !== null && typeof body.grant !== "string") ||
    (body.grantExpiresAt !== null && typeof body.grantExpiresAt !== "string")
  ) {
    throw new Error("AI가 확인한 성경 본문 표기가 올바르지 않습니다.");
  }
  return {
    scripture: body.scripture.trim(),
    normalizedByAi: body.normalizedByAi,
    grant: body.grant ?? null,
    grantExpiresAt: body.grantExpiresAt ?? null,
  };
}

async function usesFragmentedGeneration(
  request: GenerateSermonsRequest,
  signal?: AbortSignal,
): Promise<boolean> {
  throwIfGenerationAborted(signal);
  if (!request.options.aiTier) return false;
  const query = new URLSearchParams({ aiTier: request.options.aiTier });
  const response = await fetch(`/api/sermons/generate?${query}`, {
    method: "GET",
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    throw await responseError(
      response,
      "AI 엔진의 생성 방식을 확인하지 못했습니다.",
    );
  }
  const body = (await response.json()) as { fragmented?: unknown };
  return body.fragmented === true;
}

export async function requestSermonGeneration(
  request: GenerateSermonsRequest,
  signal?: AbortSignal,
  clientUserScope: string | null = null,
): Promise<GenerateSermonsResponse> {
  return requestSermonGenerationInternal(request, signal, clientUserScope);
}

async function requestSermonGenerationInternal(
  request: GenerateSermonsRequest,
  signal: AbortSignal | undefined,
  clientUserScope: string | null,
): Promise<GenerateSermonsResponse> {
  const response = await fetch("/api/sermons/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...request,
      clientUserScope: clientUserScope ?? undefined,
    }),
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    throw await responseError(response, "설교 생성에 실패했습니다.");
  }
  const result = (await response.json()) as GenerateSermonsResponse;
  notifyTokenWalletChanged();
  return result;
}

export async function requestSermonGenerationSequence(
  request: GenerateSermonsRequest,
  options: {
    generationId: string;
    expectedCount: 1 | 5;
    /**
     * The generation id may already have persisted server output even when
     * the browser missed the response and has no local alternatives yet.
     * Start with a replay-safe fragment probe instead of the engine-status
     * GET so an administrator toggle cannot hide already-paid output.
     */
    replayExisting?: boolean;
    completed?: SermonAlternative[];
    completedParts?: SermonGenerationPart[];
    signal?: AbortSignal;
    clientUserScope?: string | null;
    onProgress?: (alternatives: SermonAlternative[], completedCount: number) => void;
    onStepProgress?: (
      parts: SermonGenerationPart[],
      position: number,
      completedSteps: number,
      totalSteps: number,
    ) => void;
  },
): Promise<GenerateSermonsResponse> {
  const clientUserScope = options.clientUserScope ?? null;
  const alternatives = [...(options.completed ?? [])];
  if (alternatives.some((alternative) => alternative.scripture !== request.scripture)) {
    throw new Error(
      "저장된 초안의 본문 범위가 현재 본문과 달라 새 초안 묶음으로 다시 시작해 주세요.",
    );
  }
  const persistedParts = (options.completedParts ?? []).filter(isGenerationPart);
  let useFragmentedGeneration =
    options.replayExisting === true
      ? true
      : await usesFragmentedGeneration(request, options.signal);
  let replayModeProbe = options.replayExisting === true && persistedParts.length === 0;
  let parts = useFragmentedGeneration ? persistedParts : [];
  let latest: GenerateSermonsResponse = {
    alternatives,
    provider: "local",
    generationId: options.generationId,
    complete: alternatives.length === options.expectedCount,
  };

  for (let index = alternatives.length; index < options.expectedCount; index += 1) {
    throwIfGenerationAborted(options.signal);
    const position = (index + 1) as 1 | 2 | 3 | 4 | 5;
    let positionParts = parts
      .filter((part) => part.position === position)
      .sort((left, right) => left.step - right.step);
    let generationStep = useFragmentedGeneration
      ? (positionParts.at(-1)?.step ?? 0) + 1
      : undefined;

    while (true) {
      const controller = new AbortController();
      const abortFromParent = () => controller.abort();
      options.signal?.addEventListener("abort", abortFromParent, { once: true });
      const timeout = setTimeout(
        () => controller.abort(),
        GENERATION_REQUEST_TIMEOUT_MS,
      );

      try {
        const result = await requestSermonGenerationInternal(
          {
            ...request,
            generationId: options.generationId,
            alternativePosition: position,
            ...(generationStep ? { generationStep } : {}),
            ...(generationStep ? { generationParts: positionParts } : {}),
            existingTitles: alternatives.map((alternative) => alternative.title),
          },
          controller.signal,
          clientUserScope,
        );
        throwIfGenerationAborted(options.signal);
        if (
          replayModeProbe &&
          generationStep === 1 &&
          result.alternatives.length === 1 &&
          isSermonAlternative(result.alternatives[0]) &&
          (result.position === undefined || result.position === position) &&
          result.generationStep === undefined
        ) {
          // Older persisted hosted-engine responses may not echo fragment
          // metadata. A complete, validated alternative is still a replay;
          // accept it without consulting the now-disabled engine.
          useFragmentedGeneration = false;
          replayModeProbe = false;
          generationStep = undefined;
          positionParts = [];
          parts = [];
        }
        if (generationStep) {
          const stepCount = result.generationStepCount;
          if (
            result.position !== position ||
            result.generationStep !== generationStep ||
            typeof stepCount !== "number" ||
            !Number.isInteger(stepCount) ||
            stepCount < generationStep ||
            !Array.isArray(result.generationParts) ||
            !result.generationParts.every(isGenerationPart)
          ) {
            throw new Error(`${position}번째 설교 초안의 조각 응답 형식이 올바르지 않습니다.`);
          }
          positionParts = result.generationParts
            .filter((part) => part.position === position)
            .sort((left, right) => left.step - right.step);
          parts = [
            ...parts.filter((part) => part.position !== position),
            ...positionParts,
          ];
          throwIfGenerationAborted(options.signal);
          options.onStepProgress?.(
            [...parts],
            position,
            positionParts.length,
            stepCount,
          );
          latest = { ...result, alternatives: [...alternatives] };
          if (result.alternatives.length === 0) {
            generationStep += 1;
            continue;
          }
        }
        if (
          result.alternatives.length !== 1 ||
          !isSermonAlternative(result.alternatives[0]) ||
          result.alternatives[0].scripture !== request.scripture ||
          (result.position !== undefined && result.position !== position)
        ) {
          throw new Error(`${position}번째 설교 초안의 응답 형식이 올바르지 않습니다.`);
        }
        const alternative = result.alternatives[0];
        if (alternatives.some((item) => item.title.trim() === alternative.title.trim())) {
          throw new Error(`${position}번째 설교 초안의 제목이 앞선 초안과 겹칩니다.`);
        }
        alternatives.push(alternative);
        parts = parts.filter((part) => part.position !== position);
        latest = { ...result, alternatives: [...alternatives] };
        throwIfGenerationAborted(options.signal);
        options.onProgress?.([...alternatives], alternatives.length);
        break;
      } catch (caught) {
        if (
          replayModeProbe &&
          generationStep === 1 &&
          caught instanceof SermonClientError &&
          caught.code === SERMON_GENERATION_NOT_FRAGMENTED
        ) {
          // The probe is rejected before a provider call. Resolve the live
          // mode only after the server proves that no fragment replay exists,
          // then continue the same durable generation id without double work.
          useFragmentedGeneration = await usesFragmentedGeneration(
            request,
            options.signal,
          );
          replayModeProbe = false;
          if (!useFragmentedGeneration) {
            generationStep = undefined;
            positionParts = [];
            parts = [];
            continue;
          }
        }
        if (
          caught instanceof DOMException &&
          caught.name === "AbortError" &&
          !options.signal?.aborted
        ) {
          throw new Error(
            `${position}번째 초안의 응답 시간이 250초를 초과했습니다. 완성된 ${alternatives.length}개와 현재 초안 ${positionParts.length}단계는 보존했습니다.`,
          );
        }
        throw caught;
      } finally {
        clearTimeout(timeout);
        options.signal?.removeEventListener("abort", abortFromParent);
      }
    }
  }

  throwIfGenerationAborted(options.signal);
  return {
    ...latest,
    alternatives,
    generationId: options.generationId,
    complete: alternatives.length === options.expectedCount,
  };
}

export async function requestSermonRevision(
  request: ReviseSermonRequest,
  signal?: AbortSignal,
  clientUserScope: string | null = null,
): Promise<ReviseSermonResponse> {
  const response = await fetch("/api/sermons/revise", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...request,
      clientUserScope: clientUserScope ?? undefined,
    }),
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    throw await responseError(response, "설교 수정에 실패했습니다.");
  }
  return (await response.json()) as ReviseSermonResponse;
}
