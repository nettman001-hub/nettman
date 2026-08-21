export const SERMON_HELPER_STEP_IDS = [
  "brief",
  "observe",
  "interpret",
  "message",
  "outline",
  "apply",
  "write",
  "review",
] as const;

export type SermonHelperStepId = (typeof SERMON_HELPER_STEP_IDS)[number];

export const SERMON_HELPER_STEP_LABELS: Record<SermonHelperStepId, string> = {
  brief: "설교 상황 정리",
  observe: "본문 읽기",
  interpret: "관찰·해석",
  message: "한 문장 메시지",
  outline: "구조 설계",
  apply: "회중 적용",
  write: "직접 원고 작성",
  review: "최종 점검",
};

export const SERMON_HELPER_REVIEW_FIELD_KEYS = [
  "scriptureChecked",
  "sourcesChecked",
  "theologyChecked",
  "privacyChecked",
  "voiceChecked",
  "rehearsed",
] as const;

export const SERMON_HELPER_REVIEW_FINGERPRINT_FIELD =
  "reviewContentFingerprint" as const;

export const SERMON_HELPER_ITEM_KINDS = [
  "note",
  "observation",
  "research",
  "outline",
  "application",
  "manuscript",
  "check",
] as const;

export type SermonHelperItemKind = (typeof SERMON_HELPER_ITEM_KINDS)[number];

export const SERMON_HELPER_SOURCE_TYPES = [
  "pastor",
  "scripture",
  "ai_suggestion",
  "external_source",
] as const;

export type SermonHelperSourceType =
  (typeof SERMON_HELPER_SOURCE_TYPES)[number];

export type SermonHelperStatus = "in_progress" | "completed";
export type SermonHelperProvenanceMode = "pastor_assisted";

export type SermonHelperStepItem = {
  id: string;
  kind: SermonHelperItemKind;
  title: string;
  content: string;
  scripture?: string;
  checked?: boolean;
  provenanceIds: string[];
};

export type SermonHelperStepInput = {
  completed: boolean;
  notes: string;
  fields: Record<string, string>;
  items: SermonHelperStepItem[];
};

export type SermonHelperStepState = SermonHelperStepInput & {
  id: SermonHelperStepId;
  updatedAt: string;
};

export type SermonHelperSteps = Record<
  SermonHelperStepId,
  SermonHelperStepState
>;

export type SermonHelperProvenanceEntry = {
  id: string;
  stepId: SermonHelperStepId;
  sourceType: SermonHelperSourceType;
  label: string;
  sourceTitle?: string;
  sourceUrl?: string;
  excerpt?: string;
  verified: boolean;
  createdAt: string;
};

export type SermonHelperProject = {
  id: string;
  title: string;
  scripture: string;
  status: SermonHelperStatus;
  currentStepId: SermonHelperStepId;
  steps: SermonHelperSteps;
  provenance: SermonHelperProvenanceEntry[];
  provenanceMode: SermonHelperProvenanceMode;
  completedSermonId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type SermonHelperProjectSummary = Pick<
  SermonHelperProject,
  | "id"
  | "title"
  | "scripture"
  | "status"
  | "currentStepId"
  | "provenanceMode"
  | "completedSermonId"
  | "version"
  | "createdAt"
  | "updatedAt"
> & {
  completedStepCount: number;
};

export type CreateSermonHelperInput = {
  title: string;
  scripture: string;
};

export type PatchSermonHelperInput = {
  expectedVersion: number;
  expectedUpdatedAt: string;
  patch: {
    title?: string;
    scripture?: string;
    currentStepId?: SermonHelperStepId;
    steps?: Partial<Record<SermonHelperStepId, SermonHelperStepInput>>;
    provenance?: SermonHelperProvenanceEntry[];
  };
};

export type CompleteSermonHelperInput = {
  expectedVersion: number;
  expectedUpdatedAt: string;
};

export type DeleteSermonHelperInput = CompleteSermonHelperInput;

export type SermonHelperValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export const SERMON_HELPER_MAX_REQUEST_BYTES = 384 * 1024;
export const SERMON_HELPER_MAX_PROJECT_BYTES = 512 * 1024;
export const SERMON_HELPER_MAX_ACTIVE_PROJECTS = 30;
export const SERMON_HELPER_MAX_TOTAL_PROJECTS = 200;
export const SERMON_HELPER_MAX_PROJECTS_PER_24_HOURS = 20;
export const SERMON_HELPER_MAX_TITLE_CHARACTERS = 120;
export const SERMON_HELPER_MAX_SCRIPTURE_CHARACTERS = 300;
export const SERMON_HELPER_MAX_STEP_NOTES_CHARACTERS = 30_000;
export const SERMON_HELPER_MAX_FIELD_CHARACTERS = 30_000;
export const SERMON_HELPER_MAX_STEP_ITEMS = 80;
export const SERMON_HELPER_MAX_PROVENANCE_ENTRIES = 200;

function stableReviewJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableReviewJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableReviewJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function fingerprintPart(value: string, seed: number): string {
  let hash = seed;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * A deterministic change detector, not an authentication primitive. The
 * server recomputes it from the stored workbook before allowing completion.
 */
export function sermonHelperReviewContentFingerprint(
  project: Pick<
    SermonHelperProject,
    "id" | "title" | "scripture" | "steps" | "provenance"
  >,
): string {
  const content = stableReviewJson({
    title: project.title,
    scripture: project.scripture,
    steps: Object.fromEntries(
      SERMON_HELPER_STEP_IDS.filter((stepId) => stepId !== "review").map(
        (stepId) => {
          const step = project.steps[stepId];
          return [
            stepId,
            {
              completed: step.completed,
              notes: step.notes,
              fields: step.fields,
              items: step.items,
            },
          ];
        },
      ),
    ),
    provenance: project.provenance.filter(
      (entry) => entry.id !== `completion_${project.id}`,
    ),
  });
  return `v1-${fingerprintPart(content, 0x811c9dc5)}${fingerprintPart(
    content,
    0x9e3779b9,
  )}${fingerprintPart(content, 0x85ebca6b)}${fingerprintPart(
    content,
    0xc2b2ae35,
  )}`;
}

function reviewChecksAreComplete(project: SermonHelperProject): boolean {
  return (
    project.steps.review.completed &&
    SERMON_HELPER_REVIEW_FIELD_KEYS.every(
      (key) => project.steps.review.fields[key] === "true",
    )
  );
}

export function sermonHelperReviewIsFresh(
  project: SermonHelperProject,
): boolean {
  return (
    reviewChecksAreComplete(project) &&
    project.steps.review.fields[SERMON_HELPER_REVIEW_FINGERPRINT_FIELD] ===
      sermonHelperReviewContentFingerprint(project)
  );
}

export function invalidateSermonHelperReview(
  project: SermonHelperProject,
): SermonHelperProject {
  const fields = { ...project.steps.review.fields };
  for (const key of SERMON_HELPER_REVIEW_FIELD_KEYS) delete fields[key];
  delete fields[SERMON_HELPER_REVIEW_FINGERPRINT_FIELD];
  return {
    ...project,
    steps: {
      ...project.steps,
      review: { ...project.steps.review, completed: false, fields },
    },
  };
}

export function reconcileSermonHelperReview(
  previous: SermonHelperProject,
  next: SermonHelperProject,
): SermonHelperProject {
  const previousFingerprint = sermonHelperReviewContentFingerprint(previous);
  const nextFingerprint = sermonHelperReviewContentFingerprint(next);
  const reviewClaimedForCurrentContent =
    reviewChecksAreComplete(next) &&
    next.steps.review.fields[SERMON_HELPER_REVIEW_FINGERPRINT_FIELD] ===
      nextFingerprint;
  if (
    previousFingerprint !== nextFingerprint &&
    !reviewClaimedForCurrentContent
  ) {
    return invalidateSermonHelperReview(next);
  }
  const fields = { ...next.steps.review.fields };
  if (reviewChecksAreComplete(next)) {
    fields[SERMON_HELPER_REVIEW_FINGERPRINT_FIELD] = nextFingerprint;
  } else {
    delete fields[SERMON_HELPER_REVIEW_FINGERPRINT_FIELD];
  }
  return {
    ...next,
    steps: {
      ...next.steps,
      review: { ...next.steps.review, fields },
    },
  };
}

export function clearSermonHelperScriptureVerification(
  previous: SermonHelperProject,
  next: SermonHelperProject,
): SermonHelperProject {
  if (previous.scripture === next.scripture) return next;
  const observeFields = next.steps.observe.fields;
  if (
    observeFields.scriptureVerification === "pastor-confirmed" &&
    observeFields.canonicalScripture?.trim() === next.scripture.trim()
  ) {
    return next;
  }
  const fields = { ...observeFields };
  delete fields.scriptureVerification;
  delete fields.canonicalScripture;
  return {
    ...next,
    steps: {
      ...next.steps,
      observe: { ...next.steps.observe, fields },
    },
  };
}

type JsonObject = Record<string, unknown>;

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
  allowEmpty = true,
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
    value.length >= 1 &&
    value.length <= 80 &&
    /^[A-Za-z0-9_-]+$/.test(value)
  );
}

function safeIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 20 || value.length > 40) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function safeHttpUrl(value: unknown): string | null {
  const text = boundedText(value, 2_048, false);
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
      if (/(?:api.?key|secret|password|credential|access.?token|refresh.?token)/i.test(key)) {
        return null;
      }
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function isSermonHelperStepId(
  value: unknown,
): value is SermonHelperStepId {
  return (
    typeof value === "string" &&
    (SERMON_HELPER_STEP_IDS as readonly string[]).includes(value)
  );
}

export function createEmptySermonHelperSteps(now: string): SermonHelperSteps {
  return Object.fromEntries(
    SERMON_HELPER_STEP_IDS.map((id) => [
      id,
      { id, completed: false, notes: "", fields: {}, items: [], updatedAt: now },
    ]),
  ) as unknown as SermonHelperSteps;
}

function validateStepItem(value: unknown): SermonHelperStepItem | null {
  if (
    !isObject(value) ||
    !hasOnlyKeys(value, [
      "id",
      "kind",
      "title",
      "content",
      "scripture",
      "checked",
      "provenanceIds",
    ]) ||
    !safeIdentifier(value.id) ||
    typeof value.kind !== "string" ||
    !(SERMON_HELPER_ITEM_KINDS as readonly string[]).includes(value.kind) ||
    typeof value.checked !== "undefined" && typeof value.checked !== "boolean"
  ) {
    return null;
  }
  const title = boundedText(value.title, 240);
  const content = boundedText(value.content, 20_000);
  const scripture = value.scripture === undefined
    ? undefined
    : boundedText(value.scripture, SERMON_HELPER_MAX_SCRIPTURE_CHARACTERS);
  if (title === null || content === null || scripture === null) return null;
  if (
    !Array.isArray(value.provenanceIds) ||
    value.provenanceIds.length > 20 ||
    value.provenanceIds.some((id) => !safeIdentifier(id))
  ) {
    return null;
  }
  return {
    id: value.id,
    kind: value.kind as SermonHelperItemKind,
    title,
    content,
    ...(scripture !== undefined ? { scripture } : {}),
    ...(typeof value.checked === "boolean" ? { checked: value.checked } : {}),
    provenanceIds: [...new Set(value.provenanceIds as string[])],
  };
}

export function validateSermonHelperStepInput(
  value: unknown,
): SermonHelperValidationResult<SermonHelperStepInput> {
  if (
    !isObject(value) ||
    !hasOnlyKeys(value, ["completed", "notes", "fields", "items"]) ||
    typeof value.completed !== "boolean"
  ) {
    return { ok: false, error: "설교도우미 단계 형식을 확인해 주세요." };
  }
  const notes = boundedText(value.notes, SERMON_HELPER_MAX_STEP_NOTES_CHARACTERS);
  if (notes === null || !isObject(value.fields) || Object.keys(value.fields).length > 40) {
    return { ok: false, error: "설교도우미 단계 메모를 확인해 주세요." };
  }
  const fields: Record<string, string> = {};
  let totalFieldCharacters = 0;
  for (const [key, fieldValue] of Object.entries(value.fields)) {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key)) {
      return { ok: false, error: "설교도우미 입력 항목 이름을 확인해 주세요." };
    }
    const field = boundedText(fieldValue, SERMON_HELPER_MAX_FIELD_CHARACTERS);
    if (field === null) {
      return { ok: false, error: "설교도우미 입력 내용이 너무 깁니다." };
    }
    totalFieldCharacters += field.length;
    fields[key] = field;
  }
  if (totalFieldCharacters > 100_000) {
    return { ok: false, error: "한 단계에 저장할 수 있는 입력 분량을 초과했습니다." };
  }
  if (!Array.isArray(value.items) || value.items.length > SERMON_HELPER_MAX_STEP_ITEMS) {
    return { ok: false, error: "설교도우미 단계 항목 수를 확인해 주세요." };
  }
  const items: SermonHelperStepItem[] = [];
  const itemIds = new Set<string>();
  for (const rawItem of value.items) {
    const item = validateStepItem(rawItem);
    if (!item || itemIds.has(item.id)) {
      return { ok: false, error: "설교도우미 단계 항목 형식을 확인해 주세요." };
    }
    itemIds.add(item.id);
    items.push(item);
  }
  return { ok: true, value: { completed: value.completed, notes, fields, items } };
}

export function validateStoredSermonHelperSteps(
  value: unknown,
): SermonHelperValidationResult<SermonHelperSteps> {
  if (!isObject(value) || Object.keys(value).length !== SERMON_HELPER_STEP_IDS.length) {
    return { ok: false, error: "저장된 설교도우미 단계 형식이 올바르지 않습니다." };
  }
  const steps = {} as SermonHelperSteps;
  for (const stepId of SERMON_HELPER_STEP_IDS) {
    const rawStep = value[stepId];
    if (
      !isObject(rawStep) ||
      rawStep.id !== stepId ||
      !safeIsoTimestamp(rawStep.updatedAt)
    ) {
      return { ok: false, error: "저장된 설교도우미 단계 식별자를 확인해 주세요." };
    }
    const step = validateSermonHelperStepInput({
      completed: rawStep.completed,
      notes: rawStep.notes,
      fields: rawStep.fields,
      items: rawStep.items,
    });
    if (!step.ok) return step;
    steps[stepId] = {
      id: stepId,
      ...step.value,
      updatedAt: rawStep.updatedAt,
    };
  }
  return { ok: true, value: steps };
}

function validateProvenanceEntry(
  value: unknown,
): SermonHelperProvenanceEntry | null {
  if (
    !isObject(value) ||
    !hasOnlyKeys(value, [
      "id",
      "stepId",
      "sourceType",
      "label",
      "sourceTitle",
      "sourceUrl",
      "excerpt",
      "verified",
      "createdAt",
    ]) ||
    !safeIdentifier(value.id) ||
    !isSermonHelperStepId(value.stepId) ||
    typeof value.sourceType !== "string" ||
    !(SERMON_HELPER_SOURCE_TYPES as readonly string[]).includes(value.sourceType) ||
    typeof value.verified !== "boolean" ||
    !safeIsoTimestamp(value.createdAt)
  ) {
    return null;
  }
  const label = boundedText(value.label, 240, false);
  const sourceTitle = value.sourceTitle === undefined
    ? undefined
    : boundedText(value.sourceTitle, 300);
  const sourceUrl = value.sourceUrl === undefined ? undefined : safeHttpUrl(value.sourceUrl);
  const excerpt = value.excerpt === undefined
    ? undefined
    : boundedText(value.excerpt, 4_000);
  if (!label || sourceTitle === null || sourceUrl === null || excerpt === null) return null;
  return {
    id: value.id,
    stepId: value.stepId,
    sourceType: value.sourceType as SermonHelperSourceType,
    label,
    ...(sourceTitle !== undefined ? { sourceTitle } : {}),
    ...(sourceUrl !== undefined ? { sourceUrl } : {}),
    ...(excerpt !== undefined ? { excerpt } : {}),
    verified: value.verified,
    createdAt: value.createdAt,
  };
}

export function validateSermonHelperProvenance(
  value: unknown,
): SermonHelperValidationResult<SermonHelperProvenanceEntry[]> {
  if (!Array.isArray(value) || value.length > SERMON_HELPER_MAX_PROVENANCE_ENTRIES) {
    return { ok: false, error: "설교도우미 출처 항목 수를 확인해 주세요." };
  }
  const entries: SermonHelperProvenanceEntry[] = [];
  const ids = new Set<string>();
  for (const rawEntry of value) {
    const entry = validateProvenanceEntry(rawEntry);
    if (!entry || ids.has(entry.id)) {
      return { ok: false, error: "설교도우미 출처 형식을 확인해 주세요." };
    }
    ids.add(entry.id);
    entries.push(entry);
  }
  return { ok: true, value: entries };
}

export function validateCreateSermonHelperInput(
  value: unknown,
): SermonHelperValidationResult<CreateSermonHelperInput> {
  if (!isObject(value) || !hasOnlyKeys(value, ["title", "scripture"])) {
    return { ok: false, error: "새 설교도우미 작업의 입력 형식을 확인해 주세요." };
  }
  const title = value.title === undefined
    ? "제목 없는 설교 준비"
    : boundedText(value.title, SERMON_HELPER_MAX_TITLE_CHARACTERS, false);
  const scripture = value.scripture === undefined
    ? ""
    : boundedText(value.scripture, SERMON_HELPER_MAX_SCRIPTURE_CHARACTERS);
  if (!title || scripture === null) {
    return { ok: false, error: "제목과 성경 본문을 확인해 주세요." };
  }
  return { ok: true, value: { title, scripture } };
}

export function validatePatchSermonHelperInput(
  value: unknown,
): SermonHelperValidationResult<PatchSermonHelperInput> {
  if (
    !isObject(value) ||
    !hasOnlyKeys(value, ["expectedVersion", "expectedUpdatedAt", "patch"]) ||
    !Number.isSafeInteger(value.expectedVersion) ||
    Number(value.expectedVersion) < 1 ||
    !safeIsoTimestamp(value.expectedUpdatedAt) ||
    !isObject(value.patch) ||
    !hasOnlyKeys(value.patch, [
      "title",
      "scripture",
      "currentStepId",
      "steps",
      "provenance",
    ]) ||
    Object.keys(value.patch).length === 0
  ) {
    return { ok: false, error: "설교도우미 저장 요청 형식을 확인해 주세요." };
  }
  const patch: PatchSermonHelperInput["patch"] = {};
  if (value.patch.title !== undefined) {
    const title = boundedText(
      value.patch.title,
      SERMON_HELPER_MAX_TITLE_CHARACTERS,
      false,
    );
    if (!title) return { ok: false, error: "설교 제목을 확인해 주세요." };
    patch.title = title;
  }
  if (value.patch.scripture !== undefined) {
    const scripture = boundedText(
      value.patch.scripture,
      SERMON_HELPER_MAX_SCRIPTURE_CHARACTERS,
    );
    if (scripture === null) {
      return { ok: false, error: "성경 본문 입력을 확인해 주세요." };
    }
    patch.scripture = scripture;
  }
  if (value.patch.currentStepId !== undefined) {
    if (!isSermonHelperStepId(value.patch.currentStepId)) {
      return { ok: false, error: "현재 설교도우미 단계를 확인해 주세요." };
    }
    patch.currentStepId = value.patch.currentStepId;
  }
  if (value.patch.steps !== undefined) {
    if (!isObject(value.patch.steps)) {
      return { ok: false, error: "저장할 설교도우미 단계를 확인해 주세요." };
    }
    const steps: Partial<Record<SermonHelperStepId, SermonHelperStepInput>> = {};
    for (const [stepId, rawStep] of Object.entries(value.patch.steps)) {
      if (!isSermonHelperStepId(stepId)) {
        return { ok: false, error: "저장할 설교도우미 단계가 올바르지 않습니다." };
      }
      const step = validateSermonHelperStepInput(rawStep);
      if (!step.ok) return step;
      steps[stepId] = step.value;
    }
    if (!Object.keys(steps).length) {
      return { ok: false, error: "저장할 설교도우미 단계를 선택해 주세요." };
    }
    patch.steps = steps;
  }
  if (value.patch.provenance !== undefined) {
    const provenance = validateSermonHelperProvenance(value.patch.provenance);
    if (!provenance.ok) return provenance;
    patch.provenance = provenance.value;
  }
  return {
    ok: true,
    value: {
      expectedVersion: Number(value.expectedVersion),
      expectedUpdatedAt: value.expectedUpdatedAt,
      patch,
    },
  };
}

export function validateCompleteSermonHelperInput(
  value: unknown,
): SermonHelperValidationResult<CompleteSermonHelperInput> {
  if (
    !isObject(value) ||
    !hasOnlyKeys(value, ["expectedVersion", "expectedUpdatedAt"]) ||
    !Number.isSafeInteger(value.expectedVersion) ||
    Number(value.expectedVersion) < 1 ||
    !safeIsoTimestamp(value.expectedUpdatedAt)
  ) {
    return { ok: false, error: "설교도우미 완료 요청 형식을 확인해 주세요." };
  }
  return {
    ok: true,
    value: {
      expectedVersion: Number(value.expectedVersion),
      expectedUpdatedAt: value.expectedUpdatedAt,
    },
  };
}

export function validateDeleteSermonHelperInput(
  value: unknown,
): SermonHelperValidationResult<DeleteSermonHelperInput> {
  const validated = validateCompleteSermonHelperInput(value);
  return validated.ok
    ? { ok: true, value: validated.value }
    : { ok: false, error: "삭제할 설교도우미 작업의 버전을 확인해 주세요." };
}
