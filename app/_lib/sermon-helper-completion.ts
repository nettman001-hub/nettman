import type { SermonRecord, SermonSections } from "./data.ts";
import {
  sermonHelperCompletionIssues,
  sermonHelperProjectFromRow,
  sermonHelperProjectStorageBytes,
  type SermonHelperRow,
} from "./sermon-helper-server.ts";
import {
  SERMON_HELPER_MAX_PROJECT_BYTES,
  SERMON_HELPER_MAX_PROVENANCE_ENTRIES,
  SERMON_HELPER_STEP_IDS,
  type SermonHelperProject,
  type SermonHelperProvenanceEntry,
} from "./sermon-helper-types.ts";

type StoredSermonRow = {
  id: string;
  title: string;
  scripture: string;
  sermon_type: string;
  audience: string;
  audience_situation: string;
  point_count: number | string;
  duration: number | string;
  emotion: string;
  body_json: string;
  created_at: string;
  updated_at: string;
};

export type SermonHelperCompletionFailureKind =
  | "not_found"
  | "conflict"
  | "coach_pending"
  | "incomplete"
  | "project_too_large"
  | "integrity";

export class SermonHelperCompletionFailure extends Error {
  readonly kind: SermonHelperCompletionFailureKind;
  readonly project?: SermonHelperProject;
  readonly missing?: string[];
  readonly retryAfterSeconds?: number;

  constructor(
    kind: SermonHelperCompletionFailureKind,
    message: string,
    options: {
      project?: SermonHelperProject;
      missing?: string[];
      retryAfterSeconds?: number;
    } = {},
  ) {
    super(message);
    this.name = "SermonHelperCompletionFailure";
    this.kind = kind;
    this.project = options.project;
    this.missing = options.missing;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export type SermonHelperCompletionResult = {
  project: SermonHelperProject;
  sermon: SermonRecord;
  alreadyCompleted: boolean;
};

export type CompleteSermonHelperWithinLockInput = {
  projectId: string;
  userId: string;
  expectedVersion: number;
  expectedUpdatedAt: string;
  completedAt?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseSermonSections(value: string): SermonSections | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    return null;
  }
  if (
    !isRecord(parsed) ||
    typeof parsed.introduction !== "string" ||
    typeof parsed.conclusion !== "string" ||
    typeof parsed.application !== "string" ||
    !Array.isArray(parsed.body) ||
    parsed.body.length < 1 ||
    parsed.body.length > 4 ||
    parsed.body.some(
      (section) =>
        !isRecord(section) ||
        typeof section.heading !== "string" ||
        !section.heading.trim() ||
        typeof section.content !== "string" ||
        !section.content.trim(),
    )
  ) {
    return null;
  }
  return {
    introduction: parsed.introduction,
    body: parsed.body.map((section) => ({
      heading: (section as Record<string, string>).heading,
      content: (section as Record<string, string>).content,
    })),
    conclusion: parsed.conclusion,
    application: parsed.application,
  };
}

async function ownedProject(
  db: D1Database,
  id: string,
  userId: string,
): Promise<SermonHelperProject | null> {
  const row = await db
    .prepare(
      `SELECT id, title, scripture, status, current_step_id, steps_json,
              provenance_json, provenance_mode, completed_sermon_id,
              version, created_at, updated_at
        FROM sermon_helper_projects
        WHERE id = ? AND user_id = ? AND deleted_at IS NULL
        FOR UPDATE`,
    )
    .bind(id, userId)
    .first<SermonHelperRow>();
  return row ? sermonHelperProjectFromRow(row) : null;
}

async function ownedSermon(
  db: D1Database,
  sermonId: string,
  userId: string,
): Promise<SermonRecord | null> {
  const row = await db
    .prepare(
      `SELECT id, title, scripture, sermon_type, audience, audience_situation,
              point_count, duration, emotion, body_json, created_at, updated_at
         FROM sermons
        WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    )
    .bind(sermonId, userId)
    .first<StoredSermonRow>();
  if (!row) return null;
  const sections = parseSermonSections(row.body_json);
  const pointCount = Number(row.point_count);
  const duration = Number(row.duration);
  if (
    !sections ||
    !Number.isSafeInteger(pointCount) ||
    pointCount !== sections.body.length ||
    !Number.isSafeInteger(duration)
  ) {
    return null;
  }
  return {
    id: row.id,
    title: row.title,
    scripture: row.scripture,
    sermonType: row.sermon_type,
    audience: row.audience,
    audienceSituation: row.audience_situation,
    pointCount,
    duration,
    emotion: row.emotion,
    sections,
    authorshipMode: "pastor_assisted",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function oneOf(
  value: string | undefined,
  choices: readonly string[],
  fallback: string,
): string {
  return value && choices.includes(value) ? value : fallback;
}

function boundedDuration(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? Math.min(40, Math.max(5, parsed)) : 20;
}

export function sermonFromHelper(
  project: SermonHelperProject,
  completedAt = new Date().toISOString(),
): SermonRecord | null {
  const brief = project.steps.brief.fields;
  const write = project.steps.write;
  const manuscriptItems = write.items.filter((item) => item.kind === "manuscript");
  if (sermonHelperCompletionIssues(project).length) return null;
  return {
    id: `helper_${project.id}`,
    title: project.title.trim(),
    scripture: project.scripture.trim(),
    sermonType: oneOf(brief.sermonType, ["강해", "주제", "내러티브"], "강해"),
    audience: oneOf(brief.audience, ["청소년", "청년", "청장년", "장년"], "청장년"),
    audienceSituation: (brief.audienceSituation || "일반").slice(0, 40),
    pointCount: manuscriptItems.length,
    duration: boundedDuration(brief.duration),
    emotion: (brief.emotion || "따뜻함").slice(0, 40),
    sections: {
      introduction: write.fields.introduction.trim(),
      body: manuscriptItems.map((item, index) => ({
        heading: item.title.trim() || `${index + 1}대지`,
        content: item.content.trim(),
      })),
      conclusion: write.fields.conclusion.trim(),
      application: write.fields.application.trim(),
    },
    authorshipMode: "pastor_assisted",
    createdAt: completedAt,
    updatedAt: completedAt,
  };
}

export function sermonHelperSavedSermonMatches(
  actual: SermonRecord,
  expected: SermonRecord,
): boolean {
  return (
    actual.id === expected.id &&
    actual.title === expected.title &&
    actual.scripture === expected.scripture &&
    actual.sermonType === expected.sermonType &&
    actual.audience === expected.audience &&
    actual.audienceSituation === expected.audienceSituation &&
    actual.pointCount === expected.pointCount &&
    actual.duration === expected.duration &&
    actual.emotion === expected.emotion &&
    JSON.stringify(actual.sections) === JSON.stringify(expected.sections)
  );
}

function completionProvenance(
  project: SermonHelperProject,
  completedAt: string,
): SermonHelperProvenanceEntry[] {
  const completionId = `completion_${project.id}`;
  const withoutPreviousCompletion = project.provenance.filter(
    (entry) => entry.id !== completionId,
  );
  if (withoutPreviousCompletion.length >= SERMON_HELPER_MAX_PROVENANCE_ENTRIES) {
    throw new SermonHelperCompletionFailure(
      "incomplete",
      "완료 기록을 저장할 출처 공간이 없습니다.",
      { project, missing: ["완료 출처 기록 공간"] },
    );
  }
  return [
    ...withoutPreviousCompletion,
    {
      id: completionId,
      stepId: "review",
      sourceType: "pastor",
      label: "목회자 직접 작성 설교 완료",
      verified: true,
      createdAt: completedAt,
    },
  ];
}

function integrityFailure(message: string): SermonHelperCompletionFailure {
  return new SermonHelperCompletionFailure("integrity", message);
}

/**
 * Runs after the caller has acquired the project advisory lock. Every query is
 * intentionally executed through the same transaction-bound D1 adapter.
 */
export async function completeSermonHelperWithinLock(
  db: D1Database,
  input: CompleteSermonHelperWithinLockInput,
): Promise<SermonHelperCompletionResult> {
  const project = await ownedProject(db, input.projectId, input.userId);
  if (!project) {
    throw new SermonHelperCompletionFailure(
      "not_found",
      "설교도우미 작업을 찾을 수 없습니다.",
    );
  }

  // Coach reservation and project deletion take this same project row lock
  // before touching the request ledger. Checking the ledger while the lock is
  // held closes the reserve -> complete race without relying on process-local
  // UI state or a different advisory-lock key.
  const pendingCoach = await db
    .prepare(
      `SELECT lease_expires_at
         FROM sermon_helper_coach_requests
        WHERE user_id = ? AND project_id = ? AND status = 'pending'
        ORDER BY lease_expires_at DESC
        LIMIT 1`,
    )
    .bind(input.userId, input.projectId)
    .first<{ lease_expires_at: string }>();
  if (pendingCoach) {
    const leaseExpiresAt = Date.parse(pendingCoach.lease_expires_at);
    const retryAfterSeconds = Number.isFinite(leaseExpiresAt)
      ? Math.max(1, Math.ceil((leaseExpiresAt - Date.now()) / 1_000))
      : 1;
    throw new SermonHelperCompletionFailure(
      "coach_pending",
      "처리 중이거나 환불 확인 중인 AI 코치 요청이 있어 아직 완료할 수 없습니다.",
      { project, retryAfterSeconds },
    );
  }

  if (project.completedSermonId) {
    const expected = sermonFromHelper(project, project.updatedAt);
    const saved = await ownedSermon(
      db,
      project.completedSermonId,
      input.userId,
    );
    if (
      !expected ||
      project.completedSermonId !== expected.id ||
      !saved ||
      !sermonHelperSavedSermonMatches(saved, expected)
    ) {
      throw integrityFailure("완료된 설교와 설교도우미 작업의 연결이 올바르지 않습니다.");
    }
    return { project, sermon: saved, alreadyCompleted: true };
  }
  if (project.status !== "in_progress") {
    throw integrityFailure("완료된 설교도우미 작업의 연결 정보가 없습니다.");
  }
  if (
    project.version !== input.expectedVersion ||
    project.updatedAt !== input.expectedUpdatedAt
  ) {
    throw new SermonHelperCompletionFailure(
      "conflict",
      "다른 창에서 설교도우미 작업이 변경되었습니다.",
      { project },
    );
  }

  const issues = sermonHelperCompletionIssues(project);
  const completedAt = input.completedAt ?? new Date().toISOString();
  const sermon = issues.length ? null : sermonFromHelper(project, completedAt);
  if (!sermon) {
    throw new SermonHelperCompletionFailure(
      "incomplete",
      "설교 완료 조건을 충족하지 못했습니다.",
      { project, missing: issues },
    );
  }
  const provenance = completionProvenance(project, completedAt);
  const completedCandidate: SermonHelperProject = {
    ...project,
    status: "completed",
    provenance,
    completedSermonId: sermon.id,
    version: project.version + 1,
    updatedAt: completedAt,
  };
  if (sermonHelperProjectStorageBytes(completedCandidate) > SERMON_HELPER_MAX_PROJECT_BYTES) {
    throw new SermonHelperCompletionFailure(
      "project_too_large",
      "완료 기록을 포함한 설교도우미 작업의 저장 용량을 초과했습니다.",
      { project },
    );
  }

  const inserted = await db
    .prepare(
      `INSERT INTO sermons
         (id, user_id, draft_id, title, scripture, sermon_type, audience,
          audience_situation, point_count, duration, emotion, body_json,
          created_at, updated_at, deleted_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    )
    .bind(
      sermon.id,
      input.userId,
      sermon.title,
      sermon.scripture,
      sermon.sermonType,
      sermon.audience,
      sermon.audienceSituation,
      sermon.pointCount,
      sermon.duration,
      sermon.emotion,
      JSON.stringify(sermon.sections),
      completedAt,
      completedAt,
    )
    .run();
  if ((inserted.meta.changes ?? 0) !== 1) {
    throw integrityFailure("완료 설교를 저장하지 못했습니다.");
  }

  const completedRow = await db
    .prepare(
      `UPDATE sermon_helper_projects
          SET status = 'completed', completed_sermon_id = ?,
              provenance_json = ?, completed_step_count = ?,
              version = version + 1, updated_at = ?
        WHERE id = ? AND user_id = ? AND deleted_at IS NULL
          AND status = 'in_progress' AND completed_sermon_id IS NULL
          AND version = ? AND updated_at = ?
        RETURNING id, title, scripture, status, current_step_id, steps_json,
                  provenance_json, provenance_mode, completed_sermon_id,
                  version, created_at, updated_at`,
    )
    .bind(
      sermon.id,
      JSON.stringify(provenance),
      SERMON_HELPER_STEP_IDS.filter((stepId) => project.steps[stepId].completed).length,
      completedAt,
      project.id,
      input.userId,
      input.expectedVersion,
      input.expectedUpdatedAt,
    )
    .first<SermonHelperRow>();
  if (!completedRow) {
    const current = await ownedProject(db, input.projectId, input.userId);
    throw new SermonHelperCompletionFailure(
      "conflict",
      "설교도우미 작업 완료 중 다른 변경을 확인했습니다.",
      current ? { project: current } : {},
    );
  }
  const completedProject = sermonHelperProjectFromRow(completedRow);
  const savedSermon = await ownedSermon(db, sermon.id, input.userId);
  if (
    !completedProject ||
    !savedSermon ||
    !sermonHelperSavedSermonMatches(savedSermon, sermon)
  ) {
    throw integrityFailure("완료된 설교의 저장 결과를 확인하지 못했습니다.");
  }
  return {
    project: completedProject,
    sermon: savedSermon,
    alreadyCompleted: false,
  };
}
