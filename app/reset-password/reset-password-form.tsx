"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { clearAuthSessionMode, authErrorMessage } from "@/app/_lib/auth-client";
import { passwordPolicyError } from "@/app/_lib/password-policy";
import { createSupabaseBrowserClient } from "@/app/_lib/supabase/client";

export function ResetPasswordForm({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!enabled || pending) return;
    const policyError = passwordPolicyError(password);
    if (policyError) {
      setError(policyError);
      return;
    }
    if (password !== confirmation) {
      setError("비밀번호가 일치하지 않습니다.");
      return;
    }
    setError("");
    setPending(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user) {
        setError("재설정 링크가 만료되었거나 이미 사용되었습니다. 새 링크를 요청해 주세요.");
        return;
      }
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(authErrorMessage(updateError));
        return;
      }
      await supabase.auth.signOut({ scope: "local" });
      clearAuthSessionMode();
      router.replace("/login?password_updated=1");
      router.refresh();
    } catch {
      setError("비밀번호를 변경하지 못했습니다. 새 링크를 요청한 뒤 다시 시도해 주세요.");
    } finally {
      setPending(false);
    }
  }

  if (!enabled) {
    return (
      <div className="rounded-2xl border border-[#e3c89e] bg-[#fff8e8] p-4 text-sm leading-6 text-[#694a1f]" role="alert">
        재설정 세션이 없거나 만료되었습니다. 이메일로 새 링크를 요청해 주세요.
        <a href="/forgot-password" className="mt-4 inline-flex w-full justify-center rounded-xl bg-white px-4 py-3 font-extrabold text-[#315746] underline underline-offset-4">새 링크 요청</a>
      </div>
    );
  }

  const fieldClass = "mt-2 min-h-12 w-full rounded-xl border border-[#d5cfc4] bg-[#fcfbf8] px-4 text-sm text-[#263c32] outline-none transition focus:border-[#6f8d80] focus:ring-2 focus:ring-[#b9cec5]/60";
  return (
    <form onSubmit={handleSubmit} noValidate>
      <div>
        <label htmlFor="new-password" className="block text-sm font-extrabold text-[#34473e]">새 비밀번호</label>
        <input id="new-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" minLength={8} required disabled={pending} aria-describedby="new-password-help" className={fieldClass} />
      </div>
      <div className="mt-5">
        <label htmlFor="new-password-confirmation" className="block text-sm font-extrabold text-[#34473e]">새 비밀번호 확인</label>
        <input id="new-password-confirmation" type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="new-password" minLength={8} required disabled={pending} className={fieldClass} />
      </div>
      <p id="new-password-help" className="mt-2 text-xs leading-5 text-[#7c8680]">8자 이상이며 숫자와 특수문자를 각각 1개 이상 포함해 주세요.</p>
      {error ? <p className="mt-4 rounded-xl border border-[#e2b8ae] bg-[#fff1ee] px-4 py-3 text-sm font-semibold leading-6 text-[#7b352b]" role="alert">{error}</p> : null}
      <button type="submit" disabled={pending || !password || !confirmation} className="mt-5 inline-flex min-h-13 w-full items-center justify-center rounded-2xl bg-[#244f3f] px-5 py-3.5 text-sm font-extrabold text-white shadow-[0_12px_30px_rgba(31,74,58,.18)] hover:bg-[#1d4436] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#c28046] disabled:cursor-not-allowed disabled:opacity-55">
        {pending ? "변경 중…" : "새 비밀번호 저장"}
      </button>
    </form>
  );
}
