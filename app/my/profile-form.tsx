"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";

type ProfileValues = {
  displayName: string;
  role: string;
  church: string;
};

type ProfileFormProps = {
  initialName: string;
  email: string;
  signedIn: boolean;
  userScope: string;
};

type SaveState =
  | { kind: "idle" }
  | { kind: "saving"; message: string }
  | { kind: "success"; message: string }
  | { kind: "local"; message: string }
  | { kind: "error"; message: string };

const STORAGE_KEY_PREFIX = "sermon-guide.profile.v2";

const ROLE_OPTIONS = [
  "담임목사",
  "부목사",
  "전도사",
  "강도사",
  "교회학교 교사",
  "기타 사역자",
];

function profileStorageKey(userScope: string): string {
  return `${STORAGE_KEY_PREFIX}:${encodeURIComponent(userScope || "guest")}`;
}

function readSavedProfile(userScope: string): Partial<ProfileValues> | null {
  try {
    const raw = window.localStorage.getItem(profileStorageKey(userScope));
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const item = value as Record<string, unknown>;
    return {
      displayName:
        typeof item.displayName === "string" ? item.displayName : undefined,
      role: typeof item.role === "string" ? item.role : undefined,
      church: typeof item.church === "string" ? item.church : undefined,
    };
  } catch {
    return null;
  }
}

export function ProfileForm({ initialName, email, signedIn, userScope }: ProfileFormProps) {
  const [values, setValues] = useState<ProfileValues>({
    displayName: initialName,
    role: "담임목사",
    church: "",
  });
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  const [nameError, setNameError] = useState("");

  useEffect(() => {
    const saved = readSavedProfile(userScope);
    if (!saved) return;
    setValues((current) => ({ ...current, ...saved }));
  }, [userScope]);

  const initials = useMemo(() => {
    const trimmed = values.displayName.trim();
    return trimmed ? trimmed.slice(0, 2) : "설";
  }, [values.displayName]);

  function updateField<Key extends keyof ProfileValues>(
    key: Key,
    value: ProfileValues[Key],
  ) {
    setValues((current) => ({ ...current, [key]: value }));
    setSaveState({ kind: "idle" });
    if (key === "displayName") setNameError("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedName = values.displayName.trim();
    if (normalizedName.length < 2) {
      setNameError("표시 이름을 2자 이상 입력해 주세요.");
      return;
    }

    const nextValues = { ...values, displayName: normalizedName };
    setValues(nextValues);
    setSaveState({ kind: "saving", message: "변경 사항을 저장하고 있습니다." });

    try {
      window.localStorage.setItem(profileStorageKey(userScope), JSON.stringify(nextValues));
    } catch {
      setSaveState({
        kind: "error",
        message: "이 브라우저에 설정을 저장할 수 없습니다. 저장 공간 권한을 확인해 주세요.",
      });
      return;
    }

    if (!signedIn) {
      setSaveState({
        kind: "local",
        message: "미리보기 모드라 이 기기에만 저장했습니다. 로그인하면 계정과 동기화할 수 있습니다.",
      });
      return;
    }

    try {
      const response = await fetch("/api/profile", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(nextValues),
      });
      if (!response.ok) throw new Error("profile sync unavailable");
      setSaveState({
        kind: "success",
        message: "계정 정보가 저장되었습니다.",
      });
    } catch {
      setSaveState({
        kind: "local",
        message: "계정 서버에 연결하지 못해 이 기기에 안전하게 임시 저장했습니다. 연결 후 다시 저장해 주세요.",
      });
    }
  }

  const statusClass =
    saveState.kind === "success"
      ? "border-[#b8d3be] bg-[#eef7ef] text-[#285239]"
      : saveState.kind === "error"
        ? "border-[#e2b8ae] bg-[#fff1ee] text-[#7b352b]"
        : "border-[#e3c89e] bg-[#fff8e8] text-[#694a1f]";

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div className="flex flex-col gap-5 border-b border-[#e2ddd4] pb-6 sm:flex-row sm:items-center">
        <div
          aria-hidden="true"
          className="grid size-20 shrink-0 place-items-center rounded-[1.5rem] bg-[#dfeae3] font-serif text-xl font-bold text-[#2e5545] shadow-[inset_0_0_0_1px_rgba(45,84,67,.08)]"
        >
          {initials}
        </div>
        <div>
          <h2 className="font-serif text-xl font-bold text-[#294238]">
            기본 정보
          </h2>
          <p className="mt-1 text-sm leading-6 text-[#758079]">
            화면과 설교 문서에 표시할 사역 정보를 관리합니다.
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-5 sm:grid-cols-2">
        <div className="sm:col-span-1">
          <label
            htmlFor="display-name"
            className="block text-sm font-extrabold text-[#34473e]"
          >
            표시 이름 <span className="text-[#a64b3e]">*</span>
          </label>
          <input
            id="display-name"
            name="displayName"
            value={values.displayName}
            onChange={(event) => updateField("displayName", event.target.value)}
            minLength={2}
            maxLength={40}
            required
            aria-invalid={Boolean(nameError)}
            aria-describedby={nameError ? "display-name-error" : undefined}
            autoComplete="name"
            className="mt-2 min-h-12 w-full rounded-xl border border-[#d5cfc4] bg-[#fcfbf8] px-4 text-sm text-[#263c32] outline-none transition focus:border-[#6f8d80] focus:ring-2 focus:ring-[#b9cec5]/60"
          />
          {nameError ? (
            <p id="display-name-error" className="mt-1.5 text-xs font-semibold text-[#a14235]" role="alert">
              {nameError}
            </p>
          ) : null}
        </div>

        <div>
          <label htmlFor="ministry-role" className="block text-sm font-extrabold text-[#34473e]">
            사역 역할
          </label>
          <select
            id="ministry-role"
            name="role"
            value={values.role}
            onChange={(event) => updateField("role", event.target.value)}
            className="mt-2 min-h-12 w-full rounded-xl border border-[#d5cfc4] bg-[#fcfbf8] px-4 text-sm text-[#263c32] outline-none transition focus:border-[#6f8d80] focus:ring-2 focus:ring-[#b9cec5]/60"
          >
            {ROLE_OPTIONS.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="church-name" className="block text-sm font-extrabold text-[#34473e]">
            교회 또는 공동체 <span className="font-medium text-[#8a918d]">(선택)</span>
          </label>
          <input
            id="church-name"
            name="church"
            value={values.church}
            onChange={(event) => updateField("church", event.target.value)}
            maxLength={60}
            autoComplete="organization"
            placeholder="예: 새빛교회"
            className="mt-2 min-h-12 w-full rounded-xl border border-[#d5cfc4] bg-[#fcfbf8] px-4 text-sm text-[#263c32] outline-none transition placeholder:text-[#a7ada9] focus:border-[#6f8d80] focus:ring-2 focus:ring-[#b9cec5]/60"
          />
        </div>

        <div>
          <label htmlFor="account-email" className="block text-sm font-extrabold text-[#34473e]">
            로그인 이메일
          </label>
          <input
            id="account-email"
            value={email || "로그인 후 확인할 수 있습니다"}
            readOnly
            aria-readonly="true"
            className="mt-2 min-h-12 w-full cursor-not-allowed rounded-xl border border-[#ded9cf] bg-[#f1efea] px-4 text-sm text-[#77817b] outline-none"
          />
          <p className="mt-1.5 text-[11px] leading-5 text-[#8a918d]">
            이메일과 연결된 로그인 수단은 Supabase Auth에서 관리됩니다.
          </p>
        </div>
      </div>

      {saveState.kind !== "idle" && saveState.kind !== "saving" ? (
        <div className={`mt-6 rounded-xl border px-4 py-3 text-xs font-semibold leading-5 ${statusClass}`} role={saveState.kind === "error" ? "alert" : "status"}>
          {saveState.message}
        </div>
      ) : null}

      <div className="mt-7 flex flex-col-reverse gap-3 border-t border-[#e2ddd4] pt-6 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs leading-5 text-[#838b86]">
          <span aria-hidden="true">●</span> 비밀번호는 이 앱에 저장되지 않습니다.
        </p>
        <button
          type="submit"
          disabled={saveState.kind === "saving"}
          className="inline-flex min-h-12 items-center justify-center rounded-xl bg-[#285343] px-6 text-sm font-extrabold text-white shadow-[0_10px_25px_rgba(38,81,65,.16)] hover:bg-[#204739] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838] focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-65"
        >
          {saveState.kind === "saving" ? "저장 중…" : "변경 사항 저장"}
        </button>
      </div>
    </form>
  );
}
