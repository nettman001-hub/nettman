import Link from "next/link";
import type { ReactNode } from "react";

export type LegalSection = {
  id: string;
  title: string;
  content: ReactNode;
};

type LegalDocumentProps = {
  currentPath: "/privacy" | "/terms";
  eyebrow: string;
  title: string;
  summary: string;
  effectiveDate: string;
  sections: readonly LegalSection[];
};

function PublicHeader() {
  return (
    <header className="border-b border-[#18312b]/10 bg-[#f7f4ed]/95 backdrop-blur">
      <div className="container flex min-h-20 items-center justify-between gap-4 sm:min-h-[5.75rem]">
        <Link className="brand" href="/" aria-label="로고스AI 홈">
          <span className="brand-mark" aria-hidden="true">로</span>
          <span>로고스AI</span>
        </Link>
        <nav className="flex items-center gap-2 sm:gap-5" aria-label="공개 페이지 메뉴">
          <Link
            href="/"
            className="hidden rounded-xl px-3 py-2 text-sm font-bold text-[#606c66] hover:bg-white hover:text-[#18312b] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b95038] sm:inline-flex"
          >
            서비스 소개
          </Link>
          <Link className="button button-sm button-dark" href="/login">
            로그인
          </Link>
        </nav>
      </div>
    </header>
  );
}

function PublicFooter({ currentPath }: Pick<LegalDocumentProps, "currentPath">) {
  return (
    <footer className="landing-footer container">
      <Link className="brand" href="/">
        <span className="brand-mark" aria-hidden="true">로</span>
        <span>로고스AI</span>
      </Link>
      <p>말씀의 본질을 지키는 설교 준비 파트너</p>
      <nav aria-label="하단 메뉴">
        <Link href="/privacy" aria-current={currentPath === "/privacy" ? "page" : undefined}>
          개인정보처리방침
        </Link>
        <Link href="/terms" aria-current={currentPath === "/terms" ? "page" : undefined}>
          이용약관
        </Link>
        <a href="mailto:hello@sermonguide.kr">문의하기</a>
      </nav>
      <small>© 2026 LOGOS AI. All rights reserved.</small>
    </footer>
  );
}

export function LegalDocument({
  currentPath,
  eyebrow,
  title,
  summary,
  effectiveDate,
  sections,
}: LegalDocumentProps) {
  return (
    <main className="min-h-screen bg-[#f7f4ed] text-[#18312b]">
      <a
        href="#legal-content"
        className="fixed left-3 top-3 z-50 -translate-y-24 rounded-xl bg-white px-4 py-2 text-sm font-bold shadow-xl transition-transform focus:translate-y-0"
      >
        본문으로 건너뛰기
      </a>

      <PublicHeader />

      <section className="bg-[#18342a] text-white">
        <div className="container py-16 sm:py-20 lg:py-24">
          <p className="text-xs font-extrabold tracking-[0.2em] text-white uppercase">
            {eyebrow}
          </p>
          <h1 className="mt-5 max-w-4xl font-serif text-[clamp(2.7rem,7vw,5.3rem)] font-bold leading-[1.05] tracking-[-0.045em]">
            {title}
          </h1>
          <p className="mt-7 max-w-3xl text-sm leading-7 text-white sm:text-base sm:leading-8">
            {summary}
          </p>
          <p className="mt-8 inline-flex rounded-full border border-white/20 px-4 py-2 text-xs font-bold text-white">
            시행일 {effectiveDate}
          </p>
        </div>
      </section>

      <div
        id="legal-content"
        className="container grid scroll-mt-6 gap-10 py-12 lg:grid-cols-[15rem_minmax(0,1fr)] lg:items-start lg:py-20"
      >
        <aside className="rounded-3xl border border-[#18312b]/10 bg-[#fffdf8] p-5 lg:sticky lg:top-6">
          <p className="text-xs font-extrabold tracking-[0.14em] text-[#b95038] uppercase">
            목차
          </p>
          <ol className="mt-4 grid gap-1.5">
            {sections.map((section, index) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className="flex gap-2 rounded-xl px-2.5 py-2 text-sm leading-6 text-[#52615a] transition-colors hover:bg-[#dfe8d6] hover:text-[#18312b] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b95038]"
                >
                  <span aria-hidden="true" className="shrink-0 font-serif text-[#a3622e]">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span>{section.title}</span>
                </a>
              </li>
            ))}
          </ol>
        </aside>

        <article className="rounded-[2rem] border border-[#18312b]/10 bg-[#fffdf8] px-5 py-8 shadow-[0_22px_60px_rgba(24,49,43,.07)] sm:px-9 sm:py-11 lg:px-14 lg:py-14">
          <div className="rounded-2xl border border-[#b9cbb1] bg-[#eef3e9] px-5 py-4 text-sm leading-7 text-[#29453e]">
            이 문서는 현재 제공되는 로고스AI의 기능과 데이터 흐름을 기준으로 작성했습니다.
            서비스에 입력하기 전, 공개되면 곤란한 개인정보나 제3자의 비밀정보가 포함되지 않았는지 확인해 주세요.
          </div>

          <div className="mt-12 space-y-14">
            {sections.map((section, index) => (
              <section
                id={section.id}
                key={section.id}
                className="scroll-mt-8 border-b border-[#18312b]/10 pb-14 last:border-0 last:pb-0"
                aria-labelledby={`${section.id}-title`}
              >
                <p className="font-serif text-sm font-bold text-[#b95038]">
                  {String(index + 1).padStart(2, "0")}
                </p>
                <h2
                  id={`${section.id}-title`}
                  className="mt-2 font-serif text-[clamp(1.55rem,4vw,2.1rem)] font-bold leading-tight tracking-[-0.035em]"
                >
                  {section.title}
                </h2>
                <div className="mt-6 space-y-5 text-[15px] leading-8 text-[#43534c] [&_a]:font-bold [&_a]:text-[#8f432f] [&_a]:underline [&_a]:underline-offset-4 [&_h3]:pt-2 [&_h3]:font-serif [&_h3]:text-lg [&_h3]:font-bold [&_h3]:text-[#18312b] [&_li]:pl-1 [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-6 [&_p]:m-0 [&_strong]:font-extrabold [&_strong]:text-[#29453e] [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6">
                  {section.content}
                </div>
              </section>
            ))}
          </div>
        </article>
      </div>

      <PublicFooter currentPath={currentPath} />
    </main>
  );
}
