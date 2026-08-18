"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  authErrorMessage,
  setAuthSessionMode,
  startGoogleOAuth,
} from "@/app/_lib/auth-client";
import { passwordPolicyError } from "@/app/_lib/password-policy";
import { createSupabaseBrowserClient } from "@/app/_lib/supabase/client";

type PendingAction = "email" | "google" | null;

export function SignupForm({ configured }: { configured: boolean }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [pending, setPending] = useState<PendingAction>(null);
  const [error, setError] = useState("");

  function validationError(): string | null {
    const normalizedName = name.trim();
    if (normalizedName.length < 2 || normalizedName.length > 40) {
      return "이름을 2자 이상 40자 이하로 입력해 주세요.";
    }
    const passwordError = passwordPolicyError(password);
    if (passwordError) return passwordError;
    if (password !== confirmation) return "비밀번호가 일치하지 않습니다.";
    if (!termsAccepted || !privacyAccepted) {
      return "가입하려면 이용약관과 개인정보처리방침에 동의해 주세요.";
    }
    return null;
  }

  async function handleSignup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!configured || pending) return;
    const validation = validationError();
    if (validation) {
      setError(validation);
      return;
    }
    setError("");
    setPending("email");

    const callback = new URL("/auth/callback", window.location.origin);
    callback.searchParams.set("next", "/login?verified=1");
    callback.searchParams.set("flow", "signup");

    try {
      const { data, error: authError } = await createSupabaseBrowserClient().auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { full_name: name.trim(), name: name.trim() },
          emailRedirectTo: callback.toString(),
        },
      });
      if (authError) {
        setError(authErrorMessage(authError));
        return;
      }
      if (data.session) {
        setAuthSessionMode(true);
        router.replace("/home");
        router.refresh();
        return;
      }
      router.push(`/verify-email?email=${encodeURIComponent(email.trim())}`);
    } catch {
      setError("인증 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setPending(null);
    }
  }

  async function handleGoogleSignup() {
    if (!configured || pending) return;
    if (!termsAccepted || !privacyAccepted) {
      setError("Google로 시작하려면 이용약관과 개인정보처리방침에 동의해 주세요.");
      return;
    }
    setError("");
    setPending("google");
    const message = await startGoogleOAuth("/home", true);
    if (message) {
      setError(message);
      setPending(null);
    }
  }

  const fieldClass =
    "mt-2 min-h-12 w-full rounded-xl border border-[#d5cfc4] bg-[#fcfbf8] px-4 text-sm text-[#263c32] outline-none transition placeholder:text-[#a7ada9] focus:border-[#6f8d80] focus:ring-2 focus:ring-[#b9cec5]/60";

  return (
    <>
      {!configured ? (
        <p className="mb-5 rounded-xl border border-[#e2b8ae] bg-[#fff1ee] px-4 py-3 text-sm font-semibold leading-6 text-[#7b352b]" role="alert">
          인증 서비스 설정이 아직 완료되지 않았습니다. 관리자에게 문의해 주세요.
        </p>
      ) : null}
      <form onSubmit={handleSignup} noValidate>
        <div>
          <label htmlFor="signup-name" className="block text-sm font-extrabold text-[#34473e]">이름</label>
          <input id="signup-name" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" minLength={2} maxLength={40} required disabled={!configured || pending !== null} className={fieldClass} />
        </div>
        <div className="mt-5">
          <label htmlFor="signup-email" className="block text-sm font-extrabold text-[#34473e]">이메일</label>
          <input id="signup-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" inputMode="email" required disabled={!configured || pending !== null} placeholder="name@example.com" className={fieldClass} />
        </div>
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor="signup-password" className="block text-sm font-extrabold text-[#34473e]">비밀번호</label>
            <input id="signup-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" minLength={8} required disabled={!configured || pending !== null} aria-describedby="password-help" className={fieldClass} />
          </div>
          <div>
            <label htmlFor="signup-confirmation" className="block text-sm font-extrabold text-[#34473e]">비밀번호 확인</label>
            <input id="signup-confirmation" type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="new-password" minLength={8} required disabled={!configured || pending !== null} className={fieldClass} />
          </div>
        </div>
        <p id="password-help" className="mt-2 text-xs leading-5 text-[#7c8680]">8자 이상이며 숫자와 특수문자를 각각 1개 이상 포함해 주세요.</p>

        <div className="mt-5 space-y-3 rounded-2xl border border-[#e1ddd4] bg-[#faf8f3] p-4">
          <div className="flex items-start gap-3 text-sm leading-5 text-[#4f5d56]">
            <input id="signup-terms" type="checkbox" checked={termsAccepted} onChange={(event) => setTermsAccepted(event.target.checked)} disabled={pending !== null} aria-label="이용약관에 동의합니다." className="mt-0.5 size-4 accent-[#285441]" />
            <p>
              <label htmlFor="signup-terms" className="cursor-pointer"><strong className="font-extrabold">필수</strong>{" "}</label>
              <a href="/terms" className="font-extrabold text-[#285441] underline decoration-[#285441]/40 underline-offset-4 hover:decoration-current focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b8773e]">이용약관</a>
              <label htmlFor="signup-terms" className="cursor-pointer">에 동의합니다.</label>
            </p>
          </div>
          <div className="flex items-start gap-3 text-sm leading-5 text-[#4f5d56]">
            <input id="signup-privacy" type="checkbox" checked={privacyAccepted} onChange={(event) => setPrivacyAccepted(event.target.checked)} disabled={pending !== null} aria-label="개인정보처리방침에 동의합니다." className="mt-0.5 size-4 accent-[#285441]" />
            <p>
              <label htmlFor="signup-privacy" className="cursor-pointer"><strong className="font-extrabold">필수</strong>{" "}</label>
              <a href="/privacy" className="font-extrabold text-[#285441] underline decoration-[#285441]/40 underline-offset-4 hover:decoration-current focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b8773e]">개인정보처리방침</a>
              <label htmlFor="signup-privacy" className="cursor-pointer">에 동의합니다.</label>
            </p>
          </div>
        </div>

        {error ? (
          <p className="mt-4 rounded-xl border border-[#e2b8ae] bg-[#fff1ee] px-4 py-3 text-sm font-semibold leading-6 text-[#7b352b]" role="alert" aria-live="polite">{error}</p>
        ) : null}

        <button type="submit" disabled={!configured || pending !== null} className="mt-5 inline-flex min-h-13 w-full items-center justify-center rounded-2xl bg-[#244f3f] px-5 py-3.5 text-sm font-extrabold text-white shadow-[0_12px_30px_rgba(31,74,58,.18)] transition hover:bg-[#1d4436] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#c28046] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-55">
          {pending === "email" ? "계정을 만드는 중…" : "이메일로 가입하기"}
        </button>
      </form>

      <div className="my-5 flex items-center gap-3 text-[11px] font-bold tracking-[0.14em] text-[#929993] uppercase">
        <span className="h-px flex-1 bg-[#e1ddd4]" />또는<span className="h-px flex-1 bg-[#e1ddd4]" />
      </div>
      <button type="button" onClick={handleGoogleSignup} disabled={!configured || pending !== null} className="inline-flex min-h-13 w-full items-center justify-center gap-3 rounded-2xl border border-[#d5cfc4] bg-white px-5 py-3.5 text-sm font-extrabold text-[#34473e] transition hover:bg-[#f8f7f3] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#c28046] disabled:cursor-not-allowed disabled:opacity-55">
        <span aria-hidden="true" className="grid size-7 place-items-center rounded-full border border-[#ddd] text-sm font-black text-[#4285f4]">G</span>
        {pending === "google" ? "Google로 이동 중…" : "Google 계정으로 가입"}
      </button>
    </>
  );
}
