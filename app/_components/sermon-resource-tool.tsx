"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AI_ENGINE_TIERS,
  AI_ENGINE_TIER_META,
  type AiEngineTier,
} from "@/app/_lib/ai-engine-tiers";
import {
  MINISTRY_OUTPUT_TYPES,
  STUDY_GROUPS,
  type SermonResourceMode,
  type SermonResourceResult,
} from "@/app/_lib/sermon-resources";

type SermonItem = {
  id: string;
  title: string;
  scripture?: string;
  passage?: string;
  updatedAt?: string;
};

type ToolProps = {
  mode: SermonResourceMode;
};

type RequestState = "idle" | "loading" | "success" | "error";

type FairUseStatus = {
  remainingToday: number;
  dailyLimit: number;
};

function isSermonItem(value: unknown): value is SermonItem {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as SermonItem).id === "string" &&
      typeof (value as SermonItem).title === "string",
  );
}

function resultPlainText(result: SermonResourceResult): string {
  return [
    result.title,
    result.summary,
    ...result.sections.map((section) => `${section.heading}\n${section.content}`),
  ].join("\n\n");
}

export function SermonResourceTool({ mode }: ToolProps) {
  const [sermons, setSermons] = useState<SermonItem[]>([]);
  const [sermonsLoading, setSermonsLoading] = useState(true);
  const [sermonsError, setSermonsError] = useState("");
  const [sermonsWarning, setSermonsWarning] = useState("");
  const [sermonId, setSermonId] = useState("");
  const [selections, setSelections] = useState<string[]>(
    mode === "ministry" ? [MINISTRY_OUTPUT_TYPES[0]] : [],
  );
  const [aiTier, setAiTier] = useState<AiEngineTier>("basic");
  const [requestState, setRequestState] = useState<RequestState>("idle");
  const [error, setError] = useState("");
  const [result, setResult] = useState<SermonResourceResult | null>(null);
  const [source, setSource] = useState<{ title: string; scripture: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [fairUse, setFairUse] = useState<FairUseStatus | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function loadSermons() {
      setSermonsLoading(true);
      setSermonsError("");
      setSermonsWarning("");
      try {
        const response = await fetch("/api/sermons?page=1", {
          headers: { Accept: "application/json" },
          cache: "no-store",
          signal: controller.signal,
        });
        const body = (await response.json().catch(() => null)) as
          | { items?: unknown; error?: string }
          | null;
        if (!response.ok) throw new Error(body?.error || "저장된 설교를 불러오지 못했습니다.");
        const items = Array.isArray(body?.items) ? body.items.filter(isSermonItem) : [];
        const requested = new URLSearchParams(window.location.search).get("sermonId")?.trim() ?? "";
        let nextItems = items;
        if (requested && !items.some((item) => item.id === requested)) {
          try {
            const detailResponse = await fetch(`/api/sermons/${encodeURIComponent(requested)}`, {
              headers: { Accept: "application/json" },
              cache: "no-store",
              signal: controller.signal,
            });
            const detailBody = (await detailResponse.json().catch(() => null)) as
              | { item?: unknown; error?: string }
              | null;
            if (!detailResponse.ok || !isSermonItem(detailBody?.item)) {
              setSermons(items);
              setSermonId("");
              setSermonsWarning(
                `${detailBody?.error || "요청한 설교를 찾을 수 없습니다."} 아래 목록에서 다른 설교를 선택해 주세요.`,
              );
              return;
            }
            nextItems = [detailBody.item, ...items];
          } catch (caught) {
            if (caught instanceof DOMException && caught.name === "AbortError") throw caught;
            setSermons(items);
            setSermonId("");
            setSermonsWarning("요청한 설교를 불러오지 못했습니다. 아래 목록에서 다른 설교를 선택해 주세요.");
            return;
          }
        }
        setSermons(nextItems);
        setSermonId((current) => {
          if (current) return current;
          if (requested) return nextItems.find((item) => item.id === requested)?.id ?? "";
          return nextItems[0]?.id ?? "";
        });
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setSermonsError(
          caught instanceof Error ? caught.message : "저장된 설교를 불러오지 못했습니다.",
        );
      } finally {
        if (!controller.signal.aborted) setSermonsLoading(false);
      }
    }
    void loadSermons();
    return () => controller.abort();
  }, []);

  const selectedSermon = useMemo(
    () => sermons.find((sermon) => sermon.id === sermonId) ?? null,
    [sermonId, sermons],
  );

  function toggleStudyOption(option: string) {
    setSelections((current) =>
      current.includes(option)
        ? current.filter((item) => item !== option)
        : [...current, option],
    );
    setResult(null);
    setSource(null);
    setError("");
    setFairUse(null);
    setRequestState("idle");
  }

  async function generate() {
    if (!sermonId || selections.length === 0 || requestState === "loading") return;
    setRequestState("loading");
    setError("");
    setResult(null);
    setSource(null);
    setFairUse(null);
    setCopied(false);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 100_000);
    try {
      const response = await fetch("/api/sermon-resources", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ sermonId, mode, selections, aiTier }),
        signal: controller.signal,
      });
      const body = (await response.json().catch(() => null)) as
        | {
            result?: SermonResourceResult;
            source?: { title: string; scripture: string };
            error?: string;
            remainingToday?: number;
            dailyLimit?: number;
          }
        | null;
      if (
        typeof body?.remainingToday === "number" &&
        typeof body.dailyLimit === "number"
      ) {
        setFairUse({
          remainingToday: body.remainingToday,
          dailyLimit: body.dailyLimit,
        });
      }
      if (!response.ok || !body?.result) {
        throw new Error(body?.error || "자료를 생성하지 못했습니다.");
      }
      setResult(body.result);
      setSource(body.source ?? null);
      setRequestState("success");
    } catch (caught) {
      const message =
        caught instanceof DOMException && caught.name === "AbortError"
          ? "생성 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요."
          : caught instanceof Error
            ? caught.message
            : "자료를 생성하지 못했습니다.";
      setError(message);
      setRequestState("error");
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function copyResult() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(resultPlainText(result));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="mt-7 grid gap-6 xl:grid-cols-[minmax(19rem,.72fr)_minmax(0,1.28fr)]">
      <section className="rounded-[1.75rem] border border-[#d9d4ca] bg-white p-5 shadow-[0_16px_45px_rgba(39,50,44,.06)] sm:p-7">
        <div>
          <p className="text-[10px] font-extrabold uppercase tracking-[.16em] text-[#a56732]">
            01 · Source sermon
          </p>
          <h2 className="mt-2 font-serif text-2xl font-bold text-[#294238]">완성 설교 선택</h2>
          <p className="mt-2 text-sm leading-6 text-[#6f7b75]">
            저장한 설교를 기준으로 결과물을 만듭니다.
          </p>
        </div>

        {sermonsLoading ? (
          <div className="mt-5 h-13 animate-pulse rounded-xl bg-[#f0eee8]" aria-label="설교 목록을 불러오는 중" />
        ) : sermonsError ? (
          <p className="mt-5 rounded-xl border border-[#e4bcb3] bg-[#fff2ef] p-4 text-xs font-semibold leading-5 text-[#843c31]" role="alert">
            {sermonsError}
          </p>
        ) : sermons.length === 0 ? (
          <div className="mt-5 rounded-xl border border-dashed border-[#cfc8bc] bg-[#faf8f3] p-5 text-center">
            <p className="text-sm font-bold text-[#43564d]">저장된 완성 설교가 없습니다.</p>
            <a className="mt-3 inline-flex min-h-10 items-center rounded-xl bg-[#285343] px-4 text-xs font-bold text-white" href="/sermon/options">
              새 설교 만들기
            </a>
          </div>
        ) : (
          <>
            {sermonsWarning ? (
              <p className="mt-5 rounded-xl border border-[#e6c99f] bg-[#fff8ea] p-4 text-xs font-semibold leading-5 text-[#775126]" role="status">
                {sermonsWarning}
              </p>
            ) : null}
            <label className="mt-5 block text-sm font-extrabold text-[#34473e]" htmlFor={`${mode}-sermon`}>
              설교
              <select
                id={`${mode}-sermon`}
                value={sermonId}
                onChange={(event) => {
                  setSermonId(event.target.value);
                  setSermonsWarning("");
                  setResult(null);
                  setSource(null);
                  setError("");
                  setFairUse(null);
                  setRequestState("idle");
                }}
                className="mt-2 min-h-12 w-full rounded-xl border border-[#d5cfc4] bg-[#fcfbf8] px-4 text-sm font-medium text-[#263c32] outline-none focus:border-[#6f8d80] focus:ring-2 focus:ring-[#b9cec5]/60"
              >
                {!sermonId ? <option value="">다른 설교를 선택해 주세요</option> : null}
                {sermons.map((sermon) => (
                  <option key={sermon.id} value={sermon.id}>
                    {sermon.title} · {sermon.scripture || sermon.passage || "본문 미표시"}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}

        <fieldset className="mt-7 border-t border-[#e4dfd6] pt-6">
          <legend className="text-sm font-extrabold text-[#34473e]">
            {mode === "study" ? "연구 범위" : "생성할 자료"}
          </legend>
          {mode === "study" ? (
            <div className="mt-4 space-y-5">
              {STUDY_GROUPS.map((group) => (
                <div key={group.id}>
                  <p className="text-xs font-bold text-[#758079]">{group.label}</p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {group.options.map((option) => (
                      <label
                        key={option}
                        className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 text-xs font-bold transition-colors ${
                          selections.includes(option)
                            ? "border-[#6f8c7d] bg-[#e5eee7] text-[#28513f]"
                            : "border-[#ddd8cf] bg-[#fcfbf8] text-[#637069] hover:border-[#aab7af]"
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="size-4 accent-[#315746]"
                          checked={selections.includes(option)}
                          onChange={() => toggleStudyOption(option)}
                        />
                        {option}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-4 grid gap-2">
              {MINISTRY_OUTPUT_TYPES.map((option) => (
                <label
                  key={option}
                  className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-4 text-sm font-bold transition-colors ${
                    selections[0] === option
                      ? "border-[#6f8c7d] bg-[#e5eee7] text-[#28513f]"
                      : "border-[#ddd8cf] bg-[#fcfbf8] text-[#637069] hover:border-[#aab7af]"
                  }`}
                >
                  <input
                    type="radio"
                    name="ministry-output"
                    className="size-4 accent-[#315746]"
                    checked={selections[0] === option}
                    onChange={() => {
                      setSelections([option]);
                      setResult(null);
                      setSource(null);
                      setError("");
                      setFairUse(null);
                      setRequestState("idle");
                    }}
                  />
                  {option}
                </label>
              ))}
            </div>
          )}
        </fieldset>

        <fieldset className="mt-7 border-t border-[#e4dfd6] pt-6">
          <legend className="text-sm font-extrabold text-[#34473e]">AI 엔진</legend>
          <p className="mt-1 text-xs leading-5 text-[#7b847f]">선택한 엔진 하나를 이 결과 전체에 적용합니다.</p>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {AI_ENGINE_TIERS.map((tier) => (
              <label
                key={tier}
                className={`cursor-pointer rounded-xl border px-2 py-3 text-center text-xs font-bold ${
                  aiTier === tier
                    ? "border-[#6f8c7d] bg-[#e5eee7] text-[#28513f]"
                    : "border-[#ddd8cf] bg-[#fcfbf8] text-[#637069]"
                }`}
              >
                <input
                  className="sr-only"
                  type="radio"
                  name={`${mode}-ai-tier`}
                  checked={aiTier === tier}
                  onChange={() => {
                    setAiTier(tier);
                    setResult(null);
                    setSource(null);
                    setError("");
                    setFairUse(null);
                    setCopied(false);
                    setRequestState("idle");
                  }}
                />
                {AI_ENGINE_TIER_META[tier].label}
              </label>
            ))}
          </div>
        </fieldset>

        <button
          type="button"
          disabled={!sermonId || selections.length === 0 || requestState === "loading"}
          onClick={() => void generate()}
          className="mt-7 inline-flex min-h-13 w-full items-center justify-center rounded-xl bg-[#285343] px-5 text-sm font-extrabold text-white shadow-[0_10px_25px_rgba(38,81,65,.16)] hover:bg-[#204739] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {requestState === "loading"
            ? "생성 중…"
            : mode === "study"
              ? "선택 항목 스터디 생성"
              : "사역 자료 생성"}
        </button>
        <p className="mt-3 text-center text-[11px] font-semibold leading-5 text-[#7b847f]">
          토큰 차감 없음 · 계정당 하루 20회 무료 · 동시에 1건 생성
          {fairUse ? (
            <span className="block text-[#456455]">
              오늘 남은 생성 {fairUse.remainingToday}회 / {fairUse.dailyLimit}회
            </span>
          ) : null}
        </p>
      </section>

      <section className="min-h-[36rem] rounded-[1.75rem] border border-[#d9d4ca] bg-[#fbfaf6] p-5 shadow-[0_16px_45px_rgba(39,50,44,.05)] sm:p-8" aria-live="polite">
        {requestState === "loading" ? (
          <div className="grid min-h-[30rem] place-items-center text-center">
            <div>
              <span className="mx-auto grid size-16 animate-pulse place-items-center rounded-full bg-[#dfeae3] font-serif text-xl font-bold text-[#315746]">AI</span>
              <h2 className="mt-5 font-serif text-2xl font-bold text-[#294238]">자료를 정리하고 있습니다</h2>
              <p className="mt-2 text-sm text-[#78827c]">완성 원고와 선택한 범위를 함께 살피는 중입니다.</p>
            </div>
          </div>
        ) : error ? (
          <div className="grid min-h-[30rem] place-items-center text-center">
            <div className="max-w-md">
              <span className="mx-auto grid size-14 place-items-center rounded-full bg-[#f7dfd8] text-xl font-bold text-[#963f32]">!</span>
              <h2 className="mt-5 font-serif text-2xl font-bold text-[#294238]">생성하지 못했습니다</h2>
              <p className="mt-3 text-sm leading-6 text-[#7c665f]" role="alert">{error}</p>
            </div>
          </div>
        ) : result ? (
          <article>
            <header className="border-b border-[#ddd8cf] pb-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-[10px] font-extrabold uppercase tracking-[.16em] text-[#a56732]">
                    {mode === "study" ? "Sermon study" : "Ministry resource"}
                  </p>
                  <h2 className="mt-2 font-serif text-3xl font-bold tracking-tight text-[#294238]">{result.title}</h2>
                  {source ? <p className="mt-2 text-xs font-semibold text-[#7b847f]">{source.title} · {source.scripture}</p> : null}
                </div>
                <button
                  type="button"
                  onClick={() => void copyResult()}
                  className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-xl border border-[#cfc8bc] bg-white px-4 text-xs font-extrabold text-[#40584d] hover:border-[#9ead9f]"
                >
                  {copied ? "복사됨" : "전체 복사"}
                </button>
              </div>
              <p className="mt-5 whitespace-pre-wrap text-sm leading-7 text-[#596a62]">{result.summary}</p>
            </header>
            <div className="divide-y divide-[#e2ddd4]">
              {result.sections.map((section, index) => (
                <section key={`${section.heading}-${index}`} className="py-6">
                  <div className="grid gap-4 sm:grid-cols-[2.5rem_minmax(0,1fr)]">
                    <span className="grid size-9 place-items-center rounded-full bg-[#e5eee7] font-serif text-xs font-bold text-[#315746]">{String(index + 1).padStart(2, "0")}</span>
                    <div>
                      <h3 className="font-serif text-xl font-bold text-[#2d473c]">{section.heading}</h3>
                      <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-[#52645b]">{section.content}</p>
                    </div>
                  </div>
                </section>
              ))}
            </div>
            <p className="border-t border-[#ddd8cf] pt-5 text-xs leading-5 text-[#838b86]">
              AI가 만든 보조 자료입니다. 원문·역사 정보와 인용은 사용 전에 직접 확인해 주세요.
            </p>
          </article>
        ) : (
          <div className="grid min-h-[30rem] place-items-center text-center">
            <div className="max-w-md">
              <span className="mx-auto grid size-16 place-items-center rounded-[1.4rem] bg-[#e3ece6] font-serif text-lg font-bold text-[#315746]">
                {mode === "study" ? "연" : "활"}
              </span>
              <h2 className="mt-5 font-serif text-2xl font-bold text-[#294238]">
                {mode === "study" ? "본문을 더 깊이 살펴보세요" : "완성 설교를 사역 현장으로 이어보세요"}
              </h2>
              <p className="mt-3 text-sm leading-6 text-[#78827c]">
                {selectedSermon
                  ? `'${selectedSermon.title}'을 기준으로 생성할 항목을 선택해 주세요.`
                  : "먼저 완성된 설교를 선택해 주세요."}
              </p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
