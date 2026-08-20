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

async function resolveBookIndex(rawBook: string): Promise<number> {
  const bible = await loadBible();
  const compact = rawBook.replace(/\s+/g, "");
  if (!compact) return -1;
  const exact = await bookIndex(compact);
  if (exact >= 0) return exact;
  const byAbbr = bible.books.findIndex((book) => book.abbr === compact);
  if (byAbbr >= 0) return byAbbr;
  // Common suffix-less forms such as "요한" stay ambiguous on purpose; only a
  // unique prefix of a full book name resolves.
  const prefixMatches = bible.books
    .map((book, index) => ({ book, index }))
    .filter((entry) => entry.book.name.startsWith(compact));
  return prefixMatches.length === 1 ? prefixMatches[0].index : -1;
}

/**
 * Parses user-typed references such as "요 3:16-20", "요한복음 3장 16-20절",
 * "시편 23", "창세기 1-2장" into a full range against the loaded text.
 * Returns null when the book is unknown/ambiguous or the range is invalid.
 */
export async function resolveLooseScriptureReference(
  input: string,
): Promise<{ range: ScriptureRange; canonical: string } | null> {
  const trimmed = input.normalize("NFC").trim();
  const match = /^([가-힣0-9\s]+?)\s*(\d[\d\s장절:.~-]*)$/.exec(trimmed);
  if (!match) return null;
  // The numeric tail starts at the first digit that is not part of a book
  // name like 사무엘상; split book letters from the numeric expression.
  const bookPart = match[1].replace(/\d+$/, (digits) => digits).trim();
  const numberPart = match[2].trim();
  const index = await resolveBookIndex(bookPart);
  if (index < 0) return null;
  const bible = await loadBible();
  const book = bible.books[index];

  const normalizedNumbers = numberPart
    .replace(/[~—–]/g, "-")
    .replace(/장/g, ":")
    .replace(/절/g, "")
    .replace(/\./g, ":")
    .replace(/\s+/g, "")
    .replace(/:$/, "");
  const rangeMatch = /^(\d{1,3})(?::(\d{1,3}))?(?:-(\d{1,3})(?::(\d{1,3}))?)?$/.exec(
    normalizedNumbers,
  );
  if (!rangeMatch) return null;
  const first = Number(rangeMatch[1]);
  const second = rangeMatch[2] ? Number(rangeMatch[2]) : null;
  const third = rangeMatch[3] ? Number(rangeMatch[3]) : null;
  const fourth = rangeMatch[4] ? Number(rangeMatch[4]) : null;

  let startChapter: number;
  let startVerse: number;
  let endChapter: number;
  let endVerse: number;
  const chapterCount = book.chapters.length;
  const versesIn = (chapter: number) => book.chapters[chapter - 1]?.length ?? 0;

  if (second === null && third === null) {
    // "시편 23" — whole chapter
    startChapter = first;
    startVerse = 1;
    endChapter = first;
    endVerse = versesIn(first);
  } else if (second === null && third !== null && fourth === null) {
    // "창세기 1-2" — whole chapters
    startChapter = first;
    startVerse = 1;
    endChapter = third;
    endVerse = versesIn(third);
  } else if (second !== null && third !== null && fourth !== null) {
    // "요 3:16-4:2"
    startChapter = first;
    startVerse = second;
    endChapter = third;
    endVerse = fourth;
  } else if (second !== null && third !== null) {
    // "요 3:16-20"
    startChapter = first;
    startVerse = second;
    endChapter = first;
    endVerse = third;
  } else if (second !== null) {
    // "요 3:16"
    startChapter = first;
    startVerse = second;
    endChapter = first;
    endVerse = second;
  } else {
    return null;
  }

  if (
    startChapter < 1 ||
    endChapter < startChapter ||
    endChapter > chapterCount ||
    startVerse < 1 ||
    startVerse > versesIn(startChapter) ||
    endVerse < 1 ||
    endVerse > versesIn(endChapter) ||
    (startChapter === endChapter && endVerse < startVerse)
  ) {
    return null;
  }

  const range: ScriptureRange = {
    bookIndex: index,
    book: book.name,
    startChapter,
    startVerse,
    endChapter,
    endVerse,
  };
  const canonical =
    startChapter === endChapter
      ? startVerse === endVerse
        ? `${book.name} ${startChapter}:${startVerse}`
        : `${book.name} ${startChapter}:${startVerse}-${endVerse}`
      : `${book.name} ${startChapter}:${startVerse}-${endChapter}:${endVerse}`;
  return { range, canonical };
}

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
