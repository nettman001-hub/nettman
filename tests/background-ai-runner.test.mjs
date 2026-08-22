import assert from "node:assert/strict";
import test from "node:test";

const runner = await import(
  new URL("../app/_lib/background-ai-runner.ts", import.meta.url)
);

test("keeps an AI request alive after a page subscriber leaves", async () => {
  const observed = [];
  const unsubscribe = runner.subscribeBackgroundAiRun((state) => {
    observed.push(state?.status ?? "none");
  });
  let finish;
  const deferred = new Promise((resolve) => {
    finish = resolve;
  });
  const handle = runner.startBackgroundAiRun({
    id: crypto.randomUUID(),
    key: "resource:study",
    kind: "resource",
    label: "스터디 생성",
    targetHref: "/study",
    execute: () => deferred,
  });
  unsubscribe();

  assert.equal(runner.getBackgroundAiRunState()?.status, "running");
  finish({ title: "완료" });
  assert.deepEqual(await handle.promise, { title: "완료" });
  assert.equal(runner.getBackgroundAiRunState()?.status, "completed");
  assert.ok(observed.includes("running"));
});

test("exposes one global stop action and preserves a stopped terminal state", async () => {
  const handle = runner.startBackgroundAiRun({
    id: crypto.randomUUID(),
    key: "resource:ministry",
    kind: "resource",
    label: "사역 자료 생성",
    targetHref: "/ministry",
    execute: (signal) => new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new DOMException("aborted", "AbortError"));
        return;
      }
      signal.addEventListener(
        "abort",
        () => reject(new DOMException("aborted", "AbortError")),
        { once: true },
      );
      void resolve;
    }),
  });

  runner.stopBackgroundAiRun(handle.id);
  await assert.rejects(handle.promise, { name: "AbortError" });
  assert.equal(runner.getBackgroundAiRunState()?.status, "stopped");
  assert.equal(runner.isBackgroundAiRunActive(), false);
});

test("rejects a second non-sermon AI request while one is running", async () => {
  let finish;
  const deferred = new Promise((resolve) => {
    finish = resolve;
  });
  const first = runner.startBackgroundAiRun({
    id: crypto.randomUUID(),
    key: "helper-coach:project",
    kind: "helper-coach",
    label: "AI 코치",
    targetHref: "/sermon-helper?id=project",
    execute: () => deferred,
  });

  assert.throws(
    () =>
      runner.startBackgroundAiRun({
        key: "resource:study",
        kind: "resource",
        label: "스터디",
        targetHref: "/study",
        execute: async () => null,
      }),
    runner.BackgroundAiRunBusyError,
  );
  finish("done");
  await first.promise;
});
