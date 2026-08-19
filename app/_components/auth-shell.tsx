import type { ReactNode } from "react";

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f3efe7] text-[#1e3028]">
      <a
        href="#auth-content"
        className="fixed left-3 top-3 z-50 -translate-y-24 rounded-xl bg-white px-4 py-2 text-sm font-bold shadow-xl transition-transform focus:translate-y-0"
      >
        인증 내용으로 건너뛰기
      </a>

      <div className="grid min-h-screen lg:grid-cols-[minmax(0,1.05fr)_minmax(28rem,.95fr)]">
        <aside className="relative hidden overflow-hidden bg-[#18342a] p-10 text-white lg:flex lg:flex-col lg:justify-between xl:p-14">
          <div
            aria-hidden="true"
            className="absolute -right-28 -top-28 size-80 rounded-full border border-white/10 bg-[#d9a869]/10"
          />
          <div
            aria-hidden="true"
            className="absolute -bottom-40 -left-32 size-[28rem] rounded-full border-[70px] border-white/[0.035]"
          />

          <a
            href="/"
            className="relative z-10 inline-flex w-fit items-center gap-3 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-[#efc58e]"
            aria-label="로고스AI 시작 화면"
          >
            <span className="grid size-11 place-items-center rounded-[15px] bg-[#efcf9f] font-serif text-lg font-bold text-[#234033]">
              로
            </span>
            <span>
              <span className="block font-serif text-xl font-bold tracking-tight">
                로고스AI
              </span>
              <span className="block text-[10px] font-semibold tracking-[0.2em] text-white">
                LOGOS AI
              </span>
            </span>
          </a>

          <div className="relative z-10 max-w-xl pb-10">
            <p className="text-xs font-bold tracking-[0.2em] text-white uppercase">
              From text to pulpit
            </p>
            <h2 className="mt-5 font-serif text-[clamp(2.6rem,5vw,4.8rem)] font-bold leading-[1.02] tracking-[-0.045em]">
              말씀을 붙들고,
              <br />
              더 깊이 준비하세요.
            </h2>
            <p className="mt-6 max-w-lg text-base leading-7 text-white">
              본문에서 시작해 구조와 적용까지. 로고스AI는 목회자의 생각을
              대신하지 않고, 더 선명하게 다듬는 준비 공간입니다.
            </p>

            <div className="mt-10 grid max-w-lg grid-cols-3 gap-3 border-t border-white/10 pt-7">
              {[
                ["5가지", "설교 대안"],
                ["3회", "정교한 수정"],
                ["한곳", "저장과 피드백"],
              ].map(([value, label]) => (
                <div key={label}>
                  <p className="font-serif text-xl font-bold text-white">
                    {value}
                  </p>
                  <p className="mt-1 text-xs text-white">{label}</p>
                </div>
              ))}
            </div>
          </div>

          <p className="relative z-10 text-xs leading-5 text-white">
            “내 입의 말과 마음의 묵상이 주님 앞에 열납되기를.”
            <span className="ml-2 text-white">시편 19:14</span>
          </p>
        </aside>

        <main
          id="auth-content"
          className="flex min-h-screen flex-col px-5 py-6 sm:px-10 sm:py-8 lg:px-12 xl:px-20"
        >
          <div className="flex items-center justify-between lg:justify-end">
            <a
              href="/"
              className="inline-flex items-center gap-2 rounded-xl font-serif text-lg font-bold text-[#234033] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b8773e] lg:hidden"
            >
              <span className="grid size-9 place-items-center rounded-xl bg-[#234b3c] text-sm text-white">
                설
              </span>
              로고스AI
            </a>
            <a
              href="/"
              className="rounded-xl px-3 py-2 text-sm font-bold text-[#66736d] hover:bg-white/70 hover:text-[#27493c] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b8773e]"
            >
              서비스 둘러보기
            </a>
          </div>

          <div className="mx-auto flex w-full max-w-[30rem] flex-1 items-center py-10">
            {children}
          </div>

          <p className="text-center text-[11px] leading-5 text-[#8b918d]">
            이메일·Google 인증은 Supabase Auth가 처리하며, 로고스AI는 원문
            비밀번호를 저장하지 않습니다.
          </p>
        </main>
      </div>
    </div>
  );
}
