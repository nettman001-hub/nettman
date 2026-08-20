/**
 * Deterministic lookup over the bundled 개역한글판(1961) text and the TSK
 * cross-reference dataset (see LICENSES.md in this directory). References are
 * resolved by exact book/chapter/verse keys — no AI and no network involved —
 * so generation prompts can quote real scripture instead of model memory.
 */

type BibleData = {
  books: Array<{ name: string; abbr: string; chapters: string[][] }>;
};

type CrossReferenceData = {
  refs: Record<string, number[][]>;
};

export type ScriptureRange = {
  bookIndex: number;
  book: string;
  startChapter: number;
  startVerse: number;
  endChapter: number;
  endVerse: number;
};

export type ScripturePassageVerse = {
  chapter: number;
  verse: number;
  text: string;
};

export type ScripturePassage = {
  range: ScriptureRange;
  verses: ScripturePassageVerse[];
  totalVerses: number;
  truncated: boolean;
};

const DEFAULT_MAX_PASSAGE_VERSES = 60;

let bibleCache: BibleData | null = null;
let crossReferenceCache: CrossReferenceData | null = null;
let bookIndexByName: Map<string, number> | null = null;

async function loadBible(): Promise<BibleData> {
  if (!bibleCache) {
    const { krvBibleJson } = await import("./krv-bible.data.ts");
    bibleCache = JSON.parse(krvBibleJson) as BibleData;
  }
  return bibleCache;
}

async function loadCrossReferences(): Promise<CrossReferenceData> {
  if (!crossReferenceCache) {
    const { crossReferencesJson } = await import("./cross-references.data.ts");
    crossReferenceCache = JSON.parse(crossReferencesJson) as CrossReferenceData;
  }
  return crossReferenceCache;
}

async function bookIndex(book: string): Promise<number> {
  if (!bookIndexByName) {
    const bible = await loadBible();
    bookIndexByName = new Map(bible.books.map((entry, index) => [entry.name, index]));
  }
  return bookIndexByName.get(book) ?? -1;
}

const REFERENCE_PATTERN = /^(.+?)\s+(\d{1,3}):(\d{1,3})(?:-(?:(\d{1,3}):)?(\d{1,3}))?$/;

/** Parses the server-canonical "책 장:절[-장:절|절]" reference format. */
export async function parseScriptureReference(
  reference: string,
): Promise<ScriptureRange | null> {
  const match = REFERENCE_PATTERN.exec(reference.trim());
  if (!match) return null;
  const book = match[1].trim();
  const index = await bookIndex(book);
  if (index < 0) return null;
  const startChapter = Number(match[2]);
  const startVerse = Number(match[3]);
  const endChapter = match[4] ? Number(match[4]) : startChapter;
  const endVerse = match[5] ? Number(match[5]) : startVerse;
  if (
    endChapter < startChapter ||
    (endChapter === startChapter && endVerse < startVerse)
  ) {
    return null;
  }
  return { bookIndex: index, book, startChapter, startVerse, endChapter, endVerse };
}

/**
 * Returns the passage text for a canonical reference, front-and-back biased
 * when the range exceeds maxVerses so long readings stay within budget.
 */
export async function getScripturePassage(
  reference: string,
  options: { maxVerses?: number } = {},
): Promise<ScripturePassage | null> {
  const range = await parseScriptureReference(reference);
  if (!range) return null;
  const bible = await loadBible();
  const chapters = bible.books[range.bookIndex]?.chapters;
  if (!chapters) return null;

  const verses: ScripturePassageVerse[] = [];
  for (let chapter = range.startChapter; chapter <= range.endChapter; chapter += 1) {
    const chapterVerses = chapters[chapter - 1];
    if (!chapterVerses) return null;
    const first = chapter === range.startChapter ? range.startVerse : 1;
    const last = chapter === range.endChapter ? range.endVerse : chapterVerses.length;
    if (first < 1 || last > chapterVerses.length) return null;
    for (let verse = first; verse <= last; verse += 1) {
      verses.push({ chapter, verse, text: chapterVerses[verse - 1] });
    }
  }

  const maxVerses = Math.max(1, options.maxVerses ?? DEFAULT_MAX_PASSAGE_VERSES);
  if (verses.length <= maxVerses) {
    return { range, verses, totalVerses: verses.length, truncated: false };
  }
  const headCount = Math.ceil(maxVerses * 0.7);
  const tailCount = maxVerses - headCount;
  return {
    range,
    verses: [...verses.slice(0, headCount), ...verses.slice(verses.length - tailCount)],
    totalVerses: verses.length,
    truncated: true,
  };
}

/** Formats a passage as a prompt block the model may quote from verbatim. */
export function scripturePassagePromptBlock(passage: ScripturePassage): string {
  const lines = passage.verses.map(
    (verse) => `${verse.chapter}:${verse.verse} ${verse.text}`,
  );
  const note = passage.truncated
    ? `\n(본문이 길어 전체 ${passage.totalVerses}절 중 앞뒤 ${passage.verses.length}절만 제공합니다. 생략 구간은 흐름만 요약해 다루세요.)`
    : "";
  return [
    `개역한글판(1961) 본문 — ${passage.range.book} ${passage.range.startChapter}:${passage.range.startVerse}-${passage.range.endChapter}:${passage.range.endVerse}`,
    lines.join("\n"),
  ].join("\n") + note;
}

/**
 * TSK cross references (OpenBible.info, CC-BY) for the opening verses of the
 * passage, formatted as Korean references.
 */
export async function getScriptureCrossReferences(
  reference: string,
  limit = 6,
): Promise<string[]> {
  const range = await parseScriptureReference(reference);
  if (!range) return [];
  const [bible, data] = await Promise.all([loadBible(), loadCrossReferences()]);
  const results: string[] = [];
  const seen = new Set<string>();
  const startKeys: string[] = [];
  let chapter = range.startChapter;
  let verse = range.startVerse;
  for (let index = 0; index < 3; index += 1) {
    startKeys.push(`${range.bookIndex}.${chapter}.${verse}`);
    verse += 1;
    const chapterVerses = bible.books[range.bookIndex]?.chapters[chapter - 1];
    if (chapterVerses && verse > chapterVerses.length && chapter < range.endChapter) {
      chapter += 1;
      verse = 1;
    }
  }
  for (const key of startKeys) {
    for (const entry of data.refs[key] ?? []) {
      const [book, startChapterRef, startVerseRef, endChapterRef, endVerseRef] = entry;
      const bookName = bible.books[book]?.name;
      if (!bookName) continue;
      const start = `${bookName} ${startChapterRef}:${startVerseRef}`;
      const formatted =
        endChapterRef && endVerseRef
          ? endChapterRef === startChapterRef
            ? `${start}-${endVerseRef}`
            : `${start}-${endChapterRef}:${endVerseRef}`
          : start;
      if (seen.has(formatted)) continue;
      seen.add(formatted);
      results.push(formatted);
      if (results.length >= limit) return results;
    }
  }
  return results;
}

function normalizeQuoteText(value: string): string {
  return value.normalize("NFC").replace(/[\s"'「」『』“”‘’.,;:!?·…()-]/g, "");
}

/**
 * Deterministic quote check: returns quoted fragments that claim to be
 * scripture but do not appear in the provided passage. Only clearly quoted
 * Korean segments are checked, and the result is advisory repair feedback —
 * never a hard rejection — so illustrations quoting people stay unaffected.
 */
export function findUnmatchedScriptureQuotes(
  manuscript: string,
  passage: ScripturePassage,
  maxFindings = 3,
): string[] {
  const passageNormalized = normalizeQuoteText(
    passage.verses.map((verse) => verse.text).join(""),
  );
  const findings: string[] = [];
  const quotePattern = /[“"「『]([^”"」』]{12,120})[”"」』]/g;
  for (const match of manuscript.matchAll(quotePattern)) {
    const fragment = match[1].trim();
    // Only treat as a scripture claim when Korean text sits beside a verse
    // marker or biblical phrasing cue; plain illustrations are skipped.
    if (!/[가-힣]/.test(fragment)) continue;
    const context = manuscript.slice(
      Math.max(0, (match.index ?? 0) - 40),
      (match.index ?? 0) + fragment.length + 40,
    );
    const looksLikeScripture =
      /\d{1,3}\s*[:장절]|말씀|기록되|성경|본문/.test(context);
    if (!looksLikeScripture) continue;
    const normalized = normalizeQuoteText(fragment);
    if (normalized.length < 8) continue;
    if (!passageNormalized.includes(normalized)) {
      findings.push(fragment.slice(0, 60));
      if (findings.length >= maxFindings) break;
    }
  }
  return findings;
}
