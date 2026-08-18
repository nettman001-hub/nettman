"use client";

import {
  AUTH_SESSION_MAX_AGE_SECONDS,
  AUTH_SESSION_MODE_COOKIE,
} from "./supabase/config";
import { createSupabaseBrowserClient } from "./supabase/client";

function secureCookieAttribute(): string {
  return window.location.protocol === "https:" ? "; Secure" : "";
}

export function setAuthSessionMode(remember: boolean): void {
  const maxAge = remember ? `; Max-Age=${AUTH_SESSION_MAX_AGE_SECONDS}` : "";
  const value = remember ? "persistent" : "session";
  document.cookie = `${AUTH_SESSION_MODE_COOKIE}=${value}; Path=/; SameSite=Lax${maxAge}${secureCookieAttribute()}`;
}

export function clearAuthSessionMode(): void {
  document.cookie = `${AUTH_SESSION_MODE_COOKIE}=; Path=/; SameSite=Lax; Max-Age=0${secureCookieAttribute()}`;
}

export async function startGoogleOAuth(
  returnTo: string,
  remember: boolean,
): Promise<string | null> {
  setAuthSessionMode(remember);
  const callback = new URL("/auth/callback", window.location.origin);
  callback.searchParams.set("next", returnTo);
  callback.searchParams.set("flow", "oauth");
  callback.searchParams.set("remember", remember ? "1" : "0");

  try {
    const { error } = await createSupabaseBrowserClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: callback.toString() },
    });
    if (error) {
      clearAuthSessionMode();
      return authErrorMessage(error);
    }
    return null;
  } catch {
    clearAuthSessionMode();
    return "인증 서비스 설정을 확인하는 중입니다. 잠시 후 다시 시도해 주세요.";
  }
}

export function authErrorMessage(error: { code?: string; message?: string }): string {
  switch (error.code) {
    case "email_not_confirmed":
      return "이메일 인증이 필요합니다. 받은 편지함의 인증 링크를 확인해 주세요.";
    case "user_already_exists":
      return "이미 가입된 이메일입니다. 로그인하거나 비밀번호를 재설정해 주세요.";
    case "weak_password":
      return "비밀번호 조건을 확인해 주세요.";
    case "email_address_not_authorized":
      return "인증 메일 발송 설정이 완료되지 않았습니다. 관리자에게 문의해 주세요.";
    case "email_address_invalid":
      return "사용할 수 없는 이메일 주소입니다. 다른 이메일을 입력해 주세요.";
    case "email_provider_disabled":
    case "signup_disabled":
      return "현재 이메일 회원가입을 사용할 수 없습니다. 관리자에게 문의해 주세요.";
    case "over_request_rate_limit":
      return "요청이 많습니다. 잠시 후 다시 시도해 주세요.";
    case "over_email_send_rate_limit":
      return "인증 메일 발송 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.";
    case "provider_disabled":
      return "Google 로그인이 아직 활성화되지 않았습니다. 관리자에게 문의해 주세요.";
    default:
      return "이메일 또는 비밀번호를 확인해 주세요.";
  }
}
