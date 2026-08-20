// Verifies app/_lib/bible/krv-bible.json and cross-references.json.
// Run: node scripts/verify-bible-data.mjs  (exit 1 on any failure)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BIBLE_PATH = path.join(ROOT, "app", "_lib", "bible", "krv-bible.json");
const XREF_PATH = path.join(ROOT, "app", "_lib", "bible", "cross-references.json");

let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const { books } = JSON.parse(fs.readFileSync(BIBLE_PATH, "utf8"));
const { refs } = JSON.parse(fs.readFileSync(XREF_PATH, "utf8"));

// (a) 66 books, canonical first/last names
check(Array.isArray(books) && books.length === 66, "66 books", `got ${books?.length}`);
check(books[0]?.name === "창세기" && books[65]?.name === "요한계시록", "canonical order endpoints",
  `${books[0]?.name}..${books[65]?.name}`);

// (b) total verse count (개역한글: 31,103 — KJV 31,102 with 아가 +1, 요삼 +1, 고후 -1)
const total = books.reduce((s, b) => s + b.chapters.reduce((t, c) => t + c.length, 0), 0);
check(total >= 31000 && total <= 31200, "total verses in 31,000..31,200", `got ${total}`);
const empty = books.reduce((s, b) => s + b.chapters.reduce((t, c) => t + c.filter((v) => !v).length, 0), 0);
check(empty === 0, "no empty verses", `empty=${empty}`);

// (c) five sample verses
const get = (bi, c, v) => books[bi]?.chapters[c - 1]?.[v - 1] ?? "";
const samples = [
  [0, 1, 1, "태초에 하나님이 천지를 창조하시니라", "창세기 1:1"],
  [42, 3, 16, "독생자", "요한복음 3:16"],
  [18, 23, 1, "여호와는 나의 목자", "시편 23:1"],
  [44, 8, 28, "하나님을 사랑하는", "로마서 8:28"],
  [39, 28, 20, "세상 끝날까지 너희와 항상 함께", "마태복음 28:20"],
];
for (const [bi, c, v, needle, label] of samples) {
  check(get(bi, c, v).includes(needle), `sample ${label}`, get(bi, c, v).slice(0, 40));
}

// (d) cross-reference integrity: 1,000-key deterministic sample
const verseExists = (bi, c, v) => {
  const ch = books[bi]?.chapters[c - 1];
  return !!ch && v >= 1 && v <= ch.length && !!ch[v - 1];
};
const keys = Object.keys(refs);
check(keys.length > 0, "cross-reference keys present", `keys=${keys.length}`);
const step = Math.max(1, Math.floor(keys.length / 1000));
let sampled = 0, badKey = 0, badRef = 0;
for (let i = 0; i < keys.length && sampled < 1000; i += step) {
  const key = keys[i];
  sampled++;
  const [bi, c, v] = key.split(".").map(Number);
  if (!verseExists(bi, c, v)) { badKey++; continue; }
  for (const r of refs[key]) {
    const [tb, sc, sv, ec, ev] = r;
    if (!verseExists(tb, sc, sv)) { badRef++; continue; }
    if ((ec || ev) && !verseExists(tb, ec, ev)) badRef++;
  }
}
check(badKey === 0, `sampled ${sampled} from-verse keys exist in KRV`, `bad=${badKey}`);
check(badRef === 0, "sampled target refs exist in KRV", `bad=${badRef}`);

const totalRefs = keys.reduce((s, k) => s + refs[k].length, 0);
console.log(`stats: totalVerses=${total} fromVerses=${keys.length} totalRefs=${totalRefs}`);
if (failures > 0) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("all checks passed");
