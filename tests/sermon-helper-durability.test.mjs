import assert from "node:assert/strict";
import test from "node:test";

function completedProjectRow(project, userId) {
  return {
    id: project.id,
    user_id: userId,
    title: project.title,
    scripture: project.scripture,
    status: project.status,
    current_step_id: project.currentStepId,
    steps_json: JSON.stringify(project.steps),
    provenance_json: JSON.stringify(project.provenance),
    provenance_mode: project.provenanceMode,
    completed_sermon_id: project.completedSermonId,
    completed_step_count: 0,
    version: project.version,
    created_at: project.createdAt,
    updated_at: project.updatedAt,
    deleted_at: null,
  };
}

class FakeStatement {
  constructor(state, query, values = []) {
    this.state = state;
    this.query = query;
    this.values = values;
  }

  bind(...values) {
    return new FakeStatement(this.state, this.query, values);
  }

  async first() {
    if (/FROM sermon_helper_coach_requests/.test(this.query)) {
      return this.state.pendingCoach
        ? structuredClone(this.state.pendingCoach)
        : null;
    }
    if (/^\s*SELECT[\s\S]+FROM sermon_helper_projects/.test(this.query)) {
      const [id, userId] = this.values;
      const row = this.state.project;
      return row && row.id === id && row.user_id === userId && !row.deleted_at
        ? structuredClone(row)
        : null;
    }
    if (/^\s*SELECT[\s\S]+FROM sermons/.test(this.query)) {
      const [id, userId] = this.values;
      const row = this.state.sermon;
      return row && row.id === id && row.user_id === userId && !row.deleted_at
        ? structuredClone(row)
        : null;
    }
    if (/^\s*UPDATE sermon_helper_projects/.test(this.query)) {
      const [
        sermonId,
        provenanceJson,
        completedStepCount,
        completedAt,
        projectId,
        userId,
        expectedVersion,
        expectedUpdatedAt,
      ] = this.values;
      const row = this.state.project;
      if (
        !row ||
        row.id !== projectId ||
        row.user_id !== userId ||
        row.deleted_at ||
        row.status !== "in_progress" ||
        row.completed_sermon_id !== null ||
        Number(row.version) !== Number(expectedVersion) ||
        row.updated_at !== expectedUpdatedAt
      ) {
        return null;
      }
      row.status = "completed";
      row.completed_sermon_id = sermonId;
      row.provenance_json = provenanceJson;
      row.completed_step_count = completedStepCount;
      row.version = Number(row.version) + 1;
      row.updated_at = completedAt;
      return structuredClone(row);
    }
    throw new Error(`Unexpected first() query: ${this.query}`);
  }

  async run() {
    if (!/^\s*INSERT INTO sermons/.test(this.query)) {
      throw new Error(`Unexpected run() query: ${this.query}`);
    }
    if (this.state.sermon) {
      const error = new Error("duplicate sermon id");
      error.code = "23505";
      throw error;
    }
    const [
      id,
      userId,
      title,
      scripture,
      sermonType,
      audience,
      audienceSituation,
      pointCount,
      duration,
      emotion,
      bodyJson,
      createdAt,
      updatedAt,
    ] = this.values;
    this.state.sermon = {
      id,
      user_id: userId,
      title,
      scripture,
      sermon_type: sermonType,
      audience,
      audience_situation: audienceSituation,
      point_count: pointCount,
      duration,
      emotion,
      body_json: bodyJson,
      created_at: createdAt,
      updated_at: updatedAt,
      deleted_at: null,
    };
    this.state.insertCount += 1;
    return { results: [], success: true, meta: { changes: 1 } };
  }
}

class FakeDatabase {
  constructor(state) {
    this.state = state;
  }

  prepare(query) {
    return new FakeStatement(this.state, query);
  }
}

class SerializedFakeTransactionStore {
  constructor(state) {
    this.state = state;
    this.tail = Promise.resolve();
  }

  async withLock(operation) {
    const previous = this.tail;
    let release;
    this.tail = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    const snapshot = structuredClone(this.state);
    try {
      return await operation(new FakeDatabase(this.state));
    } catch (error) {
      Object.assign(this.state, snapshot);
      throw error;
    } finally {
      release();
    }
  }
}

async function readyProject() {
  const [server, contract] = await Promise.all([
    import("../app/_lib/sermon-helper-server.ts"),
    import("../app/_lib/sermon-helper-types.ts"),
  ]);
  const now = "2026-08-21T10:00:00.000Z";
  const project = server.createNewSermonHelperProject(
    "helper-concurrency-12345678",
    "하나님의 사랑",
    "요한복음 3:16-18",
    now,
  );
  project.steps.write.completed = true;
  project.steps.write.fields = {
    introduction: "본문이 오늘 우리에게 건네는 질문으로 시작합니다.",
    conclusion: "복음의 약속을 다시 붙들며 말씀을 맺습니다.",
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
  return { project, now };
}

test("merged helper size and aggregate creation quotas are enforced dynamically", async () => {
  const [server, contract] = await Promise.all([
    import("../app/_lib/sermon-helper-server.ts"),
    import("../app/_lib/sermon-helper-types.ts"),
  ]);
  const project = server.createNewSermonHelperProject(
    "helper-size-12345678",
    "용량 검사",
    "요한복음 3:16",
    "2026-08-21T10:00:00.000Z",
  );
  assert.ok(
    server.sermonHelperProjectStorageBytes(project) <
      contract.SERMON_HELPER_MAX_PROJECT_BYTES,
  );
  for (const stepId of contract.SERMON_HELPER_STEP_IDS) {
    project.steps[stepId].notes = "n".repeat(30_000);
    project.steps[stepId].fields = {
      first: "a".repeat(30_000),
      second: "b".repeat(30_000),
    };
  }
  assert.equal(contract.validateStoredSermonHelperSteps(project.steps).ok, true);
  assert.ok(
    server.sermonHelperProjectStorageBytes(project) >
      contract.SERMON_HELPER_MAX_PROJECT_BYTES,
  );

  assert.equal(server.sermonHelperProjectLimit({ active: 29, total: 199, recent: 19 }), null);
  assert.equal(server.sermonHelperProjectLimit({ active: 29, total: 199, recent: 20 }), "rate");
  assert.equal(server.sermonHelperProjectLimit({ active: 30, total: 199, recent: 0 }), "active");
  assert.equal(server.sermonHelperProjectLimit({ active: 0, total: 200, recent: 0 }), "total");

  const summary = server.sermonHelperSummaryFromRow({
    id: "helper-summary-12345678",
    title: "경량 목록",
    scripture: "로마서 8:1",
    status: "in_progress",
    current_step_id: "message",
    provenance_mode: "pastor_assisted",
    completed_sermon_id: null,
    completed_step_count: "3",
    version: "4",
    created_at: "2026-08-21T10:00:00.000Z",
    updated_at: "2026-08-21T10:03:00.000Z",
  });
  assert.equal(summary?.completedStepCount, 3);
  assert.equal(summary?.version, 4);
});

test("two serialized completion attempts insert one sermon and replay the owned result", async () => {
  const { completeSermonHelperWithinLock } = await import(
    "../app/_lib/sermon-helper-completion.ts"
  );
  const { project, now } = await readyProject();
  const userId = "user-concurrency-12345678";
  const state = {
    project: completedProjectRow(project, userId),
    sermon: null,
    insertCount: 0,
    pendingCoach: null,
  };
  const store = new SerializedFakeTransactionStore(state);
  const input = {
    projectId: project.id,
    userId,
    expectedVersion: project.version,
    expectedUpdatedAt: project.updatedAt,
    completedAt: "2026-08-21T10:05:00.000Z",
  };

  const [first, replay] = await Promise.all([
    store.withLock((db) => completeSermonHelperWithinLock(db, input)),
    store.withLock((db) => completeSermonHelperWithinLock(db, input)),
  ]);

  assert.equal(first.alreadyCompleted, false);
  assert.equal(replay.alreadyCompleted, true);
  assert.equal(first.sermon.id, `helper_${project.id}`);
  assert.equal(replay.sermon.id, first.sermon.id);
  assert.equal(state.insertCount, 1);
  assert.equal(state.project.status, "completed");
  assert.equal(state.project.version, project.version + 1);
  assert.notEqual(state.project.updated_at, now);
});

test("a pending coach ledger blocks completion while the project row is locked", async () => {
  const {
    completeSermonHelperWithinLock,
    SermonHelperCompletionFailure,
  } = await import("../app/_lib/sermon-helper-completion.ts");
  const { project } = await readyProject();
  const userId = "user-pending-coach-12345678";
  const state = {
    project: completedProjectRow(project, userId),
    sermon: null,
    insertCount: 0,
    pendingCoach: { lease_expires_at: "2026-08-21T10:10:00.000Z" },
  };
  const store = new SerializedFakeTransactionStore(state);

  await assert.rejects(
    () => store.withLock((db) => completeSermonHelperWithinLock(db, {
      projectId: project.id,
      userId,
      expectedVersion: project.version,
      expectedUpdatedAt: project.updatedAt,
      completedAt: "2026-08-21T10:05:00.000Z",
    })),
    (error) => {
      assert.ok(error instanceof SermonHelperCompletionFailure);
      assert.equal(error.kind, "coach_pending");
      assert.ok((error.retryAfterSeconds ?? 0) >= 1);
      return true;
    },
  );
  assert.equal(state.insertCount, 0);
  assert.equal(state.sermon, null);
  assert.equal(state.project.status, "in_progress");
});
