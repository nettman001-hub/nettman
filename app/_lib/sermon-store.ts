import {
  EMPTY_SERMON_OPTIONS,
  EMPTY_SERMON_REFERENCE,
  isSermonAlternative,
  normalizeSermonAiTiers,
  type SermonDraft,
  type SermonGeneration,
  type SermonGenerationPart,
} from "./sermon-types.ts";
import type { SermonRecord } from "./data.ts";

export const SERMON_ACTIVE_DRAFT_KEY = "sermon-guide:active-draft:v1";
export const SERMON_DRAFT_PREFIX = "sermon-guide:draft:v1:";
export const SERMON_DRAFT_BACKUP_PREFIX = "sermon-guide:draft-backup:v1:";
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
    scriptureNormalization: null,
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

export function sermonGenerationUsesScripture(
  generation: SermonGeneration,
  scripture: string,
): boolean {
  if (
    generation.alternatives.some(
      (alternative) => alternative.scripture !== scripture,
    )
  ) {
    return false;
  }
  return generation.parts.every((part) => {
    if (part.payload.kind !== "outline") return true;
    const outline = part.payload.outline;
    return Boolean(
      outline &&
        typeof outline === "object" &&
        !Array.isArray(outline) &&
        "scripture" in outline &&
        outline.scripture === scripture,
    );
  });
}

export function hasActiveScriptureNormalizationGrant(
  normalization: SermonDraft["scriptureNormalization"],
  scripture: string,
  aiTier: SermonDraft["options"]["aiTier"],
  clientUserScope: string | null,
): boolean {
  if (
    !normalization?.normalizedByAi ||
    normalization.canonical !== scripture ||
    normalization.aiTier !== aiTier ||
    normalization.clientUserScope !== clientUserScope ||
    !normalization.grant
  ) {
    return false;
  }
  const expiresAt = Date.parse(normalization.grantExpiresAt ?? "");
  return Number.isFinite(expiresAt) && expiresAt > Date.now() + 30 * 60_000;
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
    const storedScripture =
      typeof parsed.scripture === "string" ? parsed.scripture.trim() : "";
    const alternatives = Array.isArray(parsed.alternatives)
      ? parsed.alternatives.filter(isSermonAlternative)
      : [];
    const generation =
      parsed.generation &&
      typeof parsed.generation === "object" &&
      typeof parsed.generation.id === "string" &&
      (parsed.generation.mode === "initial" || parsed.generation.mode === "regenerate") &&
      (parsed.generation.expectedCount === 1 || parsed.generation.expectedCount === 5) &&
      Array.isArray(parsed.generation.alternatives)
        ? {
            ...parsed.generation,
            // Keep partial-generation labels untouched. If an older provider
            // collapsed a range, sermonGenerationUsesScripture will reject the
            // partial bundle and start it again instead of mixing old content
            // into newly canonicalized alternatives.
            alternatives: parsed.generation.alternatives.filter(isSermonAlternative),
            parts: Array.isArray(parsed.generation.parts)
              ? parsed.generation.parts.filter(isGenerationPart)
              : [],
          }
        : null;
    const versions = Array.isArray(parsed.versions)
      ? parsed.versions.flatMap((version) => {
          if (!version || typeof version !== "object") {
            return [];
          }
          if (!isSermonAlternative(version.sermon)) return [];
          return [
            {
              ...version,
              sermon: version.sermon,
            },
          ];
        })
      : [];
    const completedGenerationAlternatives =
      generation &&
      generation.alternatives.length === generation.expectedCount &&
      generation.alternatives.every(
        (alternative) => alternative.scripture === storedScripture,
      ) &&
      new Set(
        generation.alternatives.map((alternative) => alternative.title.trim()),
      ).size ===
        generation.expectedCount
        ? generation.alternatives
        : null;
    const hasActiveInitialGeneration = Boolean(
      generation?.mode === "initial" &&
        !completedGenerationAlternatives &&
        generation.alternatives.length < generation.expectedCount,
    );
    const hasLegacyScriptureMismatch = Boolean(
      storedScripture &&
        (alternatives.some(
          (alternative) => alternative.scripture !== storedScripture,
        ) ||
          versions.some(
            (version) => version.sermon.scripture !== storedScripture,
          )),
    );
    const discardLegacyResults =
      hasActiveInitialGeneration || hasLegacyScriptureMismatch;
    const resetEditingState =
      discardLegacyResults || Boolean(completedGenerationAlternatives);
    if (hasLegacyScriptureMismatch) {
      try {
        const backupKey = `${SERMON_DRAFT_BACKUP_PREFIX}${id}`;
        if (!window.localStorage.getItem(backupKey)) {
          window.localStorage.setItem(backupKey, raw);
        }
      } catch {
        // Keep loading the safe draft even if this browser cannot store a backup.
      }
    }
    return {
      ...createEmptySermonDraft(),
      ...parsed,
      id,
      // Keep "generating" as a one-render recovery marker. SermonInput sends
      // this recovered bundle to the alternatives page, while a normal
      // alternatives draft can still be opened here for a deliberate edit.
      stage: completedGenerationAlternatives
        ? "generating"
        : hasLegacyScriptureMismatch
          ? "input"
          : parsed.stage ?? "options",
      scripture: storedScripture,
      options: { ...options, aiTier: aiTiers[0], aiTiers },
      scriptureNormalization:
        parsed.scriptureNormalization &&
        typeof parsed.scriptureNormalization === "object" &&
        typeof parsed.scriptureNormalization.input === "string" &&
        typeof parsed.scriptureNormalization.canonical === "string" &&
        typeof parsed.scriptureNormalization.normalizedAt === "string" &&
        (parsed.scriptureNormalization.aiTier === "basic" ||
          parsed.scriptureNormalization.aiTier === "advanced" ||
          parsed.scriptureNormalization.aiTier === "reasoning") &&
        (parsed.scriptureNormalization.clientUserScope === null ||
          typeof parsed.scriptureNormalization.clientUserScope === "string") &&
        typeof parsed.scriptureNormalization.normalizedByAi === "boolean" &&
        (parsed.scriptureNormalization.grant === null ||
          typeof parsed.scriptureNormalization.grant === "string") &&
        (parsed.scriptureNormalization.grantExpiresAt === null ||
          typeof parsed.scriptureNormalization.grantExpiresAt === "string")
          ? parsed.scriptureNormalization
          : null,
      reference: { ...EMPTY_SERMON_REFERENCE, ...parsed.reference },
      alternatives: completedGenerationAlternatives ??
        (discardLegacyResults ? [] : alternatives),
      generation: completedGenerationAlternatives ? null : generation,
      selectedAlternativeId: resetEditingState
        ? null
        : parsed.selectedAlternativeId ?? null,
      versions: resetEditingState ? [] : versions,
      revisions:
        resetEditingState || !Array.isArray(parsed.revisions)
          ? []
          : parsed.revisions,
      revisionCount:
        resetEditingState || typeof parsed.revisionCount !== "number"
          ? 0
          : parsed.revisionCount,
      completedAt: resetEditingState ? null : parsed.completedAt ?? null,
      savedSermonId: resetEditingState ? null : parsed.savedSermonId ?? null,
      saveMode: resetEditingState ? null : parsed.saveMode ?? null,
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
  const historyDraft: SermonDraft = draft.scriptureNormalization
    ? {
        ...draft,
        scriptureNormalization: {
          ...draft.scriptureNormalization,
          grant: null,
          grantExpiresAt: null,
        },
      }
    : draft;
  const withoutDuplicate = history.filter((item) => item.id !== draft.id);
  window.localStorage.setItem(
    SERMON_HISTORY_KEY,
    JSON.stringify([historyDraft, ...withoutDuplicate].slice(0, 100)),
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
    scripture:
      draft.scripture && selected.scripture === draft.scripture
        ? draft.scripture
        : selected.scripture,
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
