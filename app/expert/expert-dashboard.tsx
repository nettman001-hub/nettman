"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AppPageHeading } from "../_components/app-page-heading";
import {
  useRegisterAiAgentPage,
  type AiAgentPageRegistration,
} from "../_components/ai-agent-provider";
import type { ConsultationRecord } from "../_lib/data";

type ExpertConsultation = ConsultationRecord & { requesterName?: string | null };

const STATUS_LABEL: Record<ConsultationRecord["status"], string> = {
  waiting: "배정 대기",
  assigned: "첫 답변 대기",
  in_progress: "대화 진행",
  completed: "완료",
};

async function responseError(response: Response): Promise<string> {
  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  if (payload?.error) return payload.error;
  if (response.status === 401) return "로그인이 만료되었습니다. 다시 로그인해 주세요.";
  if (response.status === 403) return "전문가 권한이 필요한 작업입니다.";
  return "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.";
}

export function ExpertDashboard() {
  const router = useRouter();
  const [items, setItems] = useState<ExpertConsultation[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"active" | "completed">("active");
  const [assigningId, setAssigningId] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/consultations?scope=expert", { signal });
      const payload = (await response.json().catch(() => null)) as {
        items?: ExpertConsultation[];
        error?: string;
      } | null;
      if (!response.ok || !Array.isArray(payload?.items)) {
        throw new Error(payload?.error ?? "피드백 목록을 불러오지 못했습니다.");
      }
      setItems(payload.items);
      setState("ready");
      setError("");
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setError(caught instanceof Error ? caught.message : "피드백 목록을 불러오지 못했습니다.");
      setState("error");
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const filtered = useMemo(
    () =>
      items.filter((item) =>
        filter === "completed" ? item.status === "completed" : item.status !== "completed",
      ),
    [filter, items],
  );

  async function assign(id: string) {
    setAssigningId(id);
    setError("");
    const response = await fetch(`/api/consultations/${encodeURIComponent(id)}?scope=expert`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "assign" }),
    });
    if (!response.ok) {
      setError(await responseError(response));
      setAssigningId(null);
      return;
    }
    setItems((current) =>
      current.map((item) =>
        item.id === id ? { ...item, status: "assigned", expertName: "내 피드백" } : item,
      ),
    );
    setAssigningId(null);
  }

  const waiting = items.filter((item) => item.status === "waiting").length;
  const ongoing = items.filter(
    (item) => item.status === "assigned" || item.status === "in_progress",
  ).length;
  const completed = items.filter((item) => item.status === "completed").length;

  const agentRegistration = useMemo<AiAgentPageRegistration>(() => {
    const visibleItems = filtered.slice(0, 30);
    return {
      surface: "expert",
      title: "설교 피드백실",
      snapshot: {
        filters: {
          selected: filter,
          loadState: state,
          waiting,
          ongoing,
          completed,
        },
        experts: visibleItems.map((item) => ({
          id: item.id,
          sermonId: item.sermonId,
          sermonTitle: item.sermonTitle,
          status: item.status,
          reason: item.reason.slice(0, 500),
          updatedAt: item.updatedAt,
        })),
        selectedExpert: null,
      },
      capabilities: ["navigate"],
      suggestions: [
        "현재 피드백 목록의 우선 검토 순서를 정리해줘",
        "표시된 요청들의 공통 검토 주제를 알려줘",
        "검토할 피드백 대화 화면을 열어줘",
      ],
      executeAction: async (proposal) => {
        if (proposal.capability !== "navigate") {
          throw new Error("전문가 화면에서는 피드백 내역 열기만 지원합니다.");
        }
        const href = proposal.args.href;
        const allowedHrefs = new Set(
          visibleItems.map((item) => `/expert/${encodeURIComponent(item.id)}`),
        );
        if (typeof href !== "string" || !allowedHrefs.has(href)) {
          throw new Error("현재 표시된 피드백 내역 중에서 다시 선택해 주세요.");
        }
        router.push(href);
        return { message: "선택한 피드백 대화 화면을 열었습니다." };
      },
    };
  }, [completed, filter, filtered, ongoing, router, state, waiting]);

  useRegisterAiAgentPage(agentRegistration);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8 lg:px-12 lg:py-11">
      <AppPageHeading
        eyebrow="Expert workspace"
        title="설교 피드백실"
        description="대기 중인 요청을 맡고, 내게 배정된 설교에 근거 있는 피드백을 전합니다."
        action={
          <span className="inline-flex rounded-full border border-[#b8cebf] bg-[#e4eee7] px-4 py-2 text-xs font-extrabold text-[#315746]">
            전문가 계정
          </span>
        }
      />

      <section className="mt-6 grid gap-4 sm:grid-cols-3" aria-label="설교 피드백 현황">
        {[
          ["배정 대기", waiting],
          ["내 피드백 진행", ongoing],
          ["완료", completed],
        ].map(([label, value], index) => (
          <div
            key={label}
            className={`rounded-[1.4rem] p-5 ${index === 0 ? "bg-[#25483a] text-white" : "border border-[#ddd7cd] bg-white"}`}
          >
            <p className={`text-xs font-bold ${index === 0 ? "text-white" : "text-[#758079]"}`}>
              {label}
            </p>
            <p className={`mt-2 font-serif text-3xl font-bold ${index === 0 ? "text-white" : "text-[#254238]"}`}>
              {value}
            </p>
          </div>
        ))}
      </section>

      <section className="mt-7 rounded-[1.7rem] border border-[#ddd7cd] bg-white p-5 shadow-[0_16px_45px_rgba(39,50,44,.06)] sm:p-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[10px] font-extrabold tracking-[0.17em] text-[#a56732] uppercase">
              Review queue
            </p>
            <h2 className="mt-1.5 font-serif text-2xl font-bold text-[#254238]">피드백 목록</h2>
          </div>
          <div className="inline-flex self-start rounded-xl bg-[#efede7] p-1" role="tablist">
            {(["active", "completed"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={filter === value}
                onClick={() => setFilter(value)}
                className={`min-h-9 rounded-lg px-4 text-xs font-extrabold ${filter === value ? "bg-white text-[#2c4d40] shadow-sm" : "text-[#7a837e]"}`}
              >
                {value === "active" ? "진행 중" : "완료"}
              </button>
            ))}
          </div>
        </div>

        {error ? (
          <div className="mt-5 rounded-2xl border border-[#e2b8ae] bg-[#fff1ee] p-4 text-sm text-[#7b352b]" role="alert">
            {error}
            {state === "error" ? (
              <button type="button" className="ml-3 font-extrabold underline" onClick={() => void load()}>
                다시 시도
              </button>
            ) : null}
          </div>
        ) : null}

        {state === "loading" ? (
          <div className="mt-5 space-y-3" aria-busy="true">
            {[0, 1].map((item) => (
              <div key={item} className="h-28 animate-pulse rounded-2xl bg-[#f1efe9]" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="mt-5 rounded-2xl border border-dashed border-[#ccc5b9] bg-[#faf8f3] px-5 py-10 text-center text-sm font-bold text-[#34463e]">
            표시할 피드백이 없습니다.
          </div>
        ) : (
          <ul className="mt-5 divide-y divide-[#e5e0d7]">
            {filtered.map((item) => (
              <li key={item.id} className="grid gap-4 py-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <a
                  href={`/expert/${encodeURIComponent(item.id)}`}
                  className="group rounded-xl p-2 hover:bg-[#faf8f3] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838]"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-[#e5eee8] px-2.5 py-1 text-[10px] font-extrabold text-[#315746]">
                      {STATUS_LABEL[item.status]}
                    </span>
                    {item.requesterName ? (
                      <span className="text-[11px] text-[#7a837e]">요청자 {item.requesterName}</span>
                    ) : null}
                  </div>
                  <h3 className="mt-2 font-serif text-lg font-bold text-[#2a4439] group-hover:text-[#8d5a2e]">
                    {item.sermonTitle}
                  </h3>
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-[#747d78]">{item.reason}</p>
                </a>
                {item.status === "waiting" ? (
                  <button
                    type="button"
                    disabled={assigningId === item.id}
                    onClick={() => void assign(item.id)}
                    className="min-h-11 rounded-xl bg-[#315746] px-4 text-xs font-extrabold text-white hover:bg-[#25483a] disabled:cursor-wait disabled:opacity-60"
                  >
                    {assigningId === item.id ? "배정 중…" : "이 피드백 맡기"}
                  </button>
                ) : (
                  <a href={`/expert/${encodeURIComponent(item.id)}`} className="px-3 text-xs font-extrabold text-[#8a592f]">
                    검토하기 →
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
