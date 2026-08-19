"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppNotice } from "@/app/_components/app-notice";
import { AppPageHeading } from "@/app/_components/app-page-heading";
import {
  MEMBER_DENOMINATIONS,
  parseMembersListResponse,
  type MemberListFilters,
  type MemberListItem,
  type MemberListStats,
  type MembersListResponse,
} from "./member-types";

type MembersClientProps = {
  initialFilters: MemberListFilters;
  initialCursor: string;
};

const EMPTY_STATS: MemberListStats = {
  total: null,
  active: null,
  suspended: null,
  experts: null,
};

const EMPTY_RESPONSE: MembersListResponse = {
  items: [],
  stats: EMPTY_STATS,
  total: 0,
  page: 1,
  limit: 20,
  nextCursor: "",
};

function formatCount(value: number | null): string {
  return value === null ? "—" : value.toLocaleString("ko-KR");
}

function formatTokens(value: number): string {
  return value.toLocaleString("ko-KR");
}

function formatDate(value: string): string {
  if (!value) return "기록 없음";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "기록 없음";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "Asia/Seoul",
  }).format(date);
}

function roleLabel(role: MemberListItem["role"]): string {
  return role === "expert" ? "전문가" : "설교자";
}

function statusLabel(status: MemberListItem["status"]): string {
  return status === "suspended" ? "정지" : "이용 중";
}

function listSearchParams(
  filters: MemberListFilters,
  cursor: string,
): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.query) params.set("q", filters.query);
  if (filters.role !== "all") params.set("role", filters.role);
  if (filters.status !== "all") params.set("status", filters.status);
  if (filters.denomination !== "all") {
    params.set("denomination", filters.denomination);
  }
  if (filters.profile !== "all") params.set("profile", filters.profile);
  if (filters.sort !== "registered_desc") params.set("sort", filters.sort);
  if (filters.page > 1) params.set("page", String(filters.page));
  if (cursor) params.set("cursor", cursor);
  params.set("limit", "20");
  return params;
}

function memberHref(memberId: string, returnParams: URLSearchParams): string {
  const returnQuery = new URLSearchParams(returnParams);
  returnQuery.delete("limit");
  const suffix = returnQuery.toString();
  const returnTo = suffix ? `/admin/members?${suffix}` : "/admin/members";
  return `/admin/members/${encodeURIComponent(memberId)}?return_to=${encodeURIComponent(returnTo)}`;
}

function MemberBadges({ member }: { member: MemberListItem }) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      {member.isAdmin ? (
        <span className="rounded-full bg-[#2a2438] px-2.5 py-1 text-[10px] font-extrabold text-[#e8ddff]">
          관리자
        </span>
      ) : null}
      <span
        className={`rounded-full px-2.5 py-1 text-[10px] font-extrabold ${
          member.role === "expert"
            ? "bg-[#e6ecf5] text-[#3d5680]"
            : "bg-[#e1ece4] text-[#315c47]"
        }`}
      >
        {roleLabel(member.role)}
      </span>
      <span
        className={`rounded-full px-2.5 py-1 text-[10px] font-extrabold ${
          member.status === "suspended"
            ? "bg-[#f7e3dc] text-[#8f452f]"
            : "bg-[#edf5e9] text-[#3c693b]"
        }`}
      >
        {statusLabel(member.status)}
      </span>
    </span>
  );
}

export function MembersClient({
  initialFilters,
  initialCursor,
}: MembersClientProps) {
  const [queryDraft, setQueryDraft] = useState(initialFilters.query);
  const [filters, setFilters] = useState(initialFilters);
  const [cursor, setCursor] = useState(initialCursor);
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);
  const [data, setData] = useState<MembersListResponse>(EMPTY_RESPONSE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const [syncError, setSyncError] = useState("");
  const [reloadSequence, setReloadSequence] = useState(0);
  const syncInFlight = useRef(false);

  const params = useMemo(
    () => listSearchParams(filters, cursor),
    [cursor, filters],
  );

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`/api/admin/members?${params}`, {
          cache: "no-store",
          headers: { Accept: "application/json" },
          signal,
        });
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          const message =
            body &&
            typeof body === "object" &&
            typeof (body as { error?: unknown }).error === "string"
              ? String((body as { error: string }).error)
              : "회원 목록을 불러오지 못했습니다.";
          throw new Error(message);
        }
        setData(parseMembersListResponse(body));
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setError(
          caught instanceof Error
            ? caught.message
            : "회원 목록을 불러오지 못했습니다.",
        );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [params],
  );

  const synchronizeExistingMembers = useCallback(
    async () => {
      if (syncInFlight.current) return;
      syncInFlight.current = true;
      setSyncing(true);
      setSyncError("");
      setSyncMessage("");
      try {
        const response = await fetch("/api/admin/members/sync", {
          method: "POST",
          cache: "no-store",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ requestId: crypto.randomUUID() }),
        });
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          const message =
            body &&
            typeof body === "object" &&
            typeof (body as { error?: unknown }).error === "string"
              ? String((body as { error: string }).error)
              : "기존 가입 회원을 동기화하지 못했습니다.";
          throw new Error(message);
        }
        const result = body && typeof body === "object"
          ? body as Record<string, unknown>
          : {};
        const created = Math.max(0, Number(result.created) || 0);
        const updated = Math.max(0, Number(result.updated) || 0);
        const unchanged = Math.max(0, Number(result.unchanged) || 0);
        const conflicts = Math.max(0, Number(result.conflicts) || 0);
        const skipped = Math.max(0, Number(result.skipped) || 0);
        const details = [
          `신규 ${created.toLocaleString("ko-KR")}명`,
          updated > 0 ? `정보 갱신 ${updated.toLocaleString("ko-KR")}명` : "",
          `기존 확인 ${unchanged.toLocaleString("ko-KR")}명`,
          conflicts > 0 ? `충돌 ${conflicts.toLocaleString("ko-KR")}명` : "",
          skipped > 0 ? `미인증·동기화 제외 ${skipped.toLocaleString("ko-KR")}명` : "",
        ].filter(Boolean).join(" · ");
        setSyncMessage(`기존 가입 회원 동기화 완료 — ${details}`);
        setReloadSequence((current) => current + 1);
      } catch (caught) {
        setSyncError(
          caught instanceof Error
            ? caught.message
            : "기존 가입 회원을 동기화하지 못했습니다.",
        );
      } finally {
        syncInFlight.current = false;
        setSyncing(false);
      }
    },
    [],
  );

  useEffect(() => {
    const controller = new AbortController();
    const visibleParams = new URLSearchParams(params);
    visibleParams.delete("limit");
    const query = visibleParams.toString();
    window.history.replaceState(
      null,
      "",
      query ? `/admin/members?${query}` : "/admin/members",
    );
    void load(controller.signal);
    return () => controller.abort();
  }, [load, params, reloadSequence]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCursor("");
    setCursorHistory([]);
    setFilters((current) => ({
      ...current,
      query: queryDraft.trim().slice(0, 120),
      page: 1,
    }));
  }

  function updateFilter<
    Key extends "role" | "status" | "denomination" | "profile" | "sort",
  >(
    key: Key,
    value: MemberListFilters[Key],
  ) {
    setCursor("");
    setCursorHistory([]);
    setFilters((current) => ({ ...current, [key]: value, page: 1 }));
  }

  function clearFilters() {
    setQueryDraft("");
    setCursor("");
    setCursorHistory([]);
    setFilters({
      query: "",
      role: "all",
      status: "all",
      denomination: "all",
      profile: "all",
      sort: "registered_desc",
      page: 1,
    });
  }

  function nextPage() {
    if (data.nextCursor) {
      setCursorHistory((history) => [...history, cursor]);
      setCursor(data.nextCursor);
    }
    setFilters((current) => ({ ...current, page: current.page + 1 }));
  }

  function previousPage() {
    const previousCursor = cursorHistory.at(-1) ?? "";
    setCursorHistory((history) => history.slice(0, -1));
    setCursor(previousCursor);
    setFilters((current) => ({
      ...current,
      page: Math.max(1, current.page - 1),
    }));
  }

  const hasFilters = Boolean(
    filters.query ||
      filters.role !== "all" ||
      filters.status !== "all" ||
      filters.denomination !== "all" ||
      filters.profile !== "all" ||
      filters.sort !== "registered_desc",
  );
  const pageCount = Math.max(1, Math.ceil(data.total / data.limit));
  const canGoNext = data.nextCursor
    ? true
    : filters.page < pageCount && data.items.length > 0;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-7 sm:py-10 lg:px-10 lg:py-12">
      <AppPageHeading
        eyebrow="Administration"
        title="회원 관리"
        description="회원의 사역 정보와 서비스 활동을 확인하고 업무 역할, 이용 상태와 토큰을 안전하게 관리합니다."
      />

      {syncMessage ? (
        <div className="mt-5">
          <AppNotice tone="success" title="기존 가입 회원을 반영했습니다.">
            {syncMessage}
          </AppNotice>
        </div>
      ) : null}
      {syncError ? (
        <div className="mt-5">
          <AppNotice tone="warning" title="기존 가입 회원 동기화가 필요합니다.">
            <span>{syncError}</span>{" "}
            <button
              type="button"
              className="font-extrabold underline underline-offset-2"
              onClick={() => void synchronizeExistingMembers()}
            >
              다시 시도
            </button>
          </AppNotice>
        </div>
      ) : null}

      <section
        className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
        aria-label="회원 현황"
      >
        {[
          ["전체 회원", formatCount(data.stats.total), "인증 회원 동기화 후 서비스에 등록된 회원"],
          ["이용 중", formatCount(data.stats.active), "현재 서비스를 이용할 수 있음"],
          ["정지", formatCount(data.stats.suspended), "관리자 조치로 이용 제한"],
          ["전문가", formatCount(data.stats.experts), "설교 피드백 업무 가능"],
        ].map(([label, value, copy]) => (
          <article
            key={label}
            className="rounded-[1.35rem] border border-[#ddd7cd] bg-white p-5 shadow-[0_10px_30px_rgba(39,50,44,.04)]"
          >
            <p className="text-xs font-bold text-[#68746e]">{label}</p>
            <p className="mt-2 font-serif text-3xl font-bold tabular-nums text-[#254238]">
              {value}
            </p>
            <p className="mt-2 text-xs leading-5 text-[#66736c]">{copy}</p>
          </article>
        ))}
      </section>

      <section
        className="mt-6 rounded-[1.5rem] border border-[#d8d2c7] bg-white p-4 shadow-[0_14px_36px_rgba(31,54,45,.05)] sm:p-5"
        aria-labelledby="member-filter-title"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-[.17em] text-[#a56732]">
              Directory
            </p>
            <h2 id="member-filter-title" className="mt-1 font-serif text-xl font-bold text-[#29463a]">
              회원 찾기
            </h2>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              disabled={syncing}
              onClick={() => void synchronizeExistingMembers()}
              className="min-h-10 rounded-xl border border-[#9aae9f] bg-[#eef4ef] px-3 text-xs font-extrabold text-[#315746] hover:bg-[#e2ece4] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838] disabled:cursor-wait disabled:opacity-60"
            >
              {syncing ? "기존 회원 확인 중…" : "기존 가입 회원 동기화"}
            </button>
            {hasFilters ? (
              <button
                type="button"
                onClick={clearFilters}
                className="min-h-10 rounded-xl px-3 text-xs font-extrabold text-[#52645c] underline underline-offset-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838]"
              >
                검색·필터 초기화
              </button>
            ) : null}
          </div>
        </div>

        <form className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" onSubmit={submitSearch} role="search">
          <label className="relative min-w-0 sm:col-span-2">
            <span className="sr-only">이름, 이메일 또는 교회 검색</span>
            <span className="pointer-events-none absolute left-4 top-3.5 text-[#6f7c75]" aria-hidden="true">
              ⌕
            </span>
            <input
              value={queryDraft}
              onChange={(event) => setQueryDraft(event.target.value.slice(0, 120))}
              placeholder="이름, 이메일 또는 교회"
              autoComplete="off"
              className="min-h-12 w-full rounded-xl border border-[#d3cdc2] bg-[#fcfbf8] pl-11 pr-4 text-sm text-[#263c32] outline-none focus:border-[#6f8d80] focus:ring-2 focus:ring-[#b9cec5]/60"
            />
          </label>
          <label>
            <span className="sr-only">업무 역할 필터</span>
            <select
              value={filters.role}
              onChange={(event) => updateFilter("role", event.target.value as MemberListFilters["role"])}
              className="min-h-12 w-full rounded-xl border border-[#d3cdc2] bg-[#fcfbf8] px-3 text-sm font-semibold text-[#32473e] outline-none focus:ring-2 focus:ring-[#b97838]"
            >
              <option value="all">모든 역할</option>
              <option value="preacher">설교자</option>
              <option value="expert">전문가</option>
            </select>
          </label>
          <label>
            <span className="sr-only">이용 상태 필터</span>
            <select
              value={filters.status}
              onChange={(event) => updateFilter("status", event.target.value as MemberListFilters["status"])}
              className="min-h-12 w-full rounded-xl border border-[#d3cdc2] bg-[#fcfbf8] px-3 text-sm font-semibold text-[#32473e] outline-none focus:ring-2 focus:ring-[#b97838]"
            >
              <option value="all">모든 상태</option>
              <option value="active">이용 중</option>
              <option value="suspended">정지</option>
            </select>
          </label>
          <label>
            <span className="sr-only">교단 필터</span>
            <select
              value={filters.denomination}
              onChange={(event) =>
                updateFilter(
                  "denomination",
                  event.target.value as MemberListFilters["denomination"],
                )
              }
              className="min-h-12 w-full rounded-xl border border-[#d3cdc2] bg-[#fcfbf8] px-3 text-sm font-semibold text-[#32473e] outline-none focus:ring-2 focus:ring-[#b97838]"
            >
              <option value="all">모든 교단</option>
              {MEMBER_DENOMINATIONS.map((denomination) => (
                <option key={denomination} value={denomination}>
                  {denomination}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">프로필 완성도 필터</span>
            <select
              value={filters.profile}
              onChange={(event) =>
                updateFilter(
                  "profile",
                  event.target.value as MemberListFilters["profile"],
                )
              }
              className="min-h-12 w-full rounded-xl border border-[#d3cdc2] bg-[#fcfbf8] px-3 text-sm font-semibold text-[#32473e] outline-none focus:ring-2 focus:ring-[#b97838]"
            >
              <option value="all">모든 프로필</option>
              <option value="complete">프로필 완성</option>
              <option value="incomplete">프로필 미완성</option>
            </select>
          </label>
          <label>
            <span className="sr-only">회원 목록 정렬</span>
            <select
              value={filters.sort}
              onChange={(event) =>
                updateFilter(
                  "sort",
                  event.target.value as MemberListFilters["sort"],
                )
              }
              className="min-h-12 w-full rounded-xl border border-[#d3cdc2] bg-[#fcfbf8] px-3 text-sm font-semibold text-[#32473e] outline-none focus:ring-2 focus:ring-[#b97838]"
            >
              <option value="registered_desc">최근 등록순</option>
              <option value="activity_desc">최근 활동순</option>
              <option value="tokens_desc">토큰 많은순</option>
              <option value="name_asc">이름순</option>
            </select>
          </label>
          <button
            type="submit"
            className="min-h-12 rounded-xl bg-[#e3b477] px-6 text-sm font-extrabold text-[#263b33] hover:bg-[#edc490] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8b572d] focus-visible:ring-offset-2 sm:col-span-2 xl:col-span-1"
          >
            검색
          </button>
        </form>
      </section>

      {error ? (
        <div className="mt-5">
          <AppNotice tone="error" title="회원 목록을 불러오지 못했습니다.">
            <span>{error}</span>{" "}
            <button type="button" className="font-bold underline" onClick={() => void load()}>
              다시 시도
            </button>
          </AppNotice>
        </div>
      ) : null}

      <section className="mt-6 overflow-hidden rounded-3xl border border-[#d8d2c7] bg-[#fffdf8] shadow-[0_16px_44px_rgba(31,54,45,.05)]" aria-labelledby="member-list-title">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e2ddd3] px-5 py-4 sm:px-7">
          <h2 id="member-list-title" className="text-sm font-extrabold text-[#29463a]">
            회원 목록 <span className="ml-1 text-[#a26a36]">{data.total.toLocaleString("ko-KR")}</span>
          </h2>
          <p className="text-xs font-semibold text-[#69766f]" aria-live="polite">
            {loading ? "목록을 불러오는 중" : `${filters.page}페이지`}
          </p>
        </div>

        {loading ? (
          <div className="grid min-h-80 place-items-center" role="status" aria-label="회원 목록을 불러오는 중">
            <div className="text-center">
              <div className="mx-auto size-10 animate-spin rounded-full border-2 border-[#d6d0c5] border-t-[#315647]" />
              <p className="mt-3 text-sm text-[#5f6c65]">회원 정보를 정리하고 있습니다.</p>
            </div>
          </div>
        ) : data.items.length === 0 ? (
          <div className="grid min-h-80 place-items-center px-6 text-center">
            <div>
              <span aria-hidden="true" className="mx-auto grid size-14 place-items-center rounded-2xl bg-[#e3ebe4] font-serif text-lg font-bold text-[#315647]">
                회
              </span>
              <h3 className="mt-4 font-serif text-xl font-bold text-[#29463a]">
                조건에 맞는 회원이 없습니다.
              </h3>
              <p className="mt-2 text-sm text-[#64716a]">검색어나 필터를 바꿔 다시 확인해 보세요.</p>
              {hasFilters ? (
                <button type="button" onClick={clearFilters} className="mt-4 min-h-11 rounded-xl bg-[#315746] px-4 text-sm font-extrabold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838]">
                  전체 회원 보기
                </button>
              ) : null}
            </div>
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full min-w-[68rem] border-collapse text-left">
                <thead className="bg-[#f2efe8] text-[11px] font-extrabold text-[#5f6d66]">
                  <tr>
                    <th className="px-6 py-3.5" scope="col">회원</th>
                    <th className="px-4 py-3.5" scope="col">역할·상태</th>
                    <th className="px-4 py-3.5" scope="col">사역·신학</th>
                    <th className="px-4 py-3.5 text-right" scope="col">활동</th>
                    <th className="px-4 py-3.5 text-right" scope="col">토큰</th>
                    <th className="px-4 py-3.5" scope="col">최근 활동</th>
                    <th className="px-6 py-3.5 text-right" scope="col"><span className="sr-only">상세</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e7e2d8]">
                  {data.items.map((member) => (
                    <tr key={member.id} className="align-middle transition-colors hover:bg-[#f6f7f1]">
                      <td className="px-6 py-5">
                        <a href={memberHref(member.id, params)} className="rounded-lg font-serif text-base font-bold text-[#203b30] hover:text-[#995c2f] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838]">
                          {member.name}
                        </a>
                        <span className="mt-1 block max-w-64 break-words text-xs text-[#5f6d66]">{member.email || "이메일 없음"}</span>
                      </td>
                      <td className="px-4 py-5"><MemberBadges member={member} /></td>
                      <td className="px-4 py-5">
                        <span className="block text-sm font-bold text-[#34483f]">{member.church || "교회 미등록"}</span>
                        <span className="mt-1 block text-xs text-[#68756e]">
                          {[member.ministryRole, member.denomination, member.theology].filter(Boolean).join(" · ") || "사역 정보 미등록"}
                        </span>
                      </td>
                      <td className="px-4 py-5 text-right text-xs text-[#64716a]">
                        <strong className="block text-sm tabular-nums text-[#31483e]">설교 {member.sermonCount.toLocaleString("ko-KR")}</strong>
                        <span>피드백 {member.consultationCount.toLocaleString("ko-KR")}</span>
                      </td>
                      <td className="px-4 py-5 text-right text-sm font-extrabold tabular-nums text-[#9b6032]">{formatTokens(member.tokenBalance)}</td>
                      <td className="px-4 py-5 text-xs text-[#5f6d66]">{formatDate(member.lastActiveAt || member.createdAt)}</td>
                      <td className="px-6 py-5 text-right">
                        <a href={memberHref(member.id, params)} aria-label={`${member.name} 회원 상세 보기`} className="inline-flex min-h-10 items-center rounded-xl px-3 text-xs font-extrabold text-[#315746] hover:bg-[#e8eee9] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838]">
                          상세 보기 →
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="divide-y divide-[#e7e2d8] lg:hidden">
              {data.items.map((member) => (
                <li key={member.id} className="p-4 sm:p-5">
                  <article className="rounded-2xl border border-[#ddd8cf] bg-white p-4 shadow-[0_8px_22px_rgba(35,52,44,.04)]">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <a href={memberHref(member.id, params)} className="rounded-lg font-serif text-lg font-bold text-[#203b30] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838]">
                          {member.name}
                        </a>
                        <p className="mt-1 break-words text-xs text-[#5f6d66]">{member.email || "이메일 없음"}</p>
                      </div>
                      <MemberBadges member={member} />
                    </div>
                    <div className="mt-4 rounded-xl bg-[#f4f2ec] px-3.5 py-3">
                      <p className="text-sm font-bold text-[#34483f]">{member.church || "교회 미등록"}</p>
                      <p className="mt-1 text-xs leading-5 text-[#66736c]">
                        {[member.ministryRole, member.denomination, member.theology].filter(Boolean).join(" · ") || "사역 정보 미등록"}
                      </p>
                    </div>
                    <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-xl border border-[#e4dfd6] px-2 py-2.5">
                        <dt className="text-[10px] font-bold text-[#6c7771]">완성 설교</dt>
                        <dd className="mt-1 text-sm font-black tabular-nums text-[#2f493e]">{member.sermonCount.toLocaleString("ko-KR")}</dd>
                      </div>
                      <div className="rounded-xl border border-[#e4dfd6] px-2 py-2.5">
                        <dt className="text-[10px] font-bold text-[#6c7771]">피드백</dt>
                        <dd className="mt-1 text-sm font-black tabular-nums text-[#2f493e]">{member.consultationCount.toLocaleString("ko-KR")}</dd>
                      </div>
                      <div className="rounded-xl border border-[#e4dfd6] px-2 py-2.5">
                        <dt className="text-[10px] font-bold text-[#6c7771]">토큰</dt>
                        <dd className="mt-1 text-sm font-black tabular-nums text-[#955a2f]">{formatTokens(member.tokenBalance)}</dd>
                      </div>
                    </dl>
                    <div className="mt-4 flex items-center justify-between gap-3 border-t border-[#e8e3da] pt-3">
                      <p className="text-[11px] text-[#69756f]">최근 {formatDate(member.lastActiveAt || member.createdAt)}</p>
                      <a href={memberHref(member.id, params)} className="inline-flex min-h-10 items-center rounded-xl px-3 text-xs font-extrabold text-[#315746] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838]">
                        상세 보기 →
                      </a>
                    </div>
                  </article>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {!loading && data.items.length ? (
        <nav className="mt-7 flex items-center justify-center gap-3" aria-label="회원 목록 페이지 이동">
          <button
            type="button"
            onClick={previousPage}
            disabled={filters.page <= 1}
            className="min-h-11 rounded-xl border border-[#d0cabf] bg-white px-4 text-sm font-extrabold text-[#43584e] hover:border-[#91a197] disabled:cursor-not-allowed disabled:opacity-45"
          >
            ← 이전
          </button>
          <span className="min-w-20 text-center text-sm font-bold tabular-nums text-[#53645c]">
            {filters.page} / {pageCount}
          </span>
          <button
            type="button"
            onClick={nextPage}
            disabled={!canGoNext}
            className="min-h-11 rounded-xl border border-[#294b3d] bg-[#294b3d] px-4 text-sm font-extrabold text-white hover:bg-[#203e33] disabled:cursor-not-allowed disabled:opacity-45"
          >
            다음 →
          </button>
        </nav>
      ) : null}
    </div>
  );
}
