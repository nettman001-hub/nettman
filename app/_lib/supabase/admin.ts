import { createClient } from "@supabase/supabase-js";
import { getSiteOrigin, getSupabasePublicConfig } from "./config";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_ACCESS_TOKEN_LENGTH = 16_384;
const PERMANENT_BAN_DURATION = "876000h";

export type AdminAuthUserInfo = {
  id: string;
  email: string;
  emailConfirmedAt: string | null;
  lastSignInAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  bannedUntil: string | null;
};

export type AdminAuthFailure =
  | {
      available: true;
      ok: false;
      error: string;
      code: "invalid_input" | "not_found" | "rate_limited" | "provider_error";
    }
  | {
      available: false;
      ok: false;
      error: string;
      code: "unavailable";
    };

export type AdminAuthResult<T extends object = Record<never, never>> =
  | ({ available: true; ok: true } & T)
  | AdminAuthFailure;

type AdminClient = ReturnType<typeof createClient>;

function usableSecret(value: string | undefined): string | null {
  const normalized = value?.trim();
  if (!normalized || normalized === "[SENSITIVE]" || normalized === "undefined") {
    return null;
  }
  return normalized;
}

function unavailable(): AdminAuthFailure {
  return {
    available: false,
    ok: false,
    code: "unavailable",
    error: "Supabase 관리자 인증 연동이 설정되지 않았습니다.",
  };
}

function invalidInput(message: string): AdminAuthFailure {
  return {
    available: true,
    ok: false,
    code: "invalid_input",
    error: message,
  };
}

function errorRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function providerFailure(error: unknown): AdminAuthFailure {
  const record = errorRecord(error);
  const status = typeof record.status === "number" ? record.status : 0;
  const code = typeof record.code === "string" ? record.code : "";
  if (status === 404 || code === "user_not_found") {
    return {
      available: true,
      ok: false,
      code: "not_found",
      error: "Supabase 인증 회원을 찾을 수 없습니다.",
    };
  }
  if (status === 429 || code.includes("rate_limit")) {
    return {
      available: true,
      ok: false,
      code: "rate_limited",
      error: "인증 요청이 많습니다. 잠시 후 다시 시도해 주세요.",
    };
  }
  return {
    available: true,
    ok: false,
    code: "provider_error",
    error: "Supabase 인증 작업을 완료하지 못했습니다.",
  };
}

function createSupabaseAdminClient(): AdminClient | null {
  if (typeof window !== "undefined") return null;
  const config = getSupabasePublicConfig();
  const serviceRoleKey = usableSecret(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!config || !serviceRoleKey || serviceRoleKey === config.publishableKey) return null;

  return createClient(config.url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

function createSupabaseMailClient(): AdminClient | null {
  const config = getSupabasePublicConfig();
  if (!config) return null;
  const serviceRoleKey = usableSecret(process.env.SUPABASE_SERVICE_ROLE_KEY);
  return createClient(config.url, serviceRoleKey ?? config.publishableKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

export function getAdminAuthCapabilities(): {
  mailAvailable: boolean;
  privilegedAvailable: boolean;
} {
  const config = getSupabasePublicConfig();
  const serviceRoleKey = usableSecret(process.env.SUPABASE_SERVICE_ROLE_KEY);
  return {
    mailAvailable: Boolean(config),
    privilegedAvailable: Boolean(
      config && serviceRoleKey && serviceRoleKey !== config.publishableKey,
    ),
  };
}

function safeDate(value: unknown): string | null {
  return typeof value === "string" && value.length <= 80 ? value : null;
}

function safeAuthUser(value: unknown): AdminAuthUserInfo | null {
  const user = errorRecord(value);
  const id = typeof user.id === "string" ? user.id : "";
  const email = typeof user.email === "string" ? user.email.trim().toLowerCase() : "";
  if (!UUID_PATTERN.test(id) || !email || email.length > 254) return null;
  return {
    id,
    email,
    emailConfirmedAt: safeDate(user.email_confirmed_at),
    lastSignInAt: safeDate(user.last_sign_in_at),
    createdAt: safeDate(user.created_at),
    updatedAt: safeDate(user.updated_at),
    bannedUntil: safeDate(user.banned_until),
  };
}

function normalizedEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  if (!email || email.length > 254 || /[\r\n]/.test(email)) return null;
  const separator = email.lastIndexOf("@");
  if (separator <= 0 || separator === email.length - 1) return null;
  return email;
}

function trustedRedirect(value: string, fallbackPath: string): string | null {
  const siteOrigin = getSiteOrigin();
  try {
    const trustedOrigin = new URL(siteOrigin).origin;
    const fallback = new URL(fallbackPath, trustedOrigin).toString();
    if (!value.trim()) return fallback;
    const redirect = new URL(value, trustedOrigin);
    return redirect.origin === trustedOrigin ? redirect.toString() : null;
  } catch {
    return null;
  }
}

function success<T extends object>(value: T): AdminAuthResult<T> {
  return Object.assign({ available: true as const, ok: true as const }, value);
}

export async function getAdminAuthUserInfo(
  userId: string,
): Promise<AdminAuthResult<{ user: AdminAuthUserInfo }>> {
  if (!UUID_PATTERN.test(userId)) {
    return invalidInput("회원 ID 형식을 확인해 주세요.");
  }
  const client = createSupabaseAdminClient();
  if (!client) return unavailable();
  try {
    const { data, error } = await client.auth.admin.getUserById(userId);
    if (error) return providerFailure(error);
    const user = safeAuthUser(data.user);
    return user ? success({ user }) : providerFailure(null);
  } catch (error) {
    return providerFailure(error);
  }
}

export async function sendAdminPasswordReset(
  email: string,
  redirectTo = "",
): Promise<AdminAuthResult> {
  const safeEmail = normalizedEmail(email);
  if (!safeEmail) return invalidInput("이메일 형식을 확인해 주세요.");
  const safeRedirect = trustedRedirect(redirectTo, "/reset-password");
  if (!safeRedirect) return invalidInput("비밀번호 재설정 링크 주소를 확인해 주세요.");
  const client = createSupabaseMailClient();
  if (!client) return unavailable();
  try {
    const { error } = await client.auth.resetPasswordForEmail(safeEmail, {
      redirectTo: safeRedirect,
    });
    return error ? providerFailure(error) : success({});
  } catch (error) {
    return providerFailure(error);
  }
}

export async function resendAdminVerification(
  email: string,
  redirectTo = "",
): Promise<AdminAuthResult> {
  const safeEmail = normalizedEmail(email);
  if (!safeEmail) return invalidInput("이메일 형식을 확인해 주세요.");
  const safeRedirect = trustedRedirect(
    redirectTo,
    "/auth/callback?next=%2Flogin%3Fverified%3D1&flow=signup",
  );
  if (!safeRedirect) return invalidInput("인증 완료 링크 주소를 확인해 주세요.");
  const client = createSupabaseMailClient();
  if (!client) return unavailable();
  try {
    const { error } = await client.auth.resend({
      type: "signup",
      email: safeEmail,
      options: { emailRedirectTo: safeRedirect },
    });
    return error ? providerFailure(error) : success({});
  } catch (error) {
    return providerFailure(error);
  }
}

function banDuration(suspendedUntil: string | undefined): string | null {
  if (!suspendedUntil?.trim()) return PERMANENT_BAN_DURATION;
  const expiry = Date.parse(suspendedUntil);
  if (!Number.isFinite(expiry) || expiry <= Date.now()) return null;
  const seconds = Math.max(1, Math.ceil((expiry - Date.now()) / 1_000));
  const maximumSeconds = 100 * 365 * 24 * 60 * 60;
  return `${Math.min(seconds, maximumSeconds)}s`;
}

export async function setAdminAuthSuspension(
  userId: string,
  suspended: boolean,
  suspendedUntil?: string,
): Promise<AdminAuthResult<{ user: AdminAuthUserInfo }>> {
  if (!UUID_PATTERN.test(userId)) {
    return invalidInput("회원 ID 형식을 확인해 주세요.");
  }
  const duration = suspended ? banDuration(suspendedUntil) : "none";
  if (!duration) return invalidInput("정지 만료 시각은 현재보다 이후여야 합니다.");
  const client = createSupabaseAdminClient();
  if (!client) return unavailable();
  try {
    const { data, error } = await client.auth.admin.updateUserById(userId, {
      ban_duration: duration,
    });
    if (error) return providerFailure(error);
    const user = safeAuthUser(data.user);
    return user ? success({ user }) : providerFailure(null);
  } catch (error) {
    return providerFailure(error);
  }
}

/**
 * Supabase's global sign-out endpoint requires a valid target access token.
 * The token is verified against the expected user ID and is never returned or logged.
 * App-level known-session revocation remains the primary by-user-ID control.
 */
export async function globallySignOutAdminAuthUser(
  userId: string,
  targetAccessToken: string,
): Promise<AdminAuthResult<{ supabaseRevoked: true }>> {
  if (!UUID_PATTERN.test(userId)) {
    return invalidInput("회원 ID 형식을 확인해 주세요.");
  }
  if (
    !targetAccessToken ||
    targetAccessToken.length > MAX_ACCESS_TOKEN_LENGTH ||
    /\s/.test(targetAccessToken)
  ) {
    return invalidInput("대상 회원의 유효한 세션 토큰이 필요합니다.");
  }
  const client = createSupabaseAdminClient();
  if (!client) return unavailable();
  try {
    const { data, error: identityError } = await client.auth.getUser(targetAccessToken);
    if (identityError) return providerFailure(identityError);
    if (data.user?.id !== userId) {
      return invalidInput("세션 토큰의 회원이 작업 대상과 일치하지 않습니다.");
    }
    const { error } = await client.auth.admin.signOut(targetAccessToken, "global");
    return error ? providerFailure(error) : success({ supabaseRevoked: true });
  } catch (error) {
    return providerFailure(error);
  }
}
