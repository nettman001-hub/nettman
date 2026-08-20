// Regenerates the bundler-portable data modules from the source JSON files.
// A single string literal parses instantly in tsc/eslint and loads in every
// runtime (Node tests, Next.js serverless, vinext worker) without JSON import
// attributes. Run after updating the JSON sources, then commit the output.
import { readFile, writeFile } from "node:fs/promises";

const targets = [
  {
    source: new URL("../app/_lib/bible/krv-bible.json", import.meta.url),
    output: new URL("../app/_lib/bible/krv-bible.data.ts", import.meta.url),
    exportName: "krvBibleJson",
    label: "개역한글판(1961) 본문",
  },
  {
    source: new URL("../app/_lib/bible/cross-references.json", import.meta.url),
    output: new URL("../app/_lib/bible/cross-references.data.ts", import.meta.url),
    exportName: "crossReferencesJson",
    label: "TSK 교차참조 (OpenBible.info, CC-BY)",
  },
];

for (const target of targets) {
  const raw = await readFile(target.source, "utf8");
  const compact = JSON.stringify(JSON.parse(raw));
  const literal = JSON.stringify(compact);
  const banner =
    `// 자동 생성 파일 — 직접 수정하지 말고 scripts/build-bible-data.mjs를 실행하세요.\n` +
    `// 원본: ${target.label}. 라이선스는 app/_lib/bible/LICENSES.md 참조.\n`;
  await writeFile(
    target.output,
    `${banner}export const ${target.exportName}: string = ${literal};\n`,
    "utf8",
  );
  console.log(`${target.output.pathname} ← ${(compact.length / 1024 / 1024).toFixed(2)} MB`);
}
