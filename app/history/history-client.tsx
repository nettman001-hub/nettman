"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { AppPageHeading } from "../_components/app-page-heading";
import { AppNotice } from "../_components/app-notice";
import type { SermonRecord } from "../_lib/data";
import { loadLocalSermonRecords } from "../_lib/sermon-store";

type HistoryResponse = { items: SermonRecord[]; total: number; page: number; limit: number };

const formatter = new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", day: "numeric" });

export function HistoryClient() {
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<HistoryResponse>({ items: [], total: 0, page: 1, limit: 10 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (submittedQuery) params.set("q", submittedQuery);
      const response = await fetch(`/api/sermons?${params}`, { headers: { accept: "application/json" } });
      if (!response.ok) throw new Error("목록을 불러오지 못했습니다.");
      const remote = await response.json() as HistoryResponse;
      const normalizedQuery = submittedQuery.toLowerCase();
      const local = loadLocalSermonRecords().filter((item) =>
        !normalizedQuery || `${item.title} ${item.scripture} ${item.createdAt}`.toLowerCase().includes(normalizedQuery),
      );
      const remoteKeys = new Set(remote.items.map((item) => `${item.id}:${item.title}:${item.scripture}`));
      const localOnly = local.filter((item) => !remoteKeys.has(`${item.id}:${item.title}:${item.scripture}`));
      setData(page === 1 ? {
        ...remote,
        items: [...localOnly, ...remote.items]
          .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
          .slice(0, remote.limit),
        total: remote.total + localOnly.length,
      } : remote);
    } catch (reason) {
      const normalizedQuery = submittedQuery.toLowerCase();
      const local = loadLocalSermonRecords().filter((item) =>
        !normalizedQuery || `${item.title} ${item.scripture} ${item.createdAt}`.toLowerCase().includes(normalizedQuery),
      );
      setData({ items: local.slice(0, 10), total: local.length, page: 1, limit: 10 });
      setError(local.length ? "서버에 연결하지 못해 이 기기에 저장된 설교를 표시합니다." : reason instanceof Error ? reason.message : "목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [page, submittedQuery]);

  useEffect(() => { void load(); }, [load]);

  function submit(event: FormEvent) {
    event.preventDefault();
    setPage(1);
    setSubmittedQuery(query.trim());
  }

  const pageCount = Math.max(1, Math.ceil(data.total / data.limit));

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-7 sm:py-10 lg:px-10 lg:py-12">
      <AppPageHeading
        eyebrow="SERMON ARCHIVE"
        title="내 설교"
        description="완성한 설교와 선택했던 옵션을 한곳에서 다시 확인하고 활용하세요."
        action={<a href="/sermon/options" className="inline-flex min-h-11 items-center rounded-xl bg-[#25483a] px-5 text-sm font-extrabold text-white hover:bg-[#19372c]">새 설교 만들기</a>}
      />

      <form className="mt-7 flex flex-col gap-3 sm:flex-row" onSubmit={submit} role="search">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">설교 제목 또는 본문 검색</span>
          <span className="pointer-events-none absolute left-4 top-3.5 text-[#79857f]" aria-hidden="true">⌕</span>
          <input className="min-h-12 w-full rounded-xl border border-[#d7d1c5] bg-white pl-11 pr-4 text-sm outline-none focus:border-[#678475] focus:ring-4 focus:ring-[#678475]/10" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="제목, 성경 본문 또는 날짜로 검색" />
        </label>
        <button className="min-h-12 rounded-xl bg-[#e3b477] px-6 text-sm font-extrabold text-[#263b33] hover:bg-[#edc490]" type="submit">검색</button>
      </form>

      {error ? <div className="mt-5"><AppNotice tone="error" title="목록을 불러오지 못했습니다."><button type="button" className="underline" onClick={() => void load()}>다시 시도</button></AppNotice></div> : null}

      <div className="mt-7 overflow-hidden rounded-3xl border border-[#d8d2c7] bg-[#fffdf8] shadow-[0_16px_44px_rgba(31,54,45,.05)]">
        <div className="flex items-center justify-between border-b border-[#e2ddd3] px-5 py-4 sm:px-7">
          <p className="text-sm font-extrabold text-[#29463a]">저장된 설교 <span className="ml-1 text-[#a26a36]">{data.total}</span></p>
          {submittedQuery ? <button className="text-xs font-bold text-[#65746e] underline" onClick={() => { setQuery(""); setSubmittedQuery(""); setPage(1); }}>검색 초기화</button> : null}
        </div>
        {loading ? (
          <div className="grid min-h-72 place-items-center" role="status"><div className="text-center"><div className="mx-auto size-10 animate-spin rounded-full border-2 border-[#d6d0c5] border-t-[#315647]" /><p className="mt-3 text-sm text-[#6c7872]">설교를 정리하고 있습니다.</p></div></div>
        ) : data.items.length === 0 ? (
          <div className="grid min-h-72 place-items-center px-6 text-center"><div><span className="mx-auto grid size-14 place-items-center rounded-2xl bg-[#e3ebe4] font-serif text-lg font-bold text-[#315647]">설</span><h2 className="mt-4 font-serif text-xl font-bold text-[#29463a]">{submittedQuery ? "검색 결과가 없습니다." : "아직 저장된 설교가 없습니다."}</h2><p className="mt-2 text-sm text-[#6b7771]">{submittedQuery ? "다른 검색어로 다시 찾아보세요." : "첫 설교를 완성하면 이곳에서 다시 만날 수 있습니다."}</p></div></div>
        ) : (
          <ul className="divide-y divide-[#e7e2d8]">
            {data.items.map((sermon) => (
              <li key={sermon.id}>
                <a href={`/history/${sermon.id}`} className="group grid gap-4 px-5 py-5 transition-colors hover:bg-[#f6f7f1] sm:grid-cols-[1fr_auto] sm:items-center sm:px-7">
                  <div className="min-w-0">
                    <div className="mb-2 flex flex-wrap items-center gap-2"><span className="rounded-full bg-[#e2ece4] px-2.5 py-1 text-[10px] font-extrabold text-[#41654e]">{sermon.sermonType}</span><span className="text-xs font-semibold text-[#8a948f]">{sermon.scripture}</span></div>
                    <h2 className="font-serif text-xl font-bold leading-snug tracking-[-.02em] text-[#203b30] group-hover:text-[#a35d2f]">{sermon.title}</h2>
                    <p className="mt-2 line-clamp-2 text-sm text-[#6c7872]">{sermon.sections.introduction}</p>
                  </div>
                  <div className="flex items-center gap-5 text-xs text-[#78837e]"><span>{sermon.audience} · {sermon.audienceSituation || "일반"} · {sermon.duration}분</span><time dateTime={sermon.createdAt}>{formatter.format(new Date(sermon.createdAt))}</time><span className="text-lg text-[#aa6e38]" aria-hidden="true">→</span></div>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>

      {pageCount > 1 ? <nav className="mt-7 flex justify-center gap-2" aria-label="페이지 이동">
        {Array.from({ length: pageCount }, (_, index) => index + 1).map((value) => <button type="button" key={value} aria-current={value === page ? "page" : undefined} onClick={() => setPage(value)} className={`grid size-10 place-items-center rounded-xl border text-sm font-bold ${value === page ? "border-[#294b3d] bg-[#294b3d] text-white" : "border-[#d5cfc3] bg-white text-[#617069] hover:border-[#8aa094]"}`}>{value}</button>)}
      </nav> : null}
    </div>
  );
}
