"use client";

import { useState, type FormEvent } from "react";
import { authErrorMessage } from "@/app/_lib/auth-client";
import { createSupabaseBrowserClient } from "@/app/_lib/supabase/client";

export function ForgotPasswordForm({ configured }: { configured: boolean }) {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!configured || pending) return;
    setError("");
    setPending(true);
    const callback = new URL("/auth/callback", window.location.origin);
    callback.searchParams.set("next", "/reset-password");
    callback.searchParams.set("flow", "recovery");

    try {
      const { error: authError } = await createSupabaseBrowserClient().auth.resetPasswordForEmail(
        email.trim(),
        { redirectTo: callback.toString() },
      );
      if (authError) {
        setError(authErrorMessage(authError));
        return;
      }
      setSent(true);
    } catch {
      setError("인증 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setPending(false);
    }
  }

  if (sent) {
    return (
      <div className="text-center" role="status">
        <span aria-hidden="true" className="mx-auto grid size-16 place-items-center rounded-[1.35rem] bg-[#edf3ee] text-2xl font-bold text-[#315746]">@</span>
        <h2 className="mt-4 text-base font-extrabold text-[#2b4037]">메일을 확인해 주세요</h2>
        <p className="mt-2 text-sm leading-6 text-[#69756f]">가입된 이메일이라면 비밀번호 재설정 링크를 보냈습니다. 보안을 위해 계정 존재 여부는 별도로 표시하지 않습니다.</p>
        <button type="button" onClick={() => setSent(false)} className="mt-5 text-sm font-bold text-[#396451] underline underline-offset-4">다른 이메일 입력</button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <label htmlFor="recovery-email" className="block text-sm font-extrabold text-[#34473e]">가입한 이메일</label>
      <input id="recovery-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" inputMode="email" required disabled={!configured || pending} placeholder="name@example.com" className="mt-2 min-h-12 w-full rounded-xl border border-[#d5cfc4] bg-[#fcfbf8] px-4 text-sm text-[#263c32] outline-none transition placeholder:text-[#a7ada9] focus:border-[#6f8d80] focus:ring-2 focus:ring-[#b9cec5]/60" />
      {error ? <p className="mt-4 rounded-xl border border-[#e2b8ae] bg-[#fff1ee] px-4 py-3 text-sm font-semibold leading-6 text-[#7b352b]" role="alert">{error}</p> : null}
      <button type="submit" disabled={!configured || pending || !email.trim()} className="mt-5 inline-flex min-h-13 w-full items-center justify-center rounded-2xl bg-[#244f3f] px-5 py-3.5 text-sm font-extrabold text-white shadow-[0_12px_30px_rgba(31,74,58,.18)] hover:bg-[#1d4436] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#c28046] disabled:cursor-not-allowed disabled:opacity-55">
        {pending ? "발송 중…" : "재설정 링크 발송"}
      </button>
    </form>
  );
}
