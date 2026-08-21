"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AppPageHeading } from "../_components/app-page-heading";
import {
  useRegisterAiAgentPage,
  type AiAgentPageRegistration,
} from "../_components/ai-agent-provider";
import type { ConsultationRecord, SermonRecord } from "../_lib/data";

type LoadState = "loading" | "ready" | "error";
type SubmitState = "idle" | "submitting" | "success" | "error";
type DeleteState = "idle" | "deleting" | "success" | "error";

const STATUS_LABEL: Record<ConsultationRecord["status"], string> = {
  waiting: "배정 대기",
  assigned: "전문가 배정",
  in_progress: "피드백 진행",
  completed: "피드백 완료",
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Asia/Seoul",
  }).format(new Date(value));
}

export function ConsultClient({ signedIn }: { signedIn: boolean }) {
  const router = useRouter();
  const [sermons, setSermons] = useState<SermonRecord[]>([]);
  const [consultations, setConsultations] = useState<ConsultationRecord[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [sermonId, setSermonId] = useState("");
  const [reason, setReason] = useState("");
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [message, setMessage] = useState("");
  const [selectedConsultationIds, setSelectedConsultationIds] = useState<string[]>([]);
  const [deleteState, setDeleteState] = useState<DeleteState>("idle");
  const [deleteMessage, setDeleteMessage] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const requestedSermonId = new URLSearchParams(window.location.search).get("sermonId");

    async function load() {
      try {
        const [sermonResponse, consultationResponse] = await Promise.all([
          fetch("/api/sermons", { signal: controller.signal }),
          fetch("/api/consultations", { signal: controller.signal }),
        ]);
        if (!sermonResponse.ok || !consultationResponse.ok) throw new Error("load failed");
        const sermonPayload = (await sermonResponse.json()) as { items?: SermonRecord[] };
        const consultationPayload = (await consultationResponse.json()) as { items?: ConsultationRecord[] };
        const nextSermons = Array.isArray(sermonPayload.items) ? sermonPayload.items : [];
        const nextConsultations = Array.isArray(consultationPayload.items) ? consultationPayload.items : [];
        setSermons(nextSermons);
        setConsultations(nextConsultations);
        const available = nextSermons.find((item) => item.id === requestedSermonId)?.id ?? nextSermons[0]?.id ?? "";
        setSermonId(available);
        setLoadState("ready");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setLoadState("error");
      }
    }

    void load();
    return () => controller.abort();
  }, []);

  const activeCount = useMemo(
    () => consultations.filter((item) => item.status !== "completed").length,
    [consultations],
  );
  const allConsultationsSelected =
    consultations.length > 0 && selectedConsultationIds.length === consultations.length;

  const agentRegistration = useMemo<AiAgentPageRegistration>(() => {
    const visibleSermons = sermons.slice(0, 20);
    const visibleConsultations = consultations.slice(0, 20);
    const selectedSermon = visibleSermons.find((item) => item.id === sermonId);
    return {
      surface: "consult",
      title: "설교 피드백",
      snapshot: {
        form: {
          loadState,
          selectedSermon: selectedSermon
            ? {
                id: selectedSermon.id,
                title: selectedSermon.title,
                scripture: selectedSermon.scripture,
              }
            : null,
          availableSermons: visibleSermons.map((item) => ({
            id: item.id,
            title: item.title,
            scripture: item.scripture,
          })),
          requestDraft: reason.slice(0, 1_000),
          requestLength: reason.length,
          requestReady: Boolean(sermonId && reason.trim().length >= 10),
        },
        consultations: visibleConsultations.map((item) => ({
          id: item.id,
          sermonId: item.sermonId,
          sermonTitle: item.sermonTitle,
          status: item.status,
          reason: item.reason.slice(0, 500),
          queuePosition: item.queuePosition,
          updatedAt: item.updatedAt,
        })),
        selectedConsultation: null,
      },
      capabilities: ["navigate", "history.open"],
      suggestions: [
        "작성 중인 피드백 요청 내용을 검토해줘",
        "현재 피드백 내역의 진행 상태를 정리해줘",
        "선택한 설교 원고를 열어줘",
      ],
      executeAction: async (proposal) => {
        if (proposal.capability === "history.open") {
          const requestedId = proposal.args.sermonId;
          if (
            typeof requestedId !== "string" ||
            !visibleSermons.some((item) => item.id === requestedId)
          ) {
            throw new Error("현재 피드백 양식에 표시된 설교 중에서 다시 선택해 주세요.");
          }
          router.push(`/history/${encodeURIComponent(requestedId)}`);
          return { message: "선택한 설교 원고를 열었습니다." };
        }
        if (proposal.capability === "navigate") {
          const href = proposal.args.href;
          const allowedConsultationHrefs = new Set(
            visibleConsultations.map((item) => `/consult/${encodeURIComponent(item.id)}`),
          );
          if (
            typeof href !== "string" ||
            (!["/consult", "/history", "/sermon/options"].includes(href) &&
              !allowedConsultationHrefs.has(href))
          ) {
            throw new Error("현재 표시된 피드백 내역이나 안전한 설교 화면을 선택해 주세요.");
          }
          router.push(href);
          return { message: "요청한 화면으로 이동했습니다." };
        }
        throw new Error("피드백 화면에서는 이 작업을 적용할 수 없습니다.");
      },
    };
  }, [consultations, loadState, reason, router, sermonId, sermons]);

  useRegisterAiAgentPage(agentRegistration);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = reason.trim();
    if (!sermonId) {
      setSubmitState("error");
      setMessage("피드백받을 설교를 먼저 선택해 주세요.");
      return;
    }
    if (normalized.length < 10) {
      setSubmitState("error");
      setMessage("피드백받고 싶은 내용을 10자 이상 구체적으로 적어 주세요.");
      return;
    }

    setSubmitState("submitting");
    setMessage("");
    try {
      const response = await fetch("/api/consultations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sermonId, reason: normalized }),
      });
      const payload = (await response.json()) as { item?: ConsultationRecord; error?: string };
      if (!response.ok || !payload.item) throw new Error(payload.error || "요청하지 못했습니다.");
      setConsultations((current) => [payload.item!, ...current]);
      setReason("");
      setSubmitState("success");
      setMessage("설교 피드백 요청을 접수했습니다. 전문가가 배정되면 상태가 바뀝니다.");
    } catch (error) {
      setSubmitState("error");
      setMessage(error instanceof Error ? error.message : "설교 피드백 요청 중 문제가 생겼습니다.");
    }
  }

  function toggleConsultation(id: string) {
    setSelectedConsultationIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
    setDeleteState("idle");
    setDeleteMessage("");
  }

  async function deleteSelectedConsultations() {
    const ids = selectedConsultationIds.filter((id) =>
      consultations.some((item) => item.id === id),
    );
    if (ids.length === 0 || deleteState === "deleting") return;
    const confirmed = window.confirm(
      `선택한 피드백 ${ids.length}건과 대화 내용이 함께 삭제됩니다. 삭제 후에는 복구할 수 없습니다. 계속할까요?`,
    );
    if (!confirmed) return;

    setDeleteState("deleting");
    setDeleteMessage("");
    const deletedIds = new Set<string>();
    try {
      for (let index = 0; index < ids.length; index += 50) {
        const response = await fetch("/api/consultations", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: ids.slice(index, index + 50) }),
        });
        const payload = (await response.json()) as { deletedIds?: string[]; error?: string };
        if (!response.ok || !Array.isArray(payload.deletedIds)) {
          throw new Error(payload.error || "선택한 피드백을 삭제하지 못했습니다.");
        }
        payload.deletedIds.forEach((id) => deletedIds.add(id));
      }
      setConsultations((current) => current.filter((item) => !deletedIds.has(item.id)));
      setSelectedConsultationIds([]);
      setDeleteState("success");
      setDeleteMessage(`피드백 ${deletedIds.size}건을 삭제했습니다.`);
    } catch (error) {
      if (deletedIds.size > 0) {
        setConsultations((current) => current.filter((item) => !deletedIds.has(item.id)));
        setSelectedConsultationIds((current) => current.filter((id) => !deletedIds.has(id)));
      }
      setDeleteState("error");
      setDeleteMessage(
        `${deletedIds.size > 0 ? `${deletedIds.size}건은 삭제됐지만 나머지는 처리하지 못했습니다. ` : ""}${error instanceof Error ? error.message : "선택한 피드백을 삭제하지 못했습니다."}`,
      );
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8 lg:px-12 lg:py-11">
      <AppPageHeading
        eyebrow="Pastoral review"
        title="설교 피드백"
        description="완성한 설교의 흐름과 적용을 목회 코치에게 맡겨 보세요. 원고의 목소리는 지키고, 청중에게 더 잘 닿도록 함께 살핍니다."
        action={
          <a href="#request-consultation" className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[#285343] px-5 text-sm font-extrabold text-white hover:bg-[#1f4537] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838] focus-visible:ring-offset-2">
            피드백 요청하기
          </a>
        }
      />

      {!signedIn ? (
        <div className="mt-6 rounded-2xl border border-[#dfc89e] bg-[#fff8e8] px-5 py-4 text-sm leading-6 text-[#68491e]">
          현재 로컬 미리보기 계정으로 체험 중입니다. 배포된 서비스에서는 로그인한 계정의 설교와 피드백만 표시됩니다.
        </div>
      ) : null}

      <section className="mt-7 grid gap-4 sm:grid-cols-3" aria-label="설교 피드백 현황">
        {[
          ["진행 중", String(activeCount), "배정 대기와 피드백 진행을 포함합니다."],
          ["완료", String(consultations.length - activeCount), "종료된 피드백은 언제든 다시 볼 수 있습니다."],
          ["예상 답변", "1–2일", "요청 순서와 내용에 따라 달라질 수 있습니다."],
        ].map(([label, value, copy]) => (
          <div key={label} className="rounded-[1.35rem] border border-[#ddd7cd] bg-white p-5 shadow-[0_10px_30px_rgba(39,50,44,.04)]">
            <p className="text-xs font-bold text-[#758079]">{label}</p>
            <p className="mt-2 font-serif text-3xl font-bold text-[#254238]">{value}</p>
            <p className="mt-2 text-xs leading-5 text-[#858c88]">{copy}</p>
          </div>
        ))}
      </section>

      <div className="mt-7 grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(20rem,.85fr)]">
        <section className="rounded-[1.65rem] border border-[#ddd7cd] bg-white p-5 shadow-[0_16px_45px_rgba(39,50,44,.06)] sm:p-7" aria-labelledby="consultation-list-title">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[10px] font-extrabold tracking-[0.17em] text-[#a56732] uppercase">Conversation</p>
              <h2 id="consultation-list-title" className="mt-1.5 font-serif text-2xl font-bold text-[#254238]">피드백 내역</h2>
            </div>
            <span className="text-xs font-semibold text-[#818984]">총 {consultations.length}건</span>
          </div>

          {loadState === "ready" && consultations.length > 0 ? (
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#e3ddd4] bg-[#f7f5f0] px-3 py-2.5">
              <label className="inline-flex min-h-11 cursor-pointer items-center gap-2.5 px-1 text-xs font-bold text-[#4c5c54]">
                <input
                  type="checkbox"
                  className="size-5 accent-[#a44836]"
                  checked={allConsultationsSelected}
                  onChange={(event) => {
                    setSelectedConsultationIds(
                      event.target.checked ? consultations.map((item) => item.id) : [],
                    );
                    setDeleteState("idle");
                    setDeleteMessage("");
                  }}
                />
                전체 선택
              </label>
              <button
                type="button"
                onClick={() => void deleteSelectedConsultations()}
                disabled={selectedConsultationIds.length === 0 || deleteState === "deleting"}
                className="inline-flex min-h-10 items-center justify-center rounded-lg border border-[#c88778] bg-white px-4 text-xs font-extrabold text-[#8b3e32] transition hover:bg-[#fff1ee] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838] disabled:cursor-not-allowed disabled:opacity-45"
              >
                {deleteState === "deleting"
                  ? "삭제하는 중…"
                  : `선택 삭제${selectedConsultationIds.length ? ` (${selectedConsultationIds.length})` : ""}`}
              </button>
            </div>
          ) : null}

          {deleteMessage ? (
            <p
              className={`mt-3 rounded-xl border px-4 py-3 text-xs font-semibold leading-5 ${deleteState === "error" ? "border-[#e2b8ae] bg-[#fff1ee] text-[#7b352b]" : "border-[#b8d3be] bg-[#eef7ef] text-[#285239]"}`}
              role={deleteState === "error" ? "alert" : "status"}
            >
              {deleteMessage}
            </p>
          ) : null}

          {loadState === "loading" ? (
            <div className="mt-5 space-y-3" aria-busy="true" aria-label="피드백 내역을 불러오는 중">
              {[0, 1].map((item) => <div key={item} className="h-32 animate-pulse rounded-2xl bg-[#f1efe9]" />)}
            </div>
          ) : loadState === "error" ? (
            <div className="mt-5 rounded-2xl border border-[#e2b8ae] bg-[#fff1ee] p-5 text-sm text-[#7b352b]" role="alert">
              피드백 내역을 불러오지 못했습니다. 페이지를 새로고침해 주세요.
            </div>
          ) : consultations.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-dashed border-[#ccc5b9] bg-[#faf8f3] px-5 py-9 text-center">
              <span aria-hidden="true" className="mx-auto grid size-12 place-items-center rounded-2xl bg-[#e6eee8] font-serif font-bold text-[#315746]">피</span>
              <p className="mt-4 text-sm font-extrabold text-[#34463e]">아직 피드백 내역이 없습니다</p>
              <p className="mt-1 text-xs leading-5 text-[#7a837e]">오른쪽 양식에서 완성한 설교를 선택해 첫 피드백을 요청하세요.</p>
            </div>
          ) : (
            <ul className="mt-5 space-y-3">
              {consultations.map((item) => (
                <li key={item.id} className="grid grid-cols-[2.75rem_minmax(0,1fr)] items-start gap-2">
                  <label className="grid min-h-11 cursor-pointer place-items-center rounded-xl border border-transparent hover:bg-[#f3eee5]" title={`${item.sermonTitle} 선택`}>
                    <span className="sr-only">{item.sermonTitle} 피드백 선택</span>
                    <input
                      type="checkbox"
                      className="size-5 accent-[#a44836]"
                      checked={selectedConsultationIds.includes(item.id)}
                      onChange={() => toggleConsultation(item.id)}
                    />
                  </label>
                  <a href={`/consult/${encodeURIComponent(item.id)}`} className={`group block rounded-2xl border p-5 transition hover:-translate-y-0.5 hover:border-[#c7b79f] hover:bg-white hover:shadow-[0_14px_30px_rgba(40,55,47,.07)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838] ${selectedConsultationIds.includes(item.id) ? "border-[#c98b78] bg-[#fff7f3]" : "border-[#e0dbd2] bg-[#fbfaf7]"}`}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <span className={`rounded-full px-3 py-1 text-[10px] font-extrabold ${item.status === "completed" ? "bg-[#e7ebe8] text-[#65736c]" : item.status === "waiting" ? "bg-[#f6e7d4] text-[#8c5c32]" : "bg-[#dfece4] text-[#315746]"}`}>
                        {STATUS_LABEL[item.status]}
                      </span>
                      <span className="text-[11px] text-[#8a918d]">{formatDate(item.updatedAt)}</span>
                    </div>
                    <h3 className="mt-3 font-serif text-lg font-bold text-[#2a4439] group-hover:text-[#8d5a2e]">{item.sermonTitle}</h3>
                    <p className="mt-2 line-clamp-2 text-xs leading-5 text-[#747d78]">{item.reason}</p>
                    <div className="mt-4 flex items-center justify-between text-xs">
                      <span className="font-semibold text-[#65736c]">{item.expertName ?? (item.queuePosition > 0 ? `대기 ${item.queuePosition}번째` : "전문가 배정 중")}</span>
                      <span className="font-extrabold text-[#8a592f]">대화 보기 →</span>
                    </div>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section id="request-consultation" className="self-start rounded-[1.65rem] border border-[#d2c6b5] bg-[#eee5d8] p-5 sm:p-7 lg:sticky lg:top-[calc(var(--app-topbar-height,0px)+2rem)]" aria-labelledby="request-title">
          <p className="text-[10px] font-extrabold tracking-[0.17em] text-[#8d5a2e] uppercase">New request</p>
          <h2 id="request-title" className="mt-1.5 font-serif text-2xl font-bold text-[#294238]">새 피드백 요청</h2>
          <p className="mt-2 text-sm leading-6 text-[#66716c]">완성된 원고와 특히 점검받고 싶은 부분을 알려주세요.</p>
          <form className="mt-6 space-y-5" onSubmit={submit} noValidate>
            <div>
              <label htmlFor="consult-sermon" className="block text-xs font-extrabold text-[#3c5047]">피드백받을 설교</label>
              <select id="consult-sermon" value={sermonId} onChange={(event) => setSermonId(event.target.value)} disabled={loadState !== "ready" || sermons.length === 0} className="mt-2 min-h-12 w-full rounded-xl border border-[#cfc4b4] bg-white px-4 text-sm text-[#2c4339] outline-none focus:border-[#718d80] focus:ring-2 focus:ring-[#b9cec5]/60 disabled:opacity-60">
                {sermons.length === 0 ? <option value="">완성한 설교가 없습니다</option> : sermons.map((sermon) => <option key={sermon.id} value={sermon.id}>{sermon.title} · {sermon.scripture}</option>)}
              </select>
            </div>
            <div>
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="consult-reason" className="block text-xs font-extrabold text-[#3c5047]">피드백 요청 내용</label>
                <span className="text-[10px] text-[#7d827e]">{reason.length}/1,000</span>
              </div>
              <textarea id="consult-reason" value={reason} onChange={(event) => { setReason(event.target.value.slice(0, 1000)); setSubmitState("idle"); }} rows={7} minLength={10} placeholder="예: 본론의 세 대지가 본문에서 자연스럽게 이어지는지, 적용 문장이 청년 청중에게 구체적인지 봐 주세요." className="mt-2 w-full resize-y rounded-xl border border-[#cfc4b4] bg-white px-4 py-3 text-sm leading-6 text-[#2c4339] outline-none placeholder:text-[#9ba09d] focus:border-[#718d80] focus:ring-2 focus:ring-[#b9cec5]/60" />
            </div>
            {message ? <p className={`rounded-xl border px-4 py-3 text-xs font-semibold leading-5 ${submitState === "error" ? "border-[#e2b8ae] bg-[#fff1ee] text-[#7b352b]" : "border-[#b8d3be] bg-[#eef7ef] text-[#285239]"}`} role={submitState === "error" ? "alert" : "status"}>{message}</p> : null}
            <button type="submit" disabled={submitState === "submitting" || sermons.length === 0} className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-[#285343] px-5 text-sm font-extrabold text-white shadow-[0_10px_25px_rgba(38,81,65,.15)] hover:bg-[#204739] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-55">
              {submitState === "submitting" ? "요청을 접수하는 중…" : "피드백 요청 보내기"}
            </button>
          </form>
          <p className="mt-4 text-[11px] leading-5 text-[#7d827e]">전문가는 원고를 직접 덮어쓰지 않습니다. 모든 제안은 대화에서 확인한 뒤 목회자가 선택합니다.</p>
        </section>
      </div>
    </div>
  );
}
