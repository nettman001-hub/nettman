"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AI_ENGINE_TIER_META,
  isAiEngineTier,
  type AiEngineTier,
} from "@/app/_lib/ai-engine-tiers";
import {
  MINISTRY_OUTPUT_TYPES,
  STUDY_GROUPS,
  STUDY_OPTIONS,
  type SermonResourceMode,
  type SermonResourceResult,
} from "@/app/_lib/sermon-resources";
import { useAiAgent, useRegisterAiAgentPage } from "./ai-agent-provider";

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

// The agent contract accepts a maximum 28k-character snapshot. Keep enough
// headroom for form fields, source metadata, section headings, and JSON keys
// even when a critique includes a long manuscript and twelve result sections.
const AI_AGENT_RESOURCE_MANUSCRIPT_LIMIT = 10_000;
const AI_AGENT_RESOURCE_SUMMARY_LIMIT = 1_000;
const AI_AGENT_RESOURCE_SECTION_LIMIT = 900;

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function SermonResourceTool({ mode }: ToolProps) {
  const {
    engineAvailabilityStatus,
    availableEngineTiersFor,
    isEngineTierAvailableFor,
    engineAvailabilityNoticeFor,
    reloadEngineAvailability,
  } = useAiAgent();
  const selectableEngineTiers = useMemo(
    () => availableEngineTiersFor("resource"),
    [availableEngineTiersFor],
  );
  const engineAvailabilityNotice = engineAvailabilityNoticeFor("resource");
  const [sermons, setSermons] = useState<SermonItem[]>([]);
  const [sermonsLoading, setSermonsLoading] = useState(true);
  const [sermonsError, setSermonsError] = useState("");
  const [sermonsWarning, setSermonsWarning] = useState("");
  const [sermonId, setSermonId] = useState("");
  const [scriptureInput, setScriptureInput] = useState("");
  const [notesInput, setNotesInput] = useState("");
  const [manuscriptInput, setManuscriptInput] = useState("");
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
    if (
      engineAvailabilityStatus !== "ready" ||
      !selectableEngineTiers.length ||
      isEngineTierAvailableFor(aiTier, "resource")
    ) {
      return;
    }
    setAiTier(selectableEngineTiers[0]!);
  }, [
    aiTier,
    engineAvailabilityStatus,
    isEngineTierAvailableFor,
    selectableEngineTiers,
  ]);

  useEffect(() => {
    if (mode !== "ministry") {
      setSermonsLoading(false);
      return;
    }
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
  }, [mode]);

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

  const engineReady =
    engineAvailabilityStatus === "ready" &&
    isEngineTierAvailableFor(aiTier, "resource");
  const canGenerate =
    engineReady &&
    (mode === "ministry"
      ? Boolean(sermonId) && selections.length > 0
      : mode === "study"
        ? scriptureInput.trim().length > 0 && selections.length > 0
        : manuscriptInput.trim().length >= 300);

  const generate = useCallback(async () => {
    if (!canGenerate || requestState === "loading") return;
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
        body: JSON.stringify(
          mode === "ministry"
            ? { sermonId, mode, selections, aiTier }
            : mode === "study"
              ? { mode, selections, aiTier, scripture: scriptureInput.trim(), notes: notesInput.trim() }
              : { mode, aiTier, manuscript: manuscriptInput, scripture: scriptureInput.trim() },
        ),
        signal: controller.signal,
      });
      const body = (await response.json().catch(() => null)) as
        | {
            result?: SermonResourceResult;
            source?: { title: string; scripture: string };
            error?: string;
            code?: string;
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
      if (
        body?.code === "ai_engine_disabled" ||
        body?.code === "ai_engine_unavailable" ||
        body?.code === "ai_engine_status_unavailable"
      ) {
        void reloadEngineAvailability();
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
  }, [
    aiTier,
    canGenerate,
    manuscriptInput,
    mode,
    notesInput,
    requestState,
    reloadEngineAvailability,
    scriptureInput,
    selections,
    sermonId,
  ]);

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

  const agentRegistration = useMemo(() => {
    const surface = mode as "study" | "critique" | "ministry";
    const compactResult = result
      ? {
          title: result.title.slice(0, 120),
          summary: result.summary.slice(0, AI_AGENT_RESOURCE_SUMMARY_LIMIT),
          summaryTruncated:
            result.summary.length > AI_AGENT_RESOURCE_SUMMARY_LIMIT,
          sections: result.sections.slice(0, 12).map((section) => ({
            heading: section.heading.slice(0, 120),
            content: section.content.slice(0, AI_AGENT_RESOURCE_SECTION_LIMIT),
            contentTruncated:
              section.content.length > AI_AGENT_RESOURCE_SECTION_LIMIT,
          })),
        }
      : null;
    const compactSource = source
      ? {
          title: source.title.slice(0, 120),
          scripture: source.scripture.slice(0, 200),
        }
      : null;
    return {
      surface,
      title:
        mode === "study"
          ? "성경 본문 연구"
          : mode === "critique"
            ? "설교 원고 비평"
            : "사역 자료 생성",
      ...(mode === "ministry" && sermonId ? { resourceId: sermonId } : {}),
      snapshot: {
        form:
          mode === "ministry"
            ? {
                sermonId,
                availableSermons: sermons.slice(0, 20).map((item) => ({
                  id: item.id,
                  title: item.title.slice(0, 120),
                  scripture: (item.scripture ?? item.passage ?? "").slice(0, 200),
                })),
                aiTier,
              }
            : mode === "study"
              ? { scripture: scriptureInput, notes: notesInput, aiTier }
              : {
                  scripture: scriptureInput,
                  manuscript: manuscriptInput.slice(
                    0,
                    AI_AGENT_RESOURCE_MANUSCRIPT_LIMIT,
                  ),
                  manuscriptTruncated:
                    manuscriptInput.length > AI_AGENT_RESOURCE_MANUSCRIPT_LIMIT,
                  aiTier,
                },
        source: compactSource,
        result: compactResult,
        selection: selections,
        generationStatus: requestState,
      },
      capabilities: ["navigate", "resource.form.patch", "resource.generate"] as Array<
        "navigate" | "resource.form.patch" | "resource.generate"
      >,
      suggestions:
        mode === "study"
          ? [
              "현재 연구 범위에서 보완할 항목을 알려줘",
              "입력한 본문에 어울리는 연구 범위를 제안해줘",
              "연구 결과의 핵심을 정리해줘",
            ]
          : mode === "critique"
            ? [
                "이 원고에서 먼저 점검할 부분을 알려줘",
                "비평 결과의 우선순위를 정리해줘",
                "원고 입력이 충분한지 확인해줘",
              ]
            : [
                "선택한 설교에 어울리는 사역 자료를 추천해줘",
                "현재 선택 항목을 점검해줘",
                "생성된 자료의 활용 방법을 알려줘",
              ],
      executeAction: async (proposal: {
        capability: string;
        args: Record<string, unknown>;
      }) => {
        if (proposal.capability === "resource.generate") {
          if (requestState === "loading") {
            throw new Error("현재 자료를 생성하고 있습니다.");
          }
          if (!canGenerate) {
            throw new Error("자료 생성에 필요한 입력과 선택 항목을 먼저 채워 주세요.");
          }
          await generate();
          return { message: "기존 화면의 생성 절차로 자료 생성을 요청했습니다." };
        }
        if (proposal.capability !== "resource.form.patch") {
          throw new Error("현재 화면에서는 이 작업을 적용할 수 없습니다.");
        }
        if (requestState === "loading") {
          throw new Error("자료 생성 중에는 입력값을 변경할 수 없습니다.");
        }
        const patch = proposal.args.patch;
        if (!isRecord(patch)) throw new Error("변경할 입력값 형식을 확인해 주세요.");
        let applied = false;
        if (patch.aiTier !== undefined) {
          if (!isAiEngineTier(patch.aiTier)) {
            throw new Error("AI 엔진 등급을 다시 선택해 주세요.");
          }
          if (!isEngineTierAvailableFor(patch.aiTier, "resource")) {
            throw new Error(
              "관리자가 사용 중지했거나 이 기능에 연결하지 않은 AI 엔진은 선택할 수 없습니다.",
            );
          }
          setAiTier(patch.aiTier);
          applied = true;
        }
        if (mode === "study") {
          if (patch.scripture !== undefined) {
            if (typeof patch.scripture !== "string" || patch.scripture.trim().length === 0 || patch.scripture.length > 120) {
              throw new Error("성경 본문은 120자 이하로 입력해 주세요.");
            }
            setScriptureInput(patch.scripture.trim());
            applied = true;
          }
          if (patch.notes !== undefined) {
            if (typeof patch.notes !== "string" || patch.notes.length > 2_000) {
              throw new Error("기타 필요사항은 2,000자 이하로 입력해 주세요.");
            }
            setNotesInput(patch.notes);
            applied = true;
          }
          if (patch.selections !== undefined) {
            if (
              !Array.isArray(patch.selections) ||
              patch.selections.length === 0 ||
              patch.selections.some(
                (item) =>
                  typeof item !== "string" ||
                  !STUDY_OPTIONS.some((option) => option === item),
              )
            ) {
              throw new Error("연구 범위는 화면에서 제공하는 항목만 선택할 수 있습니다.");
            }
            setSelections([...new Set(patch.selections as string[])]);
            applied = true;
          }
        } else if (mode === "critique") {
          if (patch.manuscript !== undefined) {
            if (typeof patch.manuscript !== "string" || patch.manuscript.length > 60_000) {
              throw new Error("설교 원고는 60,000자 이하로 입력해 주세요.");
            }
            setManuscriptInput(patch.manuscript);
            applied = true;
          }
          if (patch.scripture !== undefined) {
            if (typeof patch.scripture !== "string" || patch.scripture.length > 120) {
              throw new Error("성경 본문은 120자 이하로 입력해 주세요.");
            }
            setScriptureInput(patch.scripture.trim());
            applied = true;
          }
        } else {
          if (patch.sermonId !== undefined) {
            if (
              typeof patch.sermonId !== "string" ||
              !sermons.some((item) => item.id === patch.sermonId)
            ) {
              throw new Error("현재 목록에 있는 저장 설교를 선택해 주세요.");
            }
            setSermonId(patch.sermonId);
            applied = true;
          }
          if (patch.selections !== undefined) {
            if (
              !Array.isArray(patch.selections) ||
              patch.selections.length === 0 ||
              patch.selections.some(
                (item) =>
                  typeof item !== "string" ||
                  !MINISTRY_OUTPUT_TYPES.some((type) => type === item),
              )
            ) {
              throw new Error("사역 자료는 화면에서 제공하는 항목만 선택할 수 있습니다.");
            }
            setSelections([...new Set(patch.selections as string[])]);
            applied = true;
          }
        }
        if (!applied) throw new Error("적용할 수 있는 입력값 변경이 없습니다.");
        setResult(null);
        setSource(null);
        setError("");
        setFairUse(null);
        setRequestState("idle");
        return {
          message:
            "제안한 내용을 입력란에 반영했습니다. 확인한 뒤 기존 생성 버튼을 눌러 주세요.",
        };
      },
    };
  }, [
    aiTier,
    canGenerate,
    generate,
    isEngineTierAvailableFor,
    manuscriptInput,
    mode,
    notesInput,
    requestState,
    result,
    scriptureInput,
    selections,
    sermonId,
    sermons,
    source,
  ]);

  useRegisterAiAgentPage(agentRegistration);

  return (
    <div className="mt-7 grid gap-6 xl:grid-cols-[minmax(19rem,.72fr)_minmax(0,1.28fr)]">
      <section className="rounded-[1.75rem] border border-[#d9d4ca] bg-white p-5 shadow-[0_16px_45px_rgba(39,50,44,.06)] sm:p-7">
        <div>
          <p className="text-[10px] font-extrabold uppercase tracking-[.16em] text-[#a56732]">
            {mode === "ministry" ? "01 · Source sermon" : mode === "study" ? "01 · Scripture" : "01 · Manuscript"}
          </p>
          <h2 className="mt-2 font-serif text-2xl font-bold text-[#294238]">
            {mode === "ministry" ? "완성 설교 선택" : mode === "study" ? "성경 본문 입력" : "설교 원고 붙여넣기"}
          </h2>
          <p className="mt-2 text-sm leading-6 text-[#6f7b75]">
            {mode === "ministry"
              ? "저장한 설교를 기준으로 결과물을 만듭니다."
              : mode === "study"
                ? "연구할 본문의 장·절을 입력하면 개역한글판(1961) 본문으로 연구합니다."
                : "직접 작성한 원고를 붙여 넣으면 설교학 루브릭으로 점검해 드립니다."}
          </p>
        </div>

        {mode === "study" ? (
          <div className="mt-5 space-y-4">
            <label className="block text-sm font-extrabold text-[#34473e]" htmlFor="study-scripture">
              성경 본문
              <input
                id="study-scripture"
                type="text"
                value={scriptureInput}
                onChange={(event) => {
                  setScriptureInput(event.target.value.slice(0, 120));
                  setResult(null);
                  setError("");
                  setRequestState("idle");
                }}
                placeholder="예: 요한복음 3:16-20 · 시편 23 · 창세기 1-2장"
                className="mt-2 min-h-12 w-full rounded-xl border border-[#d5cfc4] bg-[#fcfbf8] px-4 text-sm font-medium text-[#263c32] outline-none focus:border-[#6f8d80] focus:ring-2 focus:ring-[#b9cec5]/60"
              />
            </label>
            <label className="block text-sm font-extrabold text-[#34473e]" htmlFor="study-notes">
              기타 필요사항 <span className="font-medium text-[#7b847f]">(선택)</span>
              <textarea
                id="study-notes"
                value={notesInput}
                onChange={(event) => setNotesInput(event.target.value.slice(0, 2000))}
                rows={3}
                placeholder="설교 방향, 관심 주제, 특별히 확인하고 싶은 부분을 적어 주세요."
                className="mt-2 w-full rounded-xl border border-[#d5cfc4] bg-[#fcfbf8] px-4 py-3 text-sm font-medium leading-6 text-[#263c32] outline-none focus:border-[#6f8d80] focus:ring-2 focus:ring-[#b9cec5]/60"
              />
            </label>
          </div>
        ) : null}

        {mode === "critique" ? (
          <div className="mt-5 space-y-4">
            <label className="block text-sm font-extrabold text-[#34473e]" htmlFor="critique-manuscript">
              설교 원고
              <textarea
                id="critique-manuscript"
                value={manuscriptInput}
                onChange={(event) => {
                  setManuscriptInput(event.target.value.slice(0, 60000));
                  setResult(null);
                  setError("");
                  setRequestState("idle");
                }}
                rows={12}
                placeholder="설교 원고 전체를 붙여 넣어 주세요. (300자 이상)"
                className="mt-2 w-full rounded-xl border border-[#d5cfc4] bg-[#fcfbf8] px-4 py-3 text-sm font-medium leading-6 text-[#263c32] outline-none focus:border-[#6f8d80] focus:ring-2 focus:ring-[#b9cec5]/60"
              />
              <span className="mt-1 block text-right text-[11px] font-semibold text-[#8a938d]">
                {manuscriptInput.length.toLocaleString("ko-KR")}자
              </span>
            </label>
            <label className="block text-sm font-extrabold text-[#34473e]" htmlFor="critique-scripture">
              설교 본문 <span className="font-medium text-[#7b847f]">(선택 — 입력하면 인용 정확성도 점검)</span>
              <input
                id="critique-scripture"
                type="text"
                value={scriptureInput}
                onChange={(event) => setScriptureInput(event.target.value.slice(0, 120))}
                placeholder="예: 요한복음 3:16-20"
                className="mt-2 min-h-12 w-full rounded-xl border border-[#d5cfc4] bg-[#fcfbf8] px-4 text-sm font-medium text-[#263c32] outline-none focus:border-[#6f8d80] focus:ring-2 focus:ring-[#b9cec5]/60"
              />
            </label>
          </div>
        ) : null}

        {mode !== "ministry" ? null : sermonsLoading ? (
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

        <fieldset className={`mt-7 border-t border-[#e4dfd6] pt-6 ${mode === "critique" ? "hidden" : ""}`}>
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

        <fieldset
          className="mt-7 border-t border-[#e4dfd6] pt-6"
          aria-describedby={engineAvailabilityNotice ? `${mode}-engine-status` : undefined}
        >
          <legend className="text-sm font-extrabold text-[#34473e]">AI 엔진</legend>
          <p className="mt-1 text-xs leading-5 text-[#7b847f]">선택한 엔진 하나를 이 결과 전체에 적용합니다.</p>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {selectableEngineTiers.map((tier) => (
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
        {engineAvailabilityNotice ? (
          <div
            id={`${mode}-engine-status`}
            className="mt-3 flex items-start justify-between gap-3 rounded-xl border border-[#e2c8a8] bg-[#fff7e9] px-4 py-3 text-xs font-semibold leading-5 text-[#805326]"
            role={engineAvailabilityStatus === "error" ? "alert" : "status"}
          >
            <span>{engineAvailabilityNotice}</span>
            {engineAvailabilityStatus === "error" ? (
              <button
                type="button"
                onClick={() => void reloadEngineAvailability()}
                className="min-h-9 shrink-0 rounded-lg border border-[#b7956e] bg-white px-3 text-[10px] font-extrabold text-[#69451e] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838]"
              >
                다시 확인
              </button>
            ) : null}
          </div>
        ) : null}

        <button
          type="button"
          disabled={!canGenerate || requestState === "loading"}
          onClick={() => void generate()}
          className="mt-7 inline-flex min-h-13 w-full items-center justify-center rounded-xl bg-[#285343] px-5 text-sm font-extrabold text-white shadow-[0_10px_25px_rgba(38,81,65,.16)] hover:bg-[#204739] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {requestState === "loading"
            ? "생성 중…"
            : mode === "study"
              ? "선택 항목 스터디 생성"
              : mode === "critique"
                ? "내 설교 비평받기"
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
