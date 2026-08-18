"use client";

import { useEffect, useState } from "react";

type Preferences = {
  emailEnabled: boolean;
  pushEnabled: boolean;
};

type PermissionState = "checking" | "granted" | "denied" | "default" | "unsupported";

type StatusState =
  | { kind: "idle"; message: "" }
  | { kind: "saving" | "success" | "local" | "error"; message: string };

type NotificationPreferencesFormProps = {
  email: string;
  emailVerified: boolean;
  signedIn: boolean;
};

const STORAGE_KEY = "sermon-guide.notifications.v1";

function readLocalPreferences(): Preferences | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const item = value as Record<string, unknown>;
    if (
      typeof item.emailEnabled !== "boolean" ||
      typeof item.pushEnabled !== "boolean"
    ) {
      return null;
    }
    return {
      emailEnabled: item.emailEnabled,
      pushEnabled: item.pushEnabled,
    };
  } catch {
    return null;
  }
}

function Toggle({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (nextValue: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 shrink-0 overflow-hidden rounded-full border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-45 ${
        checked
          ? "border-[#315b49] bg-[#315b49]"
          : "border-[#c8c3ba] bg-[#d9d5cd]"
      }`}
    >
      <span
        aria-hidden="true"
        className={`absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow-sm transition-transform ${
          checked ? "translate-x-[22px]" : "translate-x-0"
        }`}
      />
    </button>
  );
}

export function NotificationPreferencesForm({
  email,
  emailVerified,
  signedIn,
}: NotificationPreferencesFormProps) {
  const [preferences, setPreferences] = useState<Preferences>({
    emailEnabled: emailVerified,
    pushEnabled: false,
  });
  const [permission, setPermission] = useState<PermissionState>("checking");
  const [status, setStatus] = useState<StatusState>({ kind: "idle", message: "" });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const local = readLocalPreferences();
    if (local) {
      setPreferences({
        emailEnabled: emailVerified ? local.emailEnabled : false,
        pushEnabled: local.pushEnabled,
      });
    }

    if (!("Notification" in window)) {
      setPermission("unsupported");
    } else {
      setPermission(window.Notification.permission);
    }

    const controller = new AbortController();

    async function loadRemote() {
      if (!signedIn) {
        setLoading(false);
        return;
      }
      try {
        const response = await fetch("/api/notification-preferences", {
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("unavailable");
        const payload: unknown = await response.json();
        if (!payload || typeof payload !== "object") throw new Error("invalid");
        const value = payload as Record<string, unknown>;
        if (
          typeof value.emailEnabled !== "boolean" ||
          typeof value.pushEnabled !== "boolean"
        ) {
          throw new Error("invalid");
        }
        setPreferences({
          emailEnabled: emailVerified ? value.emailEnabled : false,
          pushEnabled: value.pushEnabled,
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setStatus({
          kind: "local",
          message: "계정 설정 서버에 연결되지 않아 이 기기에 저장된 값을 표시합니다.",
        });
      } finally {
        setLoading(false);
      }
    }

    void loadRemote();
    return () => controller.abort();
  }, [emailVerified, signedIn]);

  async function persist(next: Preferences, changedLabel: string) {
    setPreferences(next);
    setStatus({ kind: "saving", message: `${changedLabel} 설정을 저장하고 있습니다.` });

    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      setStatus({
        kind: "error",
        message: "이 브라우저에 알림 설정을 저장할 수 없습니다. 저장 공간 권한을 확인해 주세요.",
      });
      return;
    }

    if (!signedIn) {
      setStatus({
        kind: "local",
        message: "미리보기 모드라 변경 사항을 이 기기에만 저장했습니다.",
      });
      return;
    }

    try {
      const response = await fetch("/api/notification-preferences", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(next),
      });
      if (!response.ok) throw new Error("unavailable");
      setStatus({
        kind: "success",
        message: `${changedLabel} 설정이 계정에 저장되었습니다.`,
      });
    } catch {
      setStatus({
        kind: "local",
        message: "계정 서버에 연결하지 못해 이 기기에 임시 저장했습니다. 연결 후 변경을 다시 확인해 주세요.",
      });
    }
  }

  function handleEmailChange(nextValue: boolean) {
    if (!emailVerified) {
      setStatus({
        kind: "error",
        message: "이메일 알림을 켜려면 먼저 이메일 또는 Google 계정으로 로그인해 주세요.",
      });
      return;
    }
    void persist({ ...preferences, emailEnabled: nextValue }, "이메일 알림");
  }

  async function handlePushChange(nextValue: boolean) {
    if (!nextValue) {
      void persist({ ...preferences, pushEnabled: false }, "브라우저 알림");
      return;
    }

    if (!("Notification" in window)) {
      setPermission("unsupported");
      setStatus({
        kind: "error",
        message: "이 브라우저는 알림을 지원하지 않습니다. 이메일 알림을 이용해 주세요.",
      });
      return;
    }

    let nextPermission = window.Notification.permission;
    if (nextPermission === "default") {
      nextPermission = await window.Notification.requestPermission();
    }
    setPermission(nextPermission);

    if (nextPermission !== "granted") {
      setStatus({
        kind: "error",
        message:
          nextPermission === "denied"
            ? "브라우저 알림이 차단되어 있습니다. 브라우저 사이트 설정에서 권한을 허용해 주세요."
            : "알림 권한을 허용해야 브라우저 알림을 켤 수 있습니다.",
      });
      return;
    }

    void persist({ ...preferences, pushEnabled: true }, "브라우저 알림");
  }

  async function sendTestNotification() {
    if (!("Notification" in window)) {
      setStatus({ kind: "error", message: "이 브라우저는 알림을 지원하지 않습니다." });
      return;
    }
    let nextPermission = window.Notification.permission;
    if (nextPermission === "default") {
      nextPermission = await window.Notification.requestPermission();
      setPermission(nextPermission);
    }
    if (nextPermission !== "granted") {
      setStatus({
        kind: "error",
        message: "테스트 알림을 보내려면 브라우저 알림 권한이 필요합니다.",
      });
      return;
    }
    new window.Notification("설교가이드", {
      body: "설교 ‘은혜로 걷는 길’이 완성되었습니다.",
      icon: "/favicon.svg",
      tag: "sermon-guide-test",
    });
    setStatus({ kind: "success", message: "테스트 알림을 보냈습니다." });
  }

  const permissionLabel =
    permission === "granted"
      ? "브라우저 권한 허용됨"
      : permission === "denied"
        ? "브라우저에서 차단됨"
        : permission === "unsupported"
          ? "지원하지 않는 브라우저"
          : permission === "default"
            ? "권한 확인 필요"
            : "권한 확인 중";

  const statusClass =
    status.kind === "success"
      ? "border-[#b8d3be] bg-[#eef7ef] text-[#285239]"
      : status.kind === "error"
        ? "border-[#e2b8ae] bg-[#fff1ee] text-[#7b352b]"
        : status.kind === "saving"
          ? "border-[#bad0c7] bg-[#eff6f2] text-[#315547]"
          : "border-[#e3c89e] bg-[#fff8e8] text-[#694a1f]";

  return (
    <div>
      <div className="flex items-center justify-between gap-4 border-b border-[#e2ddd4] pb-5">
        <div>
          <h2 className="font-serif text-xl font-bold text-[#294238]">수신 채널</h2>
          <p className="mt-1 text-sm leading-6 text-[#758079]">변경한 값은 즉시 저장됩니다.</p>
        </div>
        <span className={`shrink-0 rounded-full px-3 py-1 text-[10px] font-extrabold ${signedIn ? "bg-[#e5efe8] text-[#315746]" : "bg-[#f4e8d7] text-[#865c34]"}`}>
          {signedIn ? "계정 동기화" : "기기 저장"}
        </span>
      </div>

      {loading ? (
        <div className="mt-5 space-y-3" aria-label="알림 설정을 불러오는 중" aria-busy="true">
          {[0, 1].map((item) => (
            <div key={item} className="h-28 animate-pulse rounded-2xl bg-[#f2f0eb]" />
          ))}
        </div>
      ) : (
        <div className="mt-5 space-y-3">
          <section className="flex items-start gap-4 rounded-2xl border border-[#ded9d0] bg-[#fbfaf7] p-4 sm:p-5" aria-labelledby="email-notification-title">
            <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#e8efe9] text-xs font-black text-[#315746]">메일</span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 id="email-notification-title" className="text-sm font-extrabold text-[#31453c]">이메일 알림</h3>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${emailVerified ? "bg-[#e5efe8] text-[#315746]" : "bg-[#eeeae4] text-[#7c827e]"}`}>
                  {emailVerified ? "인증됨" : "로그인 필요"}
                </span>
              </div>
              <p className="mt-1 break-words text-xs leading-5 text-[#79827d]">
                {email || "로그인한 계정 이메일로 완성 소식을 보냅니다."}
              </p>
            </div>
            <Toggle
              checked={preferences.emailEnabled}
              disabled={!emailVerified}
              label="이메일 알림"
              onChange={handleEmailChange}
            />
          </section>

          <section className="flex items-start gap-4 rounded-2xl border border-[#ded9d0] bg-[#fbfaf7] p-4 sm:p-5" aria-labelledby="push-notification-title">
            <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#f4e8d9] text-xs font-black text-[#8c5c32]">웹</span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 id="push-notification-title" className="text-sm font-extrabold text-[#31453c]">브라우저 알림</h3>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${permission === "denied" || permission === "unsupported" ? "bg-[#f8e3df] text-[#93483d]" : "bg-[#eeeae4] text-[#6e7772]"}`}>
                  {permissionLabel}
                </span>
              </div>
              <p className="mt-1 text-xs leading-5 text-[#79827d]">작업 중인 탭을 닫아도 설교 완성 소식을 확인합니다.</p>
            </div>
            <Toggle
              checked={preferences.pushEnabled && permission === "granted"}
              disabled={permission === "unsupported"}
              label="브라우저 알림"
              onChange={(nextValue) => void handlePushChange(nextValue)}
            />
          </section>
        </div>
      )}

      {permission === "denied" ? (
        <div className="mt-4 rounded-xl border border-[#e4c99f] bg-[#fff8e9] px-4 py-3 text-xs leading-5 text-[#68491e]" role="alert">
          브라우저 주소창의 사이트 설정에서 알림 권한을 ‘허용’으로 바꾼 뒤 새로고침해 주세요.
        </div>
      ) : null}

      {status.kind !== "idle" ? (
        <div className={`mt-4 rounded-xl border px-4 py-3 text-xs font-semibold leading-5 ${statusClass}`} role={status.kind === "error" ? "alert" : "status"} aria-live="polite">
          {status.message}
        </div>
      ) : null}

      <div className="mt-6 flex flex-col gap-3 border-t border-[#e2ddd4] pt-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs leading-5 text-[#838b86]">알림에는 설교 제목과 상세 화면 링크만 포함됩니다.</p>
        <button
          type="button"
          onClick={() => void sendTestNotification()}
          className="inline-flex min-h-11 items-center justify-center rounded-xl border border-[#cfc9be] bg-white px-5 text-xs font-extrabold text-[#385448] hover:bg-[#f7f5f0] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838] focus-visible:ring-offset-2"
        >
          테스트 알림 보내기
        </button>
      </div>
    </div>
  );
}
