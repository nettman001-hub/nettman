import type { Metadata } from "next";
import { AppNotice } from "@/app/_components/app-notice";
import { AppShell } from "@/app/_components/app-shell";
import { requirePageUser } from "@/app/_lib/auth-user";
import { HomeRecentSermons } from "./home-recent-sermons";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "홈 | 설교가이드",
  description: "최근 설교를 확인하고 새로운 설교 준비를 시작합니다.",
};

const QUICK_LINKS = [
  {
    number: "01",
    title: "본문에서 시작",
    description: "주제와 본문을 정하고 5가지 설교 방향을 받아보세요.",
    href: "/sermon/options",
    cta: "새 설교 만들기",
  },
  {
    number: "02",
    title: "완성본 다시 보기",
    description: "저장한 설교와 당시 설정을 한곳에서 찾아보세요.",
    href: "/history",
    cta: "내 설교 열기",
  },
  {
    number: "03",
    title: "한 걸음 더 다듬기",
    description: "전문가와 설교의 흐름, 적용, 표현을 함께 점검하세요.",
    href: "/consult",
    cta: "상담 살펴보기",
  },
];

function todayLabel() {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "long",
    timeZone: "Asia/Seoul",
  }).format(new Date());
}

export default async function HomePage() {
  const user = await requirePageUser("/home");
  const displayName = user.name;

  return (
    <AppShell
      active="home"
      user={
        { id: user.id, displayName: user.name, email: user.email, isAdmin: user.isAdmin }
      }
    >
      <div className="mx-auto max-w-[90rem] px-4 py-7 sm:px-7 sm:py-9 xl:px-10">
        {!user ? (
          <div className="mb-5">
            <AppNotice tone="warning" title="미리보기 모드입니다">
              현재 화면은 로컬에서도 확인할 수 있도록 열려 있습니다. 로그인하면
              설교와 설정이 계정에 연결됩니다. <a className="font-bold underline underline-offset-2" href="/login">로그인하기</a>
            </AppNotice>
          </div>
        ) : null}

        <section className="relative overflow-hidden rounded-[2rem] bg-[#1d3e32] px-6 py-7 text-white shadow-[0_26px_70px_rgba(25,51,42,.18)] sm:px-9 sm:py-9 lg:min-h-[20rem] lg:px-11 lg:py-10">
          <div
            aria-hidden="true"
            className="absolute -right-20 -top-28 size-80 rounded-full border-[46px] border-white/[0.035]"
          />
          <div
            aria-hidden="true"
            className="absolute -bottom-28 right-[18%] size-56 rounded-full bg-[#d79a55]/10 blur-2xl"
          />

          <div className="relative z-10 flex h-full flex-col justify-between gap-10 lg:flex-row lg:items-end">
            <div className="max-w-3xl">
              <p className="text-xs font-bold tracking-[0.18em] text-white uppercase">
                {todayLabel()} · 오늘의 준비
              </p>
              <h1 className="mt-5 font-serif text-[clamp(2.35rem,6vw,4.6rem)] font-bold leading-[1.02] tracking-[-0.045em]">
                {displayName}님,
                <br />
                오늘은 어떤 말씀을
                <br className="hidden sm:block" /> 전하시나요?
              </h1>
              <p className="mt-5 max-w-xl text-sm leading-6 text-white sm:text-base">
                본문과 마음에 품은 방향을 들려주세요. 구조가 선명한 첫 초안부터
                함께 시작하겠습니다.
              </p>
            </div>

            <div className="flex shrink-0 flex-col gap-2.5 sm:flex-row lg:flex-col">
              <a
                href="/sermon/options"
                className="inline-flex min-h-13 items-center justify-center gap-3 rounded-2xl bg-[#e7bb80] px-6 text-sm font-extrabold text-[#20392f] shadow-[0_14px_30px_rgba(0,0,0,.16)] transition-transform hover:-translate-y-0.5 hover:bg-[#f0ca99] focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                새 설교 시작
                <span aria-hidden="true" className="text-lg">→</span>
              </a>
              <a
                href="/history"
                className="inline-flex min-h-12 items-center justify-center rounded-2xl border border-white/15 bg-white/7 px-6 text-sm font-bold text-white hover:bg-white/12 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#e7bb80]"
              >
                저장한 설교 보기
              </a>
            </div>
          </div>
        </section>

        <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(20rem,.75fr)]">
          <section className="rounded-[1.75rem] border border-[#ddd7cd] bg-white p-5 shadow-[0_16px_45px_rgba(39,50,44,.06)] sm:p-7" aria-labelledby="recent-title">
            <div className="mb-4 flex items-end justify-between gap-4">
              <div>
                <p className="text-[10px] font-extrabold tracking-[0.17em] text-[#a56732] uppercase">Recent work</p>
                <h2 id="recent-title" className="mt-1.5 font-serif text-2xl font-bold tracking-tight text-[#254238]">최근 설교</h2>
              </div>
              <a href="/history" className="rounded-lg text-xs font-bold text-[#5e7068] hover:text-[#a2602c] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838]">전체 보기 →</a>
            </div>
            <HomeRecentSermons />
          </section>

          <aside className="rounded-[1.75rem] border border-[#d8d0c4] bg-[#ebe2d4] p-6 sm:p-7" aria-labelledby="guide-title">
            <span className="inline-flex rounded-full bg-white/70 px-3 py-1 text-[10px] font-extrabold tracking-[0.15em] text-[#8c5c32] uppercase">Preparation guide</span>
            <h2 id="guide-title" className="mt-5 font-serif text-2xl font-bold tracking-tight text-[#294238]">한 편의 설교가 완성되는 길</h2>
            <ol className="mt-5 space-y-3">
              {["주제와 청중 정하기", "본문과 구조 살피기", "5가지 대안 비교하기", "수정하고 최종 완성하기"].map((step, index) => (
                <li key={step} className="flex items-center gap-3 text-sm font-semibold text-[#52635b]">
                  <span className="grid size-7 shrink-0 place-items-center rounded-full border border-[#b9ac9a] bg-white/50 text-[10px] font-black text-[#6f5236]">{index + 1}</span>
                  {step}
                </li>
              ))}
            </ol>
          </aside>
        </div>

        <section className="mt-10" aria-labelledby="quick-title">
          <div className="flex items-end justify-between">
            <div>
              <p className="text-[10px] font-extrabold tracking-[0.17em] text-[#a56732] uppercase">Quick paths</p>
              <h2 id="quick-title" className="mt-1.5 font-serif text-2xl font-bold tracking-tight text-[#254238]">바로가기</h2>
            </div>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            {QUICK_LINKS.map((item) => (
              <a
                key={item.number}
                href={item.href}
                className="group rounded-[1.5rem] border border-[#ddd7cd] bg-white p-5 shadow-[0_10px_30px_rgba(39,50,44,.04)] transition-all hover:-translate-y-1 hover:border-[#c8b69e] hover:shadow-[0_18px_45px_rgba(39,50,44,.09)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838] sm:p-6"
              >
                <div className="flex items-start justify-between gap-4">
                  <span className="font-serif text-2xl font-bold text-[#d0a56f]">{item.number}</span>
                  <span aria-hidden="true" className="grid size-9 place-items-center rounded-full bg-[#eff3ef] text-[#456456] transition-transform group-hover:translate-x-1">→</span>
                </div>
                <h3 className="mt-7 font-serif text-xl font-bold text-[#2b4439]">{item.title}</h3>
                <p className="mt-2 text-sm leading-6 text-[#747e78]">{item.description}</p>
                <span className="mt-5 inline-block text-xs font-extrabold text-[#87582f]">{item.cta}</span>
              </a>
            ))}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
