import assert from "node:assert/strict";
import test from "node:test";

const store = await import(
  new URL("../app/_lib/sermon-store.ts", import.meta.url)
);

function alternative(id = "alternative-1") {
  return {
    id,
    title: "돌아갈 초안",
    summary: "저장된 설교 초안 요약입니다.",
    scripture: "요한복음 3:16-18",
    sections: {
      introduction: "도입",
      points: [{ heading: "첫째", content: "본문" }],
      conclusion: "결론",
      application: "적용",
    },
  };
}

function draftAt(stage) {
  return { ...store.createEmptySermonDraft(), id: "draft-resume", stage };
}

test("returns to every saved sermon stage after leaving the workspace", () => {
  const options = draftAt("options");
  assert.equal(store.sermonDraftResumeUrl(options), "/sermon/options?draftId=draft-resume");

  const input = draftAt("input");
  assert.equal(store.sermonDraftResumeUrl(input), "/sermon/input?draftId=draft-resume");

  const generating = {
    ...draftAt("generating"),
    generation: store.createSermonGeneration("initial", 5),
  };
  assert.equal(store.sermonDraftResumeUrl(generating), "/sermon/input?draftId=draft-resume");

  const alternatives = {
    ...draftAt("alternatives"),
    alternatives: Array.from({ length: 5 }, (_, index) => alternative(`alternative-${index + 1}`)),
  };
  assert.equal(
    store.sermonDraftResumeUrl(alternatives),
    "/sermon/alternatives?draftId=draft-resume",
  );

  const editing = {
    ...alternatives,
    stage: "editing",
    selectedAlternativeId: "alternative-1",
  };
  assert.equal(store.sermonDraftResumeUrl(editing), "/sermon/edit?draftId=draft-resume");

  const completed = {
    ...editing,
    stage: "completed",
    completedAt: new Date().toISOString(),
  };
  assert.equal(store.sermonDraftResumeUrl(completed), "/sermon/complete?draftId=draft-resume");
});

test("returns an in-progress regeneration to the saved alternatives", () => {
  const current = {
    ...draftAt("generating"),
    alternatives: [alternative()],
    generation: store.createSermonGeneration("regenerate", 5),
  };
  assert.equal(
    store.sermonDraftResumeUrl(current),
    "/sermon/alternatives?draftId=draft-resume",
  );
});

test("keeps a deliberate options edit distinct from a resume entry", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL("../app/_components/sermon-options.tsx", import.meta.url),
      "utf8",
    ),
  );
  assert.match(source, /if \(!ready \|\| !draft \|\| queryDraftId\) return/);
  assert.match(source, /router\.replace\(sermonDraftResumeUrl\(draft\)\)/);
});
