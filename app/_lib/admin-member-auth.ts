import { ensureDatabase, getD1 } from "@/db";
import {
  AuthUserAccessError,
  authUserAccessErrorResponse,
  forbiddenResponse,
  resolveRequestUser,
  serviceUnavailableResponse,
  unauthorizedResponse,
  type AppUser,
} from "./auth-user";

type AppDatabase = NonNullable<ReturnType<typeof getD1>>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type AdminMemberAuthorization =
  | { ok: true; user: AppUser }
  | { ok: false; response: Response };

/**
 * New member-management handlers should use this instead of checking UI state.
 * ADMIN_EMAILS remains independent from the preacher/expert application role.
 */
export async function requireAdminMember(
  request: Request,
): Promise<AdminMemberAuthorization> {
  try {
    const user = await resolveRequestUser(request);
    if (!user) return { ok: false, response: unauthorizedResponse() };
    if (!user.isAdmin) return { ok: false, response: forbiddenResponse() };
    return { ok: true, user };
  } catch (error) {
    if (error instanceof AuthUserAccessError) {
      return { ok: false, response: authUserAccessErrorResponse(error) };
    }
    return { ok: false, response: serviceUnavailableResponse() };
  }
}

/** Exact same-origin check for browser-initiated admin mutations. */
export function adminMutationOriginAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();
  if (!origin || (fetchSite && fetchSite !== "same-origin")) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export type KnownSessionRevocationResult =
  | {
      available: true;
      ok: true;
      appRevoked: true;
      revokedCount: number;
    }
  | {
      available: true;
      ok: false;
      appRevoked: false;
      error: string;
    }
  | {
      available: false;
      ok: false;
      appRevoked: false;
      error: string;
    };

/**
 * Revokes every session ID already observed for a user. A later login receives a
 * new Supabase session_id and is allowed unless the account is also suspended.
 * This is intentionally separate from the optional Supabase JWT-based sign-out.
 */
export async function revokeKnownUserSessions(
  db: AppDatabase,
  userId: string,
  actorUserId: string,
  suspendedVersion?: number,
): Promise<KnownSessionRevocationResult> {
  if (!UUID_PATTERN.test(userId) || !UUID_PATTERN.test(actorUserId)) {
    return {
      available: true,
      ok: false,
      appRevoked: false,
      error: "회원 ID 형식을 확인해 주세요.",
    };
  }
  try {
    await ensureDatabase(db);
    const now = new Date().toISOString();
    const guardSuspendedVersion = Number.isSafeInteger(suspendedVersion) &&
      Number(suspendedVersion) >= 0;
    const result = await db
      .prepare(
        `UPDATE user_auth_sessions
         SET revoked_at = ?, revoked_by = ?
         WHERE user_id = ? AND revoked_at IS NULL
           ${guardSuspendedVersion
             ? `AND EXISTS (
                  SELECT 1 FROM users
                  WHERE users.id = user_auth_sessions.user_id
                    AND users.status = 'suspended'
                    AND users.version = ?
                    AND (users.suspended_until IS NULL OR users.suspended_until > ?)
                )`
             : ""}
         RETURNING session_id`,
      )
      .bind(
        now,
        actorUserId,
        userId,
        ...(guardSuspendedVersion ? [suspendedVersion, now] : []),
      )
      .all<{ session_id: string }>();
    return {
      available: true,
      ok: true,
      appRevoked: true,
      revokedCount: result.results.length,
    };
  } catch {
    return {
      available: false,
      ok: false,
      appRevoked: false,
      error: "회원 세션 저장소를 사용할 수 없습니다.",
    };
  }
}
