"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AppNotice } from "@/app/_components/app-notice";
import { AppPageHeading } from "@/app/_components/app-page-heading";
import {
  apiErrorMessage,
  parseMemberDetailResponse,
  type MemberDetail,
  type MemberPayment,
  type MemberRole,
} from "../member-types";

type MemberDetailClientProps = {
  memberId: string;
  returnTo: string;
};

type Feedback = {
  kind: "success" | "error";
  message: string;
} | null;

type PendingAction = {
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  run: () => Promise<void>;
};

const fieldClass =
  "mt-2 min-h-11 w-full rounded-xl border border-[#d3cdc2] bg-white px-3 text-sm text-[#293f35] outline-none focus:border-[#6f8d80] focus:ring-2 focus:ring-[#b9cec5]/60";
const reasonClass =
  "mt-2 w-full resize-y rounded-xl border border-[#d3cdc2] bg-white px-3 py-2.5 text-sm leading-6 text-[#293f35] outline-none focus:border-[#6f8d80] focus:ring-2 focus:ring-[#b9cec5]/60";

function formatNumber(value: number): string {
  return value.toLocaleString("ko-KR");
}

function formatWon(value: number): string {
  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: "KRW",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDateTime(value: string): string {
  if (!value) return "기록 없음";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "기록 없음";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Seoul",
  }).format(date);
}

function roleLabel(role: MemberRole): string {
  return role === "expert" ? "전문가" : "설교자";
}

function statusLabel(value: string): string {
  const labels: Record<string, string> = {
    active: "이용 중",
    suspended: "정지",
    waiting: "배정 대기",
    assigned: "전문가 배정",
    in_progress: "피드백 진행",
    completed: "완료",
    pending: "대기",
    processing: "처리 중",
    failed: "실패",
    cancelled: "취소",
  };
  return labels[value] ?? (value || "기록 없음");
}

function SectionCard({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[1.6rem] border border-[#ddd7cd] bg-white p-5 shadow-[0_14px_40px_rgba(39,50,44,.05)] sm:p-7">
      <p className="text-[10px] font-extrabold uppercase tracking-[.17em] text-[#a56732]">
        {eyebrow}
      </p>
      <h2 className="mt-1.5 font-serif text-2xl font-bold text-[#254238]">{title}</h2>
      {description ? (
        <p className="mt-2 text-sm leading-6 text-[#637069]">{description}</p>
      ) : null}
      <div className="mt-5">{children}</div>
    </section>
  );
}

function DetailValue({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-xl border border-[#e3ded5] bg-[#fbfaf7] px-4 py-3.5">
      <dt className="text-[11px] font-bold text-[#68746e]">{label}</dt>
      <dd className="mt-1.5 break-words text-sm font-bold text-[#30473d]">
        {value || "미등록"}
      </dd>
    </div>
  );
}

async function requestJson(url: string, init: RequestInit): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(apiErrorMessage(body, "관리 작업을 처리하지 못했습니다."));
  }
  return body;
}

function ConfirmationDialog({
  action,
  busy,
  onCancel,
  onConfirm,
}: {
  action: PendingAction;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    cancelRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, [busy, onCancel]);

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-[#0c1813]/65 backdrop-blur-sm"
        aria-label="확인 창 닫기"
        onClick={busy ? undefined : onCancel}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="member-confirm-title"
        aria-describedby="member-confirm-description"
        className="relative w-full max-w-md rounded-[1.5rem] border border-white/40 bg-[#fffdf8] p-6 shadow-[0_28px_80px_rgba(0,0,0,.3)]"
      >
        <span
          aria-hidden="true"
          className={`grid size-11 place-items-center rounded-xl font-serif font-bold ${
            action.danger
              ? "bg-[#f7dfd8] text-[#924732]"
              : "bg-[#e2ece4] text-[#315746]"
          }`}
        >
          {action.danger ? "!" : "확"}
        </span>
        <h2 id="member-confirm-title" className="mt-5 font-serif text-2xl font-bold text-[#203a30]">
          {action.title}
        </h2>
        <p id="member-confirm-description" className="mt-3 text-sm leading-6 text-[#5f6d66]">
          {action.description}
        </p>
        <div className="mt-6 grid grid-cols-2 gap-3">
          <button
            ref={cancelRef}
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="min-h-12 rounded-xl border border-[#cbc5ba] bg-white px-4 text-sm font-extrabold text-[#43564d] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838] disabled:opacity-50"
          >
            취소
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className={`min-h-12 rounded-xl px-4 text-sm font-extrabold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#d7a363] disabled:opacity-50 ${
              action.danger ? "bg-[#9a4936] hover:bg-[#823b2c]" : "bg-[#285343] hover:bg-[#1f4537]"
            }`}
          >
            {busy ? "처리 중…" : action.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function MemberDetailClient({ memberId, returnTo }: MemberDetailClientProps) {
  const [member, setMember] = useState<MemberDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busyAction, setBusyAction] = useState("");
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [selectedRole, setSelectedRole] = useState<MemberRole>("preacher");
  const [roleReason, setRoleReason] = useState("");
  const [statusReason, setStatusReason] = useState("");
  const [suspendedUntil, setSuspendedUntil] = useState("");
  const [tokenAction, setTokenAction] = useState<"grant" | "revoke">("grant");
  const [tokenAmount, setTokenAmount] = useState("100");
  const [tokenReason, setTokenReason] = useState("");
  const [authReason, setAuthReason] = useState("");
  const [paymentReason, setPaymentReason] = useState("");

  const endpoint = `/api/admin/members/${encodeURIComponent(memberId)}`;

  const load = useCallback(
    async (showLoading = true) => {
      if (showLoading) setLoading(true);
      setError("");
      try {
        const response = await fetch(endpoint, {
          cache: "no-store",
          headers: { Accept: "application/json" },
        });
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(apiErrorMessage(body, "회원 정보를 불러오지 못했습니다."));
        }
        const parsed = parseMemberDetailResponse(body);
        if (!parsed) throw new Error("회원 정보 응답을 확인하지 못했습니다.");
        setMember(parsed);
        setSelectedRole(parsed.role);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "회원 정보를 불러오지 못했습니다.");
      } finally {
        if (showLoading) setLoading(false);
      }
    },
    [endpoint],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const runMutation = useCallback(
    async (key: string, successMessage: string, run: () => Promise<unknown>) => {
      setBusyAction(key);
      setFeedback(null);
      try {
        await run();
        setFeedback({ kind: "success", message: successMessage });
        await load(false);
      } catch (caught) {
        setFeedback({
          kind: "error",
          message: caught instanceof Error ? caught.message : "관리 작업을 처리하지 못했습니다.",
        });
      } finally {
        setBusyAction("");
      }
    },
    [load],
  );

  function requireReason(value: string, message: string): string | null {
    const normalized = value.trim();
    if (normalized.length < 5) {
      setFeedback({ kind: "error", message });
      return null;
    }
    return normalized.slice(0, 500);
  }

  function prepareRoleChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!member || selectedRole === member.role) return;
    const reason = requireReason(roleReason, "역할 변경 사유를 5자 이상 입력해 주세요.");
    if (!reason) return;
    setPendingAction({
      title: `${roleLabel(selectedRole)} 역할로 변경할까요?`,
      description:
        selectedRole === "expert"
          ? "전문가가 되면 대기 중인 설교 피드백을 열람하고 맡을 수 있습니다. 입력한 사유와 변경 내용은 감사 기록에 남습니다."
          : "진행 중인 피드백이 있으면 변경이 거절될 수 있습니다. 입력한 사유와 변경 내용은 감사 기록에 남습니다.",
      confirmLabel: "역할 변경",
      run: () =>
        runMutation("role", "회원 업무 역할을 변경했습니다.", () =>
          requestJson(endpoint, {
            method: "PATCH",
            body: JSON.stringify({
              action: "role",
              role: selectedRole,
              reason,
              requestId: crypto.randomUUID(),
              expectedVersion: member.version,
            }),
          }),
        ),
    });
  }

  function prepareStatusChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!member) return;
    const reason = requireReason(statusReason, "이용 상태 변경 사유를 5자 이상 입력해 주세요.");
    if (!reason) return;
    const nextStatus = member.status === "suspended" ? "active" : "suspended";
    let expiresAt: string | null = null;
    if (nextStatus === "suspended" && suspendedUntil) {
      const date = new Date(suspendedUntil);
      if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) {
        setFeedback({ kind: "error", message: "정지 만료일은 현재보다 이후로 선택해 주세요." });
        return;
      }
      expiresAt = date.toISOString();
    }
    setPendingAction({
      title: nextStatus === "suspended" ? "회원 이용을 정지할까요?" : "회원 이용을 복구할까요?",
      description:
        nextStatus === "suspended"
          ? `${expiresAt ? `${formatDateTime(expiresAt)}까지 ` : "별도 만료일 없이 "}서비스 이용을 제한합니다. 사유는 회원 감사 기록에 남습니다.`
          : "회원이 다시 서비스에 접근할 수 있도록 이용 상태를 복구합니다.",
      confirmLabel: nextStatus === "suspended" ? "이용 정지" : "이용 복구",
      danger: nextStatus === "suspended",
      run: () =>
        runMutation("status", nextStatus === "suspended" ? "회원 이용을 정지했습니다." : "회원 이용을 복구했습니다.", () =>
          requestJson(endpoint, {
            method: "PATCH",
            body: JSON.stringify({
              action: "status",
              status: nextStatus,
              reason,
              suspendedUntil: expiresAt,
              requestId: crypto.randomUUID(),
              expectedVersion: member.version,
            }),
          }),
        ),
    });
  }

  function prepareTokenAdjustment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!member) return;
    const amount = Number(tokenAmount);
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 100_000) {
      setFeedback({ kind: "error", message: "토큰 수량은 1~100,000의 정수로 입력해 주세요." });
      return;
    }
    const reason = requireReason(tokenReason, "토큰 조정 사유를 5자 이상 입력해 주세요.");
    if (!reason) return;
    setPendingAction({
      title: tokenAction === "grant" ? `${formatNumber(amount)}토큰을 지급할까요?` : `${formatNumber(amount)}토큰을 회수할까요?`,
      description:
        tokenAction === "grant"
          ? "무료 토큰 지급 내역과 사유가 회원 원장과 감사 기록에 남습니다."
          : "잔액이 부족하면 요청이 거절될 수 있습니다. 회수 내역과 사유가 회원 원장과 감사 기록에 남습니다.",
      confirmLabel: tokenAction === "grant" ? "토큰 지급" : "토큰 회수",
      danger: tokenAction === "revoke",
      run: () =>
        runMutation("tokens", tokenAction === "grant" ? "무료 토큰을 지급했습니다." : "토큰을 회수했습니다.", () =>
          requestJson(`${endpoint}/tokens`, {
            method: "POST",
            body: JSON.stringify({
              amount: tokenAction === "grant" ? amount : -amount,
              reason,
              requestId: crypto.randomUUID(),
            }),
          }),
        ),
    });
  }

  function prepareAuthAction(
    action: "reset_password" | "resend_verification" | "sign_out_all",
  ) {
    if (!member) return;
    const reason = requireReason(authReason, "인증 작업 사유를 5자 이상 입력해 주세요.");
    if (!reason) return;
    const meta = {
      reset_password: {
        title: "비밀번호 재설정 메일을 보낼까요?",
        description: `${member.email} 주소로 비밀번호 재설정 안내를 보냅니다.`,
        label: "재설정 메일 보내기",
        success: "비밀번호 재설정 메일을 요청했습니다.",
        danger: false,
      },
      resend_verification: {
        title: "이메일 인증을 다시 보낼까요?",
        description: `${member.email} 주소로 이메일 인증 안내를 다시 보냅니다.`,
        label: "인증 메일 보내기",
        success: "이메일 인증 재발송을 요청했습니다.",
        danger: false,
      },
      sign_out_all: {
        title: "알려진 세션을 모두 종료할까요?",
        description: "서비스가 확인했고 아직 폐기하지 않은 세션을 종료합니다. 다른 기기의 실시간 인증 세션 전체를 뜻하지는 않습니다.",
        label: "알려진 세션 로그아웃",
        success: "서비스가 확인한 미폐기 세션을 종료했습니다.",
        danger: true,
      },
    }[action];
    setPendingAction({
      title: meta.title,
      description: meta.description,
      confirmLabel: meta.label,
      danger: meta.danger,
      run: () =>
        runMutation(`auth-${action}`, meta.success, () =>
          requestJson(`${endpoint}/auth`, {
            method: "POST",
            body: JSON.stringify({
              action,
              reason,
              requestId: crypto.randomUUID(),
            }),
          }),
        ),
    });
  }

  function preparePaymentReverify(payment: MemberPayment) {
    const reason = requireReason(paymentReason, "결제 재검증 사유를 5자 이상 입력해 주세요.");
    if (!reason) return;
    setPendingAction({
      title: "결제 상태를 다시 확인할까요?",
      description: `${payment.provider || "결제사"}의 결제 기록과 현재 상태를 다시 대조합니다. 중복 토큰 지급은 허용되지 않습니다.`,
      confirmLabel: "결제 재검증",
      run: () =>
        runMutation(`payment-${payment.id}`, "결제 상태를 다시 확인했습니다.", () =>
          requestJson(`${endpoint}/payments/${encodeURIComponent(payment.paymentId)}/reverify`, {
            method: "POST",
            body: JSON.stringify({
              reason,
              requestId: crypto.randomUUID(),
            }),
          }),
        ),
    });
  }

  async function confirmPendingAction() {
    const action = pendingAction;
    if (!action) return;
    setPendingAction(null);
    await action.run();
  }

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-7 sm:py-10 lg:px-10 lg:py-12" aria-busy="true" aria-label="회원 상세 정보를 불러오는 중">
        <div className="h-5 w-32 animate-pulse rounded-full bg-[#ddd7cd]" />
        <div className="mt-6 h-28 animate-pulse rounded-[1.5rem] bg-white" />
        <div className="mt-6 grid gap-5 lg:grid-cols-3">
          {[0, 1, 2].map((item) => <div key={item} className="h-44 animate-pulse rounded-[1.5rem] bg-white" />)}
        </div>
      </div>
    );
  }

  if (!member) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-7 sm:py-10 lg:px-10 lg:py-12">
        <a href={returnTo} className="inline-flex min-h-10 items-center rounded-xl text-sm font-extrabold text-[#315746] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838]">
          ← 회원 목록으로
        </a>
        <div className="mt-5">
          <AppNotice tone="error" title="회원 정보를 불러오지 못했습니다.">
            <span>{error || "회원을 찾을 수 없습니다."}</span>{" "}
            <button type="button" className="font-bold underline" onClick={() => void load()}>
              다시 시도
            </button>
          </AppNotice>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-7 sm:py-10 lg:px-10 lg:py-12">
      <a href={returnTo} className="inline-flex min-h-10 items-center rounded-xl text-sm font-extrabold text-[#315746] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838]">
        ← 회원 목록으로
      </a>
      <div className="mt-3">
        <AppPageHeading
          eyebrow="Member detail"
          title={member.name}
          description={`${member.email || "이메일 미등록"} · 서비스 등록 ${formatDateTime(member.createdAt)}`}
          action={
            <span className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-[#e1ece4] px-3 py-1.5 text-xs font-extrabold text-[#315c47]">{roleLabel(member.role)}</span>
              <span className={`rounded-full px-3 py-1.5 text-xs font-extrabold ${member.status === "suspended" ? "bg-[#f7e3dc] text-[#8f452f]" : "bg-[#edf5e9] text-[#3c693b]"}`}>
                {statusLabel(member.status)}
              </span>
            </span>
          }
        />
      </div>

      {member.status === "suspended" ? (
        <div className="mt-6 rounded-2xl border border-[#e2b8ae] bg-[#fff1ee] px-5 py-4 text-sm leading-6 text-[#743c30]" role="status">
          <strong className="block">현재 이용이 정지된 회원입니다.</strong>
          <span>{member.statusReason || "정지 사유가 기록되지 않았습니다."}</span>
          {member.suspendedUntil ? <span> · 만료 {formatDateTime(member.suspendedUntil)}</span> : null}
        </div>
      ) : null}

      {feedback ? (
        <div className={`mt-6 rounded-2xl border px-5 py-4 text-sm font-semibold ${feedback.kind === "error" ? "border-[#e2b8ae] bg-[#fff1ee] text-[#743c30]" : "border-[#b8d3be] bg-[#eef7ef] text-[#285239]"}`} role={feedback.kind === "error" ? "alert" : "status"} aria-live={feedback.kind === "error" ? "assertive" : "polite"}>
          {feedback.message}
        </div>
      ) : null}

      <a
        href="#member-actions"
        className="mt-4 inline-flex min-h-11 items-center rounded-xl border border-[#c9c2b7] bg-white px-4 text-sm font-extrabold text-[#315746] shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838] xl:hidden"
      >
        관리 작업으로 이동 ↓
      </a>

      <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="회원 핵심 지표">
        {[
          ["토큰 잔액", formatNumber(member.wallet.balance), "사용 가능한 토큰"],
          ["완성 설교", formatNumber(member.activity.sermonCount), `초안 ${formatNumber(member.activity.draftCount)}건`],
          ["설교 피드백", formatNumber(member.activity.consultationCount), `진행 ${formatNumber(member.activity.activeConsultationCount)}건`],
          ["최근 활동", formatDateTime(member.activity.lastActiveAt || member.lastActiveAt), "서비스 활동 기준"],
        ].map(([label, value, copy]) => (
          <article key={label} className="rounded-[1.35rem] border border-[#ddd7cd] bg-white p-5 shadow-[0_10px_30px_rgba(39,50,44,.04)]">
            <p className="text-xs font-bold text-[#68746e]">{label}</p>
            <p className="mt-2 break-words font-serif text-2xl font-bold text-[#254238]">{value}</p>
            <p className="mt-2 text-xs leading-5 text-[#66736c]">{copy}</p>
          </article>
        ))}
      </section>

      <div className="mt-6 grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          <SectionCard eyebrow="Profile" title="프로필과 사역 정보" description="회원이 직접 설정한 목회·신학 정보를 읽기 전용으로 표시합니다.">
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <DetailValue label="이름" value={member.name} />
              <DetailValue label="이메일" value={member.email} />
              <DetailValue label="연락처" value={member.phone} />
              <DetailValue label="사역 역할" value={member.ministryRole} />
              <DetailValue label="교회" value={member.church} />
              <DetailValue label="교단·신학" value={[member.denomination, member.theology].filter(Boolean).join(" · ")} />
            </dl>
            <div className="mt-3 rounded-xl bg-[#f3f0e9] px-4 py-3 text-xs text-[#596860]">
              회원 ID <code className="ml-1 break-all font-mono text-[#31483e]">{member.id}</code>
            </div>
          </SectionCard>

          <SectionCard eyebrow="Activity" title="서비스 활동" description="로그인 기록이 아닌 실제 설교·AI·사역 활용 기록을 기준으로 집계합니다.">
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <DetailValue label="완성 설교" value={`${formatNumber(member.activity.sermonCount)}건`} />
              <DetailValue label="설교 초안" value={`${formatNumber(member.activity.draftCount)}건`} />
              <DetailValue label="생성 실행" value={`${formatNumber(member.activity.generationCount)}회`} />
              <DetailValue label="AI 요청" value={`${formatNumber(member.activity.aiRequestCount)}회`} />
              <DetailValue label="스터디·사역 활용" value={`${formatNumber(member.activity.resourceRequestCount)}회`} />
              <DetailValue label="최근 서비스 활동" value={formatDateTime(member.activity.lastActiveAt || member.lastActiveAt)} />
            </dl>
          </SectionCard>

          <SectionCard eyebrow="Sermons" title="최근 설교" description="최근 저장된 설교의 제목과 설정 메타데이터만 표시하며 설교 본문은 노출하지 않습니다.">
            {member.sermons.length ? (
              <ul className="grid gap-3 sm:grid-cols-2">
                {member.sermons.slice(0, 20).map((sermon) => (
                  <li key={sermon.id} className="rounded-2xl border border-[#e0dbd2] bg-[#fbfaf7] px-4 py-4">
                    <h3 className="font-serif text-base font-bold leading-6 text-[#2a4439]">
                      {sermon.title}
                    </h3>
                    <p className="mt-2 text-sm font-bold text-[#4b6157]">
                      {sermon.scripture || "본문 미등록"}
                    </p>
                    <p className="mt-2 text-xs leading-5 text-[#68746e]">
                      {[sermon.sermonType, sermon.audience, sermon.audienceSituation]
                        .filter(Boolean)
                        .join(" · ") || "설정 미등록"}
                      {sermon.duration > 0 ? ` · ${sermon.duration}분` : ""}
                    </p>
                    <p className="mt-2 text-[11px] text-[#747f79]">
                      수정 {formatDateTime(sermon.updatedAt || sermon.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-xl bg-[#f5f2eb] px-4 py-4 text-sm text-[#637069]">저장된 설교가 없습니다.</p>
            )}
          </SectionCard>

          <SectionCard eyebrow="Tokens" title="토큰 원장" description="잔액과 누적 구매·사용량, 최근 조정 내역을 함께 확인합니다.">
            <dl className="grid gap-3 sm:grid-cols-3">
              <DetailValue label="현재 잔액" value={`${formatNumber(member.wallet.balance)} 토큰`} />
              <DetailValue label="누적 구매" value={`${formatNumber(member.wallet.lifetimePurchased)} 토큰`} />
              <DetailValue label="누적 사용" value={`${formatNumber(member.wallet.lifetimeSpent)} 토큰`} />
            </dl>
            {member.tokenTransactions.length ? (
              <ul className="mt-5 divide-y divide-[#e5e0d7] rounded-2xl border border-[#e1dcd3]">
                {member.tokenTransactions.slice(0, 12).map((transaction) => (
                  <li key={transaction.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
                    <div>
                      <p className="text-sm font-bold text-[#34483f]">{transaction.description || transaction.kind}</p>
                      <p className="mt-1 text-xs text-[#68746e]">{formatDateTime(transaction.createdAt)} · 잔액 {formatNumber(transaction.balanceAfter)}</p>
                    </div>
                    <strong className={`text-sm tabular-nums ${transaction.amount < 0 ? "text-[#914734]" : "text-[#2f6a47]"}`}>
                      {transaction.amount > 0 ? "+" : ""}{formatNumber(transaction.amount)}
                    </strong>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-5 rounded-xl bg-[#f5f2eb] px-4 py-4 text-sm text-[#637069]">표시할 토큰 거래 내역이 없습니다.</p>
            )}
          </SectionCard>

          <SectionCard eyebrow="Payments" title="결제와 재검증" description="결제사의 현재 상태를 다시 확인해 기록 불일치를 점검할 수 있습니다.">
            {member.payments.some((payment) => payment.reverifiable) ? (
              <label className="mb-5 block max-w-xl text-xs font-bold text-[#4f6158]">
                결제 재검증 사유
                <textarea
                  value={paymentReason}
                  onChange={(event) => setPaymentReason(event.target.value.slice(0, 500))}
                  rows={2}
                  minLength={5}
                  maxLength={500}
                  className={reasonClass}
                  placeholder="재검증이 필요한 이유를 5자 이상 입력하세요."
                />
              </label>
            ) : null}
            {member.payments.length ? (
              <ul className="space-y-3">
                {member.payments.map((payment) => (
                  <li key={payment.id} className="rounded-2xl border border-[#e0dbd2] bg-[#fbfaf7] p-4 sm:p-5">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <strong className="text-sm text-[#30473d]">{payment.provider || "결제사"}</strong>
                          <span className="rounded-full bg-[#e6ece8] px-2.5 py-1 text-[10px] font-extrabold text-[#3f5f50]">{statusLabel(payment.status)}</span>
                        </div>
                        <p className="mt-2 text-lg font-extrabold text-[#263f35]">
                          {payment.amountKrw > 0
                            ? formatWon(payment.amountKrw)
                            : payment.usdCents > 0
                              ? `$${(payment.usdCents / 100).toFixed(2)}`
                              : "금액 기록 없음"}{" "}
                          · {formatNumber(payment.tokenAmount)}토큰
                        </p>
                        <p className="mt-1 text-xs text-[#68746e]">{payment.paymentMethod || "결제 수단 미상"} · {formatDateTime(payment.createdAt)}</p>
                      </div>
                      {payment.reverifiable ? (
                        <button type="button" disabled={Boolean(busyAction)} onClick={() => preparePaymentReverify(payment)} className="min-h-11 rounded-xl border border-[#bdb6aa] bg-white px-4 text-xs font-extrabold text-[#315746] hover:bg-[#f1f4ef] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838] disabled:opacity-50">
                          {busyAction === `payment-${payment.id}` ? "확인 중…" : "결제 재검증"}
                        </button>
                      ) : (
                        <span className="rounded-full bg-[#ede9e1] px-3 py-1.5 text-[10px] font-bold text-[#5f6d66]">이전 결제 기록</span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-xl bg-[#f5f2eb] px-4 py-4 text-sm text-[#637069]">결제 기록이 없습니다.</p>
            )}
          </SectionCard>

          <SectionCard eyebrow="Feedback" title="설교 피드백" description="회원이 요청했거나 전문가로 배정받은 피드백의 최근 상태입니다.">
            {member.consultations.length ? (
              <ul className="space-y-3">
                {member.consultations.slice(0, 12).map((consultation) => (
                  <li key={consultation.id} className="rounded-2xl border border-[#e0dbd2] bg-[#fbfaf7] px-4 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <h3 className="font-serif text-base font-bold text-[#2a4439]">{consultation.sermonTitle}</h3>
                      <span className="rounded-full bg-[#e7eee9] px-2.5 py-1 text-[10px] font-extrabold text-[#3c5f4d]">{statusLabel(consultation.status)}</span>
                    </div>
                    <p className="mt-2 text-xs text-[#68746e]">{consultation.expertName ? `전문가 ${consultation.expertName} · ` : ""}{formatDateTime(consultation.updatedAt || consultation.createdAt)}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-xl bg-[#f5f2eb] px-4 py-4 text-sm text-[#637069]">설교 피드백 기록이 없습니다.</p>
            )}
          </SectionCard>

          <SectionCard eyebrow="Authentication" title="인증과 알려진 세션" description="인증 관리자에서 확인 가능한 상태와 서비스가 관측한 미폐기 세션 수를 구분해 표시합니다.">
            {!member.auth.privilegedAvailable ? (
              <p className="mb-4 rounded-xl bg-[#f5f2eb] px-4 py-3 text-xs leading-5 text-[#637069]">
                관리자 인증 연결이 없어 이메일 인증 여부·마지막 로그인·인증 서비스 정지 연동 정보는 확인할 수 없습니다.
              </p>
            ) : null}
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <DetailValue label="이메일 인증" value={member.auth.emailVerified === null ? "정보 없음" : member.auth.emailVerified ? "완료" : "미완료"} />
              <DetailValue label="로그인 방식" value={member.auth.providers.join(", ") || "정보 없음"} />
              <DetailValue label="알려진 세션" value={member.auth.sessionCount === null ? "정보 없음" : `${formatNumber(member.auth.sessionCount)}개`} />
              <DetailValue label="마지막 로그인" value={formatDateTime(member.auth.lastSignInAt)} />
            </dl>
          </SectionCard>

          <SectionCard eyebrow="Audit" title="관리자 감사 기록" description="회원에게 수행한 관리자 작업과 사유를 최신순으로 표시합니다.">
            {member.audits.length ? (
              <ol className="relative space-y-4 border-l border-[#cfc8bd] pl-5">
                {member.audits.map((audit) => (
                  <li key={audit.id} className="relative">
                    <span className="absolute -left-[1.55rem] top-1.5 size-2.5 rounded-full bg-[#b97838] ring-4 ring-white" aria-hidden="true" />
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <strong className="text-sm text-[#30473d]">{audit.summary || audit.action}</strong>
                      <time className="text-[11px] text-[#6d7872]" dateTime={audit.createdAt}>{formatDateTime(audit.createdAt)}</time>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-[#637069]">{audit.actor}{audit.reason ? ` · ${audit.reason}` : ""}</p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="rounded-xl bg-[#f5f2eb] px-4 py-4 text-sm text-[#637069]">아직 관리자 작업 기록이 없습니다.</p>
            )}
          </SectionCard>
        </div>

        <aside id="member-actions" className="scroll-mt-24 space-y-4 xl:sticky xl:top-8" aria-label="회원 관리 작업">
          <section className="rounded-[1.6rem] border border-[#d2c6b5] bg-[#eee5d8] p-5 shadow-[0_16px_42px_rgba(39,50,44,.06)]">
            <p className="text-[10px] font-extrabold uppercase tracking-[.17em] text-[#8d5a2e]">Member actions</p>
            <h2 className="mt-1.5 font-serif text-2xl font-bold text-[#294238]">관리 작업</h2>
            <p className="mt-2 text-xs leading-5 text-[#526159]">모든 상태·역할·토큰 변경은 사유와 함께 감사 기록에 남습니다.</p>

            <form className="mt-5 border-t border-[#d6c9b8] pt-5" onSubmit={prepareRoleChange}>
              <h3 className="text-sm font-extrabold text-[#34483f]">업무 역할</h3>
              <label className="mt-3 block text-xs font-bold text-[#4f6158]">
                변경할 역할
                <select value={selectedRole} onChange={(event) => setSelectedRole(event.target.value as MemberRole)} className={fieldClass}>
                  <option value="preacher">설교자</option>
                  <option value="expert">전문가</option>
                </select>
              </label>
              <label className="mt-3 block text-xs font-bold text-[#4f6158]">
                변경 사유
                <textarea value={roleReason} onChange={(event) => setRoleReason(event.target.value.slice(0, 500))} rows={3} minLength={5} maxLength={500} className={reasonClass} placeholder="권한 변경 근거를 5자 이상 입력하세요." />
              </label>
              <button type="submit" disabled={Boolean(busyAction) || selectedRole === member.role} className="mt-3 min-h-11 w-full rounded-xl bg-[#315746] px-4 text-sm font-extrabold text-white hover:bg-[#26483b] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838] disabled:opacity-45">
                {busyAction === "role" ? "변경 중…" : "역할 변경"}
              </button>
            </form>

            <form className="mt-5 border-t border-[#d6c9b8] pt-5" onSubmit={prepareStatusChange}>
              <h3 className="text-sm font-extrabold text-[#34483f]">이용 상태</h3>
              {member.status === "active" ? (
                <label className="mt-3 block text-xs font-bold text-[#4f6158]">
                  정지 만료일 <span className="font-medium">(선택)</span>
                  <input type="datetime-local" value={suspendedUntil} onChange={(event) => setSuspendedUntil(event.target.value)} className={fieldClass} />
                </label>
              ) : null}
              <label className="mt-3 block text-xs font-bold text-[#4f6158]">
                {member.status === "active" ? "정지 사유" : "복구 사유"}
                <textarea value={statusReason} onChange={(event) => setStatusReason(event.target.value.slice(0, 500))} rows={3} minLength={5} maxLength={500} className={reasonClass} placeholder="상태 변경 근거를 5자 이상 입력하세요." />
              </label>
              <button type="submit" disabled={Boolean(busyAction)} className={`mt-3 min-h-11 w-full rounded-xl px-4 text-sm font-extrabold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838] disabled:opacity-45 ${member.status === "active" ? "bg-[#9a4936] hover:bg-[#823b2c]" : "bg-[#315746] hover:bg-[#26483b]"}`}>
                {busyAction === "status" ? "처리 중…" : member.status === "active" ? "회원 이용 정지" : "회원 이용 복구"}
              </button>
            </form>

            <form className="mt-5 border-t border-[#d6c9b8] pt-5" onSubmit={prepareTokenAdjustment}>
              <h3 className="text-sm font-extrabold text-[#34483f]">무료 토큰 조정</h3>
              <fieldset className="mt-3 grid grid-cols-2 gap-2">
                <legend className="sr-only">토큰 지급 또는 회수</legend>
                {(["grant", "revoke"] as const).map((action) => (
                  <label key={action} className={`flex min-h-11 cursor-pointer items-center justify-center rounded-xl border px-3 text-xs font-extrabold ${tokenAction === action ? "border-[#315746] bg-[#315746] text-white" : "border-[#c9c0b3] bg-white/70 text-[#46594f]"}`}>
                    <input type="radio" name="token-action" value={action} checked={tokenAction === action} onChange={() => setTokenAction(action)} className="sr-only" />
                    {action === "grant" ? "지급" : "회수"}
                  </label>
                ))}
              </fieldset>
              <label className="mt-3 block text-xs font-bold text-[#4f6158]">
                토큰 수량
                <input type="number" inputMode="numeric" min={1} max={100000} step={1} value={tokenAmount} onChange={(event) => setTokenAmount(event.target.value)} className={fieldClass} />
              </label>
              <label className="mt-3 block text-xs font-bold text-[#4f6158]">
                조정 사유
                <textarea value={tokenReason} onChange={(event) => setTokenReason(event.target.value.slice(0, 500))} rows={3} minLength={5} maxLength={500} className={reasonClass} placeholder="무료 지급 또는 회수 근거를 5자 이상 입력하세요." />
              </label>
              <button type="submit" disabled={Boolean(busyAction)} className={`mt-3 min-h-11 w-full rounded-xl px-4 text-sm font-extrabold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838] disabled:opacity-45 ${tokenAction === "grant" ? "bg-[#315746] hover:bg-[#26483b]" : "bg-[#9a4936] hover:bg-[#823b2c]"}`}>
                {busyAction === "tokens" ? "처리 중…" : tokenAction === "grant" ? "무료 토큰 지급" : "토큰 회수"}
              </button>
            </form>
          </section>

          <section className="rounded-[1.5rem] border border-[#d9d4cb] bg-white p-5">
            <p className="text-[10px] font-extrabold uppercase tracking-[.16em] text-[#a56732]">Authentication</p>
            <h2 className="mt-1.5 font-serif text-xl font-bold text-[#294238]">인증 작업</h2>
            {!member.auth.mailAvailable || !member.auth.privilegedAvailable ? (
              <p className="mt-3 rounded-xl bg-[#f5f2eb] px-3 py-3 text-xs leading-5 text-[#637069]">
                {!member.auth.mailAvailable
                  ? "비밀번호·인증 메일은 Supabase 공개 설정을 연결한 뒤 사용할 수 있습니다. "
                  : "비밀번호·인증 메일은 현재 사용할 수 있습니다. "}
                {!member.auth.privilegedAvailable
                  ? "관리자 인증 상세 조회와 인증 서비스 정지 연동은 별도 관리자 연결이 필요합니다. "
                  : "관리자 인증 상세 조회가 연결되어 있습니다. "}
                서비스가 확인한 알려진 세션의 로그아웃은 지금도 가능합니다.
              </p>
            ) : null}
            <label className="mt-4 block text-xs font-bold text-[#4f6158]">
              인증 작업 사유
              <textarea
                value={authReason}
                onChange={(event) => setAuthReason(event.target.value.slice(0, 500))}
                rows={3}
                minLength={5}
                maxLength={500}
                className={reasonClass}
                placeholder="인증 조치가 필요한 이유를 5자 이상 입력하세요."
              />
            </label>
            <div className="mt-4 space-y-2">
              <button type="button" disabled={Boolean(busyAction) || !member.auth.mailAvailable || !member.email} onClick={() => prepareAuthAction("reset_password")} className="min-h-11 w-full rounded-xl border border-[#cbc5ba] px-3 text-xs font-extrabold text-[#315746] hover:bg-[#f2f5f1] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838] disabled:opacity-45">비밀번호 재설정 메일</button>
              <button type="button" disabled={Boolean(busyAction) || !member.auth.mailAvailable || !member.email || member.auth.emailVerified === true} onClick={() => prepareAuthAction("resend_verification")} className="min-h-11 w-full rounded-xl border border-[#cbc5ba] px-3 text-xs font-extrabold text-[#315746] hover:bg-[#f2f5f1] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838] disabled:opacity-45">이메일 인증 재발송</button>
              <button type="button" disabled={Boolean(busyAction)} onClick={() => prepareAuthAction("sign_out_all")} className="min-h-11 w-full rounded-xl border border-[#d4aaa0] px-3 text-xs font-extrabold text-[#914734] hover:bg-[#fff1ee] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838] disabled:opacity-45">확인된 모든 세션 로그아웃</button>
            </div>
          </section>
        </aside>
      </div>

      {pendingAction ? (
        <ConfirmationDialog
          action={pendingAction}
          busy={Boolean(busyAction)}
          onCancel={() => setPendingAction(null)}
          onConfirm={() => void confirmPendingAction()}
        />
      ) : null}
    </div>
  );
}
