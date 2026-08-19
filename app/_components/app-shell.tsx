"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { SecureSignoutButton } from "@/app/_components/secure-signout-link";
import {
  TOKEN_WALLET_CHANGED_EVENT,
  type TokenWalletEventDetail,
} from "@/app/_lib/token-wallet-events";

export type AppSection =
  | "home"
  | "sermon"
  | "history"
  | "consult"
  | "expert"
  | "study"
  | "ministry"
  | "tokens"
  | "my"
  | "notifications"
  | "admin-members"
  | "admin-ai";

type AppShellUser = {
  id: string;
  displayName: string;
  email: string;
  isAdmin?: boolean;
};

type AppShellProps = {
  active: AppSection;
  children: ReactNode;
  user: AppShellUser | null;
};

type NavItem = {
  id: AppSection;
  label: string;
  href: string;
  marker: string;
};

type TokenSummary = {
  total: number;
  remaining: number;
};

const PRIMARY_NAV: NavItem[] = [
  { id: "home", label: "홈", href: "/home", marker: "홈" },
  { id: "sermon", label: "새 설교", href: "/sermon/options", marker: "새" },
  { id: "history", label: "내 설교", href: "/history", marker: "록" },
  { id: "consult", label: "설교 피드백", href: "/consult", marker: "피" },
  { id: "study", label: "스터디", href: "/study", marker: "연" },
  { id: "ministry", label: "사역 활용", href: "/ministry", marker: "활" },
  { id: "expert", label: "설교 피드백실", href: "/expert", marker: "실" },
];

const SETTINGS_NAV: NavItem[] = [
  { id: "tokens", label: "토큰 충전", href: "/tokens", marker: "충" },
  { id: "my", label: "계정 설정", href: "/my", marker: "나" },
  {
    id: "notifications",
    label: "알림 설정",
    href: "/notifications",
    marker: "알",
  },
];

const ADMIN_NAV: NavItem[] = [
  { id: "admin-members", label: "회원 관리", href: "/admin/members", marker: "회" },
  { id: "admin-ai", label: "AI 엔진 관리", href: "/admin/ai", marker: "관" },
];

function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "로";
  const parts = trimmed.split(/\s+/);
  if (parts.length > 1) {
    return parts
      .slice(0, 2)
      .map((part) => part.charAt(0))
      .join("")
      .toUpperCase();
  }
  return trimmed.slice(0, 2);
}

function tokenSummary(wallet: TokenWalletEventDetail): TokenSummary | null {
  if (
    !Number.isSafeInteger(wallet.balance) ||
    !Number.isSafeInteger(wallet.lifetimeSpent) ||
    wallet.balance < 0 ||
    wallet.lifetimeSpent < 0
  ) {
    return null;
  }
  return {
    total: wallet.balance + wallet.lifetimeSpent,
    remaining: wallet.balance,
  };
}

function formatTokens(value: number): string {
  return value.toLocaleString("ko-KR");
}

function formatCompactTokens(value: number): string {
  return new Intl.NumberFormat("ko-KR", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function Brand() {
  return (
    <a
      href="/home"
      className="group inline-flex items-center gap-3 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-[#c7894a] focus-visible:ring-offset-4 focus-visible:ring-offset-[#172b24]"
      aria-label="로고스AI 홈"
    >
      <span
        aria-hidden="true"
        className="grid size-10 place-items-center rounded-[14px] bg-[#f1d4a9] font-serif text-lg font-bold text-[#263d34] shadow-[inset_0_0_0_1px_rgba(255,255,255,.35)] transition-transform group-hover:-rotate-3"
      >
        로
      </span>
      <span>
        <span className="block font-serif text-lg font-bold tracking-[-0.02em] text-white">
          로고스AI
        </span>
        <span className="block text-[10px] font-semibold tracking-[0.18em] text-white">
          LOGOS AI
        </span>
      </span>
    </a>
  );
}

function NavList({
  active,
  items,
  onNavigate,
}: {
  active: AppSection;
  items: NavItem[];
  onNavigate?: () => void;
}) {
  return (
    <ul className="space-y-1.5">
      {items.map((item) => {
        const selected = item.id === active;
        return (
          <li key={item.id}>
            <a
              href={item.href}
              onClick={onNavigate}
              aria-current={selected ? "page" : undefined}
              className={`group flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#e0ad6e] ${
                selected
                  ? "bg-white/12 text-white shadow-[inset_3px_0_0_#e0ad6e]"
                  : "text-white hover:bg-white/7"
              }`}
            >
              <span
                aria-hidden="true"
                className={`grid size-7 place-items-center rounded-lg text-[10px] font-bold ${
                  selected
                    ? "bg-[#e8c28d] text-[#263d34]"
                    : "bg-white/8 text-white group-hover:bg-white/12"
                }`}
              >
                {item.marker}
              </span>
              <span>{item.label}</span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

function UserSummary({ user }: { user: AppShellUser | null }) {
  if (!user) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/6 p-3.5">
        <p className="text-xs leading-5 text-white">
          로그인하면 설교와 설정을 안전하게 이어서 사용할 수 있습니다.
        </p>
        <a
          href="/login?return_to=%2Fhome"
          className="mt-3 inline-flex min-h-10 w-full items-center justify-center rounded-xl bg-[#f0d09f] px-3 text-xs font-bold text-[#21372e] transition-colors hover:bg-[#f6ddba] focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          이메일 또는 Google로 로그인
        </a>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/6 p-3">
      <span
        aria-hidden="true"
        className="grid size-10 shrink-0 place-items-center rounded-full bg-[#d7e5dc] text-xs font-bold text-[#264237]"
      >
        {initials(user.displayName)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold text-white">
          {user.displayName}
        </span>
        <span className="block truncate text-[11px] text-white">
          {user.email}
        </span>
      </span>
      <SecureSignoutButton
        returnTo="/"
        className="shrink-0 rounded-lg px-2 py-1.5 text-[11px] font-semibold text-white hover:bg-white/8 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#e0ad6e]"
      >
        로그아웃
      </SecureSignoutButton>
    </div>
  );
}

function TokenSummaryLink({
  summary,
  compact = false,
}: {
  summary: TokenSummary | null;
  compact?: boolean;
}) {
  const total = summary
    ? compact
      ? formatCompactTokens(summary.total)
      : formatTokens(summary.total)
    : "—";
  const remaining = summary
    ? compact
      ? formatCompactTokens(summary.remaining)
      : formatTokens(summary.remaining)
    : "—";

  if (compact) {
    return (
      <a
        href="/tokens"
        className="ml-auto grid min-w-[7rem] grid-cols-2 gap-1 rounded-xl border border-[#d4cec2] bg-white px-2 py-1.5 text-center shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838]"
        aria-label={
          summary
            ? `총 토큰 ${formatTokens(summary.total)}, 남은 토큰 ${formatTokens(summary.remaining)}`
            : "토큰 현황 불러오는 중"
        }
      >
        <span>
          <span className="block text-[9px] font-bold text-[#7b837f]">총</span>
          <strong className="block text-[11px] font-black tabular-nums text-[#34483f]">
            {total}
          </strong>
        </span>
        <span className="border-l border-[#e5e0d8]">
          <span className="block text-[9px] font-bold text-[#9b6238]">남음</span>
          <strong className="block text-[11px] font-black tabular-nums text-[#a05235]">
            {remaining}
          </strong>
        </span>
      </a>
    );
  }

  return (
    <a
      href="/tokens"
      className="block rounded-2xl border border-white/10 bg-white/7 p-3.5 text-white transition-colors hover:bg-white/11 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#e0ad6e]"
      aria-label={
        summary
          ? `총 토큰 ${total}, 남은 토큰 ${remaining}. 토큰 충전 페이지로 이동`
          : "토큰 현황 불러오는 중. 토큰 충전 페이지로 이동"
      }
    >
      <span className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold tracking-[0.14em] text-[#e5c79e]">
          TOKEN WALLET
        </span>
        <span className="text-[10px] font-semibold text-white/75">충전하기</span>
      </span>
      <span className="mt-3 grid grid-cols-2 gap-3">
        <span>
          <span className="block text-[10px] font-semibold text-white/75">총 토큰</span>
          <strong className="mt-1 block text-lg font-black tabular-nums text-white">
            {total}
          </strong>
        </span>
        <span className="border-l border-white/15 pl-3">
          <span className="block text-[10px] font-semibold text-white/75">남은 토큰</span>
          <strong className="mt-1 block text-lg font-black tabular-nums text-[#f2c98e]">
            {remaining}
          </strong>
        </span>
      </span>
    </a>
  );
}

function Sidebar({
  active,
  user,
  tokenWallet,
  onNavigate,
}: {
  active: AppSection;
  user: AppShellUser | null;
  tokenWallet: TokenSummary | null;
  onNavigate?: () => void;
}) {
  const adminNav = user?.isAdmin ? ADMIN_NAV : [];
  return (
    <div className="flex h-full flex-col overflow-y-auto px-4 py-5 sm:px-5 sm:py-6">
      <div className="px-2">
        <Brand />
      </div>

      <a
        href="/sermon/options"
        onClick={onNavigate}
        className="mt-8 flex min-h-12 items-center justify-between rounded-2xl bg-[#e5b679] px-4 text-sm font-extrabold text-[#21372e] shadow-[0_12px_24px_rgba(0,0,0,.16)] transition-all hover:-translate-y-0.5 hover:bg-[#edc48f] focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        <span>새 설교 시작</span>
        <span aria-hidden="true" className="text-xl font-normal">
          +
        </span>
      </a>

      <nav className="mt-7" aria-label="주요 메뉴">
        <p className="mb-2 px-3 text-[10px] font-bold tracking-[0.18em] text-white">
          WORKSPACE
        </p>
        <NavList active={active} items={PRIMARY_NAV} onNavigate={onNavigate} />
      </nav>

      <nav className="mt-7" aria-label="설정 메뉴">
        <p className="mb-2 px-3 text-[10px] font-bold tracking-[0.18em] text-white">
          PREFERENCES
        </p>
        <NavList active={active} items={SETTINGS_NAV} onNavigate={onNavigate} />
      </nav>

      {adminNav.length ? (
        <nav className="mt-7" aria-label="관리 메뉴">
          <p className="mb-2 px-3 text-[10px] font-bold tracking-[0.18em] text-white">
            ADMINISTRATION
          </p>
          <NavList active={active} items={adminNav} onNavigate={onNavigate} />
        </nav>
      ) : null}

      <div className="mt-auto pt-6">
        {user ? <TokenSummaryLink summary={tokenWallet} /> : null}
        <div className={user ? "mt-3" : undefined}>
        <UserSummary user={user} />
        </div>
      </div>
    </div>
  );
}

export function AppShell({ active, children, user }: AppShellProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [tokenWallet, setTokenWallet] = useState<TokenSummary | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!user) {
      setTokenWallet(null);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    async function refreshTokenWallet() {
      try {
        const response = await fetch("/api/tokens", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) return;
        const body = (await response.json()) as {
          wallet?: TokenWalletEventDetail;
        };
        const next = body.wallet ? tokenSummary(body.wallet) : null;
        if (!cancelled && next) setTokenWallet(next);
      } catch {
        // Keep the last known token values during temporary network failures.
      }
    }

    function handleWalletChanged(event: Event) {
      const detail = (event as CustomEvent<TokenWalletEventDetail | undefined>)
        .detail;
      const next = detail ? tokenSummary(detail) : null;
      if (next) setTokenWallet(next);
      else void refreshTokenWallet();
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") void refreshTokenWallet();
    }

    void refreshTokenWallet();
    window.addEventListener(TOKEN_WALLET_CHANGED_EVENT, handleWalletChanged);
    window.addEventListener("focus", refreshTokenWallet);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      cancelled = true;
      controller.abort();
      window.removeEventListener(TOKEN_WALLET_CHANGED_EVENT, handleWalletChanged);
      window.removeEventListener("focus", refreshTokenWallet);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [user]);

  useEffect(() => {
    if (!menuOpen) return;

    const previouslyFocused = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, [menuOpen]);

  return (
    <div className="min-h-screen bg-[#f4f1ea] text-[#1d2c25]">
      <a
        href="#main-content"
        className="fixed left-3 top-3 z-[70] -translate-y-24 rounded-xl bg-white px-4 py-2 text-sm font-bold text-[#183128] shadow-xl transition-transform focus:translate-y-0"
      >
        본문으로 건너뛰기
      </a>

      <div className="lg:grid lg:min-h-screen lg:grid-cols-[17.5rem_minmax(0,1fr)]">
        <aside className="hidden bg-[#172b24] lg:sticky lg:top-0 lg:block lg:h-screen">
          <Sidebar active={active} user={user} tokenWallet={tokenWallet} />
        </aside>

        <div className="min-w-0">
          <header className="sticky top-0 z-40 flex h-[4.5rem] items-center justify-between gap-2 border-b border-[#d9d5cb] bg-[#f4f1ea]/95 px-4 backdrop-blur sm:px-6 lg:hidden">
            <div className="[&>a>span:last-child_span:first-child]:!text-[#1f382f] [&>a>span:last-child_span:last-child]:!text-[#6c7a74]">
              <a
                href="/home"
                className="inline-flex items-center gap-2.5 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838]"
                aria-label="로고스AI 홈"
              >
                <span
                  aria-hidden="true"
                  className="grid size-9 place-items-center rounded-xl bg-[#315647] font-serif text-sm font-bold text-white"
                >
                  로
                </span>
                <span className="max-[360px]:hidden">
                  <span className="block font-serif text-base font-bold tracking-tight text-[#1f382f]">
                    로고스AI
                  </span>
                  <span className="block text-[9px] font-semibold tracking-[0.14em] text-[#6c7a74]">
                    LOGOS AI
                  </span>
                </span>
              </a>
            </div>
            {user ? <TokenSummaryLink summary={tokenWallet} compact /> : null}
            <button
              type="button"
              aria-expanded={menuOpen}
              aria-controls="mobile-navigation"
              onClick={() => setMenuOpen(true)}
              className="grid size-11 place-items-center rounded-xl border border-[#cec8bc] bg-white text-[#244237] shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838]"
            >
              <span className="sr-only">메뉴 열기</span>
              <span aria-hidden="true" className="space-y-1.5">
                <span className="block h-0.5 w-5 rounded bg-current" />
                <span className="block h-0.5 w-5 rounded bg-current" />
                <span className="block h-0.5 w-5 rounded bg-current" />
              </span>
            </button>
          </header>

          <main id="main-content" className="min-h-screen">
            {children}
          </main>
        </div>
      </div>

      {menuOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="메뉴 닫기"
            className="absolute inset-0 bg-[#0b1712]/60 backdrop-blur-sm"
            onClick={() => setMenuOpen(false)}
          />
          <aside
            id="mobile-navigation"
            className="absolute inset-y-0 right-0 w-[min(88vw,21rem)] bg-[#172b24] shadow-[-24px_0_60px_rgba(0,0,0,.24)]"
            aria-label="모바일 메뉴"
            aria-modal="true"
            role="dialog"
          >
            <button
              ref={closeButtonRef}
              type="button"
              onClick={() => setMenuOpen(false)}
              className="absolute right-4 top-4 z-10 grid size-10 place-items-center rounded-xl bg-white/8 text-xl text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#e0ad6e]"
              aria-label="메뉴 닫기"
            >
              ×
            </button>
            <Sidebar
              active={active}
              user={user}
              tokenWallet={tokenWallet}
              onNavigate={() => setMenuOpen(false)}
            />
          </aside>
        </div>
      ) : null}
    </div>
  );
}
