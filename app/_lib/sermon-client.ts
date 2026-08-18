import type {
  GenerateSermonsRequest,
  GenerateSermonsResponse,
  ReviseSermonRequest,
  ReviseSermonResponse,
  SermonAlternative,
  SermonGenerationPart,
} from "./sermon-types.ts";
import { isSermonAlternative } from "./sermon-types.ts";
import { notifyTokenWalletChanged } from "./token-wallet-events.ts";

export const GENERATION_REQUEST_TIMEOUT_MS = 250_000;

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

async function responseError(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error || fallback;
  } catch {
    return fallback;
  }
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
    throw new Error(await responseError(response, "설교 생성에 실패했습니다."));
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
  const useFragmentedGeneration = false;
  const alternatives = [...(options.completed ?? [])];
  let parts = useFragmentedGeneration
    ? (options.completedParts ?? []).filter(isGenerationPart)
    : [];
  let latest: GenerateSermonsResponse = {
    alternatives,
    provider: "local",
    generationId: options.generationId,
    complete: alternatives.length === options.expectedCount,
  };

  for (let index = alternatives.length; index < options.expectedCount; index += 1) {
    if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
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
        options.onProgress?.([...alternatives], alternatives.length);
        break;
      } catch (caught) {
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
    throw new Error(await responseError(response, "설교 수정에 실패했습니다."));
  }
  return (await response.json()) as ReviseSermonResponse;
}
