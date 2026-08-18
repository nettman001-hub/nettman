"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ConsultationRecord } from "../../_lib/data";

type Message = {
  id: string;
  senderRole: "preacher" | "expert";
  body: string;
  section: string | null;
  createdAt: string;
};

const STATUS_LABEL: Record<ConsultationRecord["status"], string> = {
  waiting: "전문가 배정 대기",
  assigned: "전문가 배정 완료",
  in_progress: "상담 진행 중",
  completed: "상담 완료",
};

function timeLabel(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" }).format(new Date(value));
}

export function ConsultationRoom({ id, expertMode = false }: { id: string; expertMode?: boolean }) {
  const [item, setItem] = useState<ConsultationRecord | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [body, setBody] = useState("");
  const [section, setSection] = useState("전체 흐름");
  const [state, setState] = useState<"loading" | "ready" | "sending" | "error">("loading");
  const [notice, setNotice] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(`/api/consultations/${encodeURIComponent(id)}`, { signal: controller.signal });
        const payload = (await response.json()) as { item?: ConsultationRecord; messages?: Message[]; error?: string };
        if (!response.ok || !payload.item) throw new Error(payload.error || "상담을 찾을 수 없습니다.");
        setItem(payload.item);
        setMessages(Array.isArray(payload.messages) ? payload.messages : []);
        setState("ready");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setNotice(error instanceof Error ? error.message : "상담을 불러오지 못했습니다.");
        setState("error");
      }
    }
    void load();
    return () => controller.abort();
  }, [id]);

  useEffect(() => {
    if (state === "ready") endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages.length, state]);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = body.trim();
    if (!normalized || !item || item.status === "completed") return;
    setState("sending");
    setNotice("");
    try {
      const response = await fetch(`/api/consultations/${encodeURIComponent(id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: normalized, section }),
      });
      const payload = (await response.json()) as { item?: Message; error?: string };
      if (!response.ok || !payload.item) throw new Error(payload.error || "메시지를 보내지 못했습니다.");
      setMessages((current) => [...current, { ...payload.item!, senderRole: expertMode ? "expert" : payload.item!.senderRole }]);
      setBody("");
      setItem((current) => current ? { ...current, status: "in_progress", updatedAt: new Date().toISOString() } : current);
      setState("ready");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "메시지를 보내지 못했습니다.");
      setState("ready");
    }
  }

  async function complete() {
    if (!item || !window.confirm("이 상담을 완료 상태로 바꿀까요? 완료 후에는 메시지를 더 보낼 수 없습니다.")) return;
    setState("sending");
    try {
      const response = await fetch(`/api/consultations/${encodeURIComponent(id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "complete" }),
      });
      if (!response.ok) throw new Error("완료 상태로 바꾸지 못했습니다.");
      setItem({ ...item, status: "completed" });
      setNotice("상담을 완료했습니다.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "완료 처리 중 문제가 생겼습니다.");
    } finally {
      setState("ready");
    }
  }

  if (state === "loading") {
    return <div className="mx-auto max-w-6xl px-4 py-10 sm:px-8"><div className="h-[38rem] animate-pulse rounded-[2rem] bg-white" /></div>;
  }

  if (!item) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <div className="rounded-[2rem] border border-[#e2b8ae] bg-white p-9"><h1 className="font-serif text-2xl font-bold text-[#294238]">상담을 열 수 없습니다</h1><p className="mt-3 text-sm text-[#7b4a42]">{notice}</p><a href={expertMode ? "/expert" : "/consult"} className="mt-6 inline-flex min-h-11 items-center rounded-xl bg-[#285343] px-5 text-sm font-bold text-white">목록으로 돌아가기</a></div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-7 sm:px-8 lg:px-12 lg:py-10">
      <div className="flex flex-col gap-5 border-b border-[#d8d2c7] pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <a href={expertMode ? "/expert" : "/consult"} className="text-xs font-extrabold text-[#8d5a2e] hover:underline">← {expertMode ? "전문가 상담 목록" : "상담 목록"}</a>
          <div className="mt-4 flex flex-wrap items-center gap-3"><span className="rounded-full bg-[#e0ece4] px-3 py-1 text-[10px] font-extrabold text-[#315746]">{STATUS_LABEL[item.status]}</span><span className="text-xs text-[#838b86]">{item.expertName ?? "전문가 배정 중"}</span></div>
          <h1 className="mt-3 font-serif text-[clamp(1.8rem,4vw,2.8rem)] font-bold tracking-tight text-[#203a30]">{item.sermonTitle}</h1>
        </div>
        <div className="flex gap-2">
          <a href={`/history/${encodeURIComponent(item.sermonId)}`} className="inline-flex min-h-11 items-center rounded-xl border border-[#cbc5ba] bg-white px-4 text-xs font-extrabold text-[#385448] hover:bg-[#f8f6f1]">원고 보기</a>
          {expertMode && item.status !== "completed" ? <button type="button" onClick={() => void complete()} disabled={state === "sending"} className="min-h-11 rounded-xl bg-[#285343] px-4 text-xs font-extrabold text-white disabled:opacity-60">상담 완료</button> : null}
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <section className="overflow-hidden rounded-[1.75rem] border border-[#ddd7cd] bg-white shadow-[0_16px_45px_rgba(39,50,44,.06)]" aria-label="상담 대화">
          <div className="max-h-[34rem] min-h-[28rem] overflow-y-auto px-4 py-6 sm:px-7">
            {messages.length === 0 ? <div className="grid min-h-[22rem] place-items-center text-center"><div><span aria-hidden="true" className="mx-auto grid size-12 place-items-center rounded-2xl bg-[#e7eee9] font-serif font-bold text-[#315746]">담</span><p className="mt-4 text-sm font-extrabold text-[#34463e]">첫 답변을 기다리고 있습니다</p><p className="mt-1 text-xs leading-5 text-[#7a837e]">전문가가 배정되면 이 대화에서 의견을 나눌 수 있습니다.</p></div></div> : <ol className="space-y-5">{messages.map((message) => {
              const mine = expertMode ? message.senderRole === "expert" : message.senderRole === "preacher";
              return <li key={message.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}><div className={`max-w-[86%] ${mine ? "text-right" : "text-left"}`}><div className={`inline-block rounded-2xl px-4 py-3 text-left text-sm leading-6 ${mine ? "rounded-br-md bg-[#285343] text-white" : "rounded-bl-md bg-[#f0ede6] text-[#35483f]"}`}><p>{message.body}</p></div><p className="mt-1.5 px-1 text-[10px] text-[#8a918d]">{message.section ? `${message.section} · ` : ""}{timeLabel(message.createdAt)}</p></div></li>;
            })}</ol>}
            <div ref={endRef} />
          </div>
          <form onSubmit={send} className="border-t border-[#e2ddd4] bg-[#faf9f6] p-4 sm:p-5">
            {notice ? <p className="mb-3 rounded-xl border border-[#e1c99f] bg-[#fff8e8] px-4 py-2.5 text-xs font-semibold text-[#694a1f]" role="status">{notice}</p> : null}
            {item.status === "completed" ? <div className="rounded-xl bg-[#e9edea] px-4 py-3 text-center text-xs font-bold text-[#65736c]">완료된 상담입니다. 대화 내용은 계속 확인할 수 있습니다.</div> : <><div className="mb-3 flex items-center gap-3"><label htmlFor="message-section" className="text-xs font-bold text-[#66736c]">관련 부분</label><select id="message-section" value={section} onChange={(event) => setSection(event.target.value)} className="rounded-lg border border-[#d2ccc1] bg-white px-3 py-2 text-xs text-[#35483f]"><option>전체 흐름</option><option>서론</option><option>본론</option><option>결론</option><option>삶의 적용</option></select></div><div className="flex items-end gap-3"><label htmlFor="consult-message" className="sr-only">메시지</label><textarea id="consult-message" value={body} onChange={(event) => setBody(event.target.value.slice(0, 2000))} rows={3} placeholder={expertMode ? "본문에 근거한 구체적인 피드백을 남겨 주세요." : "궁금한 점이나 다듬고 싶은 방향을 남겨 주세요."} className="min-h-20 flex-1 resize-y rounded-xl border border-[#d2ccc1] bg-white px-4 py-3 text-sm leading-6 outline-none focus:border-[#718d80] focus:ring-2 focus:ring-[#b9cec5]/60"/><button type="submit" disabled={state === "sending" || !body.trim()} className="min-h-12 shrink-0 rounded-xl bg-[#285343] px-5 text-sm font-extrabold text-white disabled:cursor-not-allowed disabled:opacity-50">{state === "sending" ? "전송 중" : "보내기"}</button></div><p className="mt-2 text-right text-[10px] text-[#8c928f]">{body.length}/2,000</p></>}
          </form>
        </section>

        <aside className="space-y-4">
          <section className="rounded-[1.4rem] border border-[#d9d2c7] bg-[#eee5d8] p-5"><p className="text-[10px] font-extrabold tracking-[0.15em] text-[#8d5a2e] uppercase">Initial request</p><h2 className="mt-2 text-sm font-extrabold text-[#334b40]">처음 요청한 내용</h2><p className="mt-3 text-xs leading-6 text-[#66716c]">{item.reason}</p></section>
          <section className="rounded-[1.4rem] border border-[#ddd7cd] bg-white p-5"><h2 className="text-sm font-extrabold text-[#334b40]">좋은 상담을 위한 안내</h2><ul className="mt-3 space-y-2 text-xs leading-5 text-[#747d78]"><li>• 특정 문단을 말할 때 관련 부분을 선택해 주세요.</li><li>• 제안은 원고에 자동 반영되지 않습니다.</li><li>• 성경 해석과 최종 전달 책임은 설교자에게 있습니다.</li></ul></section>
        </aside>
      </div>
    </div>
  );
}
