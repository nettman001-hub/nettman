"use client";

import Link from "next/link";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { useAiAgent } from "@/app/_components/ai-agent-provider";
import {
  AI_AGENT_MESSAGE_COSTS,
  type AiAgentCapability,
  type AiAgentSurface,
} from "@/app/_lib/ai-agent-contract";
import {
  AI_ENGINE_TIERS,
  AI_ENGINE_TIER_META,
} from "@/app/_lib/ai-engine-tiers";

const DEFAULT_SUGGESTIONS: Partial<Record<AiAgentSurface, readonly string[]>> = {
  home: [
    "오늘 준비할 설교의 시작 순서를 알려줘",
    "최근 설교를 바탕으로 다음 작업을 추천해줘",
  ],
  "sermon-helper": [
    "지금 단계에서 제가 먼저 생각할 질문을 알려줘",
    "제 메모에서 더 깊이 묵상할 지점을 짚어줘",
  ],
  sermon: [
    "현재 설교 작업에서 다음 단계를 알려줘",
    "빠뜨린 내용이 있는지 검토해줘",
  ],
  "sermon.options": [
    "현재 구성 옵션에서 빠진 부분을 검토해줘",
    "청중과 설교 목적에 맞는 옵션을 추천해줘",
  ],
  "sermon.input": [
    "본문과 주제가 자연스럽게 연결되는지 검토해줘",
    "설교를 만들기 전에 보완할 메모를 알려줘",
  ],
  "sermon.alternatives": [
    "다섯 초안의 차이를 비교하고 하나를 추천해줘",
    "목회 현장에 가장 잘 맞는 초안을 찾아줘",
  ],
  "sermon.edit": [
    "설교의 흐름과 적용이 자연스러운지 검토해줘",
    "수정이 필요한 부분을 먼저 제안해줘",
  ],
  "sermon.complete": [
    "완성한 설교의 핵심을 짧게 정리해줘",
    "이 설교로 만들 수 있는 사역 자료를 추천해줘",
  ],
  history: [
    "저장된 설교를 찾는 방법을 알려줘",
    "다시 발전시키기 좋은 설교를 찾도록 도와줘",
  ],
  "history.detail": [
    "이 설교의 핵심과 보완점을 정리해줘",
    "이 설교를 활용할 다음 작업을 추천해줘",
  ],
  study: [
    "현재 본문 연구 범위를 점검해줘",
    "본문을 깊이 살필 연구 방향을 추천해줘",
  ],
  critique: [
    "비평에서 중점적으로 볼 부분을 추천해줘",
    "원고의 구조와 적용을 점검해줘",
  ],
  ministry: [
    "이 설교에 가장 적합한 사역 자료를 추천해줘",
    "소그룹에서 사용할 질문 방향을 제안해줘",
  ],
  consult: ["설교 피드백을 요청하기 전에 확인할 점을 알려줘"],
  expert: ["전문가 피드백을 효과적으로 받는 방법을 알려줘"],
  account: ["이 화면에서 설정할 수 있는 항목을 알려줘"],
  notifications: ["알림 설정을 이해하기 쉽게 설명해줘"],
  tokens: ["현재 토큰 현황과 설교 생성 차감 원칙을 설명해줘"],
  admin: ["이 관리 화면에서 AI 에이전트가 지원하지 않는 작업을 알려줘"],
};

const CAPABILITY_LABELS: Record<AiAgentCapability, string> = {
  navigate: "화면 이동",
  "sermon.options.patch": "구성 옵션 변경 제안",
  "sermon.input.patch": "본문 입력 변경 제안",
  "sermon.alternative.select": "초안 선택",
  "sermon.generation.stop": "설교 생성 중지",
  "sermon.revision.prepare": "설교 수정안 준비",
  "resource.form.patch": "자료 입력 변경 제안",
  "resource.generate": "자료 생성",
  "history.open": "저장 설교 열기",
};

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea:not([disabled]), select:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter(
    (element) =>
      !element.hasAttribute("hidden") &&
      element.getAttribute("aria-hidden") !== "true" &&
      element.getClientRects().length > 0,
  );
}

function useDockedPanel(): boolean {
  const [docked, setDocked] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1800px)");
    const sync = () => setDocked(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  return docked;
}

export function AiAgentPanel({
  triggerRef,
}: {
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  const {
    isOpen,
    close,
    page,
    authenticated,
    messages,
    tier,
    setTier,
    pending,
    error,
    proposalStates,
    sendMessage,
    stopResponse,
    applyProposal,
    dismissProposal,
    clearConversation,
  } = useAiAgent();
  const panelRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState("");
  const docked = useDockedPanel();

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    const trigger = triggerRef.current;
    if (!docked) document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      } else if (!docked && event.key === "Tab" && panelRef.current) {
        const elements = focusableElements(panelRef.current);
        const first = elements[0];
        const last = elements.at(-1);
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      trigger?.focus();
    };
  }, [close, docked, isOpen, triggerRef]);

  useEffect(() => {
    if (!isOpen) return;
    messagesEndRef.current?.scrollIntoView({ block: "nearest" });
  }, [isOpen, messages, pending]);

  const suggestions = useMemo(
    () =>
      page?.suggestions?.length
        ? page.suggestions
        : page
          ? DEFAULT_SUGGESTIONS[page.surface] ?? []
          : [],
    [page],
  );

  if (!isOpen) return null;

  async function submit() {
    const content = draft.trim();
    if (!content || pending || !authenticated) return;
    setDraft("");
    await sendMessage(content);
  }

  return (
    <>
      <button
        type="button"
        aria-label="AI 에이전트 닫기"
        className="fixed inset-x-0 bottom-0 top-[var(--app-topbar-height,4.5rem)] z-50 bg-[#0a1511]/55 backdrop-blur-[2px] min-[1800px]:hidden"
        onClick={close}
      />
      <aside
        id="ai-agent-panel"
        ref={panelRef}
        tabIndex={-1}
        role={docked ? "complementary" : "dialog"}
        aria-modal={docked ? undefined : true}
        aria-labelledby="ai-agent-title"
        className="fixed bottom-0 right-0 top-[var(--app-topbar-height,4.5rem)] z-[55] flex w-[min(100vw,27rem)] flex-col border-l border-white/10 bg-[#142b23] text-white shadow-[-24px_0_70px_rgba(5,18,13,.28)] min-[1800px]:sticky min-[1800px]:top-[var(--app-topbar-height,4.5rem)] min-[1800px]:z-20 min-[1800px]:h-[calc(100vh-var(--app-topbar-height,4.5rem))] min-[1800px]:w-full min-[1800px]:shadow-none"
      >
        <header className="flex min-h-[5.5rem] shrink-0 items-center gap-3 border-b border-white/10 px-4 sm:px-5">
          <span
            aria-hidden="true"
            className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#6659e8] text-lg shadow-[0_10px_28px_rgba(78,63,217,.28)]"
          >
            ✦
          </span>
          <span className="min-w-0 flex-1">
            <strong id="ai-agent-title" className="block text-base font-extrabold text-white">
              AI 에이전트
            </strong>
            <span className="mt-0.5 block text-xs leading-5 text-white/75">
              현재 화면을 읽고 안전한 작업을 제안합니다
            </span>
          </span>
          {messages.length ? (
            <button
              type="button"
              onClick={clearConversation}
              disabled={pending}
              className="min-h-11 rounded-xl px-2.5 text-xs font-bold text-white/75 hover:bg-white/8 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#d9c976] disabled:opacity-40"
            >
              새 대화
            </button>
          ) : null}
          <button
            ref={closeButtonRef}
            type="button"
            onClick={close}
            className="grid size-11 shrink-0 place-items-center rounded-xl border border-white/12 bg-white/6 text-2xl leading-none text-white hover:bg-white/12 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#d9c976]"
            aria-label="AI 에이전트 닫기"
          >
            ×
          </button>
        </header>

        {!authenticated ? (
          <div className="grid flex-1 place-items-center overflow-y-auto px-6 py-10 text-center">
            <div className="max-w-xs">
              <span
                aria-hidden="true"
                className="mx-auto grid size-14 place-items-center rounded-2xl bg-white/8 text-2xl"
              >
                ✦
              </span>
              <h2 className="mt-5 text-xl font-extrabold text-white">
                로그인하고 AI 에이전트를 사용하세요
              </h2>
              <p className="mt-3 text-sm leading-6 text-white/75">
                현재 화면에 맞는 도움과 변경 제안을 안전하게 받을 수 있습니다.
              </p>
              <Link
                href="/login?return_to=%2Fhome"
                className="mt-6 inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-[#e6c17f] px-4 text-sm font-extrabold text-[#20352d] hover:bg-[#efd19e] focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                로그인하기
              </Link>
            </div>
          </div>
        ) : (
          <>
            <div className="border-b border-white/10 px-4 py-3 sm:px-5">
              <div className="flex items-start justify-between gap-3">
                <span className="min-w-0">
                  <span className="block text-[10px] font-extrabold tracking-[0.16em] text-[#e5c37e] uppercase">
                    현재 화면
                  </span>
                  <strong className="mt-1 block truncate text-sm font-bold text-white">
                    {page?.title ?? "화면 연결 중"}
                  </strong>
                </span>
                {page?.capabilities.length ? (
                  <span className="shrink-0 rounded-full border border-white/12 bg-white/7 px-2.5 py-1 text-[10px] font-bold text-white/75">
                    {page.capabilities.length}개 기능
                  </span>
                ) : null}
              </div>
              {page?.capabilities.length ? (
                <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1" aria-label="허용된 기능">
                  {page.capabilities.map((capability) => (
                    <span
                      key={capability}
                      className="shrink-0 rounded-lg bg-white/7 px-2 py-1 text-[10px] font-semibold text-white/70"
                    >
                      {CAPABILITY_LABELS[capability]}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>

            <div
              className="flex-1 overflow-y-auto px-4 py-5 sm:px-5"
              aria-live="polite"
              aria-relevant="additions"
            >
              {!messages.length ? (
                <div>
                  <p className="text-sm leading-6 text-white/80">
                    현재 화면에 관해 물어보거나, 검토하고 고칠 내용을 요청하세요.
                    AI는 바로 변경하지 않고 먼저 제안하며, 적용은 직접 확인한 뒤 진행됩니다.
                  </p>
                  {suggestions.length ? (
                    <div className="mt-5 grid gap-2" aria-label="추천 질문">
                      {suggestions.map((suggestion) => (
                        <button
                          key={suggestion}
                          type="button"
                          onClick={() => void sendMessage(suggestion)}
                          disabled={pending || !page}
                          className="min-h-12 rounded-xl border border-white/10 bg-white/7 px-4 py-3 text-left text-sm font-semibold leading-5 text-white transition-colors hover:bg-white/12 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#d9c976] disabled:opacity-45"
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : (
                <ol className="space-y-4" aria-label="AI 에이전트 대화">
                  {messages.map((message) => {
                    const proposalState = message.proposal
                      ? proposalStates[message.proposal.id]
                      : undefined;
                    return (
                      <li
                        key={message.id}
                        className={message.role === "user" ? "flex justify-end" : undefined}
                      >
                        <div
                          className={`max-w-[92%] rounded-2xl px-4 py-3 text-sm leading-6 ${
                            message.role === "user"
                              ? "rounded-br-md bg-[#e4c17f] font-semibold text-[#1d332a]"
                              : "rounded-bl-md border border-white/10 bg-white/7 text-white"
                          }`}
                        >
                          <p className="whitespace-pre-wrap">{message.content}</p>
                          {message.proposal ? (
                            <section className="mt-3 rounded-xl border border-[#e4c17f]/35 bg-[#0e211a] p-3 text-white" aria-label="AI 작업 제안">
                              <span className="text-[10px] font-extrabold tracking-[0.15em] text-[#e6c37d] uppercase">
                                확인 후 적용
                              </span>
                              <h3 className="mt-1.5 text-sm font-extrabold text-white">
                                {message.proposal.title}
                              </h3>
                              <p className="mt-1 text-xs leading-5 text-white/75">
                                {message.proposal.description}
                              </p>
                              {proposalState === "applied" ? (
                                <p className="mt-3 rounded-lg bg-[#315b49] px-3 py-2 text-xs font-bold text-white">
                                  적용했습니다
                                </p>
                              ) : proposalState === "dismissed" ? (
                                <p className="mt-3 text-xs font-semibold text-white/55">
                                  이 제안을 적용하지 않았습니다.
                                </p>
                              ) : (
                                <div className="mt-3 grid grid-cols-2 gap-2">
                                  <button
                                    type="button"
                                    onClick={() => dismissProposal(message.proposal!.id)}
                                    disabled={proposalState === "applying"}
                                    className="min-h-11 rounded-xl border border-white/15 px-3 text-xs font-bold text-white hover:bg-white/8 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#d9c976] disabled:opacity-45"
                                  >
                                    취소
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void applyProposal(message.proposal!)}
                                    disabled={proposalState === "applying"}
                                    className="min-h-11 rounded-xl bg-[#e4c17f] px-3 text-xs font-extrabold text-[#1d332a] hover:bg-[#efd49e] focus:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-55"
                                  >
                                    {proposalState === "applying" ? "적용 중…" : "적용"}
                                  </button>
                                </div>
                              )}
                            </section>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                  {pending ? (
                    <li className="flex items-center gap-2 text-xs font-semibold text-white/70" role="status">
                      <span aria-hidden="true" className="size-2 animate-pulse rounded-full bg-[#e4c17f]" />
                      현재 화면을 검토하는 중입니다…
                    </li>
                  ) : null}
                </ol>
              )}
              <div ref={messagesEndRef} />
            </div>

            <footer className="shrink-0 border-t border-white/10 bg-[#11271f] px-4 py-4 sm:px-5">
              {error ? (
                <p className="mb-3 rounded-xl border border-[#eaa897]/35 bg-[#8f3f32]/25 px-3 py-2.5 text-xs font-semibold leading-5 text-white" role="alert">
                  {error}
                </p>
              ) : null}
              <label htmlFor="ai-agent-tier" className="sr-only">
                AI 엔진 선택
              </label>
              <div className="flex items-center gap-3">
                <select
                  id="ai-agent-tier"
                  value={tier}
                  onChange={(event) => setTier(event.target.value as typeof tier)}
                  disabled={pending}
                  className="min-h-11 min-w-0 flex-1 rounded-xl border border-white/15 bg-[#1b362c] px-3 text-base font-bold text-white outline-none focus:border-[#e4c17f] focus:ring-2 focus:ring-[#e4c17f]/25 disabled:opacity-50"
                >
                  {AI_ENGINE_TIERS.map((engineTier) => (
                    <option key={engineTier} value={engineTier} className="bg-[#1b362c] text-white">
                      {AI_ENGINE_TIER_META[engineTier].label}
                    </option>
                  ))}
                </select>
                <span className="shrink-0 rounded-full bg-[#e4c17f]/14 px-2.5 py-1.5 text-xs font-extrabold text-[#f0d59f]">
                  메시지 {AI_AGENT_MESSAGE_COSTS[tier]}토큰
                </span>
              </div>
              <label htmlFor="ai-agent-message" className="sr-only">
                AI 에이전트에게 요청하기
              </label>
              <div className="mt-3 flex items-end gap-2 rounded-2xl border border-white/15 bg-white/7 p-2 focus-within:border-[#e4c17f] focus-within:ring-2 focus-within:ring-[#e4c17f]/20">
                <textarea
                  id="ai-agent-message"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value.slice(0, 2_000))}
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      !event.shiftKey &&
                      !event.nativeEvent.isComposing
                    ) {
                      event.preventDefault();
                      void submit();
                    }
                  }}
                  placeholder="현재 화면에 관해 묻거나, 고쳐 달라고 요청하세요"
                  rows={2}
                  disabled={pending || !page}
                  className="max-h-36 min-h-12 flex-1 resize-none border-0 bg-transparent px-2 py-2 text-sm leading-6 text-white placeholder:text-white/45 focus:shadow-none focus:outline-none disabled:opacity-50"
                />
                {pending ? (
                  <button
                    type="button"
                    onClick={stopResponse}
                    className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#b85e49] text-xs font-extrabold text-white hover:bg-[#c86b55] focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
                    aria-label="AI 응답 중지"
                  >
                    중지
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void submit()}
                    disabled={!draft.trim() || !page}
                    className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#6759e8] text-lg font-black text-white hover:bg-[#7669ef] focus:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label="AI 에이전트에게 전송"
                  >
                    ↵
                  </button>
                )}
              </div>
              <p className="mt-2 text-[10px] leading-4 text-white/55">
                Enter 전송 · Shift+Enter 줄바꿈 · 변경은 확인 후 적용됩니다
              </p>
            </footer>
          </>
        )}
      </aside>
    </>
  );
}
