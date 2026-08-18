import type { SermonAlternative, SermonOptions } from "./sermon-types";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function safeFilePart(value: string): string {
  return (
    value
      .normalize("NFC")
      .replace(/[\\/:*?"<>|]/g, "")
      .replace(/\s+/g, "_")
      .slice(0, 60) || "완성_설교"
  );
}

function fileBase(sermon: SermonAlternative): string {
  const date = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return `설교_${safeFilePart(sermon.title)}_${date}`;
}

function paragraphs(value: string): string {
  return value
    .split(/\n{2,}|\n/)
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join("");
}

export function printSermonAsPdf(
  sermon: SermonAlternative,
  options: SermonOptions,
): void {
  const popup = window.open("", "_blank");
  if (!popup) {
    throw new Error("팝업이 차단되었습니다. 팝업을 허용한 뒤 다시 시도해 주세요.");
  }
  popup.opener = null;

  const points = sermon.sections.points
    .map(
      (point, index) =>
        `<h3>${index + 1}. ${escapeHtml(point.heading)}</h3>${paragraphs(point.content)}`,
    )
    .join("");

  popup.document.open();
  popup.document.write(`<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>${escapeHtml(fileBase(sermon))}</title>
<style>
@page { size: A4; margin: 22mm 20mm; }
body { color:#1c2430; font-family:"Malgun Gothic","Apple SD Gothic Neo",sans-serif; font-size:11pt; line-height:1.8; }
h1 { font-size:23pt; line-height:1.3; margin:0 0 10px; } h2 { font-size:16pt; margin:30px 0 10px; page-break-after:avoid; }
h3 { font-size:13pt; margin:22px 0 8px; page-break-after:avoid; } p { margin:0 0 11px; orphans:3; widows:3; }
.meta { color:#596474; border-bottom:1px solid #ccd3dc; padding-bottom:16px; margin-bottom:28px; }
.notice { color:#596474; font-size:9pt; margin-top:30px; border-top:1px solid #ccd3dc; padding-top:12px; }
@media print { .print-help { display:none; } }
</style></head><body>
<div class="print-help">인쇄 창에서 대상을 <strong>PDF로 저장</strong>으로 선택해 주세요.</div>
<h1>${escapeHtml(sermon.title)}</h1>
<div class="meta">본문 ${escapeHtml(sermon.scripture)} · ${escapeHtml(options.sermonType)} · ${escapeHtml(options.audience)} · ${options.duration ?? "-"}분</div>
<h2>도입</h2>${paragraphs(sermon.sections.introduction)}
<h2>본론</h2>${points}
<h2>결론</h2>${paragraphs(sermon.sections.conclusion)}
<h2>적용</h2>${paragraphs(sermon.sections.application)}
<div class="notice">AI가 작성한 초안입니다. 사용 전 본문 해석과 사실 관계를 반드시 검토해 주세요.</div>
</body></html>`);
  popup.document.close();
  popup.focus();
  popup.setTimeout(() => popup.print(), 250);
}

const encoder = new TextEncoder();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value: number): Uint8Array {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff]);
}

function u32(value: number): Uint8Array {
  return new Uint8Array([
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ]);
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

type ZipEntry = { name: string; data: Uint8Array };

/** 외부 라이브러리 없이 STORE 방식의 유효한 OOXML ZIP을 만듭니다. */
function makeZip(entries: ZipEntry[]): Uint8Array {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const checksum = crc32(entry.data);
    const local = concatBytes([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0x0021),
      u32(checksum),
      u32(entry.data.length),
      u32(entry.data.length),
      u16(name.length),
      u16(0),
      name,
      entry.data,
    ]);
    localParts.push(local);

    const central = concatBytes([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0x0021),
      u32(checksum),
      u32(entry.data.length),
      u32(entry.data.length),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      name,
    ]);
    centralParts.push(central);
    offset += local.length;
  }

  const centralDirectory = concatBytes(centralParts);
  const end = concatBytes([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(centralDirectory.length),
    u32(offset),
    u16(0),
  ]);
  return concatBytes([...localParts, centralDirectory, end]);
}

function wordParagraph(text: string, style?: string): string {
  const styleXml = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : "";
  return `<w:p>${styleXml}<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

function textToWordParagraphs(text: string): string {
  return text
    .split(/\n{2,}|\n/)
    .filter(Boolean)
    .map((line) => wordParagraph(line))
    .join("");
}

export function downloadSermonDocx(
  sermon: SermonAlternative,
  options: SermonOptions,
): void {
  const points = sermon.sections.points
    .map(
      (point, index) =>
        `${wordParagraph(`${index + 1}. ${point.heading}`, "Heading2")}${textToWordParagraphs(point.content)}`,
    )
    .join("");
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
${wordParagraph(sermon.title, "Title")}
${wordParagraph(`본문 ${sermon.scripture} · ${options.sermonType} · ${options.audience} · ${options.duration ?? "-"}분`, "Subtitle")}
${wordParagraph("도입", "Heading1")}${textToWordParagraphs(sermon.sections.introduction)}
${wordParagraph("본론", "Heading1")}${points}
${wordParagraph("결론", "Heading1")}${textToWordParagraphs(sermon.sections.conclusion)}
${wordParagraph("적용", "Heading1")}${textToWordParagraphs(sermon.sections.application)}
${wordParagraph("AI가 작성한 초안입니다. 사용 전 본문 해석과 사실 관계를 반드시 검토해 주세요.")}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1247" w:right="1134" w:bottom="1247" w:left="1134"/></w:sectPr>
</w:body></w:document>`;
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Malgun Gothic" w:eastAsia="맑은 고딕"/><w:lang w:val="ko-KR" w:eastAsia="ko-KR"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="40"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:rPr><w:color w:val="647084"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="30"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="25"/></w:rPr></w:style>
</w:styles>`;

  const entries: ZipEntry[] = [
    {
      name: "[Content_Types].xml",
      data: encoder.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`),
    },
    {
      name: "_rels/.rels",
      data: encoder.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`),
    },
    { name: "word/document.xml", data: encoder.encode(documentXml) },
    { name: "word/styles.xml", data: encoder.encode(stylesXml) },
    {
      name: "word/_rels/document.xml.rels",
      data: encoder.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    },
  ];
  const bytes = makeZip(entries);
  const blob = new Blob([Uint8Array.from(bytes).buffer], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${fileBase(sermon)}.docx`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
