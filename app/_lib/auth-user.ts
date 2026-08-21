import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { ensureDatabase, getD1 } from "../../db";
import {
  AUTH_SESSION_MODE_COOKIE,
  getSupabasePublicConfig,
} from "./supabase/config";
import { createSupabaseServerClient } from "./supabase/server";
import { logAuthAccessFailure } from "./auth-failure-log";
import { ensureTokenWallet } from "./token-wallet";

export type AppUserRole = "preacher" | "expert";

export type AppUser = {
  id: string;
  email: string;
  name: string;
  role: AppUserRole;
  isDemo: boolean;
  isAdmin: boolean;
};

export type AuthUserAccessFailureReason =
  | "account_suspended"
  | "session_revoked"
  | "session_invalid"
  | "identity_unavailable"
  | "account_store_unavailable";

export class AuthUserAccessError extends Error {
  readonly reason: AuthUserAccessFailureReason;
  readonly status: 403 | 503;

  constructor(reason: AuthUserAccessFailureReason) {
    const unavailable =
      reason === "identity_unavailable" || reason === "account_store_unavailable";
    super(
      unavailable
        ? "인증된 계정 상태를 확인할 수 없습니다. 잠시 후 다시 시도해 주세요."
        : "현재 계정으로는 서비스를 이용할 수 없습니다.",
    );
    this.name = "AuthUserAccessError";
    this.reason = reason;
    this.status = unavailable ? 503 : 403;
  }
}

type UserResolutionOptions = {
  demoRole?: AppUserRole;
};

type BaseUser = Omit<AppUser, "role" | "isAdmin"> & {
  /** Supabase session identifiers are kept server-side and never returned in AppUser. */
  sessionId: string | null;
};
type AppDatabase = NonNullable<ReturnType<typeof getD1>>;

type VerifiedIdentityResult =
  | { kind: "authenticated"; user: BaseUser }
  | { kind: "anonymous" }
  | { kind: "unavailable" };

type PersistedUserResult =
  | { kind: "allowed"; user: AppUser }
  | { kind: "denied"; reason: AuthUserAccessFailureReason };

const USER_OWNER_COLUMNS = [
  ["user_profiles", "user_id"],
  ["user_ai_preferences", "user_id"],
  ["global_ai_settings", "updated_by"],
  ["managed_ai_usage", "user_id"],
  ["ai_agent_usage", "user_id"],
  ["sermon_resource_usage", "user_id"],
  ["user_auth_sessions", "user_id"],
  ["user_auth_sessions", "revoked_by"],
  ["token_wallets", "user_id"],
  ["token_transactions", "user_id"],
  ["token_topups", "user_id"],
  ["token_adjustments", "user_id"],
  ["token_adjustments", "actor_user_id"],
  ["payment_orders", "user_id"],
  ["sermon_helper_projects", "user_id"],
  ["sermon_helper_coach_requests", "user_id"],
  ["sermon_drafts", "user_id"],
  ["sermon_generation_runs", "user_id"],
  ["sermons", "user_id"],
  ["notification_preferences", "user_id"],
  ["consultations", "user_id"],
  ["consultations", "expert_id"],
  ["consultation_messages", "sender_id"],
  ["notification_deliveries", "user_id"],
] as const;

function isLocalHost(host: string | null): boolean {
  if (!host) return false;
  const normalized = host.trim().toLowerCase();
  if (normalized.startsWith("[")) {
    const end = normalized.indexOf("]");
    return end >= 0 && normalized.slice(0, end + 1) === "[::1]";
  }
  const hostname = normalized.split(":", 1)[0];
  return hostname === "localhost" || hostname === "127.0.0.1";
}

function normalizeRole(value: unknown): AppUserRole {
  return value === "expert" ? "expert" : "preacher";
}

export function isAdminEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .includes(normalized);
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function displayNameFromClaims(
  claims: Record<string, unknown>,
  email: string,
): string {
  const metadata = recordValue(claims.user_metadata);
  for (const key of ["full_name", "name", "display_name", "preferred_username"]) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 80);
  }
  return email.split("@", 1)[0] || "설교자";
}

function authErrorRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function isAnonymousAuthError(value: unknown): boolean {
  const error = authErrorRecord(value);
  const code = typeof error.code === "string" ? error.code : "";
  const status = typeof error.status === "number" ? error.status : 0;
  return (
    code === "session_not_found" ||
    code === "refresh_token_not_found" ||
    code === "refresh_token_already_used" ||
    status === 401
  );
}

async function hasValidSessionMode(): Promise<boolean> {
  const mode = (await cookies()).get(AUTH_SESSION_MODE_COOKIE)?.value;
  return mode === "session" || mode === "persistent";
}

async function verifiedSupabaseIdentity(): Promise<VerifiedIdentityResult> {
  // API requests bypass the page proxy to avoid a duplicate Supabase network
  // validation. Preserve the session-mode policy centrally before trusting claims.
  if (!(await hasValidSessionMode())) {
    return { kind: "anonymous" };
  }
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { kind: "anonymous" };
  const startedAt = Date.now();
  try {
    const { data, error } = await supabase.auth.getClaims();
    if (error) {
      if (isAnonymousAuthError(error)) return { kind: "anonymous" };
      logAuthAccessFailure("identity", error, {
        stage: "get_claims",
        elapsedMs: Date.now() - startedAt,
      });
      return { kind: "unavailable" };
    }
    if (!data?.claims) return { kind: "anonymous" };
    const claims = data.claims as Record<string, unknown>;
    const id = typeof claims.sub === "string" ? claims.sub : "";
    const email = typeof claims.email === "string" ? claims.email.trim() : "";
    const rawSessionId =
      typeof claims.session_id === "string" ? claims.session_id.trim() : "";
    if (!id || !email) return { kind: "unavailable" };
    return {
      kind: "authenticated",
      user: {
        id,
        email,
        name: displayNameFromClaims(claims, email),
        isDemo: false,
        sessionId:
          rawSessionId && rawSessionId.length <= 128 ? rawSessionId : null,
      },
    };
  } catch (error) {
    logAuthAccessFailure("identity", error, {
      stage: "get_claims_throw",
      elapsedMs: Date.now() - startedAt,
    });
    return { kind: "unavailable" };
  }
}

async function migrateVerifiedEmailOwner(db: AppDatabase, user: BaseUser) {
  const existing = await db
    .prepare("SELECT id FROM users WHERE lower(email) = lower(?) LIMIT 1")
    .bind(user.email)
    .first<{ id: string }>();
  if (!existing || existing.id === user.id) return;

  await db.batch([
    ...USER_OWNER_COLUMNS.map(([table, column]) =>
      db.prepare(`UPDATE ${table} SET ${column} = ? WHERE ${column} = ?`).bind(user.id, existing.id),
    ),
    db.prepare("UPDATE users SET id = ?, email = ?, name = ? WHERE id = ?")
      .bind(user.id, user.email, user.name, existing.id),
  ]);
}

function developmentFallbackUser(user: BaseUser): AppUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    isDemo: user.isDemo,
    role: "preacher",
    isAdmin: isAdminEmail(user.email),
  };
}

function activeSuspension(status: string, suspendedUntil: string | null): boolean {
  if (status !== "suspended") return false;
  if (!suspendedUntil?.trim()) return true;
  const expiresAt = Date.parse(suspendedUntil);
  return !Number.isFinite(expiresAt) || expiresAt > Date.now();
}

async function persistAndResolveUser(user: BaseUser): Promise<PersistedUserResult> {
  if (!user.sessionId) return { kind: "denied", reason: "session_invalid" };
  const db = getD1();
  if (!db) {
    return process.env.NODE_ENV === "production"
      ? { kind: "denied", reason: "account_store_unavailable" }
      : { kind: "allowed", user: developmentFallbackUser(user) };
  }

  const startedAt = Date.now();
  let stage = "ensure_schema";
  try {
    await ensureDatabase(db);
    stage = "migrate_owner";
    await migrateVerifiedEmailOwner(db, user);
    stage = "upsert_user";
    const now = new Date().toISOString();
    await db.batch([
      db.prepare(
        `INSERT INTO users
           (id, email, name, role, created_at, updated_at, last_seen_at)
         VALUES (?, ?, ?, 'preacher', ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           email = excluded.email,
           name = excluded.name,
           updated_at = excluded.updated_at,
           last_seen_at = excluded.last_seen_at`,
      )
        .bind(user.id, user.email, user.name, now, now, now),
      db.prepare(
        `INSERT INTO user_auth_sessions
           (user_id, session_id, first_seen_at, last_seen_at, revoked_at, revoked_by)
         VALUES (?, ?, ?, ?, NULL, NULL)
         ON CONFLICT(user_id, session_id) DO UPDATE SET
           last_seen_at = excluded.last_seen_at`,
      ).bind(user.id, user.sessionId, now, now),
    ]);
    stage = "load_record";
    const record = await db
      .prepare(
        `SELECT u.role, u.is_admin, COALESCE(p.display_name, u.name) AS display_name,
                u.status, u.suspended_until, s.revoked_at
         FROM users u
         LEFT JOIN user_profiles p ON p.user_id = u.id
         LEFT JOIN user_auth_sessions s
           ON s.user_id = u.id AND s.session_id = ?
         WHERE u.id = ?`,
      )
      .bind(user.sessionId, user.id)
      .first<{
        role: string;
        is_admin: number | boolean | null;
        display_name: string;
        status: string;
        suspended_until: string | null;
        revoked_at: string | null;
      }>();
    if (!record) return { kind: "denied", reason: "account_store_unavailable" };
    if (record.revoked_at) return { kind: "denied", reason: "session_revoked" };
    if (record.status !== "active" && record.status !== "suspended") {
      return { kind: "denied", reason: "account_store_unavailable" };
    }
    if (activeSuspension(record.status, record.suspended_until)) {
      return { kind: "denied", reason: "account_suspended" };
    }
    if (record.status === "suspended") {
      stage = "lift_suspension";
      await db
        .prepare(
          `UPDATE users
           SET status = 'active', suspended_until = NULL, status_reason = NULL,
               status_changed_at = ?, status_changed_by = NULL,
               updated_at = ?, version = version + 1
           WHERE id = ? AND status = 'suspended' AND suspended_until = ?`,
        )
        .bind(now, now, user.id, record.suspended_until)
        .run();
    }
    stage = "ensure_wallet";
    await ensureTokenWallet(db, user.id);
    return { kind: "allowed", user: {
      id: user.id,
      email: user.email,
      isDemo: user.isDemo,
      name: record?.display_name?.trim() || user.name,
      role: normalizeRole(record?.role),
      // ADMIN_EMAILS stays the bootstrap authority; administrators can also
      // grant the flag per member, and both sources are recognized here.
      isAdmin: isAdminEmail(user.email) || Boolean(record.is_admin),
    } };
  } catch (error) {
    logAuthAccessFailure("account_store", error, {
      stage,
      elapsedMs: Date.now() - startedAt,
    });
    // Production account controls are fail-closed. Local development retains a
    // minimal fallback so a database outage cannot grant expert privileges.
    return process.env.NODE_ENV === "production"
      ? { kind: "denied", reason: "account_store_unavailable" }
      : { kind: "allowed", user: developmentFallbackUser(user) };
  }
}

async function localDemoIfAllowed(
  host: string | null,
  role: AppUserRole = "preacher",
): Promise<AppUser | null> {
  if (process.env.NODE_ENV === "production") return null;
  if (process.env.SERMON_LOCAL_MODE === "true" || (!getSupabasePublicConfig() && isLocalHost(host))) {
    return demoUser(role);
  }
  return null;
}

export async function getPageUser(
  options: UserResolutionOptions = {},
): Promise<AppUser | null> {
  const identity = await verifiedSupabaseIdentity();
  if (identity.kind === "authenticated") {
    const resolved = await persistAndResolveUser(identity.user);
    return resolved.kind === "allowed" ? resolved.user : null;
  }
  if (identity.kind === "unavailable") return null;
  const requestHeaders = await headers();
  return localDemoIfAllowed(requestHeaders.get("host"), options.demoRole);
}

function userOrThrow(result: PersistedUserResult): AppUser {
  if (result.kind === "allowed") return result.user;
  throw new AuthUserAccessError(result.reason);
}

/**
 * All authenticated handlers resolve persistent account and session state.
 * A blocked identity throws instead of becoming a guest, preventing guest-path bypasses.
 */
export async function getRequestUser(request: Request): Promise<AppUser | null> {
  const identity = await verifiedSupabaseIdentity();
  if (identity.kind === "authenticated") {
    return userOrThrow(await persistAndResolveUser(identity.user));
  }
  if (identity.kind === "unavailable") {
    throw new AuthUserAccessError("identity_unavailable");
  }
  return localDemoIfAllowed(new URL(request.url).host);
}

export async function resolveRequestUser(
  request: Request,
  options: UserResolutionOptions = {},
): Promise<AppUser | null> {
  const identity = await verifiedSupabaseIdentity();
  if (identity.kind === "authenticated") {
    return userOrThrow(await persistAndResolveUser(identity.user));
  }
  if (identity.kind === "unavailable") {
    throw new AuthUserAccessError("identity_unavailable");
  }
  return localDemoIfAllowed(new URL(request.url).host, options.demoRole);
}

export type RequestUserResponseResult =
  | { user: AppUser | null }
  | { response: Response };

/** Route-handler adapter that turns only central account-access failures into HTTP responses. */
export async function getRequestUserResponse(
  request: Request,
): Promise<RequestUserResponseResult> {
  try {
    return { user: await getRequestUser(request) };
  } catch (error) {
    if (error instanceof AuthUserAccessError) {
      return { response: authUserAccessErrorResponse(error) };
    }
    throw error;
  }
}

/** Role-aware variant of getRequestUserResponse. */
export async function resolveRequestUserResponse(
  request: Request,
  options: UserResolutionOptions = {},
): Promise<RequestUserResponseResult> {
  try {
    return { user: await resolveRequestUser(request, options) };
  } catch (error) {
    if (error instanceof AuthUserAccessError) {
      return { response: authUserAccessErrorResponse(error) };
    }
    throw error;
  }
}

export async function requirePageUser(
  returnTo: string,
  options: UserResolutionOptions = {},
): Promise<AppUser> {
  const user = await getPageUser(options);
  if (user) return user;
  redirect(`/login?return_to=${encodeURIComponent(safeReturnPath(returnTo))}`);
}

export function unauthorizedResponse(): Response {
  return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });
}

export function forbiddenResponse(message = "이 작업을 수행할 권한이 없습니다."): Response {
  return Response.json({ error: message }, { status: 403 });
}

export function serviceUnavailableResponse(): Response {
  return Response.json(
    { error: "데이터 저장소에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요." },
    { status: 503 },
  );
}

export function authUserAccessErrorResponse(error: AuthUserAccessError): Response {
  return Response.json(
    { error: error.message, code: error.reason },
    { status: error.status, headers: { "Cache-Control": "no-store" } },
  );
}

function demoUser(role: AppUserRole = "preacher"): AppUser {
  if (role === "expert") {
    return {
      id: "demo-expert",
      email: "expert@sermonguide.local",
      name: "김선우 목회코치",
      role,
      isDemo: true,
      isAdmin: process.env.SERMON_LOCAL_ADMIN === "true",
    };
  }
  return {
    id: "demo-preacher",
    email: "demo@sermonguide.local",
    name: "이은찬 전도사",
    role,
    isDemo: true,
    isAdmin: process.env.SERMON_LOCAL_ADMIN === "true",
  };
}

export function safeReturnPath(value: string): string {
  if (!value.startsWith("/") || value.startsWith("//")) return "/home";
  try {
    const parsed = new URL(value, "https://app.local");
    if (parsed.origin !== "https://app.local") return "/home";
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/home";
  }
}
