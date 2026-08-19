import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ensureDatabase, getD1 } from "../../db";
import { getSupabasePublicConfig } from "./supabase/config";
import { createSupabaseServerClient } from "./supabase/server";
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

type UserResolutionOptions = {
  demoRole?: AppUserRole;
};

type BaseUser = Omit<AppUser, "role" | "isAdmin">;
type AppDatabase = NonNullable<ReturnType<typeof getD1>>;

const USER_OWNER_COLUMNS = [
  ["user_profiles", "user_id"],
  ["user_ai_preferences", "user_id"],
  ["managed_ai_usage", "user_id"],
  ["sermon_resource_usage", "user_id"],
  ["token_wallets", "user_id"],
  ["token_transactions", "user_id"],
  ["token_topups", "user_id"],
  ["payment_orders", "user_id"],
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

async function verifiedSupabaseIdentity(): Promise<BaseUser | null> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.auth.getClaims();
    if (error || !data?.claims) return null;
    const claims = data.claims as Record<string, unknown>;
    const id = typeof claims.sub === "string" ? claims.sub : "";
    const email = typeof claims.email === "string" ? claims.email.trim() : "";
    if (!id || !email) return null;
    return {
      id,
      email,
      name: displayNameFromClaims(claims, email),
      isDemo: false,
    };
  } catch {
    return null;
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

async function persistAndResolveUser(user: BaseUser): Promise<AppUser> {
  const db = getD1();
  if (!db) return { ...user, role: "preacher", isAdmin: isAdminEmail(user.email) };

  try {
    await ensureDatabase(db);
    await migrateVerifiedEmailOwner(db, user);
    const now = new Date().toISOString();
    await db
      .prepare(
        `INSERT INTO users (id, email, name, role, created_at)
         VALUES (?, ?, ?, 'preacher', ?)
         ON CONFLICT(id) DO UPDATE SET email = excluded.email, name = excluded.name`,
      )
      .bind(user.id, user.email, user.name, now)
      .run();
    await ensureTokenWallet(db, user.id);
    const record = await db
      .prepare(
        `SELECT u.role, COALESCE(p.display_name, u.name) AS display_name
         FROM users u
         LEFT JOIN user_profiles p ON p.user_id = u.id
         WHERE u.id = ?`,
      )
      .bind(user.id)
      .first<{ role: string; display_name: string }>();
    return {
      ...user,
      name: record?.display_name?.trim() || user.name,
      role: normalizeRole(record?.role),
      isAdmin: isAdminEmail(user.email),
    };
  } catch {
    // A database outage must never grant elevated privileges.
    return { ...user, role: "preacher", isAdmin: isAdminEmail(user.email) };
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
  if (identity) return persistAndResolveUser(identity);
  const requestHeaders = await headers();
  return localDemoIfAllowed(requestHeaders.get("host"), options.demoRole);
}

/** Role-sensitive handlers must use resolveRequestUser so the persisted role is authoritative. */
export async function getRequestUser(request: Request): Promise<AppUser | null> {
  const identity = await verifiedSupabaseIdentity();
  if (identity) {
    return {
      ...identity,
      role: "preacher",
      isAdmin: isAdminEmail(identity.email),
    };
  }
  return localDemoIfAllowed(new URL(request.url).host);
}

export async function resolveRequestUser(
  request: Request,
  options: UserResolutionOptions = {},
): Promise<AppUser | null> {
  const identity = await verifiedSupabaseIdentity();
  if (identity) return persistAndResolveUser(identity);
  return localDemoIfAllowed(new URL(request.url).host, options.demoRole);
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
