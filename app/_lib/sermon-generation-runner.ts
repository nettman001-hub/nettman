/**
 * Module-scoped sermon generation runner. The sequential position requests
 * used to live inside the input/alternatives pages, so navigating to another
 * menu unmounted the page and aborted the run. This singleton survives SPA
 * navigations: progress persists straight into the localStorage draft, a
 * window event lets any mounted workflow provider re-read it, and pages
 * merely subscribe for UI state. A full page load still ends the loop — the
 * existing server-side resume then continues from the last completed draft.
 */

import {
  requestSermonGenerationSequence,
  SCRIPTURE_NORMALIZATION_GRANT_INVALID,
  SermonClientError,
} from "./sermon-client.ts";
import { loadSermonDraft, persistSermonDraft } from "./sermon-store.ts";
import {
  isSermonAlternative,
  type GenerateSermonsRequest,
  type ScriptureNormalization,
  type SermonDraft,
  type SermonGeneration,
} from "./sermon-types.ts";

export const SERMON_DRAFT_EXTERNAL_UPDATE_EVENT = "sermon-draft-external-update";
export const SERMON_GENERATION_RUN_EVENT = "sermon-generation-run-changed";

export type SermonGenerationRunStatus =
  | "running"
  | "completed"
  | "stopped"
  | "error";

export type SermonGenerationRunState = {
  draftId: string;
  generationId: string;
  mode: "initial" | "regenerate";
  status: SermonGenerationRunStatus;
  expectedCount: 1 | 5;
  completedCount: number;
  step: { position: number; completed: number; total: number } | null;
  error: string | null;
  normalizationGrantInvalid: boolean;
  restartRequired: boolean;
};

type ActiveRun = {
  state: SermonGenerationRunState;
  controller: AbortController;
};

let activeRun: ActiveRun | null = null;
const listeners = new Set<(state: SermonGenerationRunState | null) => void>();

function snapshot(): SermonGenerationRunState | null {
  return activeRun ? { ...activeRun.state, step: activeRun.state.step } : null;
}

function notify(): void {
  const state = snapshot();
  for (const listener of listeners) listener(state);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(SERMON_GENERATION_RUN_EVENT));
  }
}

function announceDraftUpdate(draftId: string): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(SERMON_DRAFT_EXTERNAL_UPDATE_EVENT, { detail: { draftId } }),
    );
  }
}

function updateStoredDraft(
  draftId: string,
  updater: (current: SermonDraft) => SermonDraft,
): void {
  const current = loadSermonDraft(draftId);
  if (!current) return;
  try {
    persistSermonDraft(updater(current));
  } catch {
    // Storage pressure: the run keeps going; the server retains every
    // completed draft for resume, so nothing is lost permanently.
  }
  announceDraftUpdate(draftId);
}

export function getSermonGenerationRunState(): SermonGenerationRunState | null {
  return snapshot();
}

export function isSermonGenerationRunActive(draftId?: string): boolean {
  return Boolean(
    activeRun &&
      activeRun.state.status === "running" &&
      (!draftId || activeRun.state.draftId === draftId),
  );
}

export function subscribeSermonGenerationRun(
  listener: (state: SermonGenerationRunState | null) => void,
): () => void {
  listeners.add(listener);
  listener(snapshot());
  return () => {
    listeners.delete(listener);
  };
}

/** Aborts the active run; completed drafts stay saved for resume. */
export function stopSermonGenerationRun(): void {
  if (activeRun && activeRun.state.status === "running") {
    activeRun.controller.abort();
  }
}

/** Clears a terminal run state so its message is not shown twice. */
export function acknowledgeSermonGenerationRun(): void {
  if (activeRun && activeRun.state.status !== "running") {
    activeRun = null;
    notify();
  }
}

export function startSermonGenerationRun(args: {
  draftId: string;
  mode: "initial" | "regenerate";
  request: GenerateSermonsRequest;
  generation: SermonGeneration;
  expectedCount: 1 | 5;
  clientUserScope: string | null;
  isGuest: boolean;
  canonicalScripture: string;
  scriptureNormalization: ScriptureNormalization | null;
}): SermonGenerationRunState {
  if (activeRun && activeRun.state.status === "running") {
    return { ...activeRun.state };
  }
  const controller = new AbortController();
  const state: SermonGenerationRunState = {
    draftId: args.draftId,
    generationId: args.generation.id,
    mode: args.mode,
    status: "running",
    expectedCount: args.expectedCount,
    completedCount: args.generation.alternatives.length,
    step: null,
    error: null,
    normalizationGrantInvalid: false,
    restartRequired: false,
  };
  activeRun = { state, controller };
  notify();

  void (async () => {
    try {
      const result = await requestSermonGenerationSequence(args.request, {
        generationId: args.generation.id,
        expectedCount: args.expectedCount,
        completed: args.generation.alternatives,
        completedParts: args.generation.parts,
        signal: controller.signal,
        clientUserScope: args.clientUserScope,
        onStepProgress: (parts, position, completed, total) => {
          if (controller.signal.aborted) return;
          state.step = { position, completed, total };
          updateStoredDraft(args.draftId, (current) =>
            current.generation?.id === args.generation.id
              ? {
                  ...current,
                  generation: { ...current.generation, parts },
                  stage: "generating",
                }
              : current,
          );
          notify();
        },
        onProgress: (alternatives, completedCount) => {
          if (controller.signal.aborted) return;
          state.completedCount = completedCount;
          state.step = null;
          updateStoredDraft(args.draftId, (current) =>
            current.generation?.id === args.generation.id
              ? {
                  ...current,
                  generation: {
                    ...current.generation,
                    alternatives,
                    parts: current.generation.parts.filter(
                      (part) => part.position > completedCount,
                    ),
                  },
                  stage: "generating",
                }
              : current,
          );
          notify();
        },
      });
      if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
      const uniqueTitles = new Set(result.alternatives.map((item) => item.title));
      if (
        result.alternatives.length !== args.expectedCount ||
        !result.alternatives.every(isSermonAlternative) ||
        result.alternatives.some(
          (alternative) => alternative.scripture !== args.canonicalScripture,
        ) ||
        (args.mode === "initial" && uniqueTitles.size !== args.expectedCount)
      ) {
        throw new Error(
          args.mode === "regenerate"
            ? "다섯 초안을 모두 생성하지 못했습니다."
            : args.isGuest
              ? "미리보기 초안을 준비하지 못했습니다. 다시 시도해 주세요."
              : "다섯 개의 서로 다른 초안을 준비하지 못했습니다. 다시 시도해 주세요.",
        );
      }
      updateStoredDraft(args.draftId, (current) => ({
        ...current,
        scripture: args.canonicalScripture,
        ...(args.scriptureNormalization
          ? { scriptureNormalization: args.scriptureNormalization }
          : {}),
        alternatives: result.alternatives,
        generation: null,
        selectedAlternativeId: null,
        versions: [],
        revisions: [],
        revisionCount: 0,
        completedAt: null,
        savedSermonId: null,
        saveMode: null,
        stage: "alternatives",
      }));
      state.completedCount = result.alternatives.length;
      state.status = "completed";
      notify();
    } catch (caught) {
      const aborted =
        controller.signal.aborted ||
        (caught instanceof Error && caught.name === "AbortError");
      const normalizationGrantInvalid =
        caught instanceof SermonClientError &&
        caught.code === SCRIPTURE_NORMALIZATION_GRANT_INVALID;
      const message = aborted
        ? args.mode === "regenerate"
          ? "새 초안 생성이 중단되었습니다. 완성된 번호부터 이어서 만들 수 있습니다."
          : "초안 생성이 중단되었습니다. 완성된 초안부터 이어서 만들 수 있습니다."
        : caught instanceof Error
          ? caught.message
          : "설교 생성 중 오류가 발생했습니다.";
      const restartRequired =
        message.includes("새 초안 묶음") || message.includes("새 묶음으로 다시 시작");
      updateStoredDraft(args.draftId, (current) => {
        const next =
          current.generation?.id === args.generation.id
            ? {
                ...current,
                stage:
                  args.mode === "regenerate"
                    ? ("alternatives" as const)
                    : ("input" as const),
                generation: restartRequired ? null : current.generation,
              }
            : current;
        return normalizationGrantInvalid
          ? { ...next, scriptureNormalization: null }
          : next;
      });
      state.status = aborted ? "stopped" : "error";
      state.error = message;
      state.normalizationGrantInvalid = normalizationGrantInvalid;
      state.restartRequired = restartRequired;
      state.step = null;
      notify();
    }
  })();

  return { ...state };
}
