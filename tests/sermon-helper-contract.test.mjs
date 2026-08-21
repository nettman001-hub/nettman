import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

function stepInput(overrides = {}) {
  return {
    completed: false,
    notes: "목회자가 직접 기록한 메모",
    fields: { audience: "청장년" },
    items: [],
    ...overrides,
  };
}

test("sermon helper contract fixes eight pastor-led steps and bounded provenance", async () => {
  const contract = await import("../app/_lib/sermon-helper-types.ts");

  assert.deepEqual(contract.SERMON_HELPER_STEP_IDS, [
    "brief",
    "observe",
    "interpret",
    "message",
    "outline",
    "apply",
    "write",
    "review",
  ]);
  const now = "2026-08-21T10:00:00.000Z";
  const steps = contract.createEmptySermonHelperSteps(now);
  assert.equal(Object.keys(steps).length, 8);
  assert.equal(steps.write.completed, false);
  assert.equal(steps.review.updatedAt, now);

  const acceptedSuggestion = {
    id: "source-123",
    stepId: "message",
    sourceType: "ai_suggestion",
    label: "중심 메시지 명료화 제안",
    excerpt: "하나님의 사랑은 그리스도 안에서 먼저 찾아오신 사랑입니다.",
    verified: false,
    createdAt: now,
  };
  const provenance = contract.validateSermonHelperProvenance([acceptedSuggestion]);
  assert.equal(provenance.ok, true);

  const unsafeSource = {
    ...acceptedSuggestion,
    id: "source-unsafe",
    sourceUrl: "javascript:alert(1)",
  };
  assert.equal(contract.validateSermonHelperProvenance([unsafeSource]).ok, false);
});

test("sermon helper patch requires optimistic version and complete step replacement", async () => {
  const { validateDeleteSermonHelperInput, validatePatchSermonHelperInput } = await import(
    "../app/_lib/sermon-helper-types.ts"
  );
  const expectedUpdatedAt = "2026-08-21T10:00:00.000Z";
  const valid = validatePatchSermonHelperInput({
    expectedVersion: 3,
    expectedUpdatedAt,
    patch: { steps: { observe: stepInput() }, currentStepId: "interpret" },
  });
  assert.equal(valid.ok, true);

  assert.equal(
    validatePatchSermonHelperInput({
      expectedVersion: 3,
      expectedUpdatedAt,
      patch: { steps: { observe: { notes: "부분 덮어쓰기" } } },
    }).ok,
    false,
  );
  assert.equal(
    validatePatchSermonHelperInput({
      expectedVersion: 0,
      expectedUpdatedAt,
      patch: { title: "새 제목" },
    }).ok,
    false,
  );
  assert.equal(
    validatePatchSermonHelperInput({
      expectedVersion: 3,
      expectedUpdatedAt,
      patch: { steps: { observe: stepInput({ notes: "가".repeat(30_001) }) } },
    }).ok,
    false,
  );
  assert.equal(
    validateDeleteSermonHelperInput({ expectedVersion: 3, expectedUpdatedAt }).ok,
    true,
  );
  assert.equal(
    validateDeleteSermonHelperInput({ expectedVersion: 0, expectedUpdatedAt }).ok,
    false,
  );
});

test("sermon helper completion requires the full pastor review and manuscript", async () => {
  const [{ createNewSermonHelperProject, sermonHelperCompletionIssues }, contract] =
    await Promise.all([
      import("../app/_lib/sermon-helper-server.ts"),
      import("../app/_lib/sermon-helper-types.ts"),
    ]);
  const now = "2026-08-21T10:00:00.000Z";
  const project = createNewSermonHelperProject(
    "helper-completion-12345678",
    "하나님의 사랑",
    "요한복음 3:16-18",
    now,
  );
  project.steps.write.completed = true;
  project.steps.write.fields = {
    introduction: "회중의 현실에서 본문의 질문을 엽니다.",
    conclusion: "복음의 초대 안에서 말씀을 다시 붙듭니다.",
    application: "이번 주 한 사람에게 먼저 사랑으로 다가갑니다.",
  };
  project.steps.write.items = [
    {
      id: "manuscript-point-12345678",
      kind: "manuscript",
      title: "하나님이 먼저 사랑하셨습니다",
      content: "본문은 사랑의 시작과 주체가 하나님이심을 증언합니다.",
      provenanceIds: [],
    },
  ];
  project.steps.review.completed = true;
  project.steps.review.fields = Object.fromEntries(
    contract.SERMON_HELPER_REVIEW_FIELD_KEYS.map((field) => [field, "true"]),
  );
  project.steps.review.fields[contract.SERMON_HELPER_REVIEW_FINGERPRINT_FIELD] =
    contract.sermonHelperReviewContentFingerprint(project);
  assert.deepEqual(sermonHelperCompletionIssues(project), []);

  project.steps.write.fields.conclusion = "";
  project.steps.review.fields.sourcesChecked = "false";
  assert.deepEqual(sermonHelperCompletionIssues(project), [
    "결론",
    "목회자 최종 확인 6개 항목",
  ]);
});

test("scripture and non-review edits invalidate stale pastoral review", async () => {
  const [server, contract] = await Promise.all([
    import("../app/_lib/sermon-helper-server.ts"),
    import("../app/_lib/sermon-helper-types.ts"),
  ]);
  const now = "2026-08-21T10:00:00.000Z";
  const project = server.createNewSermonHelperProject(
    "helper-review-freshness-12345678",
    "사랑의 복음",
    "요한복음 3:16-18",
    now,
  );
  project.steps.observe.fields = {
    canonicalScripture: project.scripture,
    scriptureVerification: "pastor-confirmed",
  };
  project.steps.write.completed = true;
  project.steps.write.fields = {
    introduction: "도입",
    conclusion: "결론",
    application: "적용",
  };
  project.steps.write.items = [
    {
      id: "review-point-12345678",
      kind: "manuscript",
      title: "첫 대지",
      content: "본문을 충실하게 설명한 원고입니다.",
      provenanceIds: [],
    },
  ];
  project.steps.review.completed = true;
  project.steps.review.fields = Object.fromEntries(
    contract.SERMON_HELPER_REVIEW_FIELD_KEYS.map((key) => [key, "true"]),
  );
  project.steps.review.fields[contract.SERMON_HELPER_REVIEW_FINGERPRINT_FIELD] =
    contract.sermonHelperReviewContentFingerprint(project);
  assert.equal(contract.sermonHelperReviewIsFresh(project), true);

  const typedScripture = contract.reconcileSermonHelperReview(
    project,
    contract.clearSermonHelperScriptureVerification(project, {
      ...project,
      scripture: "요한복음 3:16-20",
    }),
  );
  assert.equal(typedScripture.steps.observe.fields.scriptureVerification, undefined);
  assert.equal(typedScripture.steps.observe.fields.canonicalScripture, undefined);
  assert.equal(typedScripture.steps.review.completed, false);
  for (const key of contract.SERMON_HELPER_REVIEW_FIELD_KEYS) {
    assert.equal(typedScripture.steps.review.fields[key], undefined);
  }

  const editedWrite = {
    completed: project.steps.write.completed,
    notes: project.steps.write.notes,
    fields: project.steps.write.fields,
    items: project.steps.write.items.map((item) => ({
      ...item,
      content: `${item.content} 수정`,
    })),
  };
  const merged = server.mergeSermonHelperPatch(
    project,
    {
      expectedVersion: project.version,
      expectedUpdatedAt: project.updatedAt,
      patch: { steps: { write: editedWrite } },
    },
    "2026-08-21T10:01:00.000Z",
  );
  assert.equal(merged.steps.review.completed, false);
  assert.equal(contract.sermonHelperReviewIsFresh(merged), false);

  const stale = structuredClone(project);
  stale.steps.write.items[0].content += " 저장소 우회 수정";
  assert.ok(
    server
      .sermonHelperCompletionIssues(stale)
      .includes("최종 점검 이후 변경된 내용 재확인"),
  );

  const provenanceChanged = server.mergeSermonHelperPatch(
    project,
    {
      expectedVersion: project.version,
      expectedUpdatedAt: project.updatedAt,
      patch: {
        provenance: [
          {
            id: "source-after-review-12345678",
            stepId: "observe",
            sourceType: "pastor",
            label: "검토 뒤 추가한 출처",
            verified: true,
            createdAt: now,
          },
        ],
      },
    },
    "2026-08-21T10:02:00.000Z",
  );
  assert.equal(provenanceChanged.steps.review.completed, false);
});

test("soft-deleted helper projects retain only a content-free tombstone", async () => {
  const server = await import("../app/_lib/sermon-helper-server.ts");
  const project = server.createNewSermonHelperProject(
    "helper-delete-redaction-12345678",
    "삭제되어야 할 민감한 제목",
    "민감한 본문 표기",
    "2026-08-21T10:00:00.000Z",
  );
  project.steps.write.notes = "삭제되어야 할 원고";
  project.provenance = [
    {
      id: "private-source-12345678",
      stepId: "write",
      sourceType: "pastor",
      label: "삭제되어야 할 출처",
      verified: true,
      createdAt: project.createdAt,
    },
  ];
  const tombstone = server.redactDeletedSermonHelperProject(
    project,
    "2026-08-21T10:03:00.000Z",
  );
  const serialized = JSON.stringify(tombstone);
  assert.equal(tombstone.title, "삭제된 설교 준비");
  assert.equal(tombstone.scripture, "");
  assert.equal(tombstone.provenance.length, 0);
  assert.equal(tombstone.steps.write.notes, "");
  assert.equal(tombstone.version, project.version + 1);
  for (const secret of [
    "삭제되어야 할 민감한 제목",
    "민감한 본문 표기",
    "삭제되어야 할 원고",
    "삭제되어야 할 출처",
  ]) {
    assert.equal(serialized.includes(secret), false);
  }
});

test("sermon helper persistence is owner-scoped and independent from generated drafts", async () => {
  const [schema, runtimeDb, collectionRoute, itemRoute, migration, secureTables, auth] =
    await Promise.all([
      source("db/schema.ts"),
      source("db/index.ts"),
      source("app/api/sermon-helper/route.ts"),
      source("app/api/sermon-helper/[id]/route.ts"),
      source("drizzle/0016_strong_thunderball.sql"),
      source("scripts/secure-supabase-tables.mjs"),
      source("app/_lib/auth-user.ts"),
    ]);

  for (const text of [schema, runtimeDb, migration, secureTables, auth]) {
    assert.match(text, /sermon_helper_projects/);
  }
  assert.match(runtimeDb, /ALTER TABLE \$\{table\} ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /idx_sermon_helper_projects_completed_sermon/);
  assert.match(migration, /completed_step_count/);
  assert.match(collectionRoute, /WHERE user_id = \?/);
  const listHandler = collectionRoute.slice(0, collectionRoute.indexOf("export async function POST"));
  assert.doesNotMatch(listHandler, /steps_json|provenance_json/);
  assert.match(collectionRoute, /withDatabaseAdvisoryLock/);
  assert.match(collectionRoute, /sermonHelperProjectLimit/);
  assert.match(
    collectionRoute,
    /DELETE FROM sermon_helper_projects[\s\S]*deleted_at IS NOT NULL[\s\S]*deleted_at < \?/,
  );
  assert.match(
    collectionRoute,
    /SUM\(CASE WHEN deleted_at IS NULL THEN 1 ELSE 0 END\) AS total_count/,
  );
  assert.match(
    collectionRoute,
    /SUM\(CASE WHEN created_at >= \? THEN 1 ELSE 0 END\) AS recent_count[\s\S]*WHERE user_id = \?`/,
  );
  assert.match(itemRoute, /WHERE id = \? AND user_id = \?/);
  assert.match(itemRoute, /version = \? AND updated_at = \?/);
  assert.match(itemRoute, /sermonHelperProjectStorageBytes/);
  assert.match(itemRoute, /SERMON_HELPER_MAX_PROJECT_BYTES/);
  assert.match(itemRoute, /code: "version_conflict"|sermonHelperConflictResponse/);
  assert.match(itemRoute, /export async function DELETE/);
  assert.match(itemRoute, /FOR UPDATE/);
  assert.match(itemRoute, /status = 'pending'/);
  assert.match(itemRoute, /code: "coach_request_pending"/);
  assert.match(itemRoute, /completed_project_preserved/);
  assert.match(itemRoute, /title = \?, scripture = ''/);
  assert.match(itemRoute, /steps_json = \?, provenance_json = '\[\]'/);
  assert.match(itemRoute, /completed_step_count = 0, deleted_at = \?/);
  assert.doesNotMatch(collectionRoute, /sermon_drafts|sermon_generation_runs/);
  assert.doesNotMatch(itemRoute, /sermon_drafts|sermon_generation_runs/);
});

test("sermon helper completion is idempotent and writes only pastor-authored sections", async () => {
  const [route, completion, sermonsRoute, sermonRoute, data] = await Promise.all([
    source("app/api/sermon-helper/[id]/complete/route.ts"),
    source("app/_lib/sermon-helper-completion.ts"),
    source("app/api/sermons/route.ts"),
    source("app/api/sermons/[id]/route.ts"),
    source("app/_lib/data.ts"),
  ]);

  assert.match(route, /withDatabaseAdvisoryLock/);
  assert.match(route, /reconcileExpiredSermonHelperCoachRequests/);
  assert.match(route, /code: "coach_request_pending"/);
  assert.match(route, /completeSermonHelperWithinLock/);
  assert.match(route, /alreadyCompleted: result\.alreadyCompleted/);
  assert.match(completion, /project\.completedSermonId/);
  assert.match(completion, /alreadyCompleted: true/);
  assert.match(completion, /id: `helper_\$\{project\.id\}`/);
  assert.match(completion, /item\.kind === "manuscript"/);
  assert.match(completion, /sermonHelperCompletionIssues\(project\)/);
  assert.match(completion, /draft_id[\s\S]*VALUES \(\?, \?, NULL/);
  assert.match(completion, /pastor_assisted|sourceType: "pastor"/);
  assert.match(completion, /version = \? AND updated_at = \?/);
  assert.match(completion, /sermonHelperSavedSermonMatches/);
  assert.match(completion, /FROM sermon_helper_projects[\s\S]*FOR UPDATE/);
  assert.match(completion, /FROM sermon_helper_coach_requests[\s\S]*status = 'pending'/);
  assert.ok(
    completion.indexOf("FROM sermon_helper_projects") <
      completion.indexOf("FROM sermon_helper_coach_requests"),
    "completion must lock the project row before checking the coach ledger",
  );
  assert.doesNotMatch(completion, /ON CONFLICT\(id\) DO NOTHING/);
  assert.ok(
    completion.indexOf("INSERT INTO sermons") <
      completion.indexOf("UPDATE sermon_helper_projects"),
    "sermon insert must precede the conditional helper update in one transaction",
  );
  assert.doesNotMatch(`${route}\n${completion}`, /sermon_generation|openai|generateSermon/);
  for (const historyApi of [sermonsRoute, sermonRoute]) {
    assert.match(historyApi, /sermon_helper_projects helper/);
    assert.match(historyApi, /pastor_assisted/);
    assert.match(historyApi, /ai_generated/);
  }
  assert.match(data, /SermonAuthorshipMode = "pastor_assisted" \| "ai_generated"/);
});
