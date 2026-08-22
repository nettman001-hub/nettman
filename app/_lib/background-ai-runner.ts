/**
 * Module-scoped runner for AI work that is not part of the sermon generation
 * sequence. App Router page components are replaced during navigation, while
 * this module stays loaded for the lifetime of the tab. Keeping the request
 * controller and terminal result here therefore lets work continue across
 * menu changes and gives AppShell one safe place to expose a Stop control.
 */

export const BACKGROUND_AI_RUN_EVENT = "background-ai-run-changed";

export type BackgroundAiRunKind =
  | "resource"
  | "helper-coach"
  | "scripture-normalization";

export type BackgroundAiRunStatus =
  | "running"
  | "completed"
  | "stopped"
  | "error";

export type BackgroundAiRunState = {
  id: string;
  key: string;
  kind: BackgroundAiRunKind;
  label: string;
  targetHref: string;
  status: BackgroundAiRunStatus;
  startedAt: number;
  finishedAt: number | null;
  context: Readonly<Record<string, unknown>>;
  result: unknown;
  error: string | null;
};

type ActiveRun = {
  state: BackgroundAiRunState;
  controller: AbortController;
  promise: Promise<unknown>;
};

export type BackgroundAiRunHandle<T> = {
  id: string;
  state: BackgroundAiRunState;
  promise: Promise<T>;
};

export class BackgroundAiRunBusyError extends Error {
  readonly active: BackgroundAiRunState;

  constructor(active: BackgroundAiRunState) {
    super("다른 AI 작업이 진행 중입니다. 완료하거나 중지한 뒤 다시 시도해 주세요.");
    this.name = "BackgroundAiRunBusyError";
    this.active = active;
  }
}

let activeRun: ActiveRun | null = null;
const listeners = new Set<(state: BackgroundAiRunState | null) => void>();

function snapshot(): BackgroundAiRunState | null {
  return activeRun
    ? {
        ...activeRun.state,
        context: { ...activeRun.state.context },
      }
    : null;
}

function notify(): void {
  const current = snapshot();
  for (const listener of listeners) listener(current);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(BACKGROUND_AI_RUN_EVENT));
  }
}

export function getBackgroundAiRunState(): BackgroundAiRunState | null {
  return snapshot();
}

export function isBackgroundAiRunActive(key?: string): boolean {
  return Boolean(
    activeRun &&
      activeRun.state.status === "running" &&
      (!key || activeRun.state.key === key),
  );
}

export function subscribeBackgroundAiRun(
  listener: (state: BackgroundAiRunState | null) => void,
): () => void {
  listeners.add(listener);
  listener(snapshot());
  return () => {
    listeners.delete(listener);
  };
}

export function stopBackgroundAiRun(id?: string): void {
  if (
    !activeRun ||
    activeRun.state.status !== "running" ||
    (id && activeRun.state.id !== id)
  ) {
    return;
  }
  activeRun.state.status = "stopped";
  activeRun.state.finishedAt = Date.now();
  activeRun.state.error = "AI 작업을 중지했습니다. 입력한 내용은 그대로 보존됩니다.";
  activeRun.controller.abort();
  notify();
}

/** Clears only the matching terminal result, never a running request. */
export function acknowledgeBackgroundAiRun(id?: string): void {
  if (
    activeRun &&
    activeRun.state.status !== "running" &&
    (!id || activeRun.state.id === id)
  ) {
    activeRun = null;
    notify();
  }
}

export function startBackgroundAiRun<T>(args: {
  id?: string;
  key: string;
  kind: BackgroundAiRunKind;
  label: string;
  targetHref: string;
  context?: Readonly<Record<string, unknown>>;
  execute: (signal: AbortSignal) => Promise<T>;
  errorMessage?: (error: unknown) => string;
}): BackgroundAiRunHandle<T> {
  if (activeRun?.state.status === "running") {
    throw new BackgroundAiRunBusyError(snapshot()!);
  }

  const id = args.id ?? crypto.randomUUID();
  const controller = new AbortController();
  const state: BackgroundAiRunState = {
    id,
    key: args.key,
    kind: args.kind,
    label: args.label,
    targetHref: args.targetHref,
    status: "running",
    startedAt: Date.now(),
    finishedAt: null,
    context: { ...(args.context ?? {}) },
    result: null,
    error: null,
  };
  const promise = Promise.resolve()
    .then(() => args.execute(controller.signal))
    .then((result) => {
      if (!controller.signal.aborted && activeRun?.state.id === id) {
        state.result = result;
        state.status = "completed";
        state.finishedAt = Date.now();
        notify();
      }
      return result;
    })
    .catch((caught) => {
      if (activeRun?.state.id === id && !controller.signal.aborted) {
        state.status = "error";
        state.finishedAt = Date.now();
        state.error = args.errorMessage
          ? args.errorMessage(caught)
          : caught instanceof Error
            ? caught.message
            : "AI 작업을 완료하지 못했습니다.";
        notify();
      }
      throw caught;
    });
  activeRun = { state, controller, promise };
  notify();

  return { id, state: snapshot()!, promise };
}
