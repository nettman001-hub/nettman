"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { AiAgentPanel } from "@/app/_components/ai-agent-panel";
import {
  useAiAgent,
  useRegisterAiAgentPage,
  useRegisterAiAgentWorkspace,
  type AiAgentPageRegistration,
} from "@/app/_components/ai-agent-provider";
import { SecureSignoutButton } from "@/app/_components/secure-signout-link";
import type { AiAgentSurface } from "@/app/_lib/ai-agent-contract";
import {
  stopBackgroundAiRun,
  subscribeBackgroundAiRun,
  type BackgroundAiRunState,
} from "@/app/_lib/background-ai-runner";
import {
  subscribeSermonGenerationRun,
  type SermonGenerationRunState,
} from "@/app/_lib/sermon-generation-runner";
import {
  loadActiveSermonDraft,
  sermonDraftResumeUrl,
  sermonDraftUrl,
} from "@/app/_lib/sermon-store";
import {
  TOKEN_WALLET_CHANGED_EVENT,
  type TokenWalletEventDetail,
} from "@/app/_lib/token-wallet-events";

export type AppSection =
  | "home" | "sermon-helper" | "sermon" | "history" | "consult" | "expert" | "study"
  | "ministry" | "critique" | "tokens" | "my" | "notifications"
  | "guide" | "admin-members" | "admin-ai";

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

type TokenSummary = { total: number; remaining: number };

const PRIMARY_NAV: NavItem[] = [
  { id: "home", label: "홈", href: "/home", marker: "홈" },
  { id: "sermon-helper", label: "설교도우미", href: "/sermon-helper", marker: "도" },
  { id: "sermon", label: "새 설교", href: "/sermon/options", marker: "새" },
  { id: "history", label: "내 설교", href: "/history", marker: "록" },
  { id: "consult", label: "설교 피드백", href: "/consult", marker: "피" },
  { id: "study", label: "스터디", href: "/study", marker: "연" },
  { id: "ministry", label: "사역 활용", href: "/ministry", marker: "활" },
  { id: "critique", label: "설교 비평", href: "/critique", marker: "평" },
  { id: "expert", label: "설교 피드백실", href: "/expert", marker: "실" },
];

const ACCOUNT_NAV = [
  { label: "사용자 설명서", href: "/guide" },
  { label: "계정 설정", href: "/my" },
  { label: "알림 설정", href: "/notifications" },
  { label: "토큰 충전", href: "/tokens" },
] as const;

const SECTION_META: Record<AppSection, { title: string; surface: AiAgentSurface }> = {
  home: { title: "홈", surface: "home" },
  "sermon-helper": { title: "설교도우미", surface: "sermon-helper" },
  sermon: { title: "설교 제작", surface: "sermon" },
  history: { title: "내 설교", surface: "history" },
  consult: { title: "설교 피드백", surface: "consult" },
  expert: { title: "설교 피드백실", surface: "expert" },
  study: { title: "스터디", surface: "study" },
  ministry: { title: "사역 활용", surface: "ministry" },
  critique: { title: "설교 비평", surface: "critique" },
  tokens: { title: "토큰 충전", surface: "tokens" },
  my: { title: "계정 설정", surface: "account" },
  notifications: { title: "알림 설정", surface: "notifications" },
  guide: { title: "사용자 설명서", surface: "account" },
  "admin-members": { title: "회원 관리", surface: "admin" },
  "admin-ai": { title: "AI 엔진 관리", surface: "admin" },
};

function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "로";
  const parts = trimmed.split(/\s+/);
  return parts.length > 1
    ? parts.slice(0, 2).map((part) => part.charAt(0)).join("").toUpperCase()
    : trimmed.slice(0, 2);
}

function tokenSummary(wallet: TokenWalletEventDetail): TokenSummary | null {
  if (
    !Number.isSafeInteger(wallet.balance) ||
    !Number.isSafeInteger(wallet.lifetimeSpent) ||
    wallet.balance < 0 ||
    wallet.lifetimeSpent < 0
  ) return null;
  return { total: wallet.balance + wallet.lifetimeSpent, remaining: wallet.balance };
}

function formatTokens(value: number): string {
  return value.toLocaleString("ko-KR");
}

function Brand({ dark = true }: { dark?: boolean }) {
  return (
    <Link
      href="/home"
      className="group inline-flex items-center gap-3 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-[#c7894a]"
      aria-label="로고스AI 홈"
    >
      <span
        aria-hidden="true"
        className={`grid size-10 place-items-center rounded-[14px] font-serif text-lg font-bold transition-transform group-hover:-rotate-3 ${
          dark ? "bg-[#f1d4a9] text-[#263d34]" : "bg-[#315647] text-white"
        }`}
      >
        로
      </span>
      <span className="max-[440px]:hidden">
        <span className={`block font-serif text-lg font-bold tracking-[-0.02em] ${dark ? "text-white" : "text-[#1f382f]"}`}>
          로고스AI
        </span>
        <span className={`block text-[10px] font-semibold tracking-[0.18em] ${dark ? "text-white/75" : "text-[#6c7a74]"}`}>
          LOGOS AI
        </span>
      </span>
    </Link>
  );
}

function NavList({
  active,
  onNavigate,
  generatingTarget,
  sermonResumeTarget,
  backgroundRun,
}: {
  active: AppSection;
  onNavigate?: () => void;
  generatingTarget?: string | null;
  sermonResumeTarget: string;
  backgroundRun?: BackgroundAiRunState | null;
}) {
  const router = useRouter();
  return (
    <ul className="space-y-1.5">
      {PRIMARY_NAV.map((item) => {
        const selected = item.id === active;
        const generating = item.id === "sermon" && Boolean(generatingTarget);
        const backgroundRunning =
          backgroundRun?.status === "running" &&
          backgroundRun.targetHref.split("?")[0] === item.href;
        const href = generating && generatingTarget
          ? generatingTarget
          : backgroundRunning
            ? backgroundRun.targetHref
            : item.id === "sermon"
              ? sermonResumeTarget
              : item.href;
        return (
          <li key={item.id}>
            <Link
              href={href}
              onClick={(event) => {
                onNavigate?.();
                if (item.id !== "sermon" || generatingTarget) return;
                const latestTarget = sermonDraftResumeUrl(loadActiveSermonDraft());
                if (latestTarget === href) return;
                event.preventDefault();
                router.push(latestTarget);
              }}
              aria-current={selected ? "page" : undefined}
              className={`group flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#e0ad6e] ${
                selected
                  ? "bg-white/12 text-white shadow-[inset_3px_0_0_#e0ad6e]"
                  : "text-white/90 hover:bg-white/7 hover:text-white"
              }`}
            >
              <span
                aria-hidden="true"
                className={`grid size-7 place-items-center rounded-lg text-[10px] font-bold ${
                  selected ? "bg-[#e8c28d] text-[#263d34]" : "bg-white/8 text-white group-hover:bg-white/12"
                }`}
              >
                {item.marker}
              </span>
              <span>{item.label}</span>
              {generating || backgroundRunning ? (
                <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-[#e8c28d]/20 px-2 py-0.5 text-[10px] font-extrabold text-[#f2c98e]">
                  <span aria-hidden="true" className="size-1.5 animate-pulse rounded-full bg-[#f2c98e]" />
                  {generating ? "생성 중" : "AI 실행 중"}
                </span>
              ) : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function Sidebar({
  active,
  onNavigate,
  generatingTarget,
  sermonResumeTarget,
  backgroundRun,
}: {
  active: AppSection;
  onNavigate?: () => void;
  generatingTarget?: string | null;
  sermonResumeTarget: string;
  backgroundRun?: BackgroundAiRunState | null;
}) {
  return (
    <div className="flex h-full flex-col overflow-y-auto px-4 py-5 sm:px-5 sm:py-6">
      <div className="px-2"><Brand /></div>
      <Link
        href={generatingTarget ?? "/sermon-helper"}
        onClick={onNavigate}
        className="mt-8 flex min-h-12 items-center justify-between rounded-2xl bg-[#e5b679] px-4 text-sm font-extrabold text-[#21372e] shadow-[0_12px_24px_rgba(0,0,0,.16)] transition-all hover:-translate-y-0.5 hover:bg-[#edc48f] focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        {generatingTarget ? (
          <>
            <span className="inline-flex items-center gap-2">
              <span aria-hidden="true" className="size-2 animate-pulse rounded-full bg-[#1d372d]" />
              설교 생성 중 · 보러 가기
            </span>
            <span aria-hidden="true">→</span>
          </>
        ) : (
          <><span>설교도우미 시작</span><span aria-hidden="true" className="text-xl">+</span></>
        )}
      </Link>
      <nav className="mt-7" aria-label="업무 메뉴">
        <p className="mb-2 px-3 text-[10px] font-bold tracking-[0.18em] text-white/65">WORKSPACE</p>
        <NavList
          active={active}
          onNavigate={onNavigate}
          generatingTarget={generatingTarget}
          sermonResumeTarget={sermonResumeTarget}
          backgroundRun={backgroundRun}
        />
      </nav>
      <p className="mt-auto px-3 pt-8 text-[10px] leading-5 text-white/45">
        설교 준비에 필요한 업무 메뉴입니다.<br />
        계정과 토큰은 우측 상단에서 관리하세요.
      </p>
    </div>
  );
}

function RemainingTokenChip({ summary }: { summary: TokenSummary | null }) {
  return (
    <Link
      href="/tokens"
      className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl border border-[#d7d2c8] bg-white px-3 text-sm font-extrabold text-[#34483f] shadow-sm hover:bg-[#faf8f3] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838] max-[520px]:px-2.5"
      aria-label={
        summary
          ? `남은 토큰 ${formatTokens(summary.remaining)}. 토큰 충전 페이지로 이동`
          : "남은 토큰을 불러오는 중. 토큰 충전 페이지로 이동"
      }
    >
      <span aria-hidden="true" className="text-[#a56836]">◆</span>
      <span className="max-[520px]:sr-only">남은 토큰</span>
      <strong className="tabular-nums text-[#8d542f] max-[520px]:sr-only">{summary ? formatTokens(summary.remaining) : "—"}</strong>
    </Link>
  );
}

function GenerationChip({ run, target }: { run: SermonGenerationRunState; target: string }) {
  return (
    <Link
      href={target}
      className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl border border-[#bdd1c5] bg-[#eaf2ed] px-3 text-xs font-extrabold text-[#315246] hover:bg-[#e0ece5] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5f826f] max-[720px]:size-11 max-[720px]:justify-center max-[720px]:px-0"
      aria-label={`새설교 생성 중 ${run.completedCount}/${run.expectedCount}. 진행 화면 보기`}
    >
      <span aria-hidden="true" className="size-2 animate-pulse rounded-full bg-[#3c735c]" />
      <span className="max-[720px]:sr-only">새설교 생성 중 {run.completedCount}/{run.expectedCount}</span>
    </Link>
  );
}

function BackgroundAiChip({ run }: { run: BackgroundAiRunState }) {
  return (
    <div className="inline-flex min-h-11 shrink-0 items-center overflow-hidden rounded-xl border border-[#d8c6a7] bg-[#fff7e7] text-xs font-extrabold text-[#755027] shadow-sm">
      <Link
        href={run.targetHref}
        className="inline-flex min-h-11 items-center gap-2 px-3 hover:bg-[#f8edd8] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838] max-[820px]:size-11 max-[820px]:justify-center max-[820px]:px-0"
        aria-label={`${run.label} 실행 중. 작업 화면 보기`}
      >
        <span aria-hidden="true" className="size-2 animate-pulse rounded-full bg-[#b97838]" />
        <span className="max-[820px]:sr-only">{run.label} 중</span>
      </Link>
      <button
        type="button"
        onClick={() => stopBackgroundAiRun(run.id)}
        className="min-h-11 border-l border-[#d8c6a7] px-3 text-[11px] font-extrabold text-[#963f32] hover:bg-[#f9e2da] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#a74d40] max-[520px]:px-2"
        aria-label={`${run.label} 중지`}
      >
        중지
      </button>
    </div>
  );
}

function AccountMenu({
  user,
  tokenWallet,
  open,
  onToggle,
  onClose,
  buttonRef,
  containerRef,
}: {
  user: AppShellUser | null;
  tokenWallet: TokenSummary | null;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  buttonRef: RefObject<HTMLButtonElement | null>;
  containerRef: RefObject<HTMLDivElement | null>;
}) {
  const menuLink = "flex min-h-11 items-center rounded-xl px-3 text-sm font-bold hover:bg-[#f2efe8] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838]";
  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls="account-menu"
        className={`inline-flex min-h-11 items-center gap-2 rounded-xl border px-2.5 text-sm font-bold shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838] ${
          open ? "border-[#9d8669] bg-[#f1e7d8] text-[#2b443a]" : "border-[#d7d2c8] bg-white text-[#34483f] hover:bg-[#faf8f3]"
        }`}
        aria-label={user ? `${user.displayName} 계정 메뉴` : "로그인 메뉴"}
      >
        <span aria-hidden="true" className="grid size-7 place-items-center rounded-full bg-[#dce8e0] text-[10px] font-black text-[#294a3d]">
          {user ? initials(user.displayName) : "나"}
        </span>
        <span className="max-xl:sr-only">{user ? "계정" : "로그인"}</span>
        <span aria-hidden="true" className="text-[10px] max-xl:hidden">⌄</span>
      </button>
      {open ? (
        <section
          id="account-menu"
          className="absolute right-0 top-[calc(100%+.65rem)] z-[70] w-[min(21rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-[#d5cfc4] bg-white text-[#253b32] shadow-[0_24px_70px_rgba(24,42,34,.22)]"
          aria-label="계정 메뉴"
        >
          {user ? (
            <>
              <div className="border-b border-[#e5e0d7] bg-[#f8f5ee] p-4">
                <div className="flex items-center gap-3">
                  <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-full bg-[#315647] text-xs font-black text-white">
                    {initials(user.displayName)}
                  </span>
                  <span className="min-w-0">
                    <strong className="block truncate text-sm font-extrabold">{user.displayName}</strong>
                    <span className="mt-0.5 block truncate text-xs text-[#65736d]">{user.email}</span>
                  </span>
                </div>
                <Link href="/tokens" onClick={onClose} className="mt-3 flex min-h-11 items-center justify-between rounded-xl border border-[#ddd6ca] bg-white px-3 text-xs font-bold hover:bg-[#fbfaf6] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838]">
                  <span>
                    <span className="block">남은 토큰</span>
                    <span className="mt-0.5 block text-[10px] font-semibold text-[#7b847f]">
                      총 토큰 {tokenWallet ? formatTokens(tokenWallet.total) : "—"}
                    </span>
                  </span>
                  <strong className="text-sm tabular-nums text-[#965b32]">{tokenWallet ? `${formatTokens(tokenWallet.remaining)}토큰` : "불러오는 중"}</strong>
                </Link>
              </div>
              <nav className="p-2" aria-label="계정 설정">
                {ACCOUNT_NAV.map((item) => (
                  <Link key={item.href} href={item.href} onClick={onClose} className={menuLink}>{item.label}</Link>
                ))}
                {user.isAdmin ? (
                  <>
                    <div className="my-2 border-t border-[#e5e0d7]" />
                    <p className="px-3 pb-1 pt-2 text-[10px] font-extrabold tracking-[0.15em] text-[#8a6a4d] uppercase">관리자</p>
                    <Link href="/admin/members" onClick={onClose} className={menuLink}>회원 관리</Link>
                    <Link href="/admin/ai" onClick={onClose} className={menuLink}>AI 엔진 관리</Link>
                  </>
                ) : null}
              </nav>
              <div className="border-t border-[#e5e0d7] p-2">
                <SecureSignoutButton
                  returnTo="/"
                  className="flex min-h-11 w-full items-center rounded-xl px-3 text-left text-sm font-bold text-[#a44836] hover:bg-[#faece8] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838]"
                >
                  로그아웃
                </SecureSignoutButton>
              </div>
            </>
          ) : (
            <div className="p-4">
              <p className="text-sm leading-6 text-[#5d6c65]">
                로그인하면 설교와 토큰, 계정 설정을 안전하게 이어서 사용할 수 있습니다.
              </p>
              <Link href="/login?return_to=%2Fhome" onClick={onClose} className="mt-4 inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-[#315647] px-4 text-sm font-extrabold text-white hover:bg-[#25483a] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838]">
                로그인하기
              </Link>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}

function trapFocus(event: KeyboardEvent, container: HTMLElement | null) {
  if (event.key !== "Tab" || !container) return;
  const elements = Array.from(
    container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => element.getClientRects().length > 0);
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

export function AppShell({ active, children, user }: AppShellProps) {
  const aiAgent = useAiAgent();
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [agentDocked, setAgentDocked] = useState(false);
  const [tokenWallet, setTokenWallet] = useState<TokenSummary | null>(null);
  const [generationRun, setGenerationRun] = useState<SermonGenerationRunState | null>(null);
  const [backgroundRun, setBackgroundRun] = useState<BackgroundAiRunState | null>(null);
  const [sermonResumeTarget, setSermonResumeTarget] = useState("/sermon/options");
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const menuPanelRef = useRef<HTMLElement>(null);
  const accountButtonRef = useRef<HTMLButtonElement>(null);
  const accountContainerRef = useRef<HTMLDivElement>(null);
  const agentButtonRef = useRef<HTMLButtonElement>(null);
  const skipLinkRef = useRef<HTMLAnchorElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const mainContentRef = useRef<HTMLElement>(null);
  const headerIdentityRef = useRef<HTMLDivElement>(null);
  const headerStatusRef = useRef<HTMLDivElement>(null);
  const headerUtilitiesRef = useRef<HTMLDivElement>(null);
  const section = SECTION_META[active];

  const workspaceRegistration = useMemo(
    () => ({ authenticated: Boolean(user), userScope: user?.id }),
    [user],
  );
  useRegisterAiAgentWorkspace(workspaceRegistration);

  const basicPageRegistration = useMemo<AiAgentPageRegistration>(
    () => {
      if (section.surface === "tokens") {
        return {
          surface: section.surface,
          title: section.title,
          snapshot: {
            summary: {
              mode: "read-only",
              remaining: tokenWallet?.remaining ?? "unavailable",
              used: tokenWallet ? tokenWallet.total - tokenWallet.remaining : "unavailable",
              restriction: "AI 에이전트는 결제나 토큰 충전을 제안하거나 실행하지 않습니다.",
            },
          },
          capabilities: [],
          suggestions: ["현재 토큰 현황과 설교 생성 차감 원칙을 설명해줘"],
        };
      }
      if (section.surface === "admin") {
        return {
          surface: section.surface,
          title: section.title,
          snapshot: {
            summary: {
              mode: "read-only",
              restriction:
                "AI 에이전트는 관리자 권한이나 설정 변경, 회원 조치, 삭제를 제안하거나 실행하지 않습니다.",
            },
          },
          capabilities: [],
          suggestions: ["이 관리 화면에서 AI 에이전트가 지원하지 않는 작업을 알려줘"],
        };
      }
      return {
        surface: section.surface,
        title: section.title,
        snapshot: {},
        capabilities: ["navigate"],
      };
    },
    [section.surface, section.title, tokenWallet],
  );
  useRegisterAiAgentPage(basicPageRegistration);

  useEffect(() => subscribeSermonGenerationRun(setGenerationRun), []);
  useEffect(() => subscribeBackgroundAiRun(setBackgroundRun), []);
  useEffect(() => {
    const refresh = () =>
      setSermonResumeTarget(sermonDraftResumeUrl(loadActiveSermonDraft()));
    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [active, generationRun?.completedCount, generationRun?.status]);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1800px)");
    const sync = () => setAgentDocked(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const shouldInert = aiAgent.isOpen && !agentDocked;
    // Keep only the AI trigger and dialog operable while the overlay is modal.
    // The trigger deliberately remains active so pressing it again closes the
    // panel, while every other workspace/header control leaves the focus tree.
    const targets = [
      skipLinkRef.current,
      sidebarRef.current,
      mainContentRef.current,
      headerIdentityRef.current,
      headerStatusRef.current,
      headerUtilitiesRef.current,
    ].filter(
      (target): target is HTMLElement => Boolean(target),
    );
    for (const target of targets) target.inert = shouldInert;
    return () => {
      for (const target of targets) target.inert = false;
    };
  }, [agentDocked, aiAgent.isOpen]);

  useEffect(() => {
    if (!user) {
      setTokenWallet(null);
      return;
    }
    let cancelled = false;
    let refreshing = false;
    const controller = new AbortController();
    async function refreshTokenWallet() {
      if (refreshing) return;
      refreshing = true;
      try {
        const response = await fetch("/api/tokens", { cache: "no-store", signal: controller.signal });
        if (!response.ok) return;
        const body = (await response.json()) as { wallet?: TokenWalletEventDetail };
        const next = body.wallet ? tokenSummary(body.wallet) : null;
        if (!cancelled && next) setTokenWallet(next);
      } catch {
        // Preserve the last value during a temporary request failure.
      } finally {
        refreshing = false;
      }
    }
    function handleWalletChanged(event: Event) {
      const detail = (event as CustomEvent<TokenWalletEventDetail | undefined>).detail;
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
    if (!accountOpen) return;
    function handlePointerDown(event: PointerEvent) {
      if (!accountContainerRef.current?.contains(event.target as Node)) setAccountOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setAccountOpen(false);
        accountButtonRef.current?.focus();
      }
    }
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [accountOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const previousOverflow = document.body.style.overflow;
    const mainContent = mainContentRef.current;
    const menuTrigger = menuTriggerRef.current;
    document.body.style.overflow = "hidden";
    if (mainContent) mainContent.inert = true;
    closeButtonRef.current?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
      else trapFocus(event, menuPanelRef.current);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (mainContent) mainContent.inert = false;
      menuTrigger?.focus();
    };
  }, [menuOpen]);

  const generatingTarget =
    generationRun?.status === "running"
      ? sermonDraftUrl(
          generationRun.mode === "regenerate" ? "/sermon/alternatives" : "/sermon/input",
          generationRun.draftId,
        )
      : null;
  const shellStyle = { "--app-topbar-height": "4.5rem" } as CSSProperties;

  return (
    <div className="min-h-screen bg-[#f4f1ea] text-[#1d2c25]" style={shellStyle}>
      <a ref={skipLinkRef} href="#main-content" className="fixed left-3 top-3 z-[90] -translate-y-24 rounded-xl bg-white px-4 py-2 text-sm font-bold text-[#183128] shadow-xl transition-transform focus:translate-y-0">
        본문으로 건너뛰기
      </a>
      <div className="lg:grid lg:min-h-screen lg:grid-cols-[17.5rem_minmax(0,1fr)]">
        <aside ref={sidebarRef} className="hidden bg-[#172b24] lg:sticky lg:top-0 lg:block lg:h-screen">
          <Sidebar
            active={active}
            generatingTarget={generatingTarget}
            sermonResumeTarget={sermonResumeTarget}
            backgroundRun={backgroundRun}
          />
        </aside>
        <div className="min-w-0">
          <header className="sticky top-0 z-[60] flex h-[var(--app-topbar-height)] items-center justify-between gap-3 border-b border-[#d9d5cb] bg-[#fffdf9]/95 px-3 backdrop-blur sm:px-5 lg:px-6">
            <div ref={headerIdentityRef} className="min-w-0">
              <div className="lg:hidden"><Brand dark={false} /></div>
              <div className="hidden min-w-0 lg:block">
                <p className="text-[10px] font-extrabold tracking-[0.16em] text-[#9b6a42] uppercase">Workspace</p>
                <p className="truncate text-base font-extrabold text-[#253e34]">{section.title}</p>
              </div>
            </div>
            <div className="ml-auto flex min-w-0 items-center gap-2">
              <div ref={headerStatusRef} className="contents">
                {generationRun?.status === "running" && generatingTarget ? (
                  <GenerationChip run={generationRun} target={generatingTarget} />
                ) : null}
                {backgroundRun?.status === "running" ? (
                  <BackgroundAiChip run={backgroundRun} />
                ) : null}
                {user ? <RemainingTokenChip summary={tokenWallet} /> : null}
              </div>
              <button
                ref={agentButtonRef}
                type="button"
                aria-expanded={aiAgent.isOpen}
                aria-controls="ai-agent-panel"
                onClick={() => {
                  setAccountOpen(false);
                  setMenuOpen(false);
                  aiAgent.toggle();
                }}
                className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl border px-3 text-sm font-extrabold shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[#6a59e5] max-[620px]:size-11 max-[620px]:justify-center max-[620px]:px-0 ${
                  aiAgent.isOpen
                    ? "border-[#5d50d7] bg-[#6458df] text-white"
                    : "border-[#d2cdc3] bg-white text-[#30483e] hover:border-[#9389e5] hover:bg-[#f5f3ff]"
                }`}
              >
                <span aria-hidden="true" className="text-base">✦</span>
                <span className="max-[620px]:sr-only">AI 에이전트</span>
              </button>
              <div ref={headerUtilitiesRef} className="contents">
                <AccountMenu
                  user={user}
                  tokenWallet={tokenWallet}
                  open={accountOpen}
                  onToggle={() => {
                    aiAgent.close();
                    setMenuOpen(false);
                    setAccountOpen((current) => !current);
                  }}
                  onClose={() => setAccountOpen(false)}
                  buttonRef={accountButtonRef}
                  containerRef={accountContainerRef}
                />
                <button
                  ref={menuTriggerRef}
                  type="button"
                  aria-expanded={menuOpen}
                  aria-controls="mobile-navigation"
                  onClick={() => {
                    aiAgent.close();
                    setAccountOpen(false);
                    setMenuOpen(true);
                  }}
                  className="grid size-11 shrink-0 place-items-center rounded-xl border border-[#cec8bc] bg-white text-[#244237] shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838] lg:hidden"
                >
                  <span className="sr-only">업무 메뉴 열기</span>
                  <span aria-hidden="true" className="space-y-1.5">
                    <span className="block h-0.5 w-5 rounded bg-current" />
                    <span className="block h-0.5 w-5 rounded bg-current" />
                    <span className="block h-0.5 w-5 rounded bg-current" />
                  </span>
                </button>
              </div>
            </div>
          </header>
          <div className={aiAgent.isOpen ? "min-[1800px]:grid min-[1800px]:grid-cols-[minmax(0,1fr)_23.5rem]" : undefined}>
            <main ref={mainContentRef} id="main-content" className="min-h-[calc(100vh-var(--app-topbar-height))] min-w-0">
              {children}
            </main>
            <AiAgentPanel triggerRef={agentButtonRef} />
          </div>
        </div>
      </div>
      {menuOpen ? (
        <div className="fixed inset-0 z-[80] lg:hidden">
          <button type="button" aria-label="업무 메뉴 닫기" className="absolute inset-0 bg-[#0b1712]/60 backdrop-blur-sm" onClick={() => setMenuOpen(false)} />
          <aside
            ref={menuPanelRef}
            tabIndex={-1}
            id="mobile-navigation"
            className="absolute inset-y-0 right-0 w-[min(88vw,21rem)] bg-[#172b24] shadow-[-24px_0_60px_rgba(0,0,0,.24)]"
            aria-label="모바일 업무 메뉴"
            aria-modal="true"
            role="dialog"
          >
            <button ref={closeButtonRef} type="button" onClick={() => setMenuOpen(false)} className="absolute right-4 top-4 z-10 grid size-11 place-items-center rounded-xl bg-white/8 text-2xl text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#e0ad6e]" aria-label="업무 메뉴 닫기">×</button>
            <Sidebar
              active={active}
              onNavigate={() => setMenuOpen(false)}
              generatingTarget={generatingTarget}
              sermonResumeTarget={sermonResumeTarget}
              backgroundRun={backgroundRun}
            />
          </aside>
        </div>
      ) : null}
    </div>
  );
}
