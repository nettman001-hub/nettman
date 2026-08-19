"use client";

import { useEffect, useState } from "react";
import { AppNotice } from "../../_components/app-notice";
import type { SermonRecord } from "../../_lib/data";
import { downloadSermonDocx } from "../../_lib/sermon-download";
import { loadLocalSermonRecords } from "../../_lib/sermon-store";
import type { SermonAlternative, SermonOptions } from "../../_lib/sermon-types";

type SermonDraftAlternative = {
  id: string;
  position: number;
  title: string;
  scripture: string;
  selected: boolean;
  sections: SermonRecord["sections"];
};

export function HistoryDetailClient({ id }: { id: string }) {
  const [sermon, setSermon] = useState<SermonRecord | null>(null);
  const [alternatives, setAlternatives] = useState<SermonDraftAlternative[]>([]);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    fetch(`/api/sermons/${encodeURIComponent(id)}`).then(async (response) => {
      if (!response.ok) throw new Error("설교를 찾을 수 없습니다.");
      return response.json() as Promise<{ item: SermonRecord; alternatives?: SermonDraftAlternative[] }>;
    }).then((data) => {
      if (!active) return;
      setSermon(data.item);
      setAlternatives(Array.isArray(data.alternatives) ? data.alternatives : []);
    }).catch((reason) => {
      if (!active) return;
      const local = loadLocalSermonRecords().find((item) => item.id === id);
      if (local) setSermon(local);
      else setError(reason instanceof Error ? reason.message : "설교를 불러오지 못했습니다.");
    });
    return () => { active = false; };
  }, [id]);
  if (error) return <div className="mx-auto max-w-4xl px-4 py-12"><AppNotice tone="error" title="설교를 열 수 없습니다.">{error} <a className="underline" href="/history">목록으로 돌아가기</a></AppNotice></div>;
  if (!sermon) return <div className="grid min-h-[70vh] place-items-center" role="status"><div className="text-center"><div className="mx-auto size-12 animate-spin rounded-full border-2 border-[#d5cfc4] border-t-[#315647]" /><p className="mt-4 text-sm text-[#6c7872]">설교 원고를 펼치고 있습니다.</p></div></div>;
  const viewing = alternatives.find((item) => item.id === viewingId) ?? null;
  // The saved manuscript came from the selected draft; list only the others.
  // Older records without a recorded selection list every generated draft.
  const hasSelected = alternatives.some((item) => item.selected);
  const otherDrafts = hasSelected ? alternatives.filter((item) => !item.selected) : alternatives;
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-7 sm:py-10 lg:px-10 lg:py-12">
      <a href="/history" className="mb-6 inline-flex items-center gap-2 text-xs font-extrabold text-[#65736d] hover:text-[#203b30]">← 내 설교로 돌아가기</a>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_17rem] lg:items-start">
        <article className="rounded-3xl border border-[#d8d2c7] bg-[#fffdf8] px-6 py-9 shadow-[0_18px_55px_rgba(31,54,45,.06)] sm:px-10 lg:px-14 lg:py-14">
          {viewing ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[#f3ede1] px-4 py-3">
              <p className="text-xs font-extrabold text-[#8a5a2c]">초안 {viewing.position} · 저장하지 않은 원고를 보는 중입니다</p>
              <button type="button" onClick={() => setViewingId(null)} className="inline-flex min-h-9 items-center rounded-lg bg-[#284b3d] px-3 text-xs font-extrabold text-white hover:bg-[#18382d]">저장한 원고 보기</button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-[#7c8882]"><span className="rounded-full bg-[#e4ece3] px-3 py-1.5 text-[#41634e]">{sermon.sermonType}</span><span>{sermon.audience}</span><span>·</span><span>{sermon.audienceSituation || "일반"}</span><span>·</span><span>{sermon.duration}분</span><span>·</span><span>{sermon.pointCount}대지</span><span>·</span><span>{sermon.emotion}</span></div>
          )}
          <p className="mt-8 text-sm font-extrabold text-[#a05c30]">{(viewing ?? sermon).scripture}</p>
          <h1 className="mt-3 font-serif text-[clamp(2.25rem,5vw,3.8rem)] font-bold leading-[1.08] tracking-[-.045em] text-[#1d372d]">{(viewing ?? sermon).title}</h1>
          <div className="my-9 h-px bg-[#ddd8cd]" />
          <SermonSection label="도입" content={(viewing ?? sermon).sections.introduction} />
          {(viewing ?? sermon).sections.body.map((point, index) => <SermonSection key={`${point.heading}-${index}`} label={`본론 ${index + 1}`} heading={point.heading} content={point.content} />)}
          <SermonSection label="결론" content={(viewing ?? sermon).sections.conclusion} />
          <SermonSection label="적용과 결단" content={(viewing ?? sermon).sections.application} accent />
        </article>
        <aside className="space-y-4 lg:sticky lg:top-6">
          {otherDrafts.length > 0 ? (
            <div className="rounded-2xl border border-[#d8d2c7] bg-white p-5">
              <p className="text-xs font-extrabold tracking-[.14em] text-[#9b6332]">DRAFTS</p>
              <h2 className="mt-2 font-serif text-xl font-bold text-[#29473b]">함께 생성한 다른 초안</h2>
              <p className="mt-2 text-xs leading-5 text-[#6c7872]">저장 당시 함께 만든 초안입니다. 눌러서 전체 원고를 확인하세요.</p>
              <ul className="mt-4 grid gap-2">
                {otherDrafts.map((draft) => {
                  const active = draft.id === viewingId;
                  return (
                    <li key={draft.id}>
                      <button
                        type="button"
                        onClick={() => setViewingId(active ? null : draft.id)}
                        aria-pressed={active}
                        className={`w-full rounded-xl border px-4 py-3 text-left transition ${active ? "border-[#284b3d] bg-[#eef2e9]" : "border-[#e0dacd] bg-[#fbfaf6] hover:bg-[#f0eee7]"}`}
                      >
                        <span className="block text-[11px] font-extrabold tracking-[.14em] text-[#a15e31]">초안 {draft.position}</span>
                        <span className="mt-1 block truncate text-sm font-extrabold text-[#233f34]">{draft.title}</span>
                        <span className="mt-1 block truncate text-xs font-semibold text-[#7c8882]">{draft.scripture}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
          <div className="rounded-2xl border border-[#d8d2c7] bg-white p-5"><p className="text-xs font-extrabold tracking-[.14em] text-[#9b6332]">DOWNLOAD</p><h2 className="mt-2 font-serif text-xl font-bold text-[#29473b]">원고 내보내기</h2><div className="mt-5 grid gap-2"><a href={`/history/${id}/print`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[#284b3d] px-4 text-sm font-extrabold text-white hover:bg-[#18382d]">PDF로 저장</a><button type="button" onClick={() => downloadSermonDocx(toAlternative(sermon), toOptions(sermon))} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-[#cfc8bb] bg-[#fbfaf6] px-4 text-sm font-extrabold text-[#29473b] hover:bg-[#f0eee7]">Word 내려받기</button></div></div>
          <div className="rounded-2xl bg-[#e3ebe3] p-5"><p className="text-xs font-extrabold text-[#496853]">전문가의 시선이 필요하신가요?</p><p className="mt-2 text-xs leading-5 text-[#617169]">완성한 설교를 목회 코치와 함께 검토할 수 있습니다.</p><a href={`/consult?sermonId=${id}`} className="mt-4 inline-flex text-sm font-extrabold text-[#294b3d] underline underline-offset-4">피드백 요청하기 →</a></div>
        </aside>
      </div>
    </div>
  );
}

function toAlternative(sermon: SermonRecord): SermonAlternative {
  return {
    id: sermon.id,
    title: sermon.title,
    summary: sermon.sections.introduction.slice(0, 240),
    scripture: sermon.scripture,
    sections: {
      introduction: sermon.sections.introduction,
      points: sermon.sections.body,
      conclusion: sermon.sections.conclusion,
      application: sermon.sections.application,
    },
  };
}

function toOptions(sermon: SermonRecord): SermonOptions {
  return {
    topic: sermon.title,
    aiTier: "basic",
    aiTiers: ["basic", "basic", "basic", "basic", "basic"],
    duration: [10, 15, 20, 25, 30].includes(sermon.duration) ? sermon.duration as SermonOptions["duration"] : 20,
    targetCharacters: null,
    tone: sermon.emotion as SermonOptions["tone"],
    sermonType: sermon.sermonType as SermonOptions["sermonType"],
    audience: sermon.audience as SermonOptions["audience"],
    audienceSituation: sermon.audienceSituation || "일반",
    pointCount: Math.min(4, Math.max(1, sermon.pointCount)) as SermonOptions["pointCount"],
    referenceMode: "auto",
  };
}

function SermonSection({ label, heading, content, accent = false }: { label: string; heading?: string; content: string; accent?: boolean }) {
  return <section className={`mt-10 ${accent ? "rounded-2xl bg-[#eef2e9] p-6" : ""}`}><p className="text-[11px] font-extrabold tracking-[.17em] text-[#a15e31]">{label}</p>{heading ? <h2 className="mt-2 font-serif text-2xl font-bold text-[#233f34]">{heading}</h2> : null}<p className="mt-4 whitespace-pre-wrap font-serif text-[1.03rem] leading-8 text-[#3b4d46]">{content}</p></section>;
}
