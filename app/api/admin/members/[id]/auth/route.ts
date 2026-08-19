import {
  adminJson,
  adminReason,
  adminRequestId,
  claimAdminAuditRequest,
  memberIdParam,
  readAdminJsonBody,
  requireAdminRequest,
} from "@/app/_lib/admin-actions";
import { revokeKnownUserSessions } from "@/app/_lib/admin-member-auth";
import { isAdminEmail } from "@/app/_lib/auth-user";
import {
  resendAdminVerification,
  sendAdminPasswordReset,
} from "@/app/_lib/supabase/admin";
import { getSiteOrigin } from "@/app/_lib/supabase/config";
import { ensureDatabase, getD1 } from "@/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };
type AuthAction = "reset_password" | "resend_verification" | "sign_out_all";

function authFailureStatus(result: {
  available: boolean;
  code?: string;
}): number {
  if (!result.available || result.code === "unavailable") return 503;
  if (result.code === "invalid_input") return 400;
  if (result.code === "not_found") return 404;
  if (result.code === "rate_limited") return 429;
  return 502;
}

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const auth = await requireAdminRequest(request);
  if ("response" in auth) return auth.response;
  const { id: rawId } = await context.params;
  const userId = memberIdParam(rawId);
  if (!userId) return adminJson({ error: "회원 식별자를 확인해 주세요." }, 400);

  const parsed = await readAdminJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const action = parsed.value.action as AuthAction;
  if (!["reset_password", "resend_verification", "sign_out_all"].includes(action)) {
    return adminJson({ error: "지원하지 않는 인증 관리 작업입니다." }, 400);
  }
  const reason = adminReason(parsed.value.reason);
  const requestId = adminRequestId(parsed.value.requestId);
  if (!reason || !requestId) {
    return adminJson({ error: "인증 관리 작업의 사유를 5자 이상 입력해 주세요." }, 400);
  }

  const db = getD1();
  if (!db) return adminJson({ error: "회원 저장소에 연결할 수 없습니다." }, 503);
  try {
    await ensureDatabase(db);
    const target = await db.prepare(
      "SELECT id, email FROM users WHERE id = ?",
    ).bind(userId).first<{ id: string; email: string }>();
    if (!target) return adminJson({ error: "회원을 찾을 수 없습니다." }, 404);
    if (
      action === "sign_out_all" &&
      (userId === auth.user.id || isAdminEmail(target.email))
    ) {
      return adminJson({ error: "관리자 계정의 세션은 이 화면에서 종료할 수 없습니다." }, 409);
    }

    const auditAction = {
      reset_password: "auth.password_reset_requested",
      resend_verification: "auth.verification_resend_requested",
      sign_out_all: "auth.session_revocation_requested",
    }[action];
    const claim = await claimAdminAuditRequest(db, {
      actorUserId: auth.user.id,
      targetUserId: userId,
      action: auditAction,
      entityType: action === "sign_out_all" ? "auth_session" : "auth_user",
      entityId: userId,
      reason,
      before: { email: target.email },
      after: { requested: true },
      requestId,
    });
    if (claim === "conflict") {
      return adminJson({ error: "이미 다른 관리자 작업에 사용된 요청 번호입니다." }, 409);
    }
    if (claim === "replay") {
      return adminJson({ completed: false, idempotent: true, action });
    }

    if (action === "sign_out_all") {
      const revoked = await revokeKnownUserSessions(db, userId, auth.user.id);
      if (!revoked.ok) {
        return adminJson({ error: revoked.error }, revoked.available ? 502 : 503);
      }
      return adminJson({
        completed: true,
        action,
        appRevoked: true,
        revokedCount: revoked.revokedCount,
      });
    }

    const siteOrigin = getSiteOrigin();
    const result = action === "reset_password"
      ? await sendAdminPasswordReset(
          target.email,
          new URL("/reset-password", siteOrigin).toString(),
        )
      : await resendAdminVerification(
          target.email,
          new URL(
            "/auth/callback?next=%2Flogin%3Fverified%3D1&flow=signup",
            siteOrigin,
          ).toString(),
        );
    if (!result.ok) {
      return adminJson({ error: result.error, code: result.code }, authFailureStatus(result));
    }
    return adminJson({ completed: true, action });
  } catch (error) {
    console.error(
      "[admin-members] auth action failed",
      error instanceof Error ? error.message : "unknown",
    );
    return adminJson({ error: "회원 인증 작업을 완료하지 못했습니다." }, 503);
  }
}
