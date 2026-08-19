import type { SermonRecord } from "./data";

const encoder = new TextEncoder();

export function createSermonDocx(sermon: SermonRecord): Uint8Array {
  const files = [
    {
      name: "[Content_Types].xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
    },
    {
      name: "_rels/.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
    },
    { name: "word/document.xml", content: createDocumentXml(sermon) },
  ];
  return createZip(files.map((file) => ({ name: file.name, data: encoder.encode(file.content) })));
}

function createDocumentXml(sermon: SermonRecord): string {
  const body = sermon.sections.body.map((point, index) => `${heading(`본론 ${index + 1}. ${point.heading}`, 28)}${paragraphs(point.content)}`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${paragraph(sermon.scripture, { color: "B95038", size: 22, bold: true, after: 120 })}
    ${paragraph(sermon.title, { size: 42, bold: true, after: 160 })}
    ${paragraph(`${sermon.sermonType} · ${sermon.audience} · ${sermon.audienceSituation || "일반"} · ${sermon.duration}분`, { color: "68756F", size: 19, after: 360 })}
    ${heading("도입", 28)}${paragraphs(sermon.sections.introduction)}
    ${body}
    ${heading("결론", 28)}${paragraphs(sermon.sections.conclusion)}
    ${heading("적용과 결단", 28)}${paragraphs(sermon.sections.application)}
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>
  </w:body>
</w:document>`;
}

function heading(text: string, size: number): string {
  return paragraph(text, { size, bold: true, before: 300, after: 110, color: "18312B" });
}

function paragraphs(text: string): string {
  return text.split(/\n+/).filter(Boolean).map((value) => paragraph(value, { size: 22, after: 170, line: 430 })).join("");
}

function paragraph(text: string, options: { size: number; color?: string; bold?: boolean; before?: number; after?: number; line?: number }): string {
  const spacing = `<w:spacing w:before="${options.before ?? 0}" w:after="${options.after ?? 0}"${options.line ? ` w:line="${options.line}" w:lineRule="auto"` : ""}/>`;
  return `<w:p><w:pPr>${spacing}</w:pPr><w:r><w:rPr><w:rFonts w:ascii="Malgun Gothic" w:hAnsi="Malgun Gothic" w:eastAsia="맑은 고딕"/><w:lang w:eastAsia="ko-KR"/><w:sz w:val="${options.size}"/><w:szCs w:val="${options.size}"/>${options.bold ? "<w:b/><w:bCs/>" : ""}${options.color ? `<w:color w:val="${options.color}"/>` : ""}</w:rPr><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

type ZipEntry = { name: string; data: Uint8Array };

function createZip(entries: ZipEntry[]): Uint8Array {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  const { time, date } = dosDateTime(new Date());

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const checksum = crc32(entry.data);
    const localHeader = concat(
      u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(time), u16(date),
      u32(checksum), u32(entry.data.length), u32(entry.data.length), u16(name.length), u16(0), name,
    );
    localParts.push(localHeader, entry.data);
    const centralHeader = concat(
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(time), u16(date),
      u32(checksum), u32(entry.data.length), u32(entry.data.length), u16(name.length), u16(0),
      u16(0), u16(0), u16(0), u32(0), u32(offset), name,
    );
    centralParts.push(centralHeader);
    offset += localHeader.length + entry.data.length;
  }

  const centralDirectory = concat(...centralParts);
  const localDirectory = concat(...localParts);
  const end = concat(
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(centralDirectory.length), u32(localDirectory.length), u16(0),
  );
  return concat(localDirectory, centralDirectory, end);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let cursor = 0;
  for (const part of parts) { result.set(part, cursor); cursor += part.length; }
  return result;
}

function u16(value: number): Uint8Array {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, true);
  return bytes;
}

function u32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value >>> 0, true);
  return bytes;
}

function dosDateTime(value: Date): { time: number; date: number } {
  const year = Math.max(1980, value.getFullYear());
  return {
    time: (value.getHours() << 11) | (value.getMinutes() << 5) | Math.floor(value.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((value.getMonth() + 1) << 5) | value.getDate(),
  };
}

const crcTable = new Uint32Array(256).map((_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
