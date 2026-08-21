"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  useRegisterAiAgentPage,
  type AiAgentPageRegistration,
} from "@/app/_components/ai-agent-provider";
import {
  DENOMINATION_OPTIONS,
  MINISTRY_ROLE_OPTIONS,
  isDenomination,
  isMinistryRole,
  isValidTheologySelection,
  theologyOptionsForDenomination,
} from "@/app/_lib/profile-options";

type ProfileValues = {
  displayName: string;
  ministryRole: string;
  denomination: string;
  theology: string;
  church: string;
  phone: string;
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

type LoadedProfile = {
  values: ProfileValues;
  email: string;
  demo: boolean;
};

// 사용자 기기에 이미 저장된 프로필을 잃지 않도록 기존 키를 계속 사용합니다.
const STORAGE_KEY_PREFIX = "sermon-guide.profile.v2";

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
    const legacyMinistryRole =
      typeof item.ministryRole === "string" ? item.ministryRole : item.role;
    const denomination = isDenomination(item.denomination)
      ? item.denomination
      : undefined;
    const theology =
      denomination && isValidTheologySelection(denomination, item.theology)
        ? String(item.theology)
        : undefined;
    return {
      displayName:
        typeof item.displayName === "string" ? item.displayName : undefined,
      ministryRole: isMinistryRole(legacyMinistryRole)
        ? legacyMinistryRole
        : undefined,
      denomination,
      theology,
      church: typeof item.church === "string" ? item.church : undefined,
      phone: typeof item.phone === "string" ? item.phone : undefined,
    };
  } catch {
    return null;
  }
}

function writeSavedProfile(userScope: string, values: ProfileValues): void {
  window.localStorage.setItem(
    profileStorageKey(userScope),
    JSON.stringify({ ...values, role: values.ministryRole }),
  );
}

function loadedProfile(
  payload: unknown,
  fallback: ProfileValues,
  fallbackEmail: string,
): LoadedProfile {
  const item =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};
  const ministryRoleValue = item.ministryRole ?? item.role;
  const ministryRole = isMinistryRole(ministryRoleValue)
    ? ministryRoleValue
    : fallback.ministryRole;
  const denomination = isDenomination(item.denomination)
    ? item.denomination
    : "";
  const theology = isValidTheologySelection(denomination, item.theology)
    ? String(item.theology)
    : "";

  return {
    values: {
      displayName:
        typeof item.displayName === "string"
          ? item.displayName.trim().slice(0, 40)
          : fallback.displayName,
      ministryRole,
      denomination,
      theology,
      church: typeof item.church === "string" ? item.church : fallback.church,
      phone: typeof item.phone === "string" ? item.phone : fallback.phone,
    },
    email: typeof item.email === "string" ? item.email : fallbackEmail,
    demo: item.demo === true,
  };
}

export function ProfileForm({ initialName, email, signedIn, userScope }: ProfileFormProps) {
  const initialValues = useMemo<ProfileValues>(
    () => ({
      displayName: initialName.trim().slice(0, 40),
      ministryRole: "담임목사",
      denomination: "",
      theology: "",
      church: "",
      phone: "",
    }),
    [initialName],
  );
  const [values, setValues] = useState<ProfileValues>(initialValues);
  const [accountEmail, setAccountEmail] = useState(email);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  const [nameError, setNameError] = useState("");

  useEffect(() => {
    let active = true;
    const saved = readSavedProfile(userScope);

    if (!signedIn) {
      if (saved) setValues((current) => ({ ...current, ...saved }));
      setLoading(false);
      return () => {
        active = false;
      };
    }

    async function loadServerProfile() {
      try {
        const response = await fetch("/api/profile", {
          headers: { Accept: "application/json" },
          cache: "no-store",
        });
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) throw new Error("계정 설정을 불러오지 못했습니다.");
        const server = loadedProfile(body, initialValues, email);
        // 로컬 데모에는 서버 저장소가 없으므로 기존 기기 사본을 우선합니다.
        const nextValues = server.demo && saved
          ? { ...server.values, ...saved }
          : server.values;
        if (!active) return;
        setValues(nextValues);
        setAccountEmail(server.email);
        try {
          writeSavedProfile(userScope, nextValues);
        } catch {
          // 서버 원본을 불러온 뒤의 기기 캐시 실패는 편집을 막지 않습니다.
        }
      } catch {
        if (!active) return;
        if (saved) setValues((current) => ({ ...current, ...saved }));
        setSaveState({
          kind: "local",
          message: "계정 서버에 연결하지 못해 이 기기에 저장된 설정을 불러왔습니다.",
        });
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadServerProfile();
    return () => {
      active = false;
    };
  }, [email, initialValues, signedIn, userScope]);

  const initials = useMemo(() => {
    const trimmed = values.displayName.trim();
    return trimmed ? trimmed.slice(0, 2) : "로";
  }, [values.displayName]);

  const theologyOptions = useMemo(
    () => theologyOptionsForDenomination(values.denomination),
    [values.denomination],
  );

  const agentRegistration = useMemo<AiAgentPageRegistration>(() => {
    const completionFields = [
      ["이름", values.displayName.trim().length >= 2],
      ["사역 역할", Boolean(values.ministryRole.trim())],
      ["교단", Boolean(values.denomination.trim())],
      ["신학 설정", Boolean(values.theology.trim())],
      ["교회", Boolean(values.church.trim())],
      ["연락처", Boolean(values.phone.trim())],
    ] as const;
    const completedFields = completionFields.filter(([, complete]) => complete).length;
    return {
      surface: "account",
      title: "계정 설정",
      snapshot: {
        profileCompletion: {
          loadState: loading ? "loading" : "ready",
          storageMode: signedIn ? "account" : "device",
          completedFields,
          totalFields: completionFields.length,
          missingFields: completionFields
            .filter(([, complete]) => !complete)
            .map(([label]) => label),
          ministryRole: values.ministryRole,
          denomination: values.denomination,
          theology: values.theology,
        },
      },
      capabilities: ["navigate"],
      suggestions: [
        "프로필 완성도와 빠진 항목을 점검해줘",
        "현재 교단과 신학 설정의 관계를 설명해줘",
        "이 화면에서 직접 확인해야 할 저장 항목을 알려줘",
      ],
    };
  }, [loading, signedIn, values]);

  useRegisterAiAgentPage(agentRegistration);

  function updateField<Key extends keyof ProfileValues>(
    key: Key,
    value: ProfileValues[Key],
  ) {
    setValues((current) => ({ ...current, [key]: value }));
    setSaveState({ kind: "idle" });
    if (key === "displayName") setNameError("");
  }

  function updateDenomination(value: string) {
    const denomination = isDenomination(value) ? value : "";
    const options = theologyOptionsForDenomination(denomination);
    setValues((current) => ({
      ...current,
      denomination,
      theology: options.includes(current.theology)
        ? current.theology
        : (options[0] ?? ""),
    }));
    setSaveState({ kind: "idle" });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextValues: ProfileValues = {
      displayName: values.displayName.trim(),
      ministryRole: values.ministryRole.trim(),
      denomination: values.denomination.trim(),
      theology: values.theology.trim(),
      church: values.church.trim(),
      phone: values.phone.trim(),
    };

    if (nextValues.displayName.length < 2 || nextValues.displayName.length > 40) {
      setNameError("이름을 2자 이상 40자 이하로 입력해 주세요.");
      return;
    }
    if (!isMinistryRole(nextValues.ministryRole)) {
      setSaveState({ kind: "error", message: "사역 역할을 확인해 주세요." });
      return;
    }
    if (!isValidTheologySelection(nextValues.denomination, nextValues.theology)) {
      setSaveState({
        kind: "error",
        message: "선택한 교단에 맞는 신학 설정을 확인해 주세요.",
      });
      return;
    }
    if (nextValues.church.length > 60 || nextValues.phone.length > 40) {
      setSaveState({ kind: "error", message: "교회 이름과 연락처 길이를 확인해 주세요." });
      return;
    }

    setValues(nextValues);
    setSaveState({ kind: "saving", message: "변경 사항을 저장하고 있습니다." });

    try {
      writeSavedProfile(userScope, nextValues);
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
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
            ? String((body as { error: string }).error)
            : "계정 정보를 저장하지 못했습니다.";
        throw new Error(message);
      }
      const saved = loadedProfile(body, nextValues, accountEmail);
      setValues(saved.values);
      setAccountEmail(saved.email);
      writeSavedProfile(userScope, saved.values);
      setSaveState({
        kind: "success",
        message: saved.demo
          ? "이 기기에 계정 설정을 저장했습니다."
          : "계정 정보가 저장되었습니다.",
      });
    } catch (error) {
      setSaveState({
        kind: "local",
        message: `${error instanceof Error ? error.message : "계정 서버에 연결하지 못했습니다."} 이 기기에는 임시 저장했습니다.`,
      });
    }
  }

  const statusClass =
    saveState.kind === "success"
      ? "border-[#b8d3be] bg-[#eef7ef] text-[#285239]"
      : saveState.kind === "error"
        ? "border-[#e2b8ae] bg-[#fff1ee] text-[#7b352b]"
        : "border-[#e3c89e] bg-[#fff8e8] text-[#694a1f]";
  const fieldClass =
    "mt-2 min-h-12 w-full rounded-xl border border-[#d5cfc4] bg-[#fcfbf8] px-4 text-sm text-[#263c32] outline-none transition focus:border-[#6f8d80] focus:ring-2 focus:ring-[#b9cec5]/60 disabled:cursor-wait disabled:opacity-65";

  return (
    <form onSubmit={handleSubmit} noValidate>
      <section aria-labelledby="theology-settings-title">
        <div className="border-b border-[#e2ddd4] pb-6">
          <p className="text-[10px] font-extrabold uppercase tracking-[.16em] text-[#a56732]">0.0 Theology</p>
          <h2 id="theology-settings-title" className="mt-2 font-serif text-xl font-bold text-[#294238]">
            신학 설정
          </h2>
          <p className="mt-1 text-sm leading-6 text-[#606c66]">
            교단을 먼저 선택하면 해당 교단의 신학 선택지가 표시됩니다.
          </p>
        </div>

        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor="denomination" className="block text-sm font-extrabold text-[#34473e]">교단</label>
            <select
              id="denomination"
              name="denomination"
              value={values.denomination}
              onChange={(event) => updateDenomination(event.target.value)}
              disabled={loading}
              className={fieldClass}
            >
              <option value="">교단을 선택해 주세요</option>
              {DENOMINATION_OPTIONS.map((denomination) => (
                <option key={denomination} value={denomination}>{denomination}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="theology" className="block text-sm font-extrabold text-[#34473e]">신학</label>
            <select
              id="theology"
              name="theology"
              value={values.theology}
              onChange={(event) => updateField("theology", event.target.value)}
              disabled={loading || !values.denomination}
              className={fieldClass}
            >
              <option value="">{values.denomination ? "신학을 선택해 주세요" : "교단을 먼저 선택해 주세요"}</option>
              {theologyOptions.map((theology) => (
                <option key={theology} value={theology}>{theology}</option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section className="mt-9 border-t border-[#e2ddd4] pt-8" aria-labelledby="personal-settings-title">
        <div className="flex flex-col gap-5 border-b border-[#e2ddd4] pb-6 sm:flex-row sm:items-center">
          <div
            aria-hidden="true"
            className="grid size-20 shrink-0 place-items-center rounded-[1.5rem] bg-[#dfeae3] font-serif text-xl font-bold text-[#2e5545] shadow-[inset_0_0_0_1px_rgba(45,84,67,.08)]"
          >
            {initials}
          </div>
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-[.16em] text-[#a56732]">0.1 Personal</p>
            <h2 id="personal-settings-title" className="mt-2 font-serif text-xl font-bold text-[#294238]">개인 설정</h2>
            <p className="mt-1 text-sm leading-6 text-[#606c66]">
              화면과 설교 문서에 표시할 사역 정보를 관리합니다.
            </p>
          </div>
        </div>

        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor="display-name" className="block text-sm font-extrabold text-[#34473e]">
              이름 <span className="text-[#a64b3e]">*</span>
            </label>
            <input
              id="display-name"
              name="displayName"
              value={values.displayName}
              onChange={(event) => updateField("displayName", event.target.value)}
              minLength={2}
              maxLength={40}
              required
              disabled={loading}
              aria-invalid={Boolean(nameError)}
              aria-describedby={nameError ? "display-name-error" : undefined}
              autoComplete="name"
              className={fieldClass}
            />
            {nameError ? <p id="display-name-error" className="mt-1.5 text-xs font-semibold text-[#a14235]" role="alert">{nameError}</p> : null}
          </div>

          <div>
            <label htmlFor="ministry-role" className="block text-sm font-extrabold text-[#34473e]">사역 역할</label>
            <select
              id="ministry-role"
              name="ministryRole"
              value={values.ministryRole}
              onChange={(event) => updateField("ministryRole", event.target.value)}
              disabled={loading}
              className={fieldClass}
            >
              {MINISTRY_ROLE_OPTIONS.map((role) => <option key={role} value={role}>{role}</option>)}
            </select>
          </div>

          <div>
            <label htmlFor="church-name" className="block text-sm font-extrabold text-[#34473e]">
              교회 <span className="font-medium text-[#606c66]">(선택)</span>
            </label>
            <input
              id="church-name"
              name="church"
              value={values.church}
              onChange={(event) => updateField("church", event.target.value)}
              maxLength={60}
              disabled={loading}
              autoComplete="organization"
              placeholder="예: 새빛교회"
              className={fieldClass}
            />
          </div>

          <div>
            <label htmlFor="phone" className="block text-sm font-extrabold text-[#34473e]">
              연락처 <span className="font-medium text-[#606c66]">(선택)</span>
            </label>
            <input
              id="phone"
              name="phone"
              type="tel"
              inputMode="tel"
              value={values.phone}
              onChange={(event) => updateField("phone", event.target.value)}
              maxLength={40}
              disabled={loading}
              autoComplete="tel"
              placeholder="예: 010-1234-5678"
              className={fieldClass}
            />
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="account-email" className="block text-sm font-extrabold text-[#34473e]">이메일</label>
            <input
              id="account-email"
              type="email"
              value={accountEmail || "로그인 후 확인할 수 있습니다"}
              readOnly
              aria-readonly="true"
              className="mt-2 min-h-12 w-full cursor-not-allowed rounded-xl border border-[#ded9cf] bg-[#f1efea] px-4 text-sm text-[#606c66] outline-none"
            />
            <p className="mt-1.5 text-[11px] leading-5 text-[#606c66]">이메일과 연결된 로그인 수단은 Supabase Auth에서 관리됩니다.</p>
          </div>
        </div>
      </section>

      {loading ? (
        <div className="mt-6 rounded-xl border border-[#d9d5cc] bg-[#f8f6f1] px-4 py-3 text-xs font-semibold text-[#65716a]" role="status">
          계정에 저장된 설정을 불러오고 있습니다.
        </div>
      ) : null}

      {saveState.kind !== "idle" && saveState.kind !== "saving" ? (
        <div className={`mt-6 rounded-xl border px-4 py-3 text-xs font-semibold leading-5 ${statusClass}`} role={saveState.kind === "error" ? "alert" : "status"}>
          {saveState.message}
        </div>
      ) : null}

      <div className="mt-7 flex flex-col-reverse gap-3 border-t border-[#e2ddd4] pt-6 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs leading-5 text-[#606c66]"><span aria-hidden="true">●</span> 비밀번호는 이 앱에 저장되지 않습니다.</p>
        <button
          type="submit"
          disabled={loading || saveState.kind === "saving"}
          className="inline-flex min-h-12 items-center justify-center rounded-xl bg-[#285343] px-6 text-sm font-extrabold text-white shadow-[0_10px_25px_rgba(38,81,65,.16)] hover:bg-[#204739] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838] focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-65"
        >
          {saveState.kind === "saving" ? "저장 중…" : "변경 사항 저장"}
        </button>
      </div>
    </form>
  );
}
