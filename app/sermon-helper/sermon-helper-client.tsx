"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  useAiAgent,
  useRegisterAiAgentPage,
} from "@/app/_components/ai-agent-provider";
import type { AgentActionProposal } from "@/app/_lib/ai-agent-contract";
import {
  BackgroundAiRunBusyError,
  startBackgroundAiRun,
  stopBackgroundAiRun,
  subscribeBackgroundAiRun,
  type BackgroundAiRunState,
} from "@/app/_lib/background-ai-runner";
import {
  AI_ENGINE_TIERS,
  AI_ENGINE_TIER_META,
  type AiEngineTier,
} from "@/app/_lib/ai-engine-tiers";
import {
  SERMON_HELPER_COACH_COSTS,
  SERMON_HELPER_COACH_WRITE_EXCERPT_MAX_CHARACTERS,
  type SermonHelperCoachApiResponse,
  type SermonHelperCoachMode,
  type SermonHelperCoachSuggestion,
} from "@/app/_lib/sermon-helper-coach-contract";
import {
  classifyStoredSermonHelperCoachRetryResponse,
  createStoredSermonHelperCoachRetry,
  parseStoredSermonHelperCoachRetry,
  sermonHelperCoachRetryStorageKey,
  type StoredSermonHelperCoachRetry,
} from "@/app/_lib/sermon-helper-coach-retry-storage";
import { requestScriptureNormalization } from "@/app/_lib/sermon-client";
import type { NormalizeScriptureResponse } from "@/app/_lib/sermon-types";
import {
  SERMON_HELPER_REVIEW_FIELD_KEYS,
  SERMON_HELPER_STEP_IDS,
  clearSermonHelperScriptureVerification,
  reconcileSermonHelperReview,
  sermonHelperReviewIsFresh,
  type SermonHelperProject,
  type SermonHelperProjectSummary,
  type SermonHelperProvenanceEntry,
  type SermonHelperStepId,
  type SermonHelperStepInput,
  type SermonHelperStepItem,
} from "@/app/_lib/sermon-helper-types";
import { notifyTokenWalletChanged } from "@/app/_lib/token-wallet-events";

type SaveState = "saved" | "dirty" | "saving" | "error" | "conflict";
type ScreenState = "loading" | "start" | "workspace" | "error";

type FieldDefinition = {
  key: string;
  label: string;
  help: string;
  placeholder?: string;
  kind?: "text" | "textarea" | "select";
  options?: readonly { value: string; label: string }[];
};

type StepDefinition = {
  id: SermonHelperStepId;
  number: string;
  shortLabel: string;
  title: string;
  eyebrow: string;
  description: string;
  prompt: string;
  fields: readonly FieldDefinition[];
};

const STEP_DEFINITIONS: readonly StepDefinition[] = [
  {
    id: "brief",
    number: "01",
    shortLabel: "상황",
    title: "설교 상황을 먼저 들여다봅니다",
    eyebrow: "회중과 목회 현장",
    description: "이번 설교가 놓인 실제 자리와 목회자의 부담을 직접 기록합니다.",
    prompt: "이번 주 회중의 삶에서 가장 마음에 걸리는 장면은 무엇인가요?",
    fields: [
      { key: "occasion", label: "예배와 절기", help: "주일예배, 수요예배, 절기 또는 특별한 계기를 적어주세요.", placeholder: "예: 부활절 후 둘째 주 주일예배" },
      { key: "audience", label: "주요 회중", help: "내 설교에 저장할 기본 회중 분류를 선택하세요.", kind: "select", options: [{ value: "청소년", label: "청소년" }, { value: "청년", label: "청년" }, { value: "청장년", label: "청장년" }, { value: "장년", label: "장년" }] },
      { key: "audienceSituation", label: "구체 대상과 현재 상황", help: "연령·새가족 등 구체 대상은 여기에 적되, 개인을 식별할 수 있는 이름과 상담 내용은 제외하세요.", placeholder: "예: 30~50대 청장년과 새가족, 일과 돌봄 사이에서 지친 상황", kind: "textarea" },
      { key: "pastoralBurden", label: "목회적 부담과 질문", help: "목회자로서 이번 주 품고 있는 질문을 먼저 남깁니다.", placeholder: "제가 이 말씀 앞에서 회중과 함께 씨름하고 싶은 질문은…", kind: "textarea" },
      { key: "sermonType", label: "설교 유형", help: "후에 저장할 설교의 기본 유형입니다.", kind: "select", options: [{ value: "강해", label: "강해 설교" }, { value: "주제", label: "주제 설교" }, { value: "내러티브", label: "내러티브 설교" }] },
      { key: "duration", label: "예상 분량", help: "직접 쓰기 단계의 분량 점검에 사용합니다.", kind: "select", options: [{ value: "10", label: "10분" }, { value: "15", label: "15분" }, { value: "20", label: "20분" }, { value: "25", label: "25분" }, { value: "30", label: "30분" }] },
      { key: "emotion", label: "정서적 방향", help: "설교가 회중에게 남기길 바라는 정서를 적어주세요.", placeholder: "예: 따뜻한 위로 뒤에 이어지는 정직한 도전" },
    ],
  },
  {
    id: "observe",
    number: "02",
    shortLabel: "본문",
    title: "본문을 천천히 읽고 관찰합니다",
    eyebrow: "본문 자체의 목소리",
    description: "해석에 앞서 반복, 변화, 인물과 질문을 목회자의 언어로 남깁니다.",
    prompt: "설명하기 전에, 본문에서 실제로 보이는 것은 무엇인가요?",
    fields: [
      { key: "translation", label: "주로 읽은 번역본", help: "비교한 번역본이 있다면 함께 적어주세요.", placeholder: "예: 개역개정, 새번역" },
      { key: "repeatedWords", label: "반복되는 말과 이미지", help: "반복, 대조, 전환 표현을 직접 표시합니다.", placeholder: "본문에서 반복되거나 서로 대비되는 표현은…", kind: "textarea" },
      { key: "charactersAndActions", label: "인물과 행동", help: "누가 무엇을 말하고 행동하는지 순서대로 살펴보세요.", placeholder: "예수님은… 제자들은… 무리는…", kind: "textarea" },
      { key: "observations", label: "내가 발견한 관찰", help: "주석을 보기 전에 내 눈에 들어온 사실을 적어주세요.", placeholder: "본문을 세 번 읽으며 새롭게 발견한 것은…", kind: "textarea" },
      { key: "questions", label: "본문에 던질 질문", help: "아직 답하지 못한 질문도 그대로 보관합니다.", placeholder: "왜 이 표현을 사용했을까? 앞뒤 문맥과 어떤 관계일까?", kind: "textarea" },
    ],
  },
  {
    id: "interpret",
    number: "03",
    shortLabel: "연구",
    title: "관찰을 검증하며 의미를 연구합니다",
    eyebrow: "문맥·배경·신학",
    description: "AI 답변을 권위로 삼지 않고 성경, 주석과 신뢰할 자료로 확인합니다.",
    prompt: "내 첫 인상을 수정하거나 더 깊게 만든 근거는 무엇인가요?",
    fields: [
      { key: "literaryContext", label: "앞뒤 문맥", help: "단락과 책 전체의 흐름 안에서 본문을 살펴보세요.", placeholder: "이 단락 앞에는… 뒤에는… 책 전체에서는…", kind: "textarea" },
      { key: "historicalContext", label: "역사·문화적 배경", help: "확인한 사실과 아직 추정인 내용을 구분해 적어주세요.", placeholder: "확인한 배경과 그 출처는…", kind: "textarea" },
      { key: "wordStudy", label: "핵심 단어와 원어", help: "사전과 주석으로 확인한 범위만 기록합니다.", placeholder: "핵심 단어의 문맥상 의미는…", kind: "textarea" },
      { key: "canonicalContext", label: "성경 전체와의 연결", help: "관련 본문을 나열하기보다 연결 이유를 적어주세요.", placeholder: "이 본문은 성경의 더 큰 이야기에서…", kind: "textarea" },
      { key: "theologicalClaim", label: "신학적 핵심", help: "교단과 신학 전통에서 다시 확인할 내용을 표시하세요.", placeholder: "이 본문이 하나님과 복음에 관해 증언하는 것은…", kind: "textarea" },
      { key: "sources", label: "직접 확인한 자료", help: "책·주석·논문 제목과 쪽수 또는 URL을 기록하세요.", placeholder: "자료명, 저자, 쪽수 또는 URL", kind: "textarea" },
    ],
  },
  {
    id: "message",
    number: "04",
    shortLabel: "메시지",
    title: "이번 설교의 한 문장을 붙잡습니다",
    eyebrow: "본문에서 오늘의 회중으로",
    description: "많은 아이디어를 하나의 복음적 중심과 설교 목적으로 좁힙니다.",
    prompt: "회중이 한 문장만 기억한다면 무엇이어야 하나요?",
    fields: [
      { key: "coreMessage", label: "한 문장 메시지", help: "본문의 주어와 힘을 살려 한 문장으로 적어보세요.", placeholder: "하나님은… 그러므로 우리는…", kind: "textarea" },
      { key: "gospelConnection", label: "그리스도와 복음의 연결", help: "본문 밖에서 억지로 덧붙이지 않았는지 살펴보세요.", placeholder: "이 본문이 복음 안에서 드러내는 소망은…", kind: "textarea" },
      { key: "sermonPurpose", label: "설교의 목적", help: "정보 전달보다 회중에게 일어나길 바라는 변화를 적습니다.", placeholder: "이 설교를 통해 회중이 깨닫고 믿고 행하기를 바라는 것은…", kind: "textarea" },
      { key: "desiredResponse", label: "회중의 응답", help: "강요가 아닌 구체적이고 은혜로운 응답을 생각하세요.", placeholder: "말씀을 들은 뒤 회중이 하나님 앞에서…", kind: "textarea" },
    ],
  },
  {
    id: "outline",
    number: "05",
    shortLabel: "구조",
    title: "메시지가 잘 들리는 흐름을 세웁니다",
    eyebrow: "한 방향으로 가는 설교",
    description: "원포인트·다대지, 귀납·연역 중 본문과 회중에 맞는 길을 선택합니다.",
    prompt: "각 부분이 같은 한 문장 메시지를 향하고 있나요?",
    fields: [
      { key: "approach", label: "전개 방식", help: "익숙함보다 이번 본문에 맞는 방식을 고르세요.", kind: "select", options: [{ value: "귀납적 원포인트", label: "귀납적 원포인트" }, { value: "연역적 원포인트", label: "연역적 원포인트" }, { value: "귀납적 다대지", label: "귀납적 다대지" }, { value: "연역적 다대지", label: "연역적 다대지" }] },
      { key: "openingMove", label: "도입의 역할", help: "흥미보다 본문의 질문으로 회중을 초대합니다.", placeholder: "도입에서 함께 바라볼 현실과 질문은…", kind: "textarea" },
      { key: "movementOne", label: "첫 번째 움직임", help: "본문의 긴장 또는 질문을 드러냅니다.", placeholder: "본문은 먼저…", kind: "textarea" },
      { key: "movementTwo", label: "두 번째 움직임", help: "복음의 전환과 핵심을 분명히 합니다.", placeholder: "그러나 하나님은…", kind: "textarea" },
      { key: "movementThree", label: "세 번째 움직임", help: "회중의 삶으로 연결할 다리를 만듭니다.", placeholder: "그러므로 오늘 우리는…", kind: "textarea" },
      { key: "closingMove", label: "결론의 역할", help: "새 내용을 더하기보다 메시지와 응답을 모읍니다.", placeholder: "마지막에 회중이 붙잡을 초대는…", kind: "textarea" },
    ],
  },
  {
    id: "apply",
    number: "06",
    shortLabel: "적용",
    title: "회중의 실제 삶에 말씀을 연결합니다",
    eyebrow: "머리·마음·손",
    description: "개인의 비밀을 노출하거나 쉬운 정답을 강요하지 않는 적용을 만듭니다.",
    prompt: "이 적용은 실제로 살아낼 수 있고, 복음의 은혜에서 나오나요?",
    fields: [
      { key: "head", label: "새롭게 이해할 것", help: "회중의 관점이 어떻게 달라져야 하는지 적어주세요.", placeholder: "우리가 새롭게 알아야 할 것은…", kind: "textarea" },
      { key: "heart", label: "하나님 앞에서 느끼고 믿을 것", help: "죄책감 조작 대신 은혜 안의 정직한 반응을 생각하세요.", placeholder: "하나님 앞에서 인정하고 신뢰할 것은…", kind: "textarea" },
      { key: "hands", label: "이번 주 실천할 것", help: "작고 구체적이며 측정 가능한 한 걸음을 제안하세요.", placeholder: "이번 주 한 번 실천할 수 있는 행동은…", kind: "textarea" },
      { key: "illustration", label: "목회자의 경험과 예화", help: "예화는 최소한으로 사용하고 사실 여부와 당사자의 존엄을 확인하세요.", placeholder: "내 삶에서 본문과 정직하게 만나는 장면은…", kind: "textarea" },
      { key: "privacyReview", label: "개인정보 점검", help: "성도의 이름·질병·상담·가족 문제를 식별할 수 없게 처리했나요?", kind: "select", options: [{ value: "not-reviewed", label: "아직 점검하지 않음" }, { value: "anonymized", label: "익명화 완료" }, { value: "not-applicable", label: "개인 사례를 사용하지 않음" }] },
    ],
  },
  {
    id: "write",
    number: "07",
    shortLabel: "직접쓰기",
    title: "목회자의 언어로 원고를 직접 씁니다",
    eyebrow: "대필 없는 집필 공간",
    description: "AI는 전체 원고를 만들지 않습니다. 목회자가 쓴 문장에 대한 질문과 점검만 제공합니다.",
    prompt: "이 문장을 내가 강단에서 내 목소리로 전할 수 있나요?",
    fields: [
      { key: "introduction", label: "도입", help: "회중의 현실과 본문의 질문을 목회자의 언어로 여세요.", placeholder: "도입을 직접 작성하세요.", kind: "textarea" },
      { key: "conclusion", label: "결론", help: "새 내용을 더하지 않고 복음의 초대와 응답을 모읍니다.", placeholder: "결론을 직접 작성하세요.", kind: "textarea" },
      { key: "application", label: "최종 적용", help: "설교 흐름 안에서 회중이 살아낼 한 걸음을 직접 써주세요.", placeholder: "최종 적용을 직접 작성하세요.", kind: "textarea" },
    ],
  },
  {
    id: "review",
    number: "08",
    shortLabel: "점검",
    title: "본문·출처·회중 앞에서 최종 점검합니다",
    eyebrow: "목회자의 최종 책임",
    description: "AI가 아니라 목회자가 사실과 신학, 개인정보와 전달을 확인하고 완료합니다.",
    prompt: "이 설교의 모든 문장을 내가 책임 있게 설명할 수 있나요?",
    fields: [
      { key: "finalNotes", label: "마지막 수정 메모", help: "낭독하며 발견한 어색함과 수정할 부분을 적어주세요.", placeholder: "최종 수정이 필요한 부분은…", kind: "textarea" },
    ],
  },
] as const;

const STEP_GROUPS = [
  { number: "01", title: "마음을 열고 읽기", description: "상황 · 본문", steps: ["brief", "observe"] },
  { number: "02", title: "깊이 살피고 붙잡기", description: "연구 · 메시지", steps: ["interpret", "message"] },
  { number: "03", title: "흐름을 세우고 잇기", description: "구조 · 적용", steps: ["outline", "apply"] },
  { number: "04", title: "내 언어로 쓰고 점검하기", description: "직접쓰기 · 점검", steps: ["write", "review"] },
] as const satisfies readonly {
  number: string;
  title: string;
  description: string;
  steps: readonly SermonHelperStepId[];
}[];

const REVIEW_CHECKS = [
  ["scriptureChecked", "성경 본문과 인용 구절을 원문에서 다시 확인했습니다."],
  ["sourcesChecked", "인용문·통계·역사적 사실의 출처를 직접 확인했습니다."],
  ["theologyChecked", "교단과 신학적 전통 안에서 표현을 점검했습니다."],
  ["privacyChecked", "개인 사례에서 성도와 가족을 식별할 정보를 제거했습니다."],
  ["voiceChecked", "AI 제안을 그대로 두지 않고 제 목소리로 판단하고 수정했습니다."],
  ["rehearsed", "원고를 소리 내어 읽고 시간과 전달 흐름을 점검했습니다."],
] as const;

const COACH_MODES: readonly {
  id: SermonHelperCoachMode;
  label: string;
  description: string;
}[] = [
  {
    id: "question",
    label: "생각 질문",
    description: "목회자의 생각을 더 깊게 여는 질문을 받습니다.",
  },
  {
    id: "research",
    label: "연구 방향",
    description: "직접 확인할 문맥·자료·검색 방향을 제안받습니다.",
  },
  {
    id: "review",
    label: "점검",
    description: "작성한 내용의 빠진 관점과 위험을 점검합니다.",
  },
  {
    id: "refine",
    label: "부분 다듬기",
    description: "선택한 문장 범위 안에서 표현 대안을 받습니다.",
  },
] as const;

const COACH_ITEM_KIND: Record<
  SermonHelperCoachSuggestion["kind"],
  SermonHelperStepItem["kind"]
> = {
  question: "note",
  research_lead: "research",
  review_note: "check",
  revision_option: "note",
};

function stepDefinition(id: SermonHelperStepId): StepDefinition {
  return STEP_DEFINITIONS.find((step) => step.id === id) ?? STEP_DEFINITIONS[0];
}

function asMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
    return body.error;
  }
  return fallback;
}

async function responseBody(response: Response): Promise<Record<string, unknown>> {
  try {
    const body = (await response.json()) as unknown;
    return body && typeof body === "object" ? body as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function notifyWalletFromApiBody(body: Record<string, unknown>): void {
  const wallet = body.wallet;
  if (
    wallet &&
    typeof wallet === "object" &&
    "balance" in wallet &&
    "lifetimeSpent" in wallet &&
    typeof wallet.balance === "number" &&
    Number.isFinite(wallet.balance) &&
    typeof wallet.lifetimeSpent === "number" &&
    Number.isFinite(wallet.lifetimeSpent)
  ) {
    notifyTokenWalletChanged({
      balance: wallet.balance,
      lifetimeSpent: wallet.lifetimeSpent,
    });
  } else if (body.walletRefreshRequired === true) {
    // An omitted success wallet means the durable result committed but the
    // snapshot read failed; listeners refetch instead of treating it as an AI
    // failure or leaving the header balance stale.
    notifyTokenWalletChanged();
  }
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "최근 수정";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function countCharacters(project: SermonHelperProject): number {
  const write = project.steps.write;
  return [
    write.fields.introduction,
    ...write.items.filter((item) => item.kind === "manuscript").flatMap((item) => [item.title, item.content]),
    write.fields.conclusion,
    write.fields.application,
  ].join("").replace(/\s/g, "").length;
}

function saveLabel(state: SaveState): string {
  if (state === "saving") return "저장 중";
  if (state === "dirty") return "변경 내용 있음";
  if (state === "error") return "저장 다시 시도 필요";
  if (state === "conflict") return "다른 창의 변경 발견";
  return "자동 저장됨";
}

function safeProject(value: unknown): SermonHelperProject | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<SermonHelperProject>;
  return typeof item.id === "string" && item.steps && typeof item.version === "number"
    ? item as SermonHelperProject
    : null;
}

function StartScreen({
  items,
  loading,
  creating,
  error,
  onCreate,
}: {
  items: readonly SermonHelperProjectSummary[];
  loading: boolean;
  creating: boolean;
  error: string | null;
  onCreate: () => void;
}) {
  return (
    <div className="mx-auto max-w-[90rem] px-4 py-7 sm:px-7 sm:py-9 xl:px-10">
      <section className="relative overflow-hidden rounded-[2rem] bg-[#1d3e32] px-6 py-8 text-white shadow-[0_26px_70px_rgba(25,51,42,.18)] sm:px-10 sm:py-11 lg:min-h-[25rem] lg:px-12 lg:py-12">
        <div aria-hidden="true" className="absolute -right-24 -top-32 size-80 rounded-full border-[48px] border-white/[0.035]" />
        <div aria-hidden="true" className="absolute -bottom-28 right-[15%] size-64 rounded-full bg-[#d99e5d]/10 blur-3xl" />
        <div className="relative flex h-full flex-col justify-between gap-10 lg:flex-row lg:items-end">
          <div className="max-w-4xl">
            <p className="text-xs font-extrabold tracking-[0.18em] text-white uppercase">Sermon helper · 목회자 주도 준비</p>
            <h1 className="mt-5 font-serif text-[clamp(2.35rem,6vw,4.7rem)] font-bold leading-[1.06] tracking-[-0.045em] text-white">
              설교의 답을 대신 쓰지 않고,
              <br />생각의 다음 걸음을 돕습니다.
            </h1>
            <p className="mt-6 max-w-2xl text-sm leading-7 text-white sm:text-base">
              상황과 본문에서 시작해 연구, 메시지, 구조, 적용을 거쳐 직접 쓴 원고를 점검합니다.
              AI의 제안은 원할 때만 받고, 목회자가 직접 채택해야 작업에 반영됩니다.
            </p>
          </div>
          <button
            type="button"
            onClick={onCreate}
            disabled={creating}
            className="inline-flex min-h-13 shrink-0 items-center justify-center gap-3 rounded-2xl bg-[#e7bb80] px-6 text-sm font-extrabold text-[#20392f] shadow-[0_14px_30px_rgba(0,0,0,.16)] hover:bg-[#f0ca99] focus:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:cursor-wait disabled:opacity-65"
          >
            {creating ? "준비 공간 여는 중" : "새 준비 시작"}
            <span aria-hidden="true" className="text-lg">→</span>
          </button>
        </div>
      </section>

      {error ? <p role="alert" className="mt-5 rounded-2xl border border-[#e8b7aa] bg-[#fff0eb] px-5 py-4 text-sm font-semibold leading-6 text-[#923e2d]">{error}</p> : null}

      <section className="mt-6 rounded-[1.75rem] border border-[#ddd7cd] bg-white p-6 shadow-[0_16px_45px_rgba(39,50,44,.06)] sm:p-8" aria-labelledby="helper-flow-title">
        <p className="text-[10px] font-extrabold tracking-[0.17em] text-[#a56732] uppercase">Eight steps · Four movements</p>
        <h2 id="helper-flow-title" className="mt-2 font-serif text-2xl font-bold tracking-tight text-[#254238]">여덟 단계를 네 흐름으로 이어갑니다</h2>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {STEP_GROUPS.map((group) => (
            <article key={group.number} className="rounded-2xl border border-[#ded8ce] bg-[#f8f5ee] p-5">
              <span className="font-serif text-xl font-bold text-[#c18a51]">{group.number}</span>
              <h3 className="mt-7 font-serif text-lg font-bold text-[#294238]">{group.title}</h3>
              <p className="mt-2 text-sm font-semibold text-[#6b7771]">{group.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mt-6 rounded-[1.75rem] border border-[#ddd7cd] bg-white p-6 shadow-[0_16px_45px_rgba(39,50,44,.06)] sm:p-8" aria-labelledby="recent-helper-title">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[10px] font-extrabold tracking-[0.17em] text-[#a56732] uppercase">Recent preparation</p>
            <h2 id="recent-helper-title" className="mt-2 font-serif text-2xl font-bold text-[#254238]">최근 설교 준비</h2>
          </div>
          <p className="max-w-lg text-xs leading-5 text-[#717c76]">작업은 계정에 자동 저장됩니다. 어느 단계에서든 돌아가 다시 생각할 수 있습니다.</p>
        </div>
        {loading ? (
          <p role="status" className="mt-6 rounded-2xl bg-[#f5f2eb] px-5 py-8 text-center text-sm font-semibold text-[#66736d]">최근 작업을 불러오는 중입니다.</p>
        ) : items.length ? (
          <ul className="mt-6 grid gap-3 lg:grid-cols-2">
            {items.map((item) => (
              <li key={item.id}>
                <a
                  href={item.status === "completed" && item.completedSermonId ? `/history/${encodeURIComponent(item.completedSermonId)}` : `/sermon-helper?id=${encodeURIComponent(item.id)}`}
                  className="group flex min-h-32 items-center gap-4 rounded-2xl border border-[#ded8ce] bg-[#fbfaf6] p-5 transition hover:-translate-y-0.5 hover:border-[#bfae98] hover:shadow-[0_14px_35px_rgba(39,50,44,.08)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838]"
                >
                  <span aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-2xl bg-[#e5eee8] font-serif text-sm font-bold text-[#315746]">{item.completedStepCount}/8</span>
                  <span className="min-w-0 flex-1">
                    <strong className="block text-base font-extrabold leading-6 text-[#293f36]">{item.title || "제목 없는 설교 준비"}</strong>
                    <span className="mt-1 block text-sm leading-5 text-[#6f7b75]">{item.scripture || "본문을 아직 정하지 않았습니다"}</span>
                    <span className="mt-2 block text-[11px] font-semibold text-[#96704e]">{item.status === "completed" ? "목회자 작성 · AI 보조로 저장 완료" : `${stepDefinition(item.currentStepId).shortLabel} 단계`} · {formatDate(item.updatedAt)}</span>
                  </span>
                  <span aria-hidden="true" className="text-xl text-[#8b9891] transition-transform group-hover:translate-x-1">→</span>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-6 rounded-2xl border border-dashed border-[#cfc7ba] bg-[#faf8f3] px-6 py-10 text-center">
            <p className="font-serif text-xl font-bold text-[#324a40]">아직 진행 중인 설교 준비가 없습니다</p>
            <p className="mt-2 text-sm leading-6 text-[#727d77]">본문과 회중을 생각하는 첫 단계부터 천천히 시작해 보세요.</p>
          </div>
        )}
      </section>
    </div>
  );
}

function FieldControl({
  definition,
  value,
  onChange,
}: {
  definition: FieldDefinition;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = `helper-field-${definition.key}`;
  const common = "mt-2 w-full rounded-xl border border-[#d5cfc3] bg-[#fffdf9] px-4 py-3 text-sm leading-6 text-[#243a31] shadow-sm outline-none transition placeholder:text-[#9aa29e] focus:border-[#7b978a] focus:ring-4 focus:ring-[#7b978a]/12";
  return (
    <div>
      <label htmlFor={id} className="text-sm font-extrabold text-[#30473d]">{definition.label}</label>
      <p id={`${id}-help`} className="mt-1 text-xs leading-5 text-[#707b75]">{definition.help}</p>
      {definition.kind === "select" ? (
        <select id={id} value={value} onChange={(event) => onChange(event.target.value)} aria-describedby={`${id}-help`} className={`${common} min-h-12`}>
          <option value="">선택하지 않음</option>
          {definition.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      ) : definition.kind === "textarea" ? (
        <textarea id={id} value={value} onChange={(event) => onChange(event.target.value)} aria-describedby={`${id}-help`} placeholder={definition.placeholder} rows={5} className={`${common} min-h-36 resize-y`} />
      ) : (
        <input id={id} type="text" value={value} onChange={(event) => onChange(event.target.value)} aria-describedby={`${id}-help`} placeholder={definition.placeholder} className={`${common} min-h-12`} />
      )}
    </div>
  );
}

function ManuscriptEditor({
  items,
  onAdd,
  onChange,
  onRemove,
}: {
  items: readonly SermonHelperStepItem[];
  onAdd: () => void;
  onChange: (id: string, patch: Partial<Pick<SermonHelperStepItem, "title" | "content">>) => void;
  onRemove: (id: string) => void;
}) {
  const manuscriptItems = items.filter((item) => item.kind === "manuscript");
  return (
    <section className="rounded-2xl border border-[#d9d3c8] bg-[#f7f4ed] p-5 sm:p-6" aria-labelledby="manuscript-points-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 id="manuscript-points-title" className="font-serif text-xl font-bold text-[#2a4338]">본문 대지 직접 쓰기</h3>
          <p className="mt-1 text-xs leading-5 text-[#6c7871]">최대 네 개의 대지를 직접 구성합니다. AI가 본문 원고를 대신 생성하지 않습니다.</p>
        </div>
        <button type="button" onClick={onAdd} disabled={manuscriptItems.length >= 4} className="inline-flex min-h-11 items-center rounded-xl border border-[#b9ad9d] bg-white px-4 text-xs font-extrabold text-[#365146] hover:bg-[#fdf9f2] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838] disabled:cursor-not-allowed disabled:opacity-45">대지 추가 +</button>
      </div>
      <div className="mt-5 space-y-4">
        {manuscriptItems.length ? manuscriptItems.map((item, index) => (
          <article key={item.id} className="rounded-2xl border border-[#d6cfc4] bg-white p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <h4 className="text-sm font-extrabold text-[#2f493e]">대지 {index + 1}</h4>
              <button type="button" onClick={() => onRemove(item.id)} className="min-h-10 rounded-lg px-3 text-xs font-bold text-[#9a4635] hover:bg-[#fff0eb] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838]">대지 삭제</button>
            </div>
            <label className="mt-3 block text-xs font-bold text-[#53645c]" htmlFor={`manuscript-title-${item.id}`}>대지 제목</label>
            <input id={`manuscript-title-${item.id}`} type="text" value={item.title} onChange={(event) => onChange(item.id, { title: event.target.value })} placeholder="이 대지가 전할 한 문장" className="mt-2 min-h-12 w-full rounded-xl border border-[#d5cfc3] bg-[#fffdf9] px-4 text-sm outline-none focus:border-[#7b978a] focus:ring-4 focus:ring-[#7b978a]/12" />
            <label className="mt-4 block text-xs font-bold text-[#53645c]" htmlFor={`manuscript-content-${item.id}`}>대지 원고</label>
            <textarea id={`manuscript-content-${item.id}`} value={item.content} onChange={(event) => onChange(item.id, { content: event.target.value })} placeholder="본문 설명과 목회적 연결을 직접 작성하세요." rows={10} className="mt-2 min-h-64 w-full resize-y rounded-xl border border-[#d5cfc3] bg-[#fffdf9] px-4 py-3 font-serif text-base leading-8 text-[#30443b] outline-none focus:border-[#7b978a] focus:ring-4 focus:ring-[#7b978a]/12" />
          </article>
        )) : (
          <div className="rounded-2xl border border-dashed border-[#c9c0b3] bg-white px-5 py-8 text-center">
            <p className="text-sm font-bold text-[#4a5d55]">아직 작성한 대지가 없습니다</p>
            <p className="mt-1 text-xs leading-5 text-[#7c8580]">대지를 추가하고 목회자의 언어로 직접 원고를 써주세요.</p>
          </div>
        )}
      </div>
    </section>
  );
}

function ProvenancePanel({
  entries,
  stepId,
  onChange,
}: {
  entries: readonly SermonHelperProvenanceEntry[];
  stepId: SermonHelperStepId;
  onChange: (entries: SermonHelperProvenanceEntry[]) => void;
}) {
  const [sourceType, setSourceType] = useState<"pastor" | "scripture" | "external_source">("external_source");
  const [label, setLabel] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const stepEntries = entries.filter((entry) => entry.stepId === stepId);

  function addEntry() {
    const normalizedLabel = label.trim();
    if (!normalizedLabel) return;
    const next: SermonHelperProvenanceEntry = {
      id: crypto.randomUUID(),
      stepId,
      sourceType,
      label: normalizedLabel.slice(0, 240),
      ...(sourceUrl.trim() ? { sourceUrl: sourceUrl.trim().slice(0, 2_048) } : {}),
      ...(excerpt.trim() ? { excerpt: excerpt.trim().slice(0, 4_000) } : {}),
      verified: sourceType === "pastor",
      createdAt: new Date().toISOString(),
    };
    onChange([...entries, next]);
    setLabel("");
    setSourceUrl("");
    setExcerpt("");
  }

  function updateEntry(id: string, patch: Partial<SermonHelperProvenanceEntry>) {
    onChange(entries.map((entry) => entry.id === id ? { ...entry, ...patch } : entry));
  }

  return (
    <section className="rounded-2xl border border-[#d9d3c8] bg-white p-5 sm:p-6" aria-labelledby="helper-sources-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="helper-sources-title" className="font-serif text-xl font-bold text-[#2a4338]">근거와 출처 기록</h3>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-[#6c7871]">
            직접 읽은 성경·주석·논문과 목회자의 판단을 구분해 남기고, 원문을 확인한 뒤 확인 표시를 해주세요.
          </p>
        </div>
        <span className="rounded-full bg-[#edf3ee] px-3 py-1.5 text-[10px] font-extrabold text-[#456353]">이 단계 {stepEntries.length}개</span>
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-[10rem_minmax(0,1fr)]">
        <label className="text-xs font-extrabold text-[#465b51]">
          자료 종류
          <select value={sourceType} onChange={(event) => setSourceType(event.target.value as typeof sourceType)} className="mt-2 min-h-11 w-full rounded-xl border border-[#d5cfc3] bg-[#fffdf9] px-3 text-sm outline-none focus:border-[#7b978a] focus:ring-4 focus:ring-[#7b978a]/12">
            <option value="external_source">외부 자료</option>
            <option value="scripture">성경 본문</option>
            <option value="pastor">목회자 판단</option>
          </select>
        </label>
        <label className="text-xs font-extrabold text-[#465b51]">
          자료 이름
          <input value={label} onChange={(event) => setLabel(event.target.value)} maxLength={240} placeholder="예: NICNT 요한복음 주석 3장" className="mt-2 min-h-11 w-full rounded-xl border border-[#d5cfc3] bg-[#fffdf9] px-3 text-sm outline-none focus:border-[#7b978a] focus:ring-4 focus:ring-[#7b978a]/12" />
        </label>
        <label className="text-xs font-extrabold text-[#465b51] lg:col-span-2">
          원문 주소 <span className="font-medium text-[#7d8882]">(선택)</span>
          <input type="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://" className="mt-2 min-h-11 w-full rounded-xl border border-[#d5cfc3] bg-[#fffdf9] px-3 text-sm outline-none focus:border-[#7b978a] focus:ring-4 focus:ring-[#7b978a]/12" />
        </label>
        <label className="text-xs font-extrabold text-[#465b51] lg:col-span-2">
          확인할 핵심 내용 <span className="font-medium text-[#7d8882]">(선택)</span>
          <textarea value={excerpt} onChange={(event) => setExcerpt(event.target.value)} rows={3} maxLength={4_000} placeholder="인용하려는 문장 또는 직접 확인할 핵심을 적어주세요." className="mt-2 w-full resize-y rounded-xl border border-[#d5cfc3] bg-[#fffdf9] px-3 py-3 text-sm leading-6 outline-none focus:border-[#7b978a] focus:ring-4 focus:ring-[#7b978a]/12" />
        </label>
      </div>
      <button type="button" onClick={addEntry} disabled={!label.trim()} className="mt-3 inline-flex min-h-11 items-center rounded-xl bg-[#315647] px-4 text-xs font-extrabold text-white hover:bg-[#24483a] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838] disabled:cursor-not-allowed disabled:opacity-45">근거 추가</button>

      {stepEntries.length ? (
        <ul className="mt-5 space-y-2">
          {stepEntries.map((entry) => (
            <li key={entry.id} className="rounded-xl border border-[#ddd6cb] bg-[#faf8f3] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="text-sm text-[#2f493e]">{entry.label}</strong>
                    <span className={`rounded-full px-2 py-1 text-[9px] font-black ${entry.sourceType === "ai_suggestion" ? "bg-[#f6e9d7] text-[#8c572d]" : "bg-[#e4ece6] text-[#42614f]"}`}>
                      {entry.sourceType === "scripture" ? "성경" : entry.sourceType === "external_source" ? "외부 자료" : entry.sourceType === "ai_suggestion" ? "AI 제안" : "목회자 판단"}
                    </span>
                  </div>
                  {entry.excerpt ? <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-[#627068]">{entry.excerpt}</p> : null}
                  {entry.sourceUrl ? <a href={entry.sourceUrl} target="_blank" rel="noreferrer" className="mt-2 block break-words text-xs font-bold text-[#356854] underline underline-offset-2">원문 열기</a> : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-[#cfc7bb] bg-white px-3 text-[10px] font-extrabold text-[#4f6158]">
                    <input type="checkbox" checked={entry.verified} onChange={(event) => updateEntry(entry.id, { verified: event.target.checked })} className="size-4 accent-[#315746]" />
                    원문 확인
                  </label>
                  <button type="button" onClick={() => onChange(entries.filter((item) => item.id !== entry.id))} className="min-h-10 rounded-lg px-3 text-[10px] font-extrabold text-[#994838] hover:bg-[#fff0eb] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838]">삭제</button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-5 rounded-xl border border-dashed border-[#cec6ba] bg-[#faf8f3] px-4 py-5 text-center text-xs font-semibold leading-5 text-[#748079]">이 단계에 기록한 근거가 아직 없습니다.</p>
      )}
    </section>
  );
}

function CoachPanel({
  project,
  clientUserScope,
  tier,
  newRequestEngineReady,
  engineAvailabilityMessage,
  onEngineAvailabilityInvalidated,
  onTierChange,
  onAdopt,
  onPendingChange,
}: {
  project: SermonHelperProject;
  clientUserScope: string;
  tier: AiEngineTier;
  newRequestEngineReady: boolean;
  engineAvailabilityMessage: string | null;
  onEngineAvailabilityInvalidated: () => void;
  onTierChange: (tier: AiEngineTier) => void;
  onAdopt: (
    stepId: SermonHelperStepId,
    suggestion: SermonHelperCoachSuggestion,
    citedSourceIds: readonly string[],
  ) => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const [mode, setMode] = useState<SermonHelperCoachMode>("question");
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<SermonHelperCoachApiResponse | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [writeItemId, setWriteItemId] = useState("");
  const [writeExcerpt, setWriteExcerpt] = useState("");
  const [storedRetry, setStoredRetry] = useState<StoredSermonHelperCoachRetry | null>(null);
  const [acceptedIds, setAcceptedIds] = useState<Set<string>>(() => new Set());
  const [backgroundRun, setBackgroundRun] =
    useState<BackgroundAiRunState | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const retryRequestRef = useRef<{
    messageId: string;
    payloadKey: string;
  } | null>(null);
  const storedRetryRef = useRef<StoredSermonHelperCoachRetry | null>(null);
  const stepId = project.currentStepId;
  const step = project.steps[stepId];
  const writeItems = stepId === "write"
    ? step.items.filter((item) => item.kind === "manuscript")
    : [];
  const selectedWriteItem = writeItems.find((item) => item.id === writeItemId);
  const retryStorageKey = useMemo(
    () => sermonHelperCoachRetryStorageKey(clientUserScope, project.id),
    [clientUserScope, project.id],
  );
  const coachInputsLocked = pending || Boolean(storedRetry);
  const runKey = `helper-coach:${project.id}`;

  const clearStoredRetry = useCallback(() => {
    storedRetryRef.current = null;
    retryRequestRef.current = null;
    setStoredRetry(null);
    if (!retryStorageKey || typeof window === "undefined") return;
    try {
      window.sessionStorage.removeItem(retryStorageKey);
    } catch {
      // The in-memory key is still cleared if storage becomes unavailable.
    }
  }, [retryStorageKey]);

  const persistStoredRetry = useCallback((record: StoredSermonHelperCoachRetry): boolean => {
    if (!retryStorageKey || typeof window === "undefined") return false;
    try {
      window.sessionStorage.setItem(retryStorageKey, JSON.stringify(record));
    } catch {
      return false;
    }
    storedRetryRef.current = record;
    setStoredRetry(record);
    return true;
  }, [retryStorageKey]);

  useEffect(
    () =>
      subscribeBackgroundAiRun((state) => {
        const own = state?.key === runKey ? state : null;
        setBackgroundRun(own);
        if (!own) return;
        if (own.status === "running") {
          setPending(true);
          setError(null);
          return;
        }
        setPending(false);
        if (own.status === "completed") {
          const completed = own.result as SermonHelperCoachApiResponse | null;
          if (completed?.answer && Array.isArray(completed.suggestions)) {
            clearStoredRetry();
            setResult(completed);
            setError(null);
          }
          return;
        }
        setError(
          own.error ||
            (own.status === "stopped"
              ? "AI 코치 요청을 중지했습니다. 작성 중인 내용은 그대로 보존됩니다."
              : "AI 코치가 응답하지 못했습니다."),
        );
      }),
    [clearStoredRetry, runKey],
  );

  useEffect(() => {
    onPendingChange(pending || Boolean(storedRetry));
  }, [onPendingChange, pending, storedRetry]);

  useEffect(() => () => {
    onPendingChange(false);
  }, [onPendingChange]);

  useEffect(() => {
    setResult(null);
    setError(null);
    setAcceptedIds(new Set());
    setPrompt("");
    setWriteItemId("");
    setWriteExcerpt("");
    retryRequestRef.current = null;
  }, [stepId]);

  useEffect(() => {
    if (!retryStorageKey || typeof window === "undefined") return;
    let raw: string | null = null;
    try {
      raw = window.sessionStorage.getItem(retryStorageKey);
    } catch {
      return;
    }
    if (!raw) return;
    const recovered = parseStoredSermonHelperCoachRetry({
      raw,
      projectId: project.id,
    });
    if (!recovered) {
      try {
        window.sessionStorage.removeItem(retryStorageKey);
      } catch {
        // Invalid or expired state is ignored even if removal is blocked.
      }
      return;
    }
    storedRetryRef.current = recovered;
    setStoredRetry(recovered);
    sessionIdRef.current = recovered.request.sessionId;
    const { messageId, ...payloadWithoutMessageId } = recovered.request;
    retryRequestRef.current = {
      messageId,
      payloadKey: JSON.stringify(payloadWithoutMessageId),
    };
    setMode(recovered.request.mode);
    setPrompt(recovered.request.prompt ?? "");
    onPendingChange(true);
    onTierChange(recovered.request.tier);
    if (recovered.request.stepId === "write") {
      setWriteItemId(recovered.request.step.items[0]?.id ?? "");
      setWriteExcerpt(recovered.request.step.items[0]?.content ?? "");
    }
  }, [onPendingChange, onTierChange, project.id, retryStorageKey]);

  async function requestCoach() {
    if (pending) return;
    let recovered = storedRetryRef.current;
    if (recovered) {
      const stillValid = parseStoredSermonHelperCoachRetry({
        raw: JSON.stringify(recovered),
        projectId: project.id,
      });
      if (!stillValid) {
        clearStoredRetry();
        recovered = null;
      } else {
        recovered = stillValid;
      }
    }
    if (!recovered && stepId === "write" && (!selectedWriteItem || !writeExcerpt.trim())) {
      setError("AI 코치에게 보낼 대지와 2,500자 이하의 검토 범위를 먼저 선택해 주세요.");
      return;
    }
    if (!recovered && !newRequestEngineReady) {
      setError(
        engineAvailabilityMessage ??
          "현재 AI 코치에 사용할 수 있는 엔진이 없습니다.",
      );
      return;
    }
    if (!sessionIdRef.current) {
      sessionIdRef.current = recovered?.request.sessionId ?? crypto.randomUUID();
    }
    setPending(true);
    setError(null);
    setResult(null);
    try {
      let exactRequest = recovered?.request;
      if (!exactRequest) {
        const sources = project.provenance
          .flatMap((entry) => {
            if (entry.stepId !== stepId || entry.sourceType === "ai_suggestion") return [];
            return [{
              id: entry.id,
              stepId: entry.stepId,
              sourceType: entry.sourceType,
              label: entry.label,
              ...(entry.sourceTitle ? { sourceTitle: entry.sourceTitle } : {}),
              ...(entry.sourceUrl ? { sourceUrl: entry.sourceUrl } : {}),
              ...(entry.excerpt ? { excerpt: entry.excerpt.slice(0, 1_000) } : {}),
              verified: entry.verified,
            }];
          })
          .slice(0, 8);
        const coachPayload = {
          projectId: project.id,
          sessionId: sessionIdRef.current,
          tier,
          mode,
          stepId,
          step: {
            completed: step.completed,
            notes: stepId === "write" ? "" : step.notes,
            fields: stepId === "write" ? {} : step.fields,
            items: stepId === "write" && selectedWriteItem
              ? [{ ...selectedWriteItem, content: writeExcerpt.trim() }]
              : step.items,
          },
          ...(prompt.trim() ? { prompt: prompt.trim() } : {}),
          context: {
            projectTitle: project.title,
            scripture: project.scripture,
            audience: project.steps.brief.fields.audience ?? "",
            occasion: project.steps.brief.fields.occasion ?? "",
          },
          sources,
        };
        const payloadKey = JSON.stringify(coachPayload);
        const retainedRequest = retryRequestRef.current;
        const messageId = retainedRequest?.payloadKey === payloadKey
          ? retainedRequest.messageId
          : crypto.randomUUID();
        retryRequestRef.current = { messageId, payloadKey };
        const record = createStoredSermonHelperCoachRetry({
          request: { ...coachPayload, messageId },
          projectId: project.id,
        });
        if (!record) {
          throw new Error("AI 코치에게 보낼 현재 단계와 검토 범위를 확인해 주세요.");
        }
        if (!persistStoredRetry(record)) {
          throw new Error(
            "안전한 재시도를 위해 이 탭의 임시 저장소를 사용할 수 있어야 합니다. 브라우저 설정을 확인해 주세요.",
          );
        }
        exactRequest = record.request;
      }
      const handle = startBackgroundAiRun<SermonHelperCoachApiResponse>({
        id: exactRequest.messageId,
        key: runKey,
        kind: "helper-coach",
        label: "설교도우미 AI 코치",
        targetHref: `/sermon-helper?id=${encodeURIComponent(project.id)}`,
        context: { projectId: project.id, stepId: exactRequest.stepId },
        execute: async (signal) => {
          const response = await fetch("/api/sermon-helper/coach", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal,
            body: JSON.stringify(exactRequest),
          });
          const body = await responseBody(response);
          notifyWalletFromApiBody(body);
          if (
            body.code === "ai_engine_disabled" ||
            body.code === "ai_engine_unavailable" ||
            body.code === "ai_engine_status_unavailable"
          ) {
            onEngineAvailabilityInvalidated();
          }
          if (!response.ok) {
            const retryAction = classifyStoredSermonHelperCoachRetryResponse({
              status: response.status,
              code: body.code,
              requestState: body.requestState,
            });
            if (retryAction === "clear") {
              clearStoredRetry();
            } else if (retryAction === "rotate") {
              const rotated = createStoredSermonHelperCoachRetry({
                request: { ...exactRequest, messageId: crypto.randomUUID() },
                projectId: project.id,
              });
              if (rotated) {
                retryRequestRef.current = null;
                persistStoredRetry(rotated);
              }
            }
            throw new Error(asMessage(body, "AI 코치가 응답하지 못했습니다."));
          }
          if (
            typeof body.answer !== "string" ||
            !Array.isArray(body.suggestions) ||
            !Array.isArray(body.warnings)
          ) {
            throw new Error("AI 코치 응답 형식을 확인하지 못했습니다.");
          }
          return body as unknown as SermonHelperCoachApiResponse;
        },
        errorMessage: (caught) =>
          caught instanceof Error ? caught.message : "AI 코치가 응답하지 못했습니다.",
      });
      const nextResult = await handle.promise;
      clearStoredRetry();
      setResult(nextResult);
    } catch (caught) {
      setError(
        caught instanceof DOMException && caught.name === "AbortError"
          ? "AI 코치 요청을 중지했습니다. 작성 중인 내용은 그대로 보존됩니다."
          : caught instanceof BackgroundAiRunBusyError
            ? caught.message
          : caught instanceof Error
            ? caught.message
            : "AI 코치가 응답하지 못했습니다.",
      );
    } finally {
      setPending(false);
    }
  }

  function adopt(suggestion: SermonHelperCoachSuggestion) {
    if (!result || acceptedIds.has(suggestion.id)) return;
    onAdopt(
      result.stepId,
      suggestion,
      result.citations.map((citation) => citation.sourceId),
    );
    setAcceptedIds((current) => new Set(current).add(suggestion.id));
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-[#d4c9b9] bg-[#fffaf2]" aria-labelledby="helper-coach-title">
      <div className="bg-[#2a4b3e] px-5 py-5 text-white sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-black tracking-[.16em] text-white uppercase">AI coach · 제안만 제공</p>
            <h3 id="helper-coach-title" className="mt-2 font-serif text-xl font-bold text-white">AI에게 다음 생각의 실마리 묻기</h3>
            <p className="mt-2 max-w-2xl text-xs leading-5 text-white">전체 원고를 만들지 않습니다. 제안은 아래에서 직접 채택해야 작업에 들어갑니다.</p>
          </div>
          <span className="rounded-full border border-white/25 bg-white/10 px-3 py-2 text-[10px] font-extrabold text-white">
            {AI_ENGINE_TIER_META[tier].label} · 요청당 {SERMON_HELPER_COACH_COSTS[tier]}토큰
          </span>
        </div>
      </div>

      <div className="p-5 sm:p-6">
        {engineAvailabilityMessage && !storedRetry ? (
          <p
            id="helper-coach-request-engine-status"
            role="status"
            className="mb-5 rounded-xl border border-[#e4c494] bg-[#fff5e7] px-4 py-3 text-xs font-bold leading-5 text-[#805326]"
          >
            {engineAvailabilityMessage}
          </p>
        ) : null}
        <fieldset>
          <legend className="text-xs font-extrabold text-[#53645c]">도움 방식</legend>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {COACH_MODES.map((item) => (
              <button key={item.id} type="button" aria-pressed={mode === item.id} onClick={() => setMode(item.id)} disabled={coachInputsLocked} className={`min-h-20 rounded-xl border p-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838] disabled:cursor-not-allowed disabled:opacity-60 ${mode === item.id ? "border-[#486c5c] bg-[#e7f0e9] text-[#294f3f]" : "border-[#ddd4c8] bg-white text-[#647169] hover:bg-[#f9f6ef]"}`}>
                <strong className="block text-xs">{item.label}</strong>
                <span className="mt-1 block text-[10px] leading-4">{item.description}</span>
              </button>
            ))}
          </div>
        </fieldset>
        {stepId === "write" ? (
          <section className="mt-5 rounded-xl border border-[#d8d1c5] bg-white p-4" aria-labelledby="coach-write-range-title">
            <h4 id="coach-write-range-title" className="text-xs font-extrabold text-[#3f574c]">AI가 읽을 대지와 범위 선택</h4>
            <p className="mt-1 text-[10px] leading-4 text-[#78827d]">
              직접 쓴 전체 원고는 자동으로 보내지 않습니다. 대지 하나를 고른 뒤 검토할 부분만 2,500자 이내로 옮겨 주세요.
            </p>
            <label htmlFor="coach-write-item" className="mt-4 block text-xs font-bold text-[#53645c]">검토할 대지</label>
            <select
              id="coach-write-item"
              value={writeItemId}
              onChange={(event) => {
                setWriteItemId(event.target.value);
                setWriteExcerpt("");
                retryRequestRef.current = null;
              }}
              disabled={coachInputsLocked}
              className="mt-2 min-h-11 w-full rounded-xl border border-[#d5cfc3] bg-white px-3 text-sm text-[#344a40] outline-none focus:border-[#7b978a] focus:ring-4 focus:ring-[#7b978a]/12"
            >
              <option value="">대지를 선택하세요</option>
              {writeItems.map((item, index) => (
                <option key={item.id} value={item.id}>대지 {index + 1} · {item.title || "제목 없음"}</option>
              ))}
            </select>
            {selectedWriteItem ? (
              <>
                <p className="mt-4 text-xs font-bold text-[#53645c]">원문을 보고 필요한 부분을 선택하세요</p>
                <textarea
                  readOnly
                  aria-label="선택한 대지 원문"
                  value={selectedWriteItem.content || "아직 작성한 원고가 없습니다."}
                  rows={7}
                  className="mt-2 max-h-52 w-full resize-y rounded-xl border border-[#e0dbd2] bg-[#faf8f3] p-3 font-serif text-sm leading-6 text-[#43554d] outline-none focus:border-[#7b978a] focus:ring-4 focus:ring-[#7b978a]/12"
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setWriteExcerpt(
                      selectedWriteItem.content.slice(
                        0,
                        SERMON_HELPER_COACH_WRITE_EXCERPT_MAX_CHARACTERS,
                      ),
                    )}
                    disabled={!selectedWriteItem.content || coachInputsLocked}
                    className="min-h-9 rounded-lg border border-[#c9c0b3] bg-[#faf8f3] px-3 text-[10px] font-bold text-[#52645b] disabled:opacity-45"
                  >
                    {selectedWriteItem.content.length <= 2_500 ? "전체를 검토 범위로 복사" : "앞 2,500자를 검토 범위로 복사"}
                  </button>
                  {selectedWriteItem.content.length > 2_500 ? (
                    <button
                      type="button"
                      onClick={() => setWriteExcerpt(
                        selectedWriteItem.content.slice(
                          -SERMON_HELPER_COACH_WRITE_EXCERPT_MAX_CHARACTERS,
                        ),
                      )}
                      disabled={coachInputsLocked}
                      className="min-h-9 rounded-lg border border-[#c9c0b3] bg-[#faf8f3] px-3 text-[10px] font-bold text-[#52645b]"
                    >
                      뒤 2,500자를 검토 범위로 복사
                    </button>
                  ) : null}
                </div>
                <label htmlFor="coach-write-excerpt" className="mt-4 block text-xs font-bold text-[#53645c]">AI에 보낼 검토 범위</label>
                <textarea
                  id="coach-write-excerpt"
                  value={writeExcerpt}
                  onChange={(event) => {
                    setWriteExcerpt(event.target.value);
                    retryRequestRef.current = null;
                  }}
                  rows={6}
                  maxLength={SERMON_HELPER_COACH_WRITE_EXCERPT_MAX_CHARACTERS}
                  disabled={coachInputsLocked}
                  placeholder="위 원문에서 검토할 문단이나 문장을 복사해 넣으세요."
                  className="mt-2 w-full resize-y rounded-xl border border-[#d5cfc3] bg-white px-4 py-3 font-serif text-sm leading-6 text-[#344a40] outline-none focus:border-[#7b978a] focus:ring-4 focus:ring-[#7b978a]/12"
                />
                <p className="mt-1 text-right text-[10px] font-semibold text-[#7b6b5a]">{writeExcerpt.length.toLocaleString("ko-KR")} / 2,500자</p>
              </>
            ) : null}
          </section>
        ) : null}
        <label htmlFor="helper-coach-prompt" className="mt-5 block text-xs font-extrabold text-[#53645c]">묻고 싶은 내용 <span className="font-medium text-[#7f8984]">(선택)</span></label>
        <textarea id="helper-coach-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={3} maxLength={1_000} disabled={coachInputsLocked} placeholder="예: 제가 적은 관찰에서 성급하게 해석한 부분을 질문으로 짚어주세요." className="mt-2 w-full resize-y rounded-xl border border-[#d5cfc3] bg-white px-4 py-3 text-sm leading-6 outline-none focus:border-[#7b978a] focus:ring-4 focus:ring-[#7b978a]/12 disabled:cursor-not-allowed disabled:bg-[#f3f0e9]" />
        {storedRetry && !pending ? (
          <p role="status" className="mt-3 rounded-xl border border-[#e4c494] bg-[#fff5e7] px-4 py-3 text-xs font-bold leading-5 text-[#805326]">
            이전 요청의 결과가 확정되지 않아 같은 요청 ID와 내용을 이 탭에 보관했습니다. 입력을 바꾸지 않고 아래 버튼을 눌러 결과 또는 환불 상태를 확인해 주세요.
          </p>
        ) : null}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {pending ? (
            <button type="button" onClick={() => stopBackgroundAiRun(backgroundRun?.id)} className="inline-flex min-h-11 items-center rounded-xl border border-[#a14736] bg-white px-4 text-xs font-extrabold text-[#9a4635] hover:bg-[#fff0eb] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838]">응답 중지</button>
          ) : (
            <button
              type="button"
              onClick={() => void requestCoach()}
              disabled={!storedRetry && !newRequestEngineReady}
              aria-describedby={!storedRetry && engineAvailabilityMessage ? "helper-coach-request-engine-status" : undefined}
              className="inline-flex min-h-11 items-center rounded-xl bg-[#315647] px-4 text-xs font-extrabold text-white hover:bg-[#24483a] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838] disabled:cursor-not-allowed disabled:opacity-45"
            >
              {storedRetry ? "이전 요청 결과 확인" : `${SERMON_HELPER_COACH_COSTS[tier]}토큰으로 제안 받기`}
            </button>
          )}
          <p className="text-[10px] font-semibold leading-4 text-[#7b6b5a]">실행할 때만 {SERMON_HELPER_COACH_COSTS[tier]}토큰이 차감됩니다. 제안 채택은 추가 차감이 없습니다.</p>
        </div>

        {pending ? <p role="status" className="mt-4 rounded-xl bg-[#edf3ee] px-4 py-3 text-xs font-bold text-[#476052]">현재 단계만 읽고 제안을 준비하고 있습니다.</p> : null}
        {error ? <p role="alert" className="mt-4 rounded-xl border border-[#e6b5a8] bg-[#fff0eb] px-4 py-3 text-xs font-semibold leading-5 text-[#934130]">{error}</p> : null}

        {result ? (
          <div className="mt-5 space-y-4" aria-live="polite">
            {result.stepId !== stepId ? (
              <p className="rounded-xl border border-[#e4c494] bg-[#fff5e7] px-4 py-3 text-xs font-bold leading-5 text-[#805326]">
                이 응답은 {STEP_DEFINITIONS.find((definition) => definition.id === result.stepId)?.shortLabel ?? result.stepId} 단계에서 요청한 결과입니다. 채택하면 그 단계에만 저장됩니다.
              </p>
            ) : null}
            <div className="rounded-xl border border-[#d8d1c5] bg-white p-4">
              <p className="text-[10px] font-black tracking-[.12em] text-[#9b6332]">COACH RESPONSE</p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#3f5149]">{result.answer}</p>
            </div>
            <ul className="grid gap-3 lg:grid-cols-2">
              {result.suggestions.map((suggestion) => {
                const accepted = acceptedIds.has(suggestion.id);
                return (
                  <li key={suggestion.id} className="flex flex-col rounded-xl border border-[#d8d1c5] bg-white p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <strong className="text-sm text-[#2e493d]">{suggestion.title}</strong>
                      <span className="rounded-full bg-[#edf3ee] px-2 py-1 text-[9px] font-black text-[#567164]">신뢰도 {suggestion.confidence === "high" ? "높음" : suggestion.confidence === "medium" ? "보통" : "낮음"}</span>
                    </div>
                    <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[#4f6058]">{suggestion.content}</p>
                    <p className="mt-2 text-[10px] leading-4 text-[#7c8781]">제안 이유: {suggestion.reason}</p>
                    <button type="button" onClick={() => adopt(suggestion)} disabled={accepted} className="mt-4 inline-flex min-h-10 items-center justify-center self-start rounded-lg bg-[#315647] px-3 text-[10px] font-extrabold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838] disabled:bg-[#dfe8e2] disabled:text-[#496456]">{accepted ? "✓ 내 작업에 채택됨" : "내 작업에 채택"}</button>
                  </li>
                );
              })}
            </ul>
            {result.uncertainties.length ? (
              <div className="rounded-xl border border-[#e4cba8] bg-[#fff5e7] p-4">
                <strong className="text-xs text-[#805326]">직접 확인할 불확실성</strong>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-[#735c43]">{result.uncertainties.map((item) => <li key={item}>{item}</li>)}</ul>
              </div>
            ) : null}
            {result.citations.length ? (
              <div className="rounded-xl border border-[#d8d1c5] bg-white p-4">
                <strong className="text-xs text-[#395448]">연결된 사용자 출처</strong>
                <ul className="mt-2 space-y-2 text-xs leading-5 text-[#5e6d66]">{result.citations.map((citation) => <li key={`${citation.sourceId}-${citation.claim}`}><span className="font-bold">{citation.label}</span> · {citation.claim}{citation.verified ? " · 원문 확인됨" : " · 원문 확인 필요"}</li>)}</ul>
              </div>
            ) : null}
            <p className="rounded-xl bg-[#f2eee6] px-4 py-3 text-[10px] font-semibold leading-4 text-[#746858]">{result.warnings.map((warning) => warning.message).join(" ")}</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function SermonHelperClient({
  initialProjectId,
  clientUserScope,
}: {
  initialProjectId: string | null;
  clientUserScope: string;
}) {
  const router = useRouter();
  const {
    engineAvailability,
    engineAvailabilityStatus,
    availableEngineTiersFor,
    isEngineTierAvailableFor,
    engineAvailabilityNoticeFor,
    reloadEngineAvailability,
  } = useAiAgent();
  const selectableCoachTiers = useMemo(
    () => availableEngineTiersFor("coach"),
    [availableEngineTiersFor],
  );
  const coachEngineAvailabilityMessage = engineAvailabilityNoticeFor("coach");
  const [screenState, setScreenState] = useState<ScreenState>(initialProjectId ? "loading" : "start");
  const [recentItems, setRecentItems] = useState<SermonHelperProjectSummary[]>([]);
  const [recentLoading, setRecentLoading] = useState(!initialProjectId);
  const [project, setProject] = useState<SermonHelperProject | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [coachPending, setCoachPending] = useState(false);
  const [aiTier, setAiTier] = useState<AiEngineTier>("basic");
  const [normalizingScripture, setNormalizingScripture] = useState(false);
  const [normalizationBackgroundRun, setNormalizationBackgroundRun] =
    useState<BackgroundAiRunState | null>(null);
  const [normalizationError, setNormalizationError] = useState<string | null>(null);
  const [normalizationCandidate, setNormalizationCandidate] = useState<string | null>(null);
  const [pendingNavigationHref, setPendingNavigationHref] = useState<string | null>(null);
  const deletingRef = useRef(false);
  const guardedHrefRef = useRef("");
  const projectRef = useRef<SermonHelperProject | null>(null);
  const serverVersionRef = useRef(0);
  const serverUpdatedAtRef = useRef("");
  const editRevisionRef = useRef(0);
  const hasUnsavedRef = useRef(false);
  const savingRef = useRef(false);
  const dirtyStepsRef = useRef(new Set<SermonHelperStepId>());
  const coachEngineReady =
    engineAvailabilityStatus === "ready" &&
    isEngineTierAvailableFor(aiTier, "coach");

  useEffect(
    () =>
      subscribeBackgroundAiRun((state) => {
        const currentProject = projectRef.current;
        const key = currentProject
          ? `scripture-normalization:${currentProject.id}`
          : "";
        const own = key && state?.key === key ? state : null;
        setNormalizationBackgroundRun(own);
        if (!own) return;
        if (own.status === "running") {
          setNormalizingScripture(true);
          setNormalizationError(null);
          return;
        }
        setNormalizingScripture(false);
        const expectedInput =
          typeof own.context.input === "string" ? own.context.input : "";
        if (
          !currentProject ||
          currentProject.id !== own.context.projectId ||
          currentProject.scripture.trim() !== expectedInput
        ) {
          return;
        }
        if (own.status === "completed") {
          const completed = own.result as NormalizeScriptureResponse | null;
          if (!completed?.normalizedByAi) {
            setNormalizationError(
              "선택한 엔진에서는 AI 본문 확인을 사용할 수 없어 입력을 그대로 보존했습니다. 성경 원문에서 범위를 직접 확인해 주세요.",
            );
          } else {
            setNormalizationCandidate(completed.scripture);
            setNormalizationError(null);
          }
          return;
        }
        setNormalizationError(
          own.error ||
            (own.status === "stopped"
              ? "본문 확인을 중지했습니다. 입력은 그대로 보존됩니다."
              : "성경 본문 표기를 확인하지 못했습니다."),
        );
      }),
    [project?.id],
  );

  useEffect(() => {
    if (
      coachPending ||
      engineAvailabilityStatus !== "ready" ||
      !selectableCoachTiers.length ||
      isEngineTierAvailableFor(aiTier, "coach")
    ) {
      return;
    }
    setAiTier(selectableCoachTiers[0]!);
    setNormalizationCandidate(null);
    setNormalizationError(null);
  }, [
    aiTier,
    coachPending,
    engineAvailabilityStatus,
    isEngineTierAvailableFor,
    selectableCoachTiers,
  ]);

  const resetProject = useCallback((next: SermonHelperProject) => {
    projectRef.current = next;
    serverVersionRef.current = next.version;
    serverUpdatedAtRef.current = next.updatedAt;
    editRevisionRef.current = 0;
    hasUnsavedRef.current = false;
    savingRef.current = false;
    dirtyStepsRef.current.clear();
    deletingRef.current = false;
    if (typeof window !== "undefined") {
      guardedHrefRef.current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    }
    setProject(next);
    setSaveState("saved");
    setError(null);
    setNormalizationError(null);
    setNormalizationCandidate(null);
    setScreenState("workspace");
  }, []);

  const loadRecent = useCallback(async () => {
    setScreenState("start");
    setRecentLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/sermon-helper?limit=20", { cache: "no-store" });
      const body = await responseBody(response);
      if (!response.ok) throw new Error(asMessage(body, "최근 설교 준비를 불러오지 못했습니다."));
      setRecentItems(Array.isArray(body.items) ? body.items as SermonHelperProjectSummary[] : []);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "최근 설교 준비를 불러오지 못했습니다.");
    } finally {
      setRecentLoading(false);
    }
  }, []);

  const loadProject = useCallback(async (id: string) => {
    setScreenState("loading");
    setError(null);
    try {
      const response = await fetch(`/api/sermon-helper/${encodeURIComponent(id)}`, { cache: "no-store" });
      const body = await responseBody(response);
      const item = safeProject(body.item);
      if (!response.ok || !item) throw new Error(asMessage(body, "설교 준비를 불러오지 못했습니다."));
      if (item.status === "completed" && item.completedSermonId) {
        router.replace(`/history/${encodeURIComponent(item.completedSermonId)}`);
        return;
      }
      resetProject(item);
    } catch (nextError) {
      setScreenState("error");
      setError(nextError instanceof Error ? nextError.message : "설교 준비를 불러오지 못했습니다.");
    }
  }, [resetProject, router]);

  useEffect(() => {
    if (initialProjectId) void loadProject(initialProjectId);
    else void loadRecent();
  }, [initialProjectId, loadProject, loadRecent]);

  const createProject = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      const response = await fetch("/api/sermon-helper", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "제목 없는 설교 준비", scripture: "" }),
      });
      const body = await responseBody(response);
      const item = safeProject(body.item);
      if (!response.ok || !item) throw new Error(asMessage(body, "새 설교 준비를 시작하지 못했습니다."));
      resetProject(item);
      router.replace(`/sermon-helper?id=${encodeURIComponent(item.id)}`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "새 설교 준비를 시작하지 못했습니다.");
    } finally {
      setCreating(false);
    }
  }, [creating, resetProject, router]);

  const mutateProject = useCallback((
    updater: (current: SermonHelperProject) => SermonHelperProject,
    dirtyStep?: SermonHelperStepId,
  ) => {
    const current = projectRef.current;
    if (!current || deletingRef.current) return;
    const updated = updater(current);
    const scriptureChanged = updated.scripture !== current.scripture;
    let next = clearSermonHelperScriptureVerification(current, updated);
    next = reconcileSermonHelperReview(current, next);
    if (scriptureChanged) dirtyStepsRef.current.add("observe");
    if (
      JSON.stringify(current.steps.review) !==
      JSON.stringify(next.steps.review)
    ) {
      dirtyStepsRef.current.add("review");
    }
    projectRef.current = next;
    setProject(next);
    editRevisionRef.current += 1;
    hasUnsavedRef.current = true;
    if (dirtyStep) dirtyStepsRef.current.add(dirtyStep);
    setSaveState("dirty");
    setError(null);
  }, []);

  const saveProject = useCallback(async (options?: { keepalive?: boolean }) => {
    if (deletingRef.current || savingRef.current || !hasUnsavedRef.current) return;
    const snapshot = projectRef.current;
    if (!snapshot) return;
    savingRef.current = true;
    setSaveState("saving");
    const revision = editRevisionRef.current;
    const dirtyStepIds = [...dirtyStepsRef.current];
    const steps = Object.fromEntries(
      dirtyStepIds.map((id) => {
        const step = snapshot.steps[id];
        const input: SermonHelperStepInput = {
          completed: step.completed,
          notes: step.notes,
          fields: step.fields,
          items: step.items,
        };
        return [id, input];
      }),
    );
    try {
      const response = await fetch(`/api/sermon-helper/${encodeURIComponent(snapshot.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedVersion: serverVersionRef.current,
          expectedUpdatedAt: serverUpdatedAtRef.current,
          patch: {
            title: snapshot.title || "제목 없는 설교 준비",
            scripture: snapshot.scripture,
            currentStepId: snapshot.currentStepId,
            ...(dirtyStepIds.length ? { steps } : {}),
            provenance: snapshot.provenance,
          },
        }),
        keepalive: options?.keepalive,
      });
      const body = await responseBody(response);
      if (response.status === 409) {
        setPendingNavigationHref(null);
        setSaveState("conflict");
        setError("다른 창에서 이 설교 준비가 수정되었습니다. 현재 입력은 화면에 보존했습니다. 서버 내용을 다시 불러온 뒤 계속해 주세요.");
        return;
      }
      const item = safeProject(body.item);
      if (!response.ok || !item) throw new Error(asMessage(body, "자동 저장하지 못했습니다."));
      serverVersionRef.current = item.version;
      serverUpdatedAtRef.current = item.updatedAt;
      setProject((current) => {
        if (!current || current.id !== item.id) return current;
        const next = { ...current, version: item.version, updatedAt: item.updatedAt };
        projectRef.current = next;
        return next;
      });
      if (revision === editRevisionRef.current) {
        hasUnsavedRef.current = false;
        dirtyStepsRef.current.clear();
        setSaveState("saved");
      } else {
        setSaveState("dirty");
      }
    } catch (nextError) {
      setPendingNavigationHref(null);
      setSaveState("error");
      setError(nextError instanceof Error ? nextError.message : "자동 저장하지 못했습니다. 입력은 현재 화면에 보존되어 있습니다.");
    } finally {
      savingRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!project || !hasUnsavedRef.current || saveState === "conflict") return;
    const timer = window.setTimeout(() => void saveProject(), 850);
    return () => window.clearTimeout(timer);
  }, [project, saveProject, saveState]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveProject();
      }
    }
    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") void saveProject({ keepalive: true });
    }
    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [saveProject]);

  useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (!hasUnsavedRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    }

    function handleNavigationClick(event: MouseEvent) {
      if (
        !hasUnsavedRef.current ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      const nextHref = `${url.pathname}${url.search}${url.hash}`;
      const currentHref = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (nextHref === currentHref) return;
      event.preventDefault();
      setPendingNavigationHref(nextHref);
      void saveProject();
    }

    function handlePopState(event: PopStateEvent) {
      if (!hasUnsavedRef.current || deletingRef.current) return;
      const targetHref = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      const guardedHref = guardedHrefRef.current;
      if (!guardedHref || targetHref === guardedHref) return;
      event.stopImmediatePropagation();
      window.history.pushState(
        { ...window.history.state, sermonHelperRestored: true },
        "",
        guardedHref,
      );
      setPendingNavigationHref(targetHref);
      void saveProject();
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("popstate", handlePopState, true);
    document.addEventListener("click", handleNavigationClick, true);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("popstate", handlePopState, true);
      document.removeEventListener("click", handleNavigationClick, true);
    };
  }, [saveProject]);

  useEffect(() => {
    if (
      !pendingNavigationHref ||
      saveState !== "saved" ||
      hasUnsavedRef.current ||
      savingRef.current
    ) return;
    const nextHref = pendingNavigationHref;
    setPendingNavigationHref(null);
    router.push(nextHref);
  }, [pendingNavigationHref, router, saveState]);

  const activeStep = project ? stepDefinition(project.currentStepId) : STEP_DEFINITIONS[0];
  const completedCount = project
    ? SERMON_HELPER_STEP_IDS.filter((id) => project.steps[id].completed).length
    : 0;

  const agentRegistration = useMemo(() => {
    if (!project) {
      return {
        surface: "sermon-helper" as const,
        title: "설교도우미 시작",
        snapshot: { helper: { mode: "start", recentWorkCount: recentItems.length } },
        capabilities: ["navigate" as const],
        suggestions: ["설교도우미의 여덟 단계를 설명해줘", "자동 설교 생성과 설교도우미의 차이를 알려줘"],
      };
    }
    const step = project.steps[project.currentStepId];
    return {
      surface: "sermon-helper" as const,
      title: `설교도우미 · ${activeStep.shortLabel}`,
      resourceId: project.id,
      version: project.version,
      snapshot: {
        helper: {
          title: project.title,
          scripture: project.scripture,
          currentStep: activeStep.shortLabel,
          completedSteps: completedCount,
          pastorNotes: step.notes.slice(0, 1_800),
          filledFields: Object.entries(step.fields).filter(([, value]) => value.trim()).map(([key]) => key),
          restriction: "목회자가 직접 작성하며 전체 원고 자동 생성은 허용하지 않습니다.",
        },
      },
      capabilities: ["navigate" as const],
      suggestions: ["지금 단계에서 제가 먼저 생각할 질문을 알려줘", "제 메모에서 더 깊이 묵상할 지점을 짚어줘"],
      executeAction: async (proposal: AgentActionProposal) => {
        const href = proposal.args.href;
        if (
          proposal.capability !== "navigate" ||
          typeof href !== "string" ||
          !href.startsWith("/") ||
          href.startsWith("//") ||
          /^\/(?:api|admin|auth|tokens)(?:\/|$)/.test(href)
        ) {
          throw new Error("안전하게 이동할 수 있는 앱 화면을 다시 선택해 주세요.");
        }
        if (hasUnsavedRef.current) await saveProject();
        if (hasUnsavedRef.current || savingRef.current) {
          throw new Error("변경 내용을 저장하는 중입니다. 저장 완료 후 다시 이동해 주세요.");
        }
        router.push(href);
        return { message: "변경 내용을 저장한 뒤 요청한 화면으로 이동했습니다." };
      },
    };
  }, [activeStep.shortLabel, completedCount, project, recentItems.length, router, saveProject]);
  useRegisterAiAgentPage(agentRegistration);

  const updateField = useCallback((stepId: SermonHelperStepId, key: string, value: string) => {
    mutateProject((current) => ({
      ...current,
      steps: {
        ...current.steps,
        [stepId]: {
          ...current.steps[stepId],
          fields: { ...current.steps[stepId].fields, [key]: value },
        },
      },
    }), stepId);
  }, [mutateProject]);

  const updateNotes = useCallback((stepId: SermonHelperStepId, notes: string) => {
    mutateProject((current) => ({
      ...current,
      steps: { ...current.steps, [stepId]: { ...current.steps[stepId], notes } },
    }), stepId);
  }, [mutateProject]);

  const selectStep = useCallback((stepId: SermonHelperStepId) => {
    mutateProject((current) => ({ ...current, currentStepId: stepId }));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [mutateProject]);

  const toggleCompleted = useCallback((stepId: SermonHelperStepId) => {
    mutateProject((current) => ({
      ...current,
      steps: {
        ...current.steps,
        [stepId]: { ...current.steps[stepId], completed: !current.steps[stepId].completed },
      },
    }), stepId);
  }, [mutateProject]);

  const addManuscriptItem = useCallback(() => {
    mutateProject((current) => {
      const step = current.steps.write;
      if (step.items.filter((item) => item.kind === "manuscript").length >= 4) return current;
      const item: SermonHelperStepItem = {
        id: crypto.randomUUID(),
        kind: "manuscript",
        title: "",
        content: "",
        provenanceIds: [],
      };
      return { ...current, steps: { ...current.steps, write: { ...step, items: [...step.items, item] } } };
    }, "write");
  }, [mutateProject]);

  const updateManuscriptItem = useCallback((id: string, patch: Partial<Pick<SermonHelperStepItem, "title" | "content">>) => {
    mutateProject((current) => ({
      ...current,
      steps: {
        ...current.steps,
        write: {
          ...current.steps.write,
          items: current.steps.write.items.map((item) => item.id === id ? { ...item, ...patch } : item),
        },
      },
    }), "write");
  }, [mutateProject]);

  const removeManuscriptItem = useCallback((id: string) => {
    mutateProject((current) => ({
      ...current,
      steps: { ...current.steps, write: { ...current.steps.write, items: current.steps.write.items.filter((item) => item.id !== id) } },
    }), "write");
  }, [mutateProject]);

  const updateProvenance = useCallback((entries: SermonHelperProvenanceEntry[]) => {
    const nextIds = new Set(entries.map((entry) => entry.id));
    const removedIds = new Set(
      (projectRef.current?.provenance ?? [])
        .filter((entry) => !nextIds.has(entry.id))
        .map((entry) => entry.id),
    );
    if (removedIds.size) {
      for (const stepId of SERMON_HELPER_STEP_IDS) {
        if (projectRef.current?.steps[stepId].items.some((item) =>
          item.provenanceIds.some((id) => removedIds.has(id)))) {
          dirtyStepsRef.current.add(stepId);
        }
      }
    }
    mutateProject((current) => ({
      ...current,
      provenance: entries,
      steps: Object.fromEntries(SERMON_HELPER_STEP_IDS.map((stepId) => [
        stepId,
        {
          ...current.steps[stepId],
          items: current.steps[stepId].items.map((item) => ({
            ...item,
            provenanceIds: item.provenanceIds.filter((id) => !removedIds.has(id)),
          })),
        },
      ])) as SermonHelperProject["steps"],
    }));
  }, [mutateProject]);

  const removeStepItem = useCallback((stepId: SermonHelperStepId, itemId: string) => {
    mutateProject((current) => ({
      ...current,
      steps: {
        ...current.steps,
        [stepId]: {
          ...current.steps[stepId],
          items: current.steps[stepId].items.filter((item) => item.id !== itemId),
        },
      },
    }), stepId);
  }, [mutateProject]);

  const adoptCoachSuggestion = useCallback((
    stepId: SermonHelperStepId,
    suggestion: SermonHelperCoachSuggestion,
    citedSourceIds: readonly string[],
  ) => {
    const provenanceId = crypto.randomUUID();
    mutateProject((current) => {
      const provenance: SermonHelperProvenanceEntry = {
        id: provenanceId,
        stepId,
        sourceType: "ai_suggestion",
        label: `AI 코치 제안 · ${suggestion.title}`.slice(0, 240),
        excerpt: suggestion.content.slice(0, 4_000),
        verified: false,
        createdAt: new Date().toISOString(),
      };
      const validSourceIds = new Set(current.provenance.map((entry) => entry.id));
      const item: SermonHelperStepItem = {
        id: crypto.randomUUID(),
        kind: COACH_ITEM_KIND[suggestion.kind],
        title: suggestion.title.slice(0, 240),
        content: suggestion.content.slice(0, 20_000),
        provenanceIds: [
          provenanceId,
          ...citedSourceIds.filter((id) => validSourceIds.has(id)),
        ],
      };
      return {
        ...current,
        provenance: [...current.provenance, provenance],
        steps: {
          ...current.steps,
          [stepId]: {
            ...current.steps[stepId],
            items: [...current.steps[stepId].items, item],
          },
        },
      };
    }, stepId);
  }, [mutateProject]);

  const confirmScripture = useCallback((canonical: string, original: string) => {
    mutateProject((current) => {
      const duplicate = current.provenance.some(
        (entry) => entry.stepId === "observe" && entry.sourceType === "scripture" && entry.label === canonical,
      );
      const scriptureSource: SermonHelperProvenanceEntry = {
        id: crypto.randomUUID(),
        stepId: "observe",
        sourceType: "scripture",
        label: canonical,
        excerpt: "성경 본문 표기를 AI로 정규화한 뒤 목회자가 범위를 확인했습니다.",
        verified: true,
        createdAt: new Date().toISOString(),
      };
      return {
        ...current,
        scripture: canonical,
        provenance: duplicate ? current.provenance : [...current.provenance, scriptureSource],
        steps: {
          ...current.steps,
          observe: {
            ...current.steps.observe,
            fields: {
              ...current.steps.observe.fields,
              originalScriptureInput: original,
              canonicalScripture: canonical,
              scriptureVerification: "pastor-confirmed",
            },
          },
        },
      };
    }, "observe");
    setNormalizationCandidate(null);
    setNormalizationError(null);
  }, [mutateProject]);

  const normalizeScripture = useCallback(async () => {
    const snapshot = projectRef.current;
    if (!snapshot || normalizingScripture) return;
    if (!coachEngineReady) {
      setNormalizationError(
        coachEngineAvailabilityMessage ??
          "현재 본문 확인에 사용할 수 있는 AI 엔진이 없습니다.",
      );
      return;
    }
    const input = snapshot.scripture.trim();
    if (!input) {
      setNormalizationError("먼저 읽을 성경 본문을 입력해 주세요.");
      return;
    }
    setNormalizingScripture(true);
    setNormalizationError(null);
    setNormalizationCandidate(null);
    try {
      const handle = startBackgroundAiRun<NormalizeScriptureResponse>({
        key: `scripture-normalization:${snapshot.id}`,
        kind: "scripture-normalization",
        label: "성경 본문 확인",
        targetHref: `/sermon-helper?id=${encodeURIComponent(snapshot.id)}`,
        context: { projectId: snapshot.id, input, aiTier },
        execute: (signal) =>
          requestScriptureNormalization(
            {
              draftId: snapshot.id,
              scripture: input,
              aiTier,
              clientUserScope,
            },
            signal,
          ),
        errorMessage: (caught) =>
          caught instanceof Error
            ? caught.message
            : "성경 본문 표기를 확인하지 못했습니다.",
      });
      const result = await handle.promise;
      if (
        projectRef.current?.id !== snapshot.id ||
        projectRef.current.scripture.trim() !== input
      ) {
        return;
      }
      if (!result.normalizedByAi) {
        setNormalizationError(
          "선택한 엔진에서는 AI 본문 확인을 사용할 수 없어 입력을 그대로 보존했습니다. 성경 원문에서 범위를 직접 확인해 주세요.",
        );
      } else {
        setNormalizationCandidate(result.scripture);
      }
    } catch (caught) {
      void reloadEngineAvailability();
      if (
        projectRef.current?.id !== snapshot.id ||
        projectRef.current.scripture.trim() !== input
      ) {
        return;
      }
      setNormalizationError(
        caught instanceof DOMException && caught.name === "AbortError"
          ? "본문 확인을 중지했습니다. 입력은 그대로 보존됩니다."
          : caught instanceof BackgroundAiRunBusyError
            ? caught.message
          : caught instanceof Error
            ? caught.message
            : "성경 본문 표기를 확인하지 못했습니다.",
      );
    } finally {
      setNormalizingScripture(false);
    }
  }, [
    aiTier,
    clientUserScope,
    coachEngineAvailabilityMessage,
    coachEngineReady,
    normalizingScripture,
    reloadEngineAvailability,
  ]);

  const deleteProject = useCallback(async () => {
    const snapshot = projectRef.current;
    if (!snapshot || deletingRef.current || deleting) return;
    if (coachPending) {
      setError("AI 코치의 '응답 중지'를 누르고 요청이 끝난 뒤 이 준비를 삭제해 주세요.");
      return;
    }
    if (savingRef.current) {
      setError("저장이 끝난 뒤 다시 삭제해 주세요.");
      return;
    }
    if (!window.confirm("이 설교 준비와 저장되지 않은 변경을 삭제할까요? 완료된 내 설교는 이 기능으로 삭제되지 않습니다.")) {
      return;
    }
    const wasUnsaved = hasUnsavedRef.current;
    deletingRef.current = true;
    setDeleting(true);
    setPendingNavigationHref(null);
    setError(null);
    hasUnsavedRef.current = false;
    stopBackgroundAiRun(normalizationBackgroundRun?.id);
    let versionConflict = false;
    try {
      const response = await fetch(
        `/api/sermon-helper/${encodeURIComponent(snapshot.id)}`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedVersion: serverVersionRef.current,
            expectedUpdatedAt: serverUpdatedAtRef.current,
          }),
        },
      );
      const body = await responseBody(response);
      if (!response.ok || body.deleted !== true) {
        if (response.status === 409 && body.code === "coach_request_pending") {
          throw new Error(
            "AI 코치 요청이 아직 처리 중입니다. 응답을 중지하거나 완료된 뒤 다시 삭제해 주세요.",
          );
        }
        if (response.status === 409) {
          versionConflict = true;
          setSaveState("conflict");
        }
        throw new Error(asMessage(body, "설교 준비를 삭제하지 못했습니다."));
      }
      projectRef.current = null;
      dirtyStepsRef.current.clear();
      editRevisionRef.current = 0;
      setProject(null);
      setSaveState("saved");
      guardedHrefRef.current = "/sermon-helper";
      router.replace("/sermon-helper");
      await loadRecent();
    } catch (nextError) {
      hasUnsavedRef.current = wasUnsaved;
      if (wasUnsaved && !versionConflict) setSaveState("dirty");
      setError(nextError instanceof Error ? nextError.message : "설교 준비를 삭제하지 못했습니다.");
    } finally {
      deletingRef.current = false;
      setDeleting(false);
    }
  }, [
    coachPending,
    deleting,
    loadRecent,
    normalizationBackgroundRun?.id,
    router,
  ]);

  const completeProject = useCallback(async () => {
    const snapshot = projectRef.current;
    if (!snapshot || completing) return;
    if (coachPending) {
      setError("AI 코치의 '응답 중지'를 누르고 요청이 끝난 뒤 내 설교로 저장해 주세요.");
      return;
    }
    setCompleting(true);
    setError(null);
    try {
      if (hasUnsavedRef.current) await saveProject();
      const current = projectRef.current;
      if (!current || hasUnsavedRef.current) throw new Error("변경 내용을 먼저 저장한 뒤 다시 완료해 주세요.");
      const response = await fetch(`/api/sermon-helper/${encodeURIComponent(current.id)}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: serverVersionRef.current, expectedUpdatedAt: serverUpdatedAtRef.current }),
      });
      const body = await responseBody(response);
      const nextProject = safeProject(body.item);
      if (!response.ok || !nextProject) {
        if (response.status === 409 && body.code === "coach_request_pending") {
          throw new Error(
            "AI 코치 요청이 아직 처리 중입니다. 응답을 중지하거나 완료된 뒤 내 설교로 저장해 주세요.",
          );
        }
        throw new Error(asMessage(body, "설교 준비를 완료하지 못했습니다."));
      }
      resetProject(nextProject);
      const sermonId = typeof body.sermonId === "string" ? body.sermonId : nextProject.completedSermonId;
      if (sermonId) router.push(`/history/${encodeURIComponent(sermonId)}`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "설교 준비를 완료하지 못했습니다.");
    } finally {
      setCompleting(false);
    }
  }, [coachPending, completing, resetProject, router, saveProject]);

  if (screenState === "loading") {
    return <div className="mx-auto grid min-h-[60vh] max-w-3xl place-items-center px-5 text-center"><div role="status"><span aria-hidden="true" className="mx-auto block size-12 animate-pulse rounded-2xl bg-[#dfeae3]" /><p className="mt-4 text-sm font-bold text-[#52645c]">설교 준비 공간을 불러오는 중입니다.</p></div></div>;
  }

  if (screenState === "error") {
    return <div className="mx-auto max-w-2xl px-5 py-20 text-center"><h1 className="font-serif text-3xl font-bold text-[#294238]">설교 준비를 열지 못했습니다</h1><p role="alert" className="mt-4 text-sm leading-6 text-[#8d4638]">{error}</p><a href="/sermon-helper" className="mt-7 inline-flex min-h-12 items-center rounded-xl bg-[#315647] px-5 text-sm font-extrabold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838]">설교도우미 처음으로</a></div>;
  }

  if (screenState === "start" || !project) {
    return <StartScreen items={recentItems} loading={recentLoading} creating={creating} error={error} onCreate={() => void createProject()} />;
  }

  const stepState = project.steps[project.currentStepId];
  const activeIndex = STEP_DEFINITIONS.findIndex((step) => step.id === project.currentStepId);
  const previousStep = STEP_DEFINITIONS[activeIndex - 1];
  const nextStep = STEP_DEFINITIONS[activeIndex + 1];
  const manuscriptCharacters = countCharacters(project);
  const reviewChecksCompleted = REVIEW_CHECKS.filter(([key]) => stepState.fields[key] === "true").length;
  const manuscriptItems = project.steps.write.items.filter((item) => item.kind === "manuscript");
  const canComplete = Boolean(
    project.title.trim() &&
      project.scripture.trim() &&
      project.steps.write.completed &&
      project.steps.review.completed &&
      project.steps.write.fields.introduction?.trim() &&
      project.steps.write.fields.conclusion?.trim() &&
      project.steps.write.fields.application?.trim() &&
      manuscriptItems.length >= 1 &&
      manuscriptItems.length <= 4 &&
      manuscriptItems.every((item) => item.title.trim() && item.content.trim()) &&
      SERMON_HELPER_REVIEW_FIELD_KEYS.every(
        (key) => project.steps.review.fields[key] === "true",
      ) &&
      sermonHelperReviewIsFresh(project)
  );

  return (
    <div className="mx-auto max-w-[90rem] px-3 py-5 sm:px-6 sm:py-7 xl:px-8">
      <header className="rounded-[1.75rem] border border-[#d8d2c7] bg-white p-5 shadow-[0_14px_40px_rgba(39,50,44,.06)] sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="min-w-0 flex-1">
            <a href="/sermon-helper" className="inline-flex min-h-10 items-center gap-2 rounded-lg text-xs font-extrabold text-[#77614a] hover:text-[#a2612d] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838]"><span aria-hidden="true">←</span> 최근 준비</a>
            <label htmlFor="helper-title" className="sr-only">설교 준비 제목</label>
            <input id="helper-title" value={project.title} onChange={(event) => mutateProject((current) => ({ ...current, title: event.target.value }))} className="mt-2 block w-full border-0 bg-transparent p-0 font-serif text-[clamp(1.8rem,4vw,2.7rem)] font-bold leading-tight tracking-[-0.035em] text-[#243f34] outline-none placeholder:text-[#9ca49f]" placeholder="설교 준비 제목" />
            <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px] font-semibold text-[#6c7771]">
              {project.status === "completed" ? <span className="inline-flex min-h-7 items-center rounded-full bg-[#315647] px-3 font-extrabold text-white">✓ 내 설교로 저장 완료</span> : null}
              <span className={`inline-flex min-h-7 items-center gap-1.5 rounded-full px-3 ${saveState === "saved" ? "bg-[#e7f0e9] text-[#39604d]" : saveState === "conflict" || saveState === "error" ? "bg-[#fff0eb] text-[#984b38]" : "bg-[#f5eadb] text-[#8d5c30]"}`} role="status"><span aria-hidden="true">{saveState === "saved" ? "✓" : "●"}</span>{saveLabel(saveState)}</span>
              <span>완료 {completedCount}/8</span>
              <span>최근 저장 {formatDate(project.updatedAt)}</span>
              <span className="hidden sm:inline">Ctrl/⌘ + S로 즉시 저장</span>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <label className="text-[10px] font-extrabold text-[#53645c]">
              AI 보조 엔진
              {coachPending && !coachEngineReady ? (
                <span className="mt-1 block min-h-11 rounded-xl border border-[#cfc7bb] bg-[#f3f0e9] px-3 py-3 text-xs font-extrabold text-[#766b5d]">
                  이전 요청 엔진으로 결과 확인 중
                </span>
              ) : (
                <select
                  value={coachEngineReady ? aiTier : ""}
                  onChange={(event) => setAiTier(event.target.value as AiEngineTier)}
                  disabled={
                    coachPending ||
                    engineAvailabilityStatus !== "ready" ||
                    !selectableCoachTiers.length
                  }
                  aria-describedby={coachEngineAvailabilityMessage ? "helper-coach-engine-status" : undefined}
                  className="mt-1 block min-h-11 rounded-xl border border-[#cfc7bb] bg-white px-3 text-xs font-extrabold text-[#304b3f] outline-none focus:border-[#7b978a] focus:ring-4 focus:ring-[#7b978a]/12 disabled:cursor-not-allowed disabled:bg-[#f3f0e9]"
                >
                  {!coachEngineReady ? (
                    <option value="" disabled>
                      {engineAvailabilityStatus === "loading"
                        ? "엔진 확인 중"
                        : engineAvailabilityStatus === "error"
                          ? "엔진 확인 필요"
                          : "사용 가능한 엔진 없음"}
                    </option>
                  ) : null}
                  {AI_ENGINE_TIERS.map((tier) => {
                    const available = isEngineTierAvailableFor(tier, "coach");
                    const entry = engineAvailability.find((item) => item.tier === tier);
                    const status = !entry?.enabled
                      ? "사용중지"
                      : !entry.configured
                        ? "준비중"
                        : "사용불가";
                    return (
                      <option key={tier} value={tier} disabled={!available}>
                        {AI_ENGINE_TIER_META[tier].label} · 코치 {SERMON_HELPER_COACH_COSTS[tier]}토큰
                        {!available ? ` · ${status}` : ""}
                      </option>
                    );
                  })}
                </select>
              )}
            </label>
            {(saveState === "error" || saveState === "dirty") ? <button type="button" onClick={() => void saveProject()} className="inline-flex min-h-11 items-center rounded-xl border border-[#a99c8b] bg-white px-4 text-xs font-extrabold text-[#365146] hover:bg-[#faf7f0] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838]">지금 저장</button> : null}
            {saveState === "conflict" ? <button type="button" onClick={() => void loadProject(project.id)} className="inline-flex min-h-11 items-center rounded-xl bg-[#9a4938] px-4 text-xs font-extrabold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838]">서버 내용 다시 불러오기</button> : null}
            <button type="button" onClick={() => void deleteProject()} disabled={deleting || saveState === "saving" || coachPending} aria-describedby={coachPending ? "coach-delete-wait" : undefined} className="inline-flex min-h-11 items-center rounded-xl border border-[#cfaea5] bg-white px-4 text-xs font-extrabold text-[#914d3d] hover:bg-[#fff4f0] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838] disabled:cursor-not-allowed disabled:opacity-45">{deleting ? "삭제하는 중" : "이 준비 삭제"}</button>
          </div>
        </div>
        {coachEngineAvailabilityMessage && !coachPending ? (
          <div
            id="helper-coach-engine-status"
            className="mt-4 flex items-start justify-between gap-3 rounded-xl border border-[#e4c494] bg-[#fff5e7] px-4 py-3 text-xs font-bold leading-5 text-[#805326]"
            role={engineAvailabilityStatus === "error" ? "alert" : "status"}
          >
            <span>{coachEngineAvailabilityMessage}</span>
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
        {coachPending ? <p id="coach-delete-wait" role="status" className="mt-4 rounded-xl bg-[#fff5e7] px-4 py-3 text-xs font-bold leading-5 text-[#805326]">AI 코치 요청 중에는 이 준비를 삭제할 수 없습니다. AI 코치 영역의 ‘응답 중지’를 누르고 요청이 끝난 뒤 삭제해 주세요.</p> : null}
        {pendingNavigationHref ? <p role="status" className="mt-4 rounded-xl bg-[#edf3ee] px-4 py-3 text-xs font-extrabold text-[#456052]">변경 내용을 안전하게 저장한 뒤 이동합니다.</p> : null}
        {error ? <p role="alert" className="mt-4 rounded-xl border border-[#e7b6a9] bg-[#fff0eb] px-4 py-3 text-xs font-semibold leading-5 text-[#943f2f]">{error}</p> : null}
        <div className="mt-6">
          <label htmlFor="helper-scripture" className="text-xs font-extrabold text-[#52655c]">이번 설교의 본문</label>
          <input id="helper-scripture" value={project.scripture} onChange={(event) => { stopBackgroundAiRun(normalizationBackgroundRun?.id); setNormalizationCandidate(null); setNormalizationError(null); mutateProject((current) => ({ ...current, scripture: event.target.value }), "observe"); }} placeholder="예: 요한복음 3장 16~18절 또는 요한복음 3:16-18" className="mt-2 min-h-12 w-full rounded-xl border border-[#d5cfc3] bg-[#faf8f3] px-4 text-sm font-bold text-[#2d483d] outline-none focus:border-[#7b978a] focus:ring-4 focus:ring-[#7b978a]/12" />
        </div>
      </header>

      <nav className="mt-4 rounded-[1.5rem] border border-[#d8d2c7] bg-[#f9f7f2] p-3 sm:p-4" aria-label="설교도우미 단계">
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {STEP_GROUPS.map((group) => {
            const active = (group.steps as readonly SermonHelperStepId[]).includes(
              project.currentStepId,
            );
            const groupCompleted = group.steps.filter((id) => project.steps[id].completed).length;
            return (
              <section key={group.number} className={`rounded-2xl border p-3 ${active ? "border-[#8aa294] bg-white shadow-sm" : "border-transparent bg-[#f0ede6]"}`} aria-label={group.title}>
                <div className="flex items-center justify-between gap-2 px-1">
                  <span className="text-[10px] font-black tracking-[0.12em] text-[#9b6b41]">{group.number} · {group.title}</span>
                  <span className="text-[10px] font-bold text-[#6f7b75]">{groupCompleted}/2</span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-1.5">
                  {group.steps.map((stepId) => {
                    const definition = stepDefinition(stepId);
                    const selected = stepId === project.currentStepId;
                    return <button key={stepId} type="button" aria-current={selected ? "step" : undefined} onClick={() => selectStep(stepId)} className={`min-h-11 rounded-xl px-2 text-xs font-extrabold focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838] ${selected ? "bg-[#2a4b3e] text-white" : project.steps[stepId].completed ? "bg-[#deebe2] text-[#315746]" : "bg-white text-[#66746d] hover:bg-[#fdfbf7]"}`}>{project.steps[stepId].completed ? <span aria-hidden="true">✓ </span> : null}{definition.shortLabel}</button>;
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </nav>

      <main className="mt-4 overflow-hidden rounded-[1.75rem] border border-[#d8d2c7] bg-white shadow-[0_18px_50px_rgba(39,50,44,.07)]">
        <section className="bg-[#21483a] px-5 py-7 text-white sm:px-8 sm:py-9">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="max-w-4xl">
              <p className="text-[10px] font-extrabold tracking-[0.18em] text-white uppercase">{activeStep.number} · {activeStep.eyebrow}</p>
              <h2 className="mt-3 font-serif text-[clamp(1.8rem,4vw,2.8rem)] font-bold leading-tight tracking-[-0.035em] text-white">{activeStep.title}</h2>
              <p className="mt-4 max-w-3xl text-sm leading-7 text-white">{activeStep.description}</p>
            </div>
            <button type="button" onClick={() => toggleCompleted(project.currentStepId)} className={`inline-flex min-h-11 items-center rounded-xl px-4 text-xs font-extrabold focus:outline-none focus-visible:ring-2 focus-visible:ring-white ${stepState.completed ? "bg-[#e8c28d] text-[#234036]" : "border border-white/30 bg-white/10 text-white hover:bg-white/15"}`}>{stepState.completed ? "✓ 단계 완료" : "이 단계 완료 표시"}</button>
          </div>
          <blockquote className="mt-6 max-w-3xl border-l-2 border-[#e4b979] pl-4 font-serif text-base leading-7 text-white">“{activeStep.prompt}”</blockquote>
        </section>

        <div className="space-y-7 p-5 sm:p-8">
          {project.currentStepId === "review" ? (
            <section aria-labelledby="review-checklist-title">
              <h3 id="review-checklist-title" className="font-serif text-xl font-bold text-[#2b4439]">목회자 최종 확인</h3>
              <p className="mt-2 text-sm leading-6 text-[#6f7b75]">AI가 대신 확인했다고 표시할 수 없습니다. 각 항목을 직접 살핀 뒤 체크하세요.</p>
              <div className="mt-5 grid gap-3 lg:grid-cols-2">
                {REVIEW_CHECKS.map(([key, label]) => {
                  const checked = stepState.fields[key] === "true";
                  return <label key={key} className={`flex min-h-16 cursor-pointer items-start gap-3 rounded-2xl border p-4 text-sm font-semibold leading-6 ${checked ? "border-[#8ba895] bg-[#edf5ef] text-[#315746]" : "border-[#d7d1c7] bg-[#fbfaf7] text-[#53635b]"}`}><input type="checkbox" checked={checked} onChange={(event) => updateField("review", key, event.target.checked ? "true" : "false")} className="mt-1 size-5 shrink-0 accent-[#315746]" /><span>{label}</span></label>;
                })}
              </div>
              <p className="mt-3 text-xs font-bold text-[#87603c]">확인 {reviewChecksCompleted}/{REVIEW_CHECKS.length}</p>
            </section>
          ) : null}

          {project.currentStepId === "write" ? (
            <div className="rounded-2xl border border-[#ead2b2] bg-[#fff8ee] px-5 py-4 text-sm leading-6 text-[#75512e]">
              <strong className="block text-[#68401f]">직접쓰기 원칙</strong>
              전체 원고 자동 생성은 제공하지 않습니다. 현재까지 기록한 묵상과 구조를 보며 목회자의 문장으로 직접 써주세요.
            </div>
          ) : null}

          {project.currentStepId === "observe" ? (
            <section className="rounded-2xl border border-[#d4c8b7] bg-[#fffaf1] p-5 sm:p-6" aria-labelledby="helper-scripture-reading-title">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="max-w-3xl">
                  <p className="text-[10px] font-black tracking-[.15em] text-[#9b6332] uppercase">Read before explain</p>
                  <h3 id="helper-scripture-reading-title" className="mt-2 font-serif text-xl font-bold text-[#2a4338]">먼저 성경 원문을 직접 읽어주세요</h3>
                  <p className="mt-2 text-xs leading-5 text-[#65736c]">
                    입력한 자연어 장절은 기존 AI 본문 확인 기능으로 표준 표기만 확인합니다. 본문 전문은 AI의 기억으로 만들어 표시하지 않으므로, 사용 중인 인쇄 성경 또는 정식 성경 앱에서 범위 전체를 직접 읽어주세요.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {normalizingScripture ? (
                    <button type="button" onClick={() => stopBackgroundAiRun(normalizationBackgroundRun?.id)} className="inline-flex min-h-11 items-center rounded-xl border border-[#a24837] bg-white px-4 text-xs font-extrabold text-[#974232] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838]">본문 확인 중지</button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void normalizeScripture()}
                      disabled={!coachEngineReady}
                      aria-describedby={!coachEngineReady && coachEngineAvailabilityMessage ? "helper-coach-engine-status" : undefined}
                      className="inline-flex min-h-11 items-center rounded-xl bg-[#315647] px-4 text-xs font-extrabold text-white hover:bg-[#24483a] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838] disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      AI로 본문 표기 확인
                    </button>
                  )}
                </div>
              </div>
              {project.steps.observe.fields.scriptureVerification === "pastor-confirmed" ? (
                <p className="mt-4 rounded-xl bg-[#e7f0e9] px-4 py-3 text-xs font-extrabold text-[#3a604d]">✓ 목회자 확인 표기: {project.steps.observe.fields.canonicalScripture || project.scripture}</p>
              ) : null}
              {normalizationCandidate ? (
                <div className="mt-4 rounded-xl border border-[#e4c494] bg-white p-4">
                  <p className="text-xs font-bold leading-5 text-[#74502f]">AI가 다음 표기로 이해했습니다. 범위를 직접 확인한 뒤에만 적용해 주세요.</p>
                  <p className="mt-2 font-serif text-lg font-bold text-[#2d4b3f]">{normalizationCandidate}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" onClick={() => confirmScripture(normalizationCandidate, project.scripture)} className="inline-flex min-h-10 items-center rounded-lg bg-[#315647] px-3 text-[10px] font-extrabold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838]">직접 확인했고 이 표기 적용</button>
                    <button type="button" onClick={() => setNormalizationCandidate(null)} className="inline-flex min-h-10 items-center rounded-lg border border-[#cfc7bb] bg-white px-3 text-[10px] font-extrabold text-[#52645b] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838]">입력 유지</button>
                  </div>
                </div>
              ) : null}
              {normalizationError ? <p role="alert" className="mt-4 rounded-xl border border-[#e5b9ab] bg-[#fff0eb] px-4 py-3 text-xs font-semibold leading-5 text-[#914130]">{normalizationError}</p> : null}
            </section>
          ) : null}

          <div className="grid gap-6 lg:grid-cols-2">
            {activeStep.fields.map((field) => <FieldControl key={field.key} definition={field} value={stepState.fields[field.key] ?? ""} onChange={(value) => updateField(project.currentStepId, field.key, value)} />)}
          </div>

          {project.currentStepId === "write" ? (
            <ManuscriptEditor items={project.steps.write.items} onAdd={addManuscriptItem} onChange={updateManuscriptItem} onRemove={removeManuscriptItem} />
          ) : null}

          <section className="rounded-2xl border border-[#d9d3c8] bg-[#f7f4ed] p-5 sm:p-6" aria-labelledby="pastor-notes-title">
            <label id="pastor-notes-title" htmlFor="helper-step-notes" className="font-serif text-xl font-bold text-[#2a4338]">내 묵상 메모</label>
            <p className="mt-1 text-xs leading-5 text-[#6d7972]">완성된 문장일 필요가 없습니다. 기도하며 떠오른 질문과 망설임도 목회자의 기록입니다.</p>
            <textarea id="helper-step-notes" value={stepState.notes} onChange={(event) => updateNotes(project.currentStepId, event.target.value)} rows={7} placeholder="이 단계에서 제가 직접 붙잡은 생각은…" className="mt-4 min-h-44 w-full resize-y rounded-xl border border-[#d2cbc0] bg-white px-4 py-3 font-serif text-base leading-8 text-[#30443b] outline-none focus:border-[#7b978a] focus:ring-4 focus:ring-[#7b978a]/12" />
          </section>

          {stepState.items.some((item) => item.kind !== "manuscript") ? (
            <section className="rounded-2xl border border-[#d9d3c8] bg-[#f5f1e9] p-5 sm:p-6" aria-labelledby="helper-adopted-title">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 id="helper-adopted-title" className="font-serif text-xl font-bold text-[#2a4338]">내가 채택한 제안과 연구 항목</h3>
                  <p className="mt-1 text-xs leading-5 text-[#6b7770]">채택한 AI 제안도 목회자의 판단과 수정이 필요한 작업 재료입니다.</p>
                </div>
                <span className="rounded-full bg-white px-3 py-1.5 text-[10px] font-extrabold text-[#54685e]">{stepState.items.filter((item) => item.kind !== "manuscript").length}개</span>
              </div>
              <ul className="mt-4 grid gap-3 lg:grid-cols-2">
                {stepState.items.filter((item) => item.kind !== "manuscript").map((item) => (
                  <li key={item.id} className="rounded-xl border border-[#d7d0c4] bg-white p-4">
                    <div className="flex items-start justify-between gap-3">
                      <strong className="text-sm leading-6 text-[#2e493d]">{item.title}</strong>
                      <button type="button" onClick={() => removeStepItem(project.currentStepId, item.id)} className="min-h-9 shrink-0 rounded-lg px-2 text-[10px] font-extrabold text-[#964535] hover:bg-[#fff0eb] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838]">제거</button>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#53645c]">{item.content}</p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <ProvenancePanel entries={project.provenance} stepId={project.currentStepId} onChange={updateProvenance} />

          <CoachPanel
            project={project}
            clientUserScope={clientUserScope}
            tier={aiTier}
            newRequestEngineReady={coachEngineReady}
            engineAvailabilityMessage={coachEngineAvailabilityMessage}
            onEngineAvailabilityInvalidated={() => {
              void reloadEngineAvailability();
            }}
            onTierChange={setAiTier}
            onAdopt={adoptCoachSuggestion}
            onPendingChange={setCoachPending}
          />

          {project.currentStepId === "write" ? (
            <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-[#edf3ee] px-5 py-4 text-xs font-semibold text-[#4c6358]">
              <span className="font-extrabold text-[#315746]">현재 원고 약 {manuscriptCharacters.toLocaleString("ko-KR")}자</span>
              <span>말하는 속도에 따라 실제 설교 시간은 달라질 수 있습니다.</span>
            </div>
          ) : null}

          {project.currentStepId === "review" ? (
            <section className="rounded-2xl border border-[#d2c7b9] bg-[#f4efe6] p-5 sm:p-6" aria-labelledby="helper-finish-title">
              <h3 id="helper-finish-title" className="font-serif text-xl font-bold text-[#2a4338]">내 설교로 저장하기</h3>
              <p className="mt-2 text-sm leading-6 text-[#66746d]">직접쓰기와 최종 점검을 완료하면 설교도우미의 기록을 하나의 설교로 보관합니다. 목회자가 쓴 원고만 저장됩니다.</p>
              {project.status === "completed" && project.completedSermonId ? (
                <a href={`/history/${encodeURIComponent(project.completedSermonId)}`} className="mt-5 inline-flex min-h-12 items-center rounded-xl bg-[#315647] px-5 text-sm font-extrabold text-white hover:bg-[#24483a] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838]">저장한 설교 열기 →</a>
              ) : (
                <button type="button" onClick={() => void completeProject()} disabled={!canComplete || completing || coachPending} aria-describedby={coachPending ? "coach-complete-wait" : undefined} className="mt-5 inline-flex min-h-12 items-center rounded-xl bg-[#315647] px-5 text-sm font-extrabold text-white hover:bg-[#24483a] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838] disabled:cursor-not-allowed disabled:opacity-45">{completing ? "설교로 저장하는 중" : "내 설교로 저장"}</button>
              )}
              {coachPending && project.status !== "completed" ? <p id="coach-complete-wait" className="mt-3 text-xs font-bold leading-5 text-[#805326]">AI 코치 요청을 중지하거나 완료한 뒤 내 설교로 저장할 수 있습니다.</p> : null}
              {!canComplete && project.status !== "completed" ? <p className="mt-3 text-xs leading-5 text-[#8a5b34]">제목과 본문, 도입·결론·최종 적용, 1~4개 대지의 제목과 원고를 모두 작성하고 직접쓰기·점검 단계를 완료해 주세요. 점검의 여섯 항목도 모두 직접 확인해야 합니다.</p> : null}
            </section>
          ) : null}
        </div>

        <footer className="flex flex-col-reverse gap-3 border-t border-[#ded8cf] bg-[#faf8f3] px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          {previousStep ? <button type="button" onClick={() => selectStep(previousStep.id)} className="inline-flex min-h-12 items-center justify-center rounded-xl border border-[#bdb3a6] bg-white px-5 text-sm font-extrabold text-[#3f554b] hover:bg-[#fdfbf7] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838]">← {previousStep.shortLabel}로 돌아가기</button> : <span />}
          {nextStep ? <button type="button" onClick={() => selectStep(nextStep.id)} className="inline-flex min-h-12 items-center justify-center rounded-xl bg-[#315647] px-5 text-sm font-extrabold text-white hover:bg-[#24483a] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838]">다음 · {nextStep.shortLabel} →</button> : <button type="button" onClick={() => selectStep("brief")} className="inline-flex min-h-12 items-center justify-center rounded-xl border border-[#bdb3a6] bg-white px-5 text-sm font-extrabold text-[#3f554b] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838]">처음부터 다시 살피기</button>}
        </footer>
      </main>
    </div>
  );
}
