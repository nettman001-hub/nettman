import type { ReactNode } from "react";

type AuthCardProps = {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
};

export function AuthCard({
  eyebrow,
  title,
  description,
  children,
  footer,
}: AuthCardProps) {
  return (
    <section className="w-full" aria-labelledby="auth-title">
      <p className="text-[11px] font-extrabold tracking-[0.18em] text-[#a3622e] uppercase">
        {eyebrow}
      </p>
      <h1
        id="auth-title"
        className="mt-3 font-serif text-[clamp(2.25rem,7vw,3.5rem)] font-bold leading-[1.08] tracking-[-0.04em] text-[#203b30]"
      >
        {title}
      </h1>
      <p className="mt-4 text-sm leading-6 text-[#68736d] sm:text-base">
        {description}
      </p>

      <div className="mt-8 rounded-[1.75rem] border border-[#d8d2c7] bg-white p-5 shadow-[0_24px_70px_rgba(38,48,42,.09)] sm:p-7">
        {children}
      </div>

      {footer ? (
        <div className="mt-6 text-center text-sm text-[#6b746f]">{footer}</div>
      ) : null}
    </section>
  );
}

export function AuthPrimaryLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      className="inline-flex min-h-13 w-full items-center justify-center gap-3 rounded-2xl bg-[#244f3f] px-5 py-3.5 text-sm font-extrabold text-white shadow-[0_12px_30px_rgba(31,74,58,.18)] transition-all hover:-translate-y-0.5 hover:bg-[#1d4436] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#c28046] focus-visible:ring-offset-2"
    >
      <span
        aria-hidden="true"
        className="grid size-7 place-items-center rounded-lg bg-white text-[11px] font-black text-[#244f3f]"
      >
        AI
      </span>
      {children}
    </a>
  );
}

export function AuthAssurance() {
  return (
    <div className="mt-5 flex items-start gap-3 rounded-2xl bg-[#f2f5f1] px-4 py-3.5 text-[#52615a]">
      <span
        aria-hidden="true"
        className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-[#dbe9e0] text-[11px] font-black text-[#2d5947]"
      >
        ✓
      </span>
      <p className="text-xs leading-5">
        비밀번호는 Supabase Auth가 암호화해 처리합니다. 로고스AI의 앱
        데이터베이스에는 원문 비밀번호를 저장하지 않습니다.
      </p>
    </div>
  );
}
