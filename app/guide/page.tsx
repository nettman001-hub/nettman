import Link from "next/link";
import type { Metadata } from "next";
import { AppPageHeading } from "@/app/_components/app-page-heading";
import { AppShell } from "@/app/_components/app-shell";
import { requirePageUser } from "@/app/_lib/auth-user";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "사용자 설명서",
  description:
    "로고스AI의 설교도우미, AI 초안, 저장 설교, 스터디, 사역 활용, 피드백과 토큰 사용 방법을 안내합니다.",
};

const TABLE_OF_CONTENTS = [
  ["quick-start", "처음 시작하기"],
  ["choose-workflow", "설교 준비 방식 선택"],
  ["sermon-helper", "설교도우미 사용법"],
  ["ai-drafts", "AI 다섯 초안 만들기"],
  ["ai-agent", "AI 에이전트 활용"],
  ["history", "저장·수정·내보내기"],
  ["resources", "스터디·비평·사역 활용"],
  ["feedback", "설교 피드백"],
  ["tokens", "토큰과 충전"],
  ["account", "계정과 알림"],
  ["troubleshooting", "문제 해결"],
  ["safe-use", "안전하고 책임 있게 사용하기"],
] as const;

const HELPER_STEPS = [
  ["01", "설교 상황 정리", "예배, 회중과 설교의 목적을 먼저 분명히 합니다."],
  ["02", "본문 읽기", "본문 범위를 확인하고 반복되는 표현과 핵심 흐름을 기록합니다."],
  ["03", "관찰·해석", "문맥, 배경, 구조와 확인이 필요한 연구 내용을 정리합니다."],
  ["04", "한 문장 메시지", "본문이 오늘의 회중에게 전하는 중심 메시지를 한 문장으로 다듬습니다."],
  ["05", "구조 설계", "도입, 대지와 결론의 역할을 정하고 흐름을 세웁니다."],
  ["06", "회중 적용", "구체적인 상황, 결단과 실천을 회중의 언어로 작성합니다."],
  ["07", "직접 원고 작성", "목회자의 어조로 도입·본론·결론·적용을 직접 씁니다."],
  ["08", "최종 점검", "본문, 출처, 신학, 개인정보, 목소리와 리허설을 확인합니다."],
] as const;

const GUIDE_LINK =
  "font-extrabold text-[#8d4f2b] underline decoration-[#c99c72] underline-offset-4 hover:text-[#64371f] focus:outline-none focus-visible:rounded focus-visible:ring-2 focus-visible:ring-[#b97838]";

function SectionTitle({
  id,
  number,
  title,
  description,
}: {
  id: string;
  number: string;
  title: string;
  description: string;
}) {
  return (
    <div className="border-b border-[#dfd8cc] pb-5">
      <p className="font-serif text-sm font-bold text-[#b16c35]">{number}</p>
      <h2 id={id} className="mt-1 font-serif text-[clamp(1.6rem,4vw,2.15rem)] font-bold leading-tight tracking-[-0.03em] text-[#213d32]">
        {title}
      </h2>
      <p className="mt-3 max-w-3xl text-sm leading-7 text-[#66746d]">{description}</p>
    </div>
  );
}

function StepList({ children }: { children: React.ReactNode }) {
  return (
    <ol className="mt-5 grid gap-3 text-sm leading-7 text-[#4e5e56] [counter-reset:guide-step]">
      {children}
    </ol>
  );
}

function Step({ children }: { children: React.ReactNode }) {
  return (
    <li className="relative rounded-2xl border border-[#ded8ce] bg-[#fbfaf6] py-4 pl-14 pr-4 [counter-increment:guide-step] before:absolute before:left-4 before:top-4 before:grid before:size-7 before:place-items-center before:rounded-full before:bg-[#315647] before:text-[10px] before:font-black before:text-white before:content-[counter(guide-step)]">
      {children}
    </li>
  );
}

function Callout({
  title,
  children,
  tone = "green",
}: {
  title: string;
  children: React.ReactNode;
  tone?: "green" | "amber";
}) {
  const color =
    tone === "amber"
      ? "border-[#e0c6a5] bg-[#fbf2e5] text-[#5c4835]"
      : "border-[#b9cdbf] bg-[#edf3ee] text-[#355147]";
  return (
    <aside className={`mt-5 rounded-2xl border px-5 py-4 text-sm leading-7 ${color}`}>
      <strong className="block font-extrabold">{title}</strong>
      <div className="mt-1">{children}</div>
    </aside>
  );
}

export default async function GuidePage() {
  const user = await requirePageUser("/guide");

  return (
    <AppShell
      active="guide"
      user={{
        id: user.id,
        displayName: user.name,
        email: user.email,
        isAdmin: user.isAdmin,
      }}
    >
      <div className="mx-auto max-w-[90rem] px-4 py-7 sm:px-7 sm:py-10 xl:px-10">
        <AppPageHeading
          eyebrow="Customer guide"
          title="사용자 설명서"
          description="처음 로그인한 순간부터 설교 준비, 저장, 후속 자료 생성과 내보내기까지 로고스AI의 전체 사용 흐름을 안내합니다."
          action={
            <Link
              href="/sermon-helper"
              className="inline-flex min-h-11 items-center rounded-xl bg-[#315647] px-4 text-sm font-extrabold text-white hover:bg-[#25483a] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838]"
            >
              설교도우미 시작
            </Link>
          }
        />

        <section className="mt-7 overflow-hidden rounded-[2rem] bg-[#1d3f33] px-5 py-7 text-white shadow-[0_22px_55px_rgba(28,56,46,.14)] sm:px-8 sm:py-9" aria-labelledby="guide-welcome-title">
          <div className="grid gap-7 lg:grid-cols-[minmax(0,1.2fr)_minmax(18rem,.8fr)] lg:items-end">
            <div>
              <p className="text-xs font-extrabold tracking-[0.16em] text-[#e8c28d] uppercase">Welcome to Logos AI</p>
              <h2 id="guide-welcome-title" className="mt-3 max-w-3xl font-serif text-[clamp(1.8rem,5vw,3.2rem)] font-bold leading-[1.08] tracking-[-0.04em]">
                AI가 대신 설교하는 곳이 아니라,
                <br className="hidden sm:block" /> 내 설교를 더 깊이 준비하는 공간입니다.
              </h2>
              <p className="mt-5 max-w-2xl text-sm leading-7 text-white/80 sm:text-base">
                목회자가 직접 묵상하고 쓰는 설교도우미와, 서로 다른 다섯 방향을 비교하는 AI 초안 중 상황에 맞는 방식을 선택하세요. 모든 AI 결과는 강단에서 사용하기 전에 반드시 직접 검토해야 합니다.
              </p>
            </div>
            <div className="rounded-2xl border border-white/15 bg-white/8 p-5">
              <p className="text-xs font-extrabold text-[#f0c993]">가장 빠른 시작 순서</p>
              <ol className="mt-3 space-y-2 text-sm leading-6 text-white/85">
                <li>1. 계정과 신학 배경 설정</li>
                <li>2. 두 설교 준비 방식 중 하나 선택</li>
                <li>3. 결과를 검토하고 내 설교에 저장</li>
                <li>4. 스터디·피드백·사역 자료로 확장</li>
              </ol>
            </div>
          </div>
        </section>

        <div className="mt-7 grid gap-7 xl:grid-cols-[17rem_minmax(0,1fr)] xl:items-start">
          <aside className="rounded-[1.5rem] border border-[#d9d3c9] bg-white p-4 shadow-[0_12px_35px_rgba(38,52,45,.05)] xl:sticky xl:top-5" aria-label="사용자 설명서 목차">
            <p className="px-2 text-[10px] font-extrabold tracking-[0.17em] text-[#a56732] uppercase">Contents</p>
            <nav className="mt-3">
              <ol className="grid gap-1">
                {TABLE_OF_CONTENTS.map(([id, label], index) => (
                  <li key={id}>
                    <a
                      href={`#${id}`}
                      className="flex min-h-10 items-center gap-2 rounded-xl px-2.5 py-2 text-xs font-bold leading-5 text-[#5c6a63] hover:bg-[#f1eee7] hover:text-[#29473b] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838]"
                    >
                      <span className="font-serif text-[#b27642]" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                      {label}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
            <div className="mt-4 border-t border-[#e4dfd7] px-2 pt-4 text-xs leading-5 text-[#768079]">
              찾는 내용이 없으면 <a href="mailto:hello@sermonguide.kr" className="font-bold text-[#80502f] underline underline-offset-2">고객 문의</a>로 알려주세요.
            </div>
          </aside>

          <article className="rounded-[2rem] border border-[#dcd6cc] bg-white px-5 py-8 shadow-[0_18px_50px_rgba(38,52,45,.06)] sm:px-8 sm:py-10 lg:px-11">
            <div className="space-y-16">
              <section id="quick-start" className="scroll-mt-6" aria-labelledby="quick-start-title">
                <SectionTitle id="quick-start-title" number="01" title="처음 시작하기" description="로그인 뒤 세 가지만 먼저 확인하면 이후 생성 결과가 내 사역 환경에 더 잘 맞습니다." />
                <div className="mt-6 grid gap-4 md:grid-cols-3">
                  {[
                    ["1", "프로필 입력", "이름, 사역 역할, 교단·신학, 교회와 연락처를 확인합니다.", "/my", "계정 설정 열기"],
                    ["2", "토큰 확인", "가입 축하 200토큰과 현재 잔액, 사용 내역을 확인합니다.", "/tokens", "토큰 지갑 열기"],
                    ["3", "알림 선택", "긴 생성 작업이 끝났을 때 받을 이메일·브라우저 알림을 선택합니다.", "/notifications", "알림 설정 열기"],
                  ].map(([number, title, description, href, cta]) => (
                    <div key={number} className="rounded-2xl border border-[#ddd7cd] bg-[#fbfaf6] p-5">
                      <span className="grid size-8 place-items-center rounded-full bg-[#e6d5bd] text-xs font-black text-[#6f4b2e]">{number}</span>
                      <h3 className="mt-4 font-serif text-lg font-bold text-[#294238]">{title}</h3>
                      <p className="mt-2 text-sm leading-6 text-[#68756e]">{description}</p>
                      <Link href={href} className={`mt-4 inline-block text-xs ${GUIDE_LINK}`}>{cta} →</Link>
                    </div>
                  ))}
                </div>
                <Callout title="이메일은 어디에서 바꾸나요?">
                  로그인 이메일과 비밀번호는 인증 계정의 보안 정보입니다. 프로필 화면에서는 이메일을 확인만 할 수 있으며, 비밀번호는 <Link href="/reset-password" className={GUIDE_LINK}>비밀번호 변경</Link>에서 바꿀 수 있습니다.
                </Callout>
              </section>

              <section id="choose-workflow" className="scroll-mt-6" aria-labelledby="choose-workflow-title">
                <SectionTitle id="choose-workflow-title" number="02" title="설교 준비 방식 선택" description="한 편을 직접 깊게 쓸 때와 여러 방향을 빠르게 비교할 때의 출발점이 다릅니다." />
                <div className="mt-6 grid gap-4 lg:grid-cols-2">
                  <div className="rounded-[1.5rem] border border-[#bfcfc4] bg-[#eef4ef] p-6">
                    <p className="text-[10px] font-extrabold tracking-[0.14em] text-[#47705e] uppercase">Pastor-led</p>
                    <h3 className="mt-2 font-serif text-xl font-bold text-[#294238]">설교도우미</h3>
                    <p className="mt-3 text-sm leading-7 text-[#586a61]">목회자가 묵상, 연구, 구조와 원고를 직접 작성합니다. AI는 요청한 현재 단계에만 질문이나 짧은 표현 대안을 제안합니다.</p>
                    <p className="mt-3 text-xs font-bold text-[#3f5e51]">추천: 본문 연구부터 내 목소리로 차근차근 완성할 때</p>
                    <Link href="/sermon-helper" className={`mt-5 inline-block text-sm ${GUIDE_LINK}`}>설교도우미로 준비하기 →</Link>
                  </div>
                  <div className="rounded-[1.5rem] border border-[#dec6a8] bg-[#fbf3e8] p-6">
                    <p className="text-[10px] font-extrabold tracking-[0.14em] text-[#9a6537] uppercase">AI drafts</p>
                    <h3 className="mt-2 font-serif text-xl font-bold text-[#4a392b]">AI 다섯 초안</h3>
                    <p className="mt-3 text-sm leading-7 text-[#685b50]">제목, 회중, 본문과 구성을 정하면 서로 다른 관점의 다섯 초안을 만들어 비교하고 한 편을 골라 수정합니다.</p>
                    <p className="mt-3 text-xs font-bold text-[#765436]">추천: 다양한 설교 방향을 비교해 출발점을 찾을 때</p>
                    <Link href="/sermon/options" className={`mt-5 inline-block text-sm ${GUIDE_LINK}`}>AI 초안 만들기 →</Link>
                  </div>
                </div>
                <Callout title="두 방식은 서로 덮어쓰지 않습니다">
                  설교도우미 작업과 AI 다섯 초안 작업은 별도로 저장됩니다. 상황에 따라 각각 시작해도 기존 작업은 유지됩니다.
                </Callout>
              </section>

              <section id="sermon-helper" className="scroll-mt-6" aria-labelledby="sermon-helper-title">
                <SectionTitle id="sermon-helper-title" number="03" title="설교도우미 사용법" description="여덟 단계는 순서대로 진행해도 되고, 필요한 단계로 자유롭게 이동해도 됩니다." />
                <div className="mt-6 grid gap-3 sm:grid-cols-2">
                  {HELPER_STEPS.map(([number, title, description]) => (
                    <div key={number} className="flex gap-4 rounded-2xl border border-[#ded8ce] bg-[#fbfaf6] p-4">
                      <span className="font-serif text-lg font-bold text-[#bd804a]">{number}</span>
                      <div>
                        <h3 className="font-bold text-[#304b40]">{title}</h3>
                        <p className="mt-1 text-xs leading-5 text-[#6b7771]">{description}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <h3 className="mt-7 font-serif text-xl font-bold text-[#294238]">저장과 AI 코치</h3>
                <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-7 text-[#56655d] marker:text-[#b57743]">
                  <li>입력 내용은 서버에 자동 저장됩니다. 저장 표시가 끝난 뒤 다른 기기에서도 같은 계정으로 이어갈 수 있습니다.</li>
                  <li>출처를 추가하면 해당 메모나 문장과 연결해 두고, 마지막 점검에서 근거를 다시 확인할 수 있습니다.</li>
                  <li>AI 코치는 <strong>생각 질문, 연구 방향, 점검, 부분 다듬기</strong> 중 필요한 도움만 요청합니다.</li>
                  <li>AI 제안은 곧바로 내 원고가 되지 않습니다. 내용을 읽고 <strong>내 작업에 채택</strong>을 눌러야 반영됩니다.</li>
                  <li>마지막 여섯 가지 점검을 모두 확인하고 완료하면 “목회자 작성 · AI 보조” 설교로 내 설교에 저장됩니다.</li>
                </ul>
                <Callout title="AI 코치 비용" tone="amber">
                  직접 작성과 자동 저장은 무료입니다. AI 코치를 호출할 때만 기본 1토큰, 고급 2토큰, 고급 추론 4토큰을 사용하며, 제안을 만들지 못한 요청은 자동 환불됩니다.
                </Callout>
              </section>

              <section id="ai-drafts" className="scroll-mt-6" aria-labelledby="ai-drafts-title">
                <SectionTitle id="ai-drafts-title" number="04" title="AI 다섯 초안 만들기" description="하나의 공통 엔진으로 다섯 설교 방향을 순서대로 만들고, 원하는 한 편을 골라 완성합니다." />
                <StepList>
                  <Step><strong className="text-[#304b40]">기본 옵션 설정</strong><br />설교 제목, 10~30분 분량, 유형, 1~4대지, 대상, 청중 상황, 감정선과 예배 유형을 선택합니다.</Step>
                  <Step><strong className="text-[#304b40]">공통 AI 엔진 선택</strong><br />기본·고급·고급 추론 중 하나를 선택합니다. 선택한 등급은 다섯 초안 전체에 공통 적용되고 예상 토큰이 화면에 표시됩니다.</Step>
                  <Step><strong className="text-[#304b40]">본문 확인</strong><br />성경 본문 범위를 입력하고 서비스가 정리한 표기가 맞는지 직접 확인합니다. 참고 URL, 메모와 TXT 파일도 선택적으로 추가할 수 있습니다.</Step>
                  <Step><strong className="text-[#304b40]">생성 진행</strong><br />다섯 초안은 순차 생성됩니다. 다른 화면으로 이동해도 상단의 “생성 중” 표시로 돌아올 수 있고, 중지하면 이미 완성된 초안은 유지됩니다.</Step>
                  <Step><strong className="text-[#304b40]">비교와 선택</strong><br />서로 다른 중심 메시지와 흐름을 읽고 한 편을 선택합니다. 제목만 보지 말고 본문 해석, 그리스도 연결과 회중 적용을 함께 확인하세요.</Step>
                  <Step><strong className="text-[#304b40]">수정과 완성</strong><br />도입·본문·결론·적용 중 원하는 부분을 최대 3회까지 AI로 수정한 뒤 저장하고 PDF 또는 Word로 내보냅니다.</Step>
                </StepList>
                <Callout title="중복 차감 방지">
                  같은 생성 작업을 이어서 실행하거나 네트워크 문제로 같은 요청이 다시 전달되어도 작업 ID 기준으로 중복 차감하지 않습니다. 첫 결과가 전혀 만들어지지 않고 실패하면 사용한 토큰을 돌려줍니다.
                </Callout>
              </section>

              <section id="ai-agent" className="scroll-mt-6" aria-labelledby="ai-agent-title">
                <SectionTitle id="ai-agent-title" number="05" title="AI 에이전트 활용" description="화면 상단 우측의 AI 에이전트는 현재 열어 둔 업무를 이해하고 다음 행동을 함께 정리합니다." />
                <div className="mt-6 grid gap-4 md:grid-cols-2">
                  <div className="rounded-2xl border border-[#d9d3c8] p-5">
                    <h3 className="font-serif text-lg font-bold text-[#294238]">잘하는 일</h3>
                    <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-[#617068]">
                      <li>현재 화면 사용법과 다음 단계 설명</li>
                      <li>설교 옵션·본문·수정 지시 초안 준비</li>
                      <li>저장 설교 찾기와 후속 자료 입력 보조</li>
                      <li>스터디·비평·사역 활용 요청 정리</li>
                    </ul>
                  </div>
                  <div className="rounded-2xl border border-[#e0cdb8] bg-[#fbf5ec] p-5">
                    <h3 className="font-serif text-lg font-bold text-[#4e3b2d]">하지 않는 일</h3>
                    <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-[#6d5f54]">
                      <li>사용자 확인 없이 화면 내용 변경</li>
                      <li>결제·충전 또는 관리자·회원 설정 변경</li>
                      <li>삭제, 외부 전송이나 권한이 없는 정보 열람</li>
                      <li>개인 OpenAI 호환 엔진 사용</li>
                    </ul>
                  </div>
                </div>
                <p className="mt-5 text-sm leading-7 text-[#56655d]">에이전트가 준비한 변경은 내용을 확인하고 <strong>적용</strong>을 눌러야 실행됩니다. 대화 한 건은 기본 1토큰, 고급 2토큰, 고급 추론 4토큰이며 계정당 동시에 1건, 하루 60회까지 요청할 수 있습니다.</p>
              </section>

              <section id="history" className="scroll-mt-6" aria-labelledby="history-title">
                <SectionTitle id="history-title" number="06" title="저장·수정·내보내기" description="완성한 설교는 내 설교에서 다시 찾고, 당시의 설정과 원고를 함께 확인할 수 있습니다." />
                <ul className="mt-5 list-disc space-y-2 pl-5 text-sm leading-7 text-[#56655d] marker:text-[#b57743]">
                  <li><Link href="/history" className={GUIDE_LINK}>내 설교</Link>에서 제목으로 검색하고 최근 저장 순서로 확인합니다.</li>
                  <li>설교 상세에는 본문, 설교 유형, 대상, 상황, 분량과 전체 원고가 표시됩니다.</li>
                  <li><strong>PDF로 저장</strong>은 브라우저 인쇄 창을 열며, 대상에서 “PDF로 저장”을 선택합니다.</li>
                  <li><strong>Word 내려받기</strong>는 한글 서식을 포함한 편집용 DOCX 파일을 만듭니다.</li>
                  <li>공용 컴퓨터에서 내려받은 파일에는 설교 내용이 남으므로 사용 후 안전하게 이동하거나 삭제하세요.</li>
                </ul>
              </section>

              <section id="resources" className="scroll-mt-6" aria-labelledby="resources-title">
                <SectionTitle id="resources-title" number="07" title="스터디·비평·사역 활용" description="설교를 완성한 뒤 연구와 실제 사역 자료로 확장하는 세 가지 도구입니다." />
                <div className="mt-6 overflow-x-auto rounded-2xl border border-[#ddd7cd]">
                  <table className="w-full min-w-[42rem] border-collapse text-left text-sm">
                    <thead className="bg-[#f1eee7] text-[#344d42]">
                      <tr><th className="px-4 py-3 font-extrabold">도구</th><th className="px-4 py-3 font-extrabold">입력</th><th className="px-4 py-3 font-extrabold">만들 수 있는 결과</th></tr>
                    </thead>
                    <tbody className="divide-y divide-[#e4ded4] text-[#5d6b64]">
                      <tr><th className="px-4 py-4 font-bold text-[#315647]"><Link href="/study">스터디</Link></th><td className="px-4 py-4">직접 입력한 성경 본문</td><td className="px-4 py-4">헬라어·히브리어 원문, 저자·역사·지리·문화·청중 배경, 문학·구조 이해</td></tr>
                      <tr><th className="px-4 py-4 font-bold text-[#315647]"><Link href="/critique">설교 비평</Link></th><td className="px-4 py-4">직접 붙여 넣은 설교 원고</td><td className="px-4 py-4">통일성, 본문 밀착도, 복음의 흐름, 적용 구체성 등 일곱 축 점검</td></tr>
                      <tr><th className="px-4 py-4 font-bold text-[#315647]"><Link href="/ministry">사역 활용</Link></th><td className="px-4 py-4">내 설교에 저장된 완성 원고</td><td className="px-4 py-4">소그룹 나눔 질문지, 주보용 요약문, 숏폼 문구</td></tr>
                    </tbody>
                  </table>
                </div>
                <Callout title="토큰과 공정 이용 한도">
                  스터디와 사역 활용은 생성 1회당 기본 1 · 고급 2 · 고급추론 4토큰을 차감하고, 설교 비평은 토큰을 차감하지 않습니다. 세 도구는 계정당 합산 하루 20회, 동시에 1건만 생성할 수 있으며 실패한 요청은 일일 횟수에서 제외됩니다.
                </Callout>
              </section>

              <section id="feedback" className="scroll-mt-6" aria-labelledby="feedback-title">
                <SectionTitle id="feedback-title" number="08" title="설교 피드백" description="저장한 설교를 선택해 전문가에게 점검을 요청하고 메시지로 의견을 나눕니다." />
                <StepList>
                  <Step><Link href="/consult" className={GUIDE_LINK}>설교 피드백</Link>에서 내 설교 중 검토받을 원고를 선택합니다.</Step>
                  <Step>도움을 받고 싶은 이유와 특별히 살펴볼 부분을 구체적으로 작성해 신청합니다.</Step>
                  <Step>전문가가 요청을 배정받으면 원고를 확인하고 메시지를 남깁니다. 상태와 답변을 같은 화면에서 확인합니다.</Step>
                  <Step>전문가의 의견은 참고 자료입니다. 본문 해석과 최종 설교에 대한 판단과 책임은 설교자에게 있습니다.</Step>
                </StepList>
                <Callout title="개인정보를 최소화하세요" tone="amber">
                  피드백 신청 이유와 메시지에 교인 실명, 연락처, 건강정보나 비공개 상담 내용을 입력하지 마세요. 피드백 진행에 꼭 필요한 범위만 공유해 주세요.
                </Callout>
              </section>

              <section id="tokens" className="scroll-mt-6" aria-labelledby="tokens-title">
                <SectionTitle id="tokens-title" number="09" title="토큰과 충전" description="설교 생성 전에 예상 비용을 확인하고, 우측 상단에서 남은 토큰과 사용 내역을 관리합니다." />
                <div className="mt-6 grid gap-4 lg:grid-cols-3">
                  {[
                    ["기본", "1배", "10분·1포인트 약 10토큰부터"],
                    ["고급", "2배", "10분·1포인트 약 20토큰부터"],
                    ["고급 추론", "4배", "10분·1포인트 약 40토큰부터"],
                  ].map(([name, multiplier, cost]) => (
                    <div key={name} className="rounded-2xl border border-[#ded8ce] bg-[#fbfaf6] p-5">
                      <p className="text-xs font-extrabold text-[#9b6234]">{multiplier} 엔진</p>
                      <h3 className="mt-1 font-serif text-xl font-bold text-[#294238]">{name}</h3>
                      <p className="mt-2 text-sm text-[#68756e]">{cost}</p>
                    </div>
                  ))}
                </div>
                <p className="mt-5 text-sm leading-7 text-[#56655d]">설교 생성 비용은 <strong>엔진 배수 × (설교 분량 + 5 + 대지 추가분)</strong>으로 계산하며, 대지가 하나 늘 때마다 기본 단위 2가 더해집니다. 다섯 초안의 개수는 비용을 늘리지 않습니다. 실제 차감액은 옵션 화면의 예상 비용을 확인하세요.</p>
                <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-7 text-[#56655d] marker:text-[#b57743]">
                  <li>회원 가입 시 200토큰이 지급됩니다.</li>
                  <li>충전은 구독이 아닌 일회성 결제이며 1,000원당 기본 200토큰입니다.</li>
                  <li>충전 화면에 행사 보너스가 표시되면 결제 완료 후 기본 토큰과 함께 적립됩니다.</li>
                  <li>총 토큰은 현재 잔액과 지금까지 사용한 토큰의 합계이며, 남은 토큰은 지금 사용할 수 있는 잔액입니다.</li>
                  <li>결제 가능 여부와 결제 수단은 운영 환경에 따라 달라질 수 있으므로 <Link href="/tokens" className={GUIDE_LINK}>토큰 충전</Link> 화면의 안내를 확인하세요.</li>
                </ul>
              </section>

              <section id="account" className="scroll-mt-6" aria-labelledby="account-title">
                <SectionTitle id="account-title" number="10" title="계정과 알림" description="화면 상단 우측의 계정 버튼에서 사용자 정보, 설명서, 알림, 토큰과 로그아웃을 관리합니다." />
                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  {[
                    ["사용자 설명서", "지금 보고 있는 전체 이용 안내입니다."],
                    ["계정 설정", "이름, 사역 역할, 교단·신학, 교회와 연락처를 관리합니다."],
                    ["알림 설정", "설교 완성 이메일과 브라우저 알림을 원하는 채널만 선택합니다."],
                    ["토큰 충전", "현재 잔액, 누적 사용량, 충전과 거래 내역을 확인합니다."],
                  ].map(([title, description]) => (
                    <div key={title} className="rounded-2xl border border-[#ded8ce] p-4">
                      <h3 className="font-bold text-[#304b40]">{title}</h3>
                      <p className="mt-1 text-xs leading-5 text-[#6b7771]">{description}</p>
                    </div>
                  ))}
                </div>
                <Callout title="공용 기기에서는 반드시 로그아웃하세요">
                  로그인 유지 옵션을 사용하지 말고, 작업을 마친 뒤 계정 메뉴에서 로그아웃하세요. 내려받은 Word·PDF와 브라우저에 남은 사이트 데이터도 함께 확인하는 것이 안전합니다.
                </Callout>
              </section>

              <section id="troubleshooting" className="scroll-mt-6" aria-labelledby="troubleshooting-title">
                <SectionTitle id="troubleshooting-title" number="11" title="문제 해결" description="작업이 멈추거나 결과가 보이지 않을 때 아래 순서대로 확인하세요." />
                <div className="mt-6 space-y-3">
                  {[
                    ["생성이 오래 걸려요", "상단의 생성 중 표시를 확인하세요. 다른 화면에 있어도 작업은 이어질 수 있습니다. 같은 버튼을 여러 번 누르지 말고, 오류 문구가 나온 뒤 재시도하세요."],
                    ["토큰이 부족하다고 나와요", "우측 상단 잔액을 확인하고 토큰 충전 화면에서 내역을 확인하세요. 실패 환불 직후라면 잠시 기다린 뒤 새로고침하세요."],
                    ["저장한 설교가 안 보여요", "같은 계정으로 로그인했는지 확인하고 내 설교를 새로고침하세요. 설교도우미 작업은 완료 전까지 설교도우미 목록에 있습니다."],
                    ["브라우저 알림이 안 와요", "알림 설정에서 브라우저 알림을 켠 뒤 주소창의 사이트 권한도 허용했는지 확인하세요. 운영체제의 알림 차단 설정도 확인합니다."],
                    ["로그인이 반복해서 풀려요", "공용·시크릿 브라우저인지, 쿠키 차단이 켜져 있는지 확인하세요. 비밀번호를 잊었다면 로그인 화면의 재설정 기능을 사용합니다."],
                    ["AI 결과가 이상해요", "본문 범위와 옵션을 먼저 확인하고, 사실·인용·원어·역사 정보는 성경과 신뢰할 수 있는 자료로 재검증하세요. 필요한 부분만 구체적으로 수정 요청하는 것이 좋습니다."],
                  ].map(([question, answer]) => (
                    <details key={question} className="group rounded-2xl border border-[#ddd7cd] bg-[#fbfaf6] px-5 py-4 open:bg-white">
                      <summary className="cursor-pointer list-none pr-7 text-sm font-extrabold text-[#304b40] marker:hidden after:float-right after:content-['＋'] group-open:after:content-['−']">{question}</summary>
                      <p className="mt-3 text-sm leading-7 text-[#66746d]">{answer}</p>
                    </details>
                  ))}
                </div>
                <p className="mt-5 text-sm leading-7 text-[#66746d]">계속 해결되지 않으면 오류 문구, 발생 시각, 사용한 화면과 재현 순서를 적어 <a href="mailto:hello@sermonguide.kr" className={GUIDE_LINK}>hello@sermonguide.kr</a>로 문의해 주세요. 비밀번호와 API 키는 보내지 마세요.</p>
              </section>

              <section id="safe-use" className="scroll-mt-6" aria-labelledby="safe-use-title">
                <SectionTitle id="safe-use-title" number="12" title="안전하고 책임 있게 사용하기" description="로고스AI는 설교 준비 도구이며 목회자와 공동체의 최종 판단을 대신하지 않습니다." />
                <div className="mt-6 rounded-[1.5rem] border border-[#d9c4aa] bg-[#fbf2e6] p-5 sm:p-6">
                  <ul className="list-disc space-y-2 pl-5 text-sm leading-7 text-[#604f40] marker:text-[#aa6d37]">
                    <li>AI 결과의 성경 인용, 문맥, 원어, 역사 정보와 적용을 직접 검토하세요.</li>
                    <li>교인 실명, 연락처, 의료·재정 정보와 비공개 상담 내용을 입력하지 마세요.</li>
                    <li>참고 자료를 사용할 권한과 출처를 확인하고, 타인의 원고를 그대로 제출하지 마세요.</li>
                    <li>AI가 제안한 문장을 내 목회적 언어로 다시 다듬고 실제 회중의 상황에 맞는지 점검하세요.</li>
                    <li>중요한 설교는 Word 또는 PDF로 별도 보관하고 리허설 과정에서 최종 수정하세요.</li>
                  </ul>
                </div>
                <div className="mt-5 flex flex-wrap gap-3 text-xs font-bold">
                  <Link href="/privacy" className="rounded-xl border border-[#d6cfc3] px-4 py-3 text-[#53665d] hover:bg-[#f3f0e9]">개인정보처리방침</Link>
                  <Link href="/terms" className="rounded-xl border border-[#d6cfc3] px-4 py-3 text-[#53665d] hover:bg-[#f3f0e9]">이용약관</Link>
                  <Link href="/home" className="rounded-xl bg-[#315647] px-4 py-3 text-white hover:bg-[#25483a]">홈으로 돌아가기</Link>
                </div>
              </section>
            </div>
          </article>
        </div>
      </div>
    </AppShell>
  );
}
