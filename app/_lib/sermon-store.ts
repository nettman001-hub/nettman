import {
  EMPTY_SERMON_OPTIONS,
  EMPTY_SERMON_REFERENCE,
  normalizeSermonAiTiers,
  type SermonDraft,
  type SermonGeneration,
  type SermonGenerationPart,
} from "./sermon-types";
import type { SermonRecord } from "./data";

export const SERMON_ACTIVE_DRAFT_KEY = "sermon-guide:active-draft:v1";
export const SERMON_DRAFT_PREFIX = "sermon-guide:draft:v1:";
export const SERMON_HISTORY_KEY = "sermon-guide:history:v1";
export const SERMON_GUEST_PREVIEW_KEY = "sermon-guide:guest-preview:v1";

function makeId(prefix: string): string {
  const randomId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${randomId}`;
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

export function createEmptySermonDraft(): SermonDraft {
  const now = new Date().toISOString();
  return {
    id: makeId("draft"),
    stage: "options",
    createdAt: now,
    updatedAt: now,
    options: {
      ...EMPTY_SERMON_OPTIONS,
      aiTiers: [...EMPTY_SERMON_OPTIONS.aiTiers],
    },
    scripture: "",
    reference: { ...EMPTY_SERMON_REFERENCE },
    alternatives: [],
    generation: null,
    selectedAlternativeId: null,
    versions: [],
    revisions: [],
    revisionCount: 0,
    completedAt: null,
    savedSermonId: null,
    saveMode: null,
  };
}

export function createSermonGeneration(
  mode: SermonGeneration["mode"],
  expectedCount: SermonGeneration["expectedCount"],
): SermonGeneration {
  return {
    id: makeId("generation"),
    mode,
    expectedCount,
    alternatives: [],
    parts: [],
    startedAt: new Date().toISOString(),
  };
}

export function loadSermonDraft(id: string): SermonDraft | null {
  if (typeof window === "undefined" || !id) return null;
  try {
    const raw = window.localStorage.getItem(`${SERMON_DRAFT_PREFIX}${id}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SermonDraft>;
    if (parsed.id !== id || !parsed.options || !parsed.reference) return null;
    const options = { ...EMPTY_SERMON_OPTIONS, ...parsed.options };
    const aiTiers = normalizeSermonAiTiers(options);
    return {
      ...createEmptySermonDraft(),
      ...parsed,
      id,
      options: { ...options, aiTier: aiTiers[0], aiTiers },
      reference: { ...EMPTY_SERMON_REFERENCE, ...parsed.reference },
      alternatives: Array.isArray(parsed.alternatives) ? parsed.alternatives : [],
      generation:
        parsed.generation &&
        typeof parsed.generation === "object" &&
        typeof parsed.generation.id === "string" &&
        (parsed.generation.mode === "initial" || parsed.generation.mode === "regenerate") &&
        (parsed.generation.expectedCount === 1 || parsed.generation.expectedCount === 5) &&
        Array.isArray(parsed.generation.alternatives)
          ? {
              ...parsed.generation,
              parts: Array.isArray(parsed.generation.parts)
                ? parsed.generation.parts.filter(isGenerationPart)
                : [],
            }
          : null,
      versions: Array.isArray(parsed.versions) ? parsed.versions : [],
      revisions: Array.isArray(parsed.revisions) ? parsed.revisions : [],
      revisionCount:
        typeof parsed.revisionCount === "number" ? parsed.revisionCount : 0,
    };
  } catch {
    return null;
  }
}

export function loadActiveSermonDraft(): SermonDraft | null {
  if (typeof window === "undefined") return null;
  const id = window.localStorage.getItem(SERMON_ACTIVE_DRAFT_KEY);
  return id ? loadSermonDraft(id) : null;
}

export function persistSermonDraft(draft: SermonDraft): SermonDraft {
  const next = { ...draft, updatedAt: new Date().toISOString() };
  if (typeof window === "undefined") return next;
  window.localStorage.setItem(
    `${SERMON_DRAFT_PREFIX}${next.id}`,
    JSON.stringify(next),
  );
  window.localStorage.setItem(SERMON_ACTIVE_DRAFT_KEY, next.id);
  return next;
}

export function addSermonToHistory(draft: SermonDraft): void {
  if (typeof window === "undefined") return;
  let history: SermonDraft[] = [];
  try {
    const raw = window.localStorage.getItem(SERMON_HISTORY_KEY);
    history = raw ? (JSON.parse(raw) as SermonDraft[]) : [];
    if (!Array.isArray(history)) history = [];
  } catch {
    history = [];
  }
  const withoutDuplicate = history.filter((item) => item.id !== draft.id);
  window.localStorage.setItem(
    SERMON_HISTORY_KEY,
    JSON.stringify([draft, ...withoutDuplicate].slice(0, 100)),
  );
}

export function loadSermonHistory(): SermonDraft[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SERMON_HISTORY_KEY);
    if (!raw) return [];
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? value.filter((item): item is SermonDraft => Boolean(item && typeof item === "object" && "id" in item)) : [];
  } catch {
    return [];
  }
}

export function completedDraftToRecord(draft: SermonDraft): SermonRecord | null {
  const selected = draft.versions.at(-1)?.sermon
    ?? draft.alternatives.find((item) => item.id === draft.selectedAlternativeId)
    ?? draft.alternatives[0];
  if (!selected) return null;
  return {
    id: draft.savedSermonId || draft.id,
    title: selected.title,
    scripture: selected.scripture || draft.scripture,
    sermonType: draft.options.sermonType || "강해",
    audience: draft.options.audience || "청장년",
    pointCount: selected.sections.points.length,
    duration: draft.options.duration || 20,
    emotion: draft.options.tone || "위로",
    sections: {
      introduction: selected.sections.introduction,
      body: selected.sections.points,
      conclusion: selected.sections.conclusion,
      application: selected.sections.application,
    },
    createdAt: draft.createdAt,
    updatedAt: draft.completedAt || draft.updatedAt,
  };
}

export function loadLocalSermonRecords(): SermonRecord[] {
  return loadSermonHistory()
    .map(completedDraftToRecord)
    .filter((item): item is SermonRecord => item !== null);
}

export function sermonDraftUrl(
  path: string,
  draftId: string,
  extra?: Record<string, string>,
): string {
  const params = new URLSearchParams({ draftId, ...extra });
  return `${path}?${params.toString()}`;
}
