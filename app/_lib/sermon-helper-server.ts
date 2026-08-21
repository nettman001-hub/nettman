import {
  SERMON_HELPER_MAX_ACTIVE_PROJECTS,
  SERMON_HELPER_MAX_PROJECTS_PER_24_HOURS,
  SERMON_HELPER_MAX_REQUEST_BYTES,
  SERMON_HELPER_MAX_PROJECT_BYTES,
  SERMON_HELPER_MAX_TOTAL_PROJECTS,
  SERMON_HELPER_REVIEW_FIELD_KEYS,
  SERMON_HELPER_STEP_IDS,
  clearSermonHelperScriptureVerification,
  createEmptySermonHelperSteps,
  isSermonHelperStepId,
  reconcileSermonHelperReview,
  sermonHelperReviewIsFresh,
  validateSermonHelperProvenance,
  validateStoredSermonHelperSteps,
  type PatchSermonHelperInput,
  type SermonHelperProject,
  type SermonHelperProjectSummary,
} from "./sermon-helper-types.ts";

export type SermonHelperProjectLimit = "active" | "total" | "rate" | null;

export type SermonHelperProjectCounts = {
  active: number | string | null | undefined;
  total: number | string | null | undefined;
  recent: number | string | null | undefined;
};

export type SermonHelperRow = {
  id: string;
  title: string;
  scripture: string;
  status: string;
  current_step_id: string;
  steps_json: string;
  provenance_json: string;
  provenance_mode: string;
  completed_sermon_id: string | null;
  completed_step_count?: number | string;
  version: number | string;
  created_at: string;
  updated_at: string;
};

export type SermonHelperSummaryRow = Omit<
  SermonHelperRow,
  "steps_json" | "provenance_json"
> & {
  completed_step_count: number | string;
};

export class SermonHelperRequestBodyError extends Error {
  readonly status: 400 | 413 | 415;

  constructor(message: string, status: 400 | 413 | 415 = 400) {
    super(message);
    this.name = "SermonHelperRequestBodyError";
    this.status = status;
  }
}

function parseStoredJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function safeIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 20 || value.length > 40) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

export function sermonHelperProjectFromRow(
  row: SermonHelperRow,
): SermonHelperProject | null {
  const version = Number(row.version);
  if (
    !row.id ||
    !row.title ||
    (row.status !== "in_progress" && row.status !== "completed") ||
    !isSermonHelperStepId(row.current_step_id) ||
    row.provenance_mode !== "pastor_assisted" ||
    !Number.isSafeInteger(version) ||
    version < 1 ||
    !safeIsoTimestamp(row.created_at) ||
    !safeIsoTimestamp(row.updated_at)
  ) {
    return null;
  }
  const steps = validateStoredSermonHelperSteps(parseStoredJson(row.steps_json));
  if (!steps.ok) return null;
  const provenance = validateSermonHelperProvenance(
    parseStoredJson(row.provenance_json),
  );
  if (!provenance.ok) return null;
  const project: SermonHelperProject = {
    id: row.id,
    title: row.title,
    scripture: row.scripture,
    status: row.status,
    currentStepId: row.current_step_id,
    steps: steps.value,
    provenance: provenance.value,
    provenanceMode: "pastor_assisted",
    completedSermonId: row.completed_sermon_id,
    version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  return sermonHelperProjectStorageBytes(project) <= SERMON_HELPER_MAX_PROJECT_BYTES
    ? project
    : null;
}

export function sermonHelperSummary(
  project: SermonHelperProject,
): SermonHelperProjectSummary {
  return {
    id: project.id,
    title: project.title,
    scripture: project.scripture,
    status: project.status,
    currentStepId: project.currentStepId,
    completedStepCount: SERMON_HELPER_STEP_IDS.filter(
      (stepId) => project.steps[stepId].completed,
    ).length,
    provenanceMode: project.provenanceMode,
    completedSermonId: project.completedSermonId,
    version: project.version,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

export function sermonHelperSummaryFromRow(
  row: SermonHelperSummaryRow,
): SermonHelperProjectSummary | null {
  const version = Number(row.version);
  const completedStepCount = Number(row.completed_step_count);
  if (
    !row.id ||
    !row.title ||
    (row.status !== "in_progress" && row.status !== "completed") ||
    !isSermonHelperStepId(row.current_step_id) ||
    row.provenance_mode !== "pastor_assisted" ||
    !Number.isSafeInteger(version) ||
    version < 1 ||
    !Number.isSafeInteger(completedStepCount) ||
    completedStepCount < 0 ||
    completedStepCount > SERMON_HELPER_STEP_IDS.length ||
    !safeIsoTimestamp(row.created_at) ||
    !safeIsoTimestamp(row.updated_at)
  ) {
    return null;
  }
  return {
    id: row.id,
    title: row.title,
    scripture: row.scripture,
    status: row.status,
    currentStepId: row.current_step_id,
    completedStepCount,
    provenanceMode: "pastor_assisted",
    completedSermonId: row.completed_sermon_id,
    version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function sermonHelperProjectStorageBytes(
  project: Pick<SermonHelperProject, "title" | "scripture" | "steps" | "provenance">,
): number {
  return new TextEncoder().encode(
    JSON.stringify({
      title: project.title,
      scripture: project.scripture,
      steps: project.steps,
      provenance: project.provenance,
    }),
  ).byteLength;
}

export function sermonHelperProjectLimit(
  counts: SermonHelperProjectCounts,
): SermonHelperProjectLimit {
  const recent = Number(counts.recent ?? 0);
  const active = Number(counts.active ?? 0);
  const total = Number(counts.total ?? 0);
  if (!Number.isFinite(recent) || !Number.isFinite(active) || !Number.isFinite(total)) {
    return "total";
  }
  if (recent >= SERMON_HELPER_MAX_PROJECTS_PER_24_HOURS) return "rate";
  if (active >= SERMON_HELPER_MAX_ACTIVE_PROJECTS) return "active";
  if (total >= SERMON_HELPER_MAX_TOTAL_PROJECTS) return "total";
  return null;
}

export function mergeSermonHelperPatch(
  project: SermonHelperProject,
  input: PatchSermonHelperInput,
  now: string,
): SermonHelperProject {
  const steps = { ...project.steps };
  for (const stepId of SERMON_HELPER_STEP_IDS) {
    const update = input.patch.steps?.[stepId];
    if (!update) continue;
    steps[stepId] = { id: stepId, ...update, updatedAt: now };
  }
  const merged: SermonHelperProject = {
    ...project,
    ...(input.patch.title !== undefined ? { title: input.patch.title } : {}),
    ...(input.patch.scripture !== undefined
      ? { scripture: input.patch.scripture }
      : {}),
    ...(input.patch.currentStepId !== undefined
      ? { currentStepId: input.patch.currentStepId }
      : {}),
    steps,
    ...(input.patch.provenance !== undefined
      ? { provenance: input.patch.provenance }
      : {}),
    version: project.version + 1,
    updatedAt: now,
  };
  return reconcileSermonHelperReview(
    project,
    clearSermonHelperScriptureVerification(project, merged),
  );
}

export function createNewSermonHelperProject(
  id: string,
  title: string,
  scripture: string,
  now: string,
): SermonHelperProject {
  return {
    id,
    title,
    scripture,
    status: "in_progress",
    currentStepId: "brief",
    steps: createEmptySermonHelperSteps(now),
    provenance: [],
    provenanceMode: "pastor_assisted",
    completedSermonId: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}

export function redactDeletedSermonHelperProject(
  project: SermonHelperProject,
  deletedAt: string,
): SermonHelperProject {
  return {
    ...project,
    title: "삭제된 설교 준비",
    scripture: "",
    currentStepId: "brief",
    steps: createEmptySermonHelperSteps(deletedAt),
    provenance: [],
    version: project.version + 1,
    updatedAt: deletedAt,
  };
}

export function sermonHelperCompletionIssues(
  project: SermonHelperProject,
): string[] {
  const issues: string[] = [];
  const write = project.steps.write;
  const manuscriptItems = write.items.filter((item) => item.kind === "manuscript");
  if (!project.title.trim()) issues.push("설교 제목");
  if (!project.scripture.trim()) issues.push("성경 본문");
  if (!write.completed) issues.push("직접쓰기 단계 완료");
  if (!write.fields.introduction?.trim()) issues.push("도입");
  if (!write.fields.conclusion?.trim()) issues.push("결론");
  if (!write.fields.application?.trim()) issues.push("최종 적용");
  if (manuscriptItems.length < 1 || manuscriptItems.length > 4) {
    issues.push("1~4개 대지");
  } else if (
    manuscriptItems.some((item) => !item.title.trim() || !item.content.trim())
  ) {
    issues.push("각 대지의 제목과 내용");
  }
  if (!project.steps.review.completed) issues.push("최종 점검 단계 완료");
  if (
    SERMON_HELPER_REVIEW_FIELD_KEYS.some(
      (field) => project.steps.review.fields[field] !== "true",
    )
  ) {
    issues.push("목회자 최종 확인 6개 항목");
  }
  if (
    project.steps.review.completed &&
    SERMON_HELPER_REVIEW_FIELD_KEYS.every(
      (field) => project.steps.review.fields[field] === "true",
    ) &&
    !sermonHelperReviewIsFresh(project)
  ) {
    issues.push("최종 점검 이후 변경된 내용 재확인");
  }
  return issues;
}

export async function readSermonHelperJsonBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    throw new SermonHelperRequestBodyError(
      "JSON 형식으로 요청해 주세요.",
      415,
    );
  }
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > SERMON_HELPER_MAX_REQUEST_BYTES) {
    throw new SermonHelperRequestBodyError(
      "설교도우미 저장 요청이 너무 큽니다.",
      413,
    );
  }
  if (!request.body) {
    throw new SermonHelperRequestBodyError("설교도우미 요청 내용을 확인해 주세요.");
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > SERMON_HELPER_MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new SermonHelperRequestBodyError(
          "설교도우미 저장 요청이 너무 큽니다.",
          413,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return JSON.parse(text) as unknown;
  } catch {
    throw new SermonHelperRequestBodyError("JSON 요청 형식을 확인해 주세요.");
  }
}

export function sermonHelperBodyErrorResponse(error: unknown): Response | null {
  if (!(error instanceof SermonHelperRequestBodyError)) return null;
  return Response.json(
    { error: error.message },
    { status: error.status, headers: { "Cache-Control": "no-store" } },
  );
}

export function sermonHelperConflictResponse(
  project: Pick<SermonHelperProject, "version" | "updatedAt">,
): Response {
  return Response.json(
    {
      error: "다른 창에서 설교도우미 작업이 변경되었습니다. 최신 내용을 불러와 주세요.",
      code: "version_conflict",
      current: { version: project.version, updatedAt: project.updatedAt },
    },
    { status: 409, headers: { "Cache-Control": "no-store" } },
  );
}
