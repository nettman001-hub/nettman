"use client";

import { useEffect, useState } from "react";
import type { SermonRecord } from "../../../_lib/data";
import { loadLocalSermonRecords } from "../../../_lib/sermon-store";

export function PrintSermonClient({ id }: { id: string }) {
  const [sermon, setSermon] = useState<SermonRecord | null>(null);
  useEffect(() => {
    let active = true;
    fetch(`/api/sermons/${encodeURIComponent(id)}`)
      .then((response) => {
        if (!response.ok) throw new Error("not found");
        return response.json() as Promise<{ item: SermonRecord }>;
      })
      .then((data) => { if (active) setSermon(data.item); })
      .catch(() => {
        if (active) setSermon(loadLocalSermonRecords().find((item) => item.id === id) ?? null);
      });
    return () => { active = false; };
  }, [id]);
  if (!sermon) return <main className="grid min-h-screen place-items-center"><p>인쇄용 원고를 준비하고 있습니다.</p></main>;
  return <main className="mx-auto max-w-[800px] bg-white px-8 py-10 text-black print:max-w-none print:p-0"><div className="mb-8 flex justify-end gap-2 print:hidden"><button className="button button-primary" onClick={() => window.print()}>PDF로 저장 / 인쇄</button><button className="button button-ghost" onClick={() => window.close()}>닫기</button></div><article><p className="text-sm font-bold">{sermon.scripture}</p><h1 className="mt-2 font-serif text-4xl font-bold">{sermon.title}</h1><p className="mt-3 text-sm text-gray-600">{sermon.sermonType} · {sermon.audience} · {sermon.duration}분</p><hr className="my-8" /><PrintSection title="도입" content={sermon.sections.introduction} />{sermon.sections.body.map((point, index) => <PrintSection key={point.heading} title={`본론 ${index + 1}. ${point.heading}`} content={point.content} />)}<PrintSection title="결론" content={sermon.sections.conclusion} /><PrintSection title="적용과 결단" content={sermon.sections.application} /></article></main>;
}
function PrintSection({ title, content }: { title: string; content: string }) { return <section className="mb-8 break-inside-avoid"><h2 className="font-serif text-xl font-bold">{title}</h2><p className="mt-3 whitespace-pre-wrap font-serif leading-8">{content}</p></section>; }
