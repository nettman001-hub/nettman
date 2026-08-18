"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  authErrorMessage,
  clearAuthSessionMode,
  setAuthSessionMode,
  startGoogleOAuth,
} from "@/app/_lib/auth-client";
import { createSupabaseBrowserClient } from "@/app/_lib/supabase/client";

type PendingAction = "email" | "google" | null;

export function LoginForm({
  configured,
  initialNotice,
  returnTo,
}: {
  configured: boolean;
  initialNotice?: string;
  returnTo: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [pending, setPending] = useState<PendingAction>(null);
  const [error, setError] = useState("");

  async function handleEmailLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!configured || pending) return;
    setError("");
    setPending("email");
    setAuthSessionMode(remember);

    try {
      const { error: authError } = await createSupabaseBrowserClient().auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (authError) {
        clearAuthSessionMode();
        if (authError.code === "email_not_confirmed") {
          router.push(`/verify-email?email=${encodeURIComponent(email.trim())}`);
          return;
        }
        setError(authErrorMessage(authError));
        return;
      }
      router.replace(returnTo);
      router.refresh();
    } catch {
      clearAuthSessionMode();
      setError("인증 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setPending(null);
    }
  }

  async function handleGoogleLogin() {
    if (!configured || pending) return;
    setError("");
    setPending("google");
    const message = await startGoogleOAuth(returnTo, remember);
    if (message) {
      setError(message);
      setPending(null);
    }
  }

  const fieldClass =
    "mt-2 min-h-12 w-full rounded-xl border border-[#d5cfc4] bg-[#fcfbf8] px-4 text-sm text-[#263c32] outline-none transition placeholder:text-[#a7ada9] focus:border-[#6f8d80] focus:ring-2 focus:ring-[#b9cec5]/60";

  return (
    <>
      {initialNotice ? (
        <p className="mb-5 rounded-xl border border-[#b9d2c0] bg-[#eef7ef] px-4 py-3 text-sm font-semibold leading-6 text-[#285239]" role="status">
          {initialNotice}
        </p>
      ) : null}
      {!configured ? (
        <p className="mb-5 rounded-xl border border-[#e2b8ae] bg-[#fff1ee] px-4 py-3 text-sm font-semibold leading-6 text-[#7b352b]" role="alert">
          인증 서비스 설정이 아직 완료되지 않았습니다. 관리자에게 문의해 주세요.
        </p>
      ) : null}

      <form onSubmit={handleEmailLogin} noValidate>
        <div>
          <label htmlFor="login-email" className="block text-sm font-extrabold text-[#34473e]">
            이메일
          </label>
          <input
            id="login-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            inputMode="email"
            required
            disabled={!configured || pending !== null}
            placeholder="name@example.com"
            className={fieldClass}
          />
        </div>
        <div className="mt-5">
          <div className="flex items-center justify-between gap-4">
            <label htmlFor="login-password" className="block text-sm font-extrabold text-[#34473e]">
              비밀번호
            </label>
            <a href="/forgot-password" className="text-xs font-bold text-[#396451] underline decoration-[#b9c9c1] underline-offset-4">
              비밀번호 찾기
            </a>
          </div>
          <input
            id="login-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
            disabled={!configured || pending !== null}
            className={fieldClass}
          />
        </div>

        <label className="mt-4 flex cursor-pointer items-start gap-3 text-sm leading-5 text-[#56635d]">
          <input
            type="checkbox"
            checked={remember}
            onChange={(event) => setRemember(event.target.checked)}
            disabled={pending !== null}
            className="mt-0.5 size-4 accent-[#285441]"
          />
          <span>
            로그인 유지
            <span className="block text-xs text-[#8a918d]">
              켜면 최대 7일, 끄면 브라우저를 닫을 때까지 유지됩니다.
            </span>
          </span>
        </label>

        {error ? (
          <p className="mt-4 rounded-xl border border-[#e2b8ae] bg-[#fff1ee] px-4 py-3 text-sm font-semibold leading-6 text-[#7b352b]" role="alert" aria-live="polite">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={!configured || pending !== null || !email.trim() || !password}
          className="mt-5 inline-flex min-h-13 w-full items-center justify-center rounded-2xl bg-[#244f3f] px-5 py-3.5 text-sm font-extrabold text-white shadow-[0_12px_30px_rgba(31,74,58,.18)] transition hover:bg-[#1d4436] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#c28046] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-55"
        >
          {pending === "email" ? "로그인 중…" : "이메일로 로그인"}
        </button>
      </form>

      <div className="my-5 flex items-center gap-3 text-[11px] font-bold tracking-[0.14em] text-[#929993] uppercase">
        <span className="h-px flex-1 bg-[#e1ddd4]" />
        또는
        <span className="h-px flex-1 bg-[#e1ddd4]" />
      </div>
      <button
        type="button"
        onClick={handleGoogleLogin}
        disabled={!configured || pending !== null}
        className="inline-flex min-h-13 w-full items-center justify-center gap-3 rounded-2xl border border-[#d5cfc4] bg-white px-5 py-3.5 text-sm font-extrabold text-[#34473e] transition hover:bg-[#f8f7f3] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#c28046] disabled:cursor-not-allowed disabled:opacity-55"
      >
        <span aria-hidden="true" className="grid size-7 place-items-center rounded-full border border-[#ddd] text-sm font-black text-[#4285f4]">G</span>
        {pending === "google" ? "Google로 이동 중…" : "Google 계정으로 계속"}
      </button>
    </>
  );
}
