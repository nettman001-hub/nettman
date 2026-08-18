"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import type { ConsultationRecord, SermonRecord } from "../../_lib/data";

type Consultation = ConsultationRecord & { requesterName?: string | null };
type Message = {
  id: string;
  senderRole: "preacher" | "expert";
  body: string;
  section: string | null;
  createdAt: string;
};

async function parseError(response: Response) {
  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  return payload?.error ?? "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.";
}

export function ExpertConsultationRoom({ id }: { id: string }) {
  const [consultation, setConsultation] = useState<Consultation | null>(null);
  const [sermon, setSermon] = useState<SermonRecord | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [body, setBody] = useState("");
  const [section, setSection] = useState("전체");
  const [busy, setBusy] = useState<"assign" | "send" | "complete" | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    setError("");
    const response = await fetch(`/api/consultations/${encodeURIComponent(id)}?scope=expert`);
    if (!response.ok) {
      setError(await parseError(response));
      setState("error");
      return;
    }
    const payload = (await response.json()) as { item: Consultation; messages: Message[] };
    setConsultation(payload.item);
    setMessages(payload.messages);

    if (payload.item.status !== "waiting") {
      const sermonResponse = await fetch(
        `/api/sermons/${encodeURIComponent(payload.item.sermonId)}?scope=expert`,
      );
      if (sermonResponse.ok) {
        const sermonPayload = (await sermonResponse.json()) as { item: SermonRecord };
        setSermon(sermonPayload.item);
      }
    }
    setState("ready");
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function assign() {
    setBusy("assign");
    setError("");
    const response = await fetch(`/api/consultations/${encodeURIComponent(id)}?scope=expert`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "assign" }),
    });
    if (!response.ok) {
      setError(await parseError(response));
      setBusy(null);
      return;
    }
    await load();
    setBusy(null);
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!body.trim()) return;
    setBusy("send");
    setError("");
    const response = await fetch(`/api/consultations/${encodeURIComponent(id)}?scope=expert`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body, section: section === "전체" ? undefined : section }),
    });
    if (!response.ok) {
      setError(await parseError(response));
      setBusy(null);
      return;
    }
    const payload = (await response.json()) as { item: Message };
    setMessages((current) => [...current, payload.item]);
    setConsultation((current) => (current ? { ...current, status: "in_progress" } : current));
    setBody("");
    setBusy(null);
  }

  async function complete() {
    setBusy("complete");
    setError("");
    const response = await fetch(`/api/consultations/${encodeURIComponent(id)}?scope=expert`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "complete" }),
    });
    if (!response.ok) {
      setError(await parseError(response));
      setBusy(null);
      return;
    }
    setConsultation((current) => (current ? { ...current, status: "completed" } : current));
    setBusy(null);
  }

  if (state === "loading") {
    return <div className="mx-auto max-w-6xl px-4 py-12 text-sm text-[#69756f]" aria-busy="true">상담을 불러오는 중입니다…</div>;
  }
  if (state === "error" || !consultation) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <div className="rounded-2xl border border-[#e2b8ae] bg-[#fff1ee] p-6 text-sm text-[#7b352b]" role="alert">
          <p className="font-extrabold">상담을 열 수 없습니다</p>
          <p className="mt-2">{error}</p>
          <button type="button" onClick={() => void load()} className="mt-4 font-extrabold underline">다시 시도</button>
        </div>
      </div>
    );
  }

  const completed = consultation.status === "completed";
  const waiting = consultation.status === "waiting";

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-8 lg:px-12">
      <div className="flex flex-col gap-5 rounded-[1.7rem] bg-[#1e3f33] p-6 text-white sm:flex-row sm:items-end sm:justify-between sm:p-8">
        <div>
          <a href="/expert" className="text-xs font-bold text-white">← 상담 목록</a>
          <p className="mt-5 text-[10px] font-extrabold tracking-[0.16em] text-white uppercase">Consultation review</p>
          <h1 className="mt-2 font-serif text-3xl font-bold">{consultation.sermonTitle}</h1>
          <p className="mt-2 text-sm text-white">요청자 {consultation.requesterName ?? "설교자"}</p>
        </div>
        {waiting ? (
          <button type="button" disabled={busy !== null} onClick={() => void assign()} className="min-h-11 rounded-xl bg-[#e7bb80] px-5 text-sm font-extrabold text-[#20392f] disabled:opacity-60">
            {busy === "assign" ? "배정 중…" : "이 상담 맡기"}
          </button>
        ) : completed ? (
          <span className="rounded-full bg-white/10 px-4 py-2 text-xs font-extrabold">완료된 상담</span>
        ) : (
          <button type="button" disabled={busy !== null} onClick={() => void complete()} className="min-h-11 rounded-xl border border-white/20 px-5 text-sm font-extrabold hover:bg-white/10 disabled:opacity-60">
            {busy === "complete" ? "완료 처리 중…" : "상담 완료"}
          </button>
        )}
      </div>

      {error ? <div className="mt-5 rounded-xl border border-[#e2b8ae] bg-[#fff1ee] p-4 text-sm text-[#7b352b]" role="alert">{error}</div> : null}

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(20rem,.8fr)]">
        <section className="rounded-[1.6rem] border border-[#ddd7cd] bg-white p-6 sm:p-8">
          <p className="text-xs font-extrabold text-[#8a592f]">상담 요청</p>
          <p className="mt-3 text-sm leading-7 text-[#5f6c65]">{consultation.reason}</p>

          {waiting ? (
            <div className="mt-7 rounded-2xl border border-[#dfc89e] bg-[#fff8e8] p-5 text-sm leading-6 text-[#68491e]">
              상담을 맡으면 원고 전체와 대화 입력란이 열립니다. 맡기 전에는 요청 요약만 확인할 수 있습니다.
            </div>
          ) : sermon ? (
            <article className="mt-8 border-t border-[#e6e0d7] pt-7 text-[#34463e]">
              <p className="text-xs font-extrabold text-[#8a592f]">{sermon.scripture}</p>
              <h2 className="mt-2 font-serif text-2xl font-bold">설교 원고</h2>
              <section className="mt-6"><h3 className="font-serif text-lg font-bold">서론</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-7">{sermon.sections.introduction}</p></section>
              {sermon.sections.body.map((point, index) => (
                <section key={`${point.heading}-${index}`} className="mt-6">
                  <h3 className="font-serif text-lg font-bold">{index + 1}. {point.heading}</h3>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-7">{point.content}</p>
                </section>
              ))}
              <section className="mt-6"><h3 className="font-serif text-lg font-bold">결론</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-7">{sermon.sections.conclusion}</p></section>
              <section className="mt-6 rounded-xl bg-[#f3f1eb] p-4"><h3 className="font-serif text-lg font-bold">적용</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-7">{sermon.sections.application}</p></section>
            </article>
          ) : (
            <p className="mt-7 text-sm text-[#7b352b]">배정된 설교 원고를 불러오지 못했습니다.</p>
          )}
        </section>

        <section className="flex min-h-[34rem] flex-col rounded-[1.6rem] border border-[#ddd7cd] bg-white p-5 sm:p-6">
          <h2 className="font-serif text-xl font-bold text-[#294238]">상담 대화</h2>
          <div className="mt-5 flex-1 space-y-3" aria-live="polite">
            {messages.length === 0 ? <p className="rounded-xl bg-[#f5f3ee] p-4 text-xs leading-5 text-[#737d77]">아직 오간 메시지가 없습니다.</p> : messages.map((message) => (
              <div key={message.id} className={`rounded-2xl p-4 text-sm leading-6 ${message.senderRole === "expert" ? "ml-7 bg-[#315746] text-white" : "mr-7 bg-[#f0ede6] text-[#394a42]"}`}>
                <p className="text-[10px] font-extrabold">{message.senderRole === "expert" ? "전문가" : "설교자"}{message.section ? ` · ${message.section}` : ""}</p>
                <p className="mt-1 whitespace-pre-wrap">{message.body}</p>
              </div>
            ))}
          </div>

          {!waiting && !completed ? (
            <form className="mt-5 border-t border-[#e5e0d7] pt-5" onSubmit={send}>
              <label className="text-xs font-extrabold text-[#4c5e55]" htmlFor="expert-section">피드백 구간</label>
              <select id="expert-section" value={section} onChange={(event) => setSection(event.target.value)} className="mt-2 min-h-10 w-full rounded-xl border border-[#d7d1c7] bg-white px-3 text-sm">
                {['전체', '서론', '본론', '결론', '적용'].map((value) => <option key={value}>{value}</option>)}
              </select>
              <label className="mt-4 block text-xs font-extrabold text-[#4c5e55]" htmlFor="expert-message">피드백</label>
              <textarea id="expert-message" required maxLength={2000} value={body} onChange={(event) => setBody(event.target.value)} rows={5} className="mt-2 w-full rounded-xl border border-[#d7d1c7] p-3 text-sm leading-6" placeholder="본문 근거와 구체적인 수정 제안을 함께 적어 주세요." />
              <button type="submit" disabled={busy !== null || !body.trim()} className="mt-3 min-h-11 w-full rounded-xl bg-[#315746] px-4 text-sm font-extrabold text-white disabled:opacity-50">{busy === "send" ? "전송 중…" : "피드백 보내기"}</button>
            </form>
          ) : completed ? (
            <p className="mt-5 rounded-xl bg-[#f5f3ee] p-4 text-xs leading-5 text-[#68736d]">완료된 상담은 기록으로만 볼 수 있으며 새 메시지를 보낼 수 없습니다.</p>
          ) : null}
        </section>
      </div>
    </div>
  );
}
