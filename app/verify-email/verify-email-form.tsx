"use client";

import { useEffect, useState, type FormEvent } from "react";
import { authErrorMessage } from "@/app/_lib/auth-client";
import { createSupabaseBrowserClient } from "@/app/_lib/supabase/client";

export function VerifyEmailForm({ configured, initialEmail }: { configured: boolean; initialEmail: string }) {
  const [email, setEmail] = useState(initialEmail);
  const [pending, setPending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  async function handleResend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!configured || pending || cooldown > 0) return;
    setError("");
    setMessage("");
    setPending(true);
    const callback = new URL("/auth/callback", window.location.origin);
    callback.searchParams.set("next", "/login?verified=1");
    callback.searchParams.set("flow", "signup");
    try {
      const { error: authError } = await createSupabaseBrowserClient().auth.resend({
        type: "signup",
        email: email.trim(),
        options: { emailRedirectTo: callback.toString() },
      });
      if (authError) {
        setError(authErrorMessage(authError));
        return;
      }
      setMessage("인증 메일을 다시 보냈습니다. 스팸함도 함께 확인해 주세요.");
      setCooldown(60);
    } catch {
      setError("인증 메일을 보내지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleResend} noValidate className="mt-6 border-t border-[#e2ddd4] pt-5">
      <label htmlFor="verification-email" className="block text-sm font-extrabold text-[#34473e]">인증 이메일</label>
      <input id="verification-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" inputMode="email" required disabled={!configured || pending} placeholder="name@example.com" className="mt-2 min-h-12 w-full rounded-xl border border-[#d5cfc4] bg-[#fcfbf8] px-4 text-sm text-[#263c32] outline-none transition placeholder:text-[#a7ada9] focus:border-[#6f8d80] focus:ring-2 focus:ring-[#b9cec5]/60" />
      {message ? <p className="mt-3 text-sm font-semibold leading-6 text-[#285239]" role="status">{message}</p> : null}
      {error ? <p className="mt-3 text-sm font-semibold leading-6 text-[#7b352b]" role="alert">{error}</p> : null}
      <button type="submit" disabled={!configured || pending || cooldown > 0 || !email.trim()} className="mt-4 inline-flex min-h-12 w-full items-center justify-center rounded-xl border border-[#cbbdac] bg-white px-4 text-sm font-extrabold text-[#315746] hover:bg-[#f8f7f3] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838] disabled:cursor-not-allowed disabled:opacity-55">
        {pending ? "발송 중…" : cooldown > 0 ? `${cooldown}초 후 재발송` : "인증 링크 재발송"}
      </button>
    </form>
  );
}
