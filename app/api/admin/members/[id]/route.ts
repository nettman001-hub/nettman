import {
  adminJson,
  adminReason,
  adminRequestId,
  stableAdvisoryLockKey,
  expectedMemberVersion,
  memberIdParam,
  readAdminJsonBody,
  requireAdminRequest,
  safeJson,
} from "@/app/_lib/admin-actions";
import { revokeKnownUserSessions } from "@/app/_lib/admin-member-auth";
import { isAdminEmail } from "@/app/_lib/auth-user";
import {
  getAdminAuthCapabilities,
  getAdminAuthUserInfo,
  setAdminAuthSuspension,
} from "@/app/_lib/supabase/admin";
import { ensureDatabase, getD1, withDatabaseAdvisoryLock } from "@/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

type AuditReplayRow = {
  actor_user_id: string;
  target_user_id: string | null;
  action: string;
  reason: string;
  after_json: string;
};

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function integer(value: unknown): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function auditSummary(value: unknown): string {
  const action = text(value);
  return ({
    "member.role_changed": "업무 역할 변경",
    "member.suspended": "회원 이용 정지",
    "member.reactivated": "회원 이용 복구",
    "member.auth_directory_synced": "기존 가입 회원 동기화",
    "tokens.free_granted": "무료 토큰 지급",
    "tokens.reclaimed": "토큰 회수",
    "auth.password_reset_requested": "비밀번호 재설정 메일 요청",
    "auth.verification_resend_requested": "이메일 인증 재발송 요청",
    "auth.session_revocation_requested": "전체 세션 종료 요청",
    "payment.reverification_requested": "결제 재검증 요청",
  } as Record<string, string>)[action] ?? action;
}

function auditReplayMatches(
  row: AuditReplayRow,
  input: {
    actorUserId: string;
    targetUserId: string;
    action: string;
    reason: string;
    afterJson: string;
  },
): boolean {
  return row.actor_user_id === input.actorUserId &&
    row.target_user_id === input.targetUserId &&
    row.action === input.action &&
    row.reason === input.reason &&
    row.after_json === input.afterJson;
}

async function synchronizeMemberStatus(
  db: NonNullable<ReturnType<typeof getD1>>,
  userId: string,
  actorUserId: string,
  expected: {
    version: number;
    status: "active" | "suspended";
    suspendedUntil: string | null;
  },
) {
  return withDatabaseAdvisoryLock(
    db,
    stableAdvisoryLockKey(`member-status:${userId}`),
    async (lockedDb) => {
      const latest = await lockedDb.prepare(
        `SELECT status, suspended_until, version FROM users WHERE id = ?`,
      ).bind(userId).first<{
        status: string;
        suspended_until: string | null;
        version: number;
      }>();
      const stillExpected = Boolean(
        latest &&
        integer(latest.version) === expected.version &&
        latest.status === expected.status &&
        (latest.suspended_until ?? null) === expected.suspendedUntil,
      );
      if (!stillExpected) {
        return { authSync: null, sessionSync: null, skipped: true };
      }

      const authSync = await setAdminAuthSuspension(
        userId,
        expected.status === "suspended",
        expected.suspendedUntil ?? undefined,
      );
      const sessionSync = expected.status === "suspended"
        ? await revokeKnownUserSessions(
            lockedDb,
            userId,
            actorUserId,
            expected.version,
          )
        : null;
      return { authSync, sessionSync, skipped: false };
    },
  );
}

async function targetId(context: RouteContext): Promise<string | null> {
  const { id } = await context.params;
  return memberIdParam(id);
}

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const auth = await requireAdminRequest(request);
  if ("response" in auth) return auth.response;
  const id = await targetId(context);
  if (!id) return adminJson({ error: "회원 식별자를 확인해 주세요." }, 400);
  const db = getD1();
  if (!db) return adminJson({ error: "회원 저장소에 연결할 수 없습니다." }, 503);

  try {
    await ensureDatabase(db);
    const member = await db.prepare(
      `SELECT
        u.id, u.email, u.name, u.role, u.status, u.status_reason,
        u.suspended_until, u.status_changed_at, u.status_changed_by,
        u.created_at, u.updated_at, u.last_seen_at, u.version,
        COALESCE(p.display_name, u.name) AS display_name,
        COALESCE(p.ministry_role, '') AS ministry_role,
        COALESCE(p.denomination, '') AS denomination,
        COALESCE(p.theology, '') AS theology,
        COALESCE(p.church, '') AS church,
        COALESCE(p.phone, '') AS phone,
        COALESCE(w.balance, 0) AS balance,
        COALESCE(w.lifetime_purchased, 0) AS lifetime_purchased,
        COALESCE(w.lifetime_spent, 0) AS lifetime_spent,
        COALESCE(np.email_enabled, 1) AS email_enabled,
        COALESCE(np.push_enabled, 0) AS push_enabled,
        COALESCE(np.completion_enabled, 1) AS completion_enabled
       FROM users u
       LEFT JOIN user_profiles p ON p.user_id = u.id
       LEFT JOIN token_wallets w ON w.user_id = u.id
       LEFT JOIN notification_preferences np ON np.user_id = u.id
       WHERE u.id = ?`,
    ).bind(id).first<Record<string, unknown>>();
    if (!member) return adminJson({ error: "회원을 찾을 수 없습니다." }, 404);

    const [
      counts,
      tokenHistory,
      payments,
      legacyTopups,
      sermons,
      consultations,
      audits,
      usage,
      sessions,
      authInfo,
    ] =
      await Promise.all([
        db.prepare(
          `SELECT
            (SELECT COUNT(*) FROM sermon_drafts d WHERE d.user_id = ?) AS draft_count,
            (SELECT COUNT(*) FROM sermons s WHERE s.user_id = ? AND s.deleted_at IS NULL) AS sermon_count,
            (SELECT COUNT(*) FROM sermon_generation_runs r WHERE r.user_id = ?) AS generation_count,
            (SELECT COUNT(*) FROM consultations c WHERE c.user_id = ?) AS consultation_count,
            (SELECT COUNT(*) FROM consultations c WHERE c.expert_id = ?) AS expert_consultation_count,
            (SELECT COUNT(*) FROM consultations c WHERE c.expert_id = ? AND c.status IN ('assigned', 'in_progress')) AS active_expert_count,
            (SELECT COUNT(*) FROM payment_orders p WHERE p.user_id = ?) AS payment_count,
            (SELECT COALESCE(SUM(p.amount_krw), 0) FROM payment_orders p WHERE p.user_id = ? AND p.status = 'completed') AS paid_krw,
            (SELECT MAX(activity_at) FROM (
              SELECT MAX(d.updated_at) AS activity_at FROM sermon_drafts d WHERE d.user_id = ?
              UNION ALL SELECT MAX(s.updated_at) FROM sermons s WHERE s.user_id = ?
              UNION ALL SELECT MAX(c.updated_at) FROM consultations c WHERE c.user_id = ? OR c.expert_id = ?
              UNION ALL SELECT MAX(t.created_at) FROM token_transactions t WHERE t.user_id = ?
              UNION ALL SELECT MAX(p.created_at) FROM payment_orders p WHERE p.user_id = ?
            ) recent_activity) AS last_activity_at`,
        ).bind(
          id, id, id, id, id, id, id, id,
          id, id, id, id, id, id,
        ).first<Record<string, unknown>>(),
        db.prepare(
          `SELECT id, kind, amount, balance_after, reference_id, description, metadata_json, created_at
           FROM token_transactions WHERE user_id = ?
           ORDER BY created_at DESC LIMIT 50`,
        ).bind(id).all<Record<string, unknown>>(),
        db.prepare(
          `SELECT id, payment_id, provider, payment_method, amount_krw, token_amount,
                  status, transaction_id, created_at, completed_at
           FROM payment_orders WHERE user_id = ?
           ORDER BY created_at DESC LIMIT 30`,
        ).bind(id).all<Record<string, unknown>>(),
        db.prepare(
          `SELECT id, usd_cents, token_amount, status, stripe_checkout_session_id,
                  created_at, completed_at
           FROM token_topups WHERE user_id = ?
           ORDER BY created_at DESC LIMIT 20`,
        ).bind(id).all<Record<string, unknown>>(),
        db.prepare(
          `SELECT id, title, scripture, sermon_type, audience, audience_situation,
                  duration, created_at, updated_at
           FROM sermons WHERE user_id = ? AND deleted_at IS NULL
           ORDER BY updated_at DESC LIMIT 20`,
        ).bind(id).all<Record<string, unknown>>(),
        db.prepare(
          `SELECT c.id, c.sermon_id, c.user_id, c.expert_id, c.reason, c.status,
                  c.created_at, c.updated_at, s.title AS sermon_title,
                  COALESCE(ep.display_name, e.name, '') AS expert_name
           FROM consultations c
           LEFT JOIN sermons s ON s.id = c.sermon_id
           LEFT JOIN users e ON e.id = c.expert_id
           LEFT JOIN user_profiles ep ON ep.user_id = e.id
           WHERE c.user_id = ? OR c.expert_id = ?
           ORDER BY c.updated_at DESC LIMIT 30`,
        ).bind(id, id).all<Record<string, unknown>>(),
        db.prepare(
          `SELECT a.id, a.actor_user_id, a.action, a.entity_type, a.entity_id,
                  a.reason, a.before_json, a.after_json, a.request_id, a.created_at,
                  COALESCE(p.display_name, u.name, u.email, '관리자') AS actor_name
           FROM admin_audit_logs a
           LEFT JOIN users u ON u.id = a.actor_user_id
           LEFT JOIN user_profiles p ON p.user_id = u.id
           WHERE a.target_user_id = ?
           ORDER BY a.created_at DESC LIMIT 50`,
        ).bind(id).all<Record<string, unknown>>(),
        db.prepare(
          `SELECT
            COALESCE((SELECT SUM(request_count) FROM managed_ai_usage WHERE user_id = ?), 0) AS managed_count,
            COALESCE((SELECT SUM(request_count) FROM sermon_resource_usage WHERE user_id = ?), 0) AS resource_count`,
        ).bind(id, id).first<Record<string, unknown>>(),
        db.prepare(
          `SELECT COUNT(*) AS count FROM user_auth_sessions
           WHERE user_id = ? AND revoked_at IS NULL`,
        ).bind(id).first<{ count: number }>(),
        getAdminAuthUserInfo(id),
      ]);

    const now = new Date().toISOString();
    const authCapabilities = getAdminAuthCapabilities();
    const suspended =
      member.status === "suspended" &&
      (!member.suspended_until || text(member.suspended_until) > now);
    return adminJson({
      member: {
        id: text(member.id),
        email: text(member.email),
        name: text(member.name),
        displayName: text(member.display_name),
        role: member.role === "expert" ? "expert" : "preacher",
        status: suspended ? "suspended" : "active",
        statusReason: text(member.status_reason),
        suspendedUntil: nullableText(member.suspended_until),
        statusChangedAt: nullableText(member.status_changed_at),
        statusChangedBy: nullableText(member.status_changed_by),
        createdAt: text(member.created_at),
        serviceRegisteredAt: text(member.created_at),
        updatedAt: nullableText(member.updated_at),
        lastSeenAt: nullableText(member.last_seen_at),
        version: integer(member.version),
        profile: {
          ministryRole: text(member.ministry_role),
          denomination: text(member.denomination),
          theology: text(member.theology),
          church: text(member.church),
          phone: text(member.phone),
        },
        wallet: {
          balance: integer(member.balance),
          lifetimePurchased: integer(member.lifetime_purchased),
          lifetimeSpent: integer(member.lifetime_spent),
        },
        notifications: {
          emailEnabled: integer(member.email_enabled) === 1,
          pushEnabled: integer(member.push_enabled) === 1,
          completionEnabled: integer(member.completion_enabled) === 1,
        },
      },
      counts: {
        drafts: integer(counts?.draft_count),
        sermons: integer(counts?.sermon_count),
        generations: integer(counts?.generation_count),
        consultations: integer(counts?.consultation_count),
        expertConsultations: integer(counts?.expert_consultation_count),
        activeExpertConsultations: integer(counts?.active_expert_count),
        payments: integer(counts?.payment_count),
        paidKrw: integer(counts?.paid_krw),
        managedAiRequests: integer(usage?.managed_count),
        resourceRequests: integer(usage?.resource_count),
        lastActiveAt: nullableText(counts?.last_activity_at),
      },
      tokenHistory: tokenHistory.results.map((row) => ({
        id: text(row.id),
        kind: text(row.kind),
        amount: integer(row.amount),
        balanceAfter: integer(row.balance_after),
        referenceId: text(row.reference_id),
        description: text(row.description),
        createdAt: text(row.created_at),
      })),
      payments: payments.results.map((row) => ({
        id: text(row.id),
        paymentId: text(row.payment_id),
        provider: text(row.provider),
        paymentMethod: text(row.payment_method),
        amountKrw: integer(row.amount_krw),
        tokenAmount: integer(row.token_amount),
        status: text(row.status),
        transactionId: nullableText(row.transaction_id),
        createdAt: text(row.created_at),
        completedAt: nullableText(row.completed_at),
      })),
      legacyTopups: legacyTopups.results.map((row) => ({
        id: text(row.id),
        usdCents: integer(row.usd_cents),
        tokenAmount: integer(row.token_amount),
        status: text(row.status),
        checkoutSessionId: nullableText(row.stripe_checkout_session_id),
        createdAt: text(row.created_at),
        completedAt: nullableText(row.completed_at),
      })),
      sermons: sermons.results.map((row) => ({
        id: text(row.id),
        title: text(row.title),
        scripture: text(row.scripture),
        sermonType: text(row.sermon_type),
        audience: text(row.audience),
        audienceSituation: text(row.audience_situation),
        duration: integer(row.duration),
        createdAt: text(row.created_at),
        updatedAt: text(row.updated_at),
      })),
      consultations: consultations.results.map((row) => ({
        id: text(row.id),
        sermonId: text(row.sermon_id),
        sermonTitle: text(row.sermon_title),
        expertName: text(row.expert_name),
        relationship: row.user_id === id ? "requester" : "expert",
        reason: text(row.reason),
        status: text(row.status),
        createdAt: text(row.created_at),
        updatedAt: text(row.updated_at),
      })),
      auditLog: audits.results.map((row) => ({
        id: text(row.id),
        actorUserId: nullableText(row.actor_user_id),
        actorName: text(row.actor_name) || "관리자",
        action: text(row.action),
        summary: auditSummary(row.action),
        entityType: text(row.entity_type),
        entityId: nullableText(row.entity_id),
        reason: text(row.reason),
        beforeJson: text(row.before_json),
        afterJson: text(row.after_json),
        requestId: text(row.request_id),
        createdAt: text(row.created_at),
      })),
      auth: authInfo.ok
        ? {
            available: true,
            configured: authCapabilities.privilegedAvailable,
            mailAvailable: authCapabilities.mailAvailable,
            privilegedAvailable: authCapabilities.privilegedAvailable,
            emailVerified: Boolean(authInfo.user.emailConfirmedAt),
            lastSignInAt: authInfo.user.lastSignInAt,
            createdAt: authInfo.user.createdAt,
            updatedAt: authInfo.user.updatedAt,
            bannedUntil: authInfo.user.bannedUntil,
            providers: [],
            sessionCount: integer(sessions?.count),
          }
        : {
            available: authCapabilities.privilegedAvailable,
            configured: authCapabilities.privilegedAvailable,
            mailAvailable: authCapabilities.mailAvailable,
            privilegedAvailable: authCapabilities.privilegedAvailable,
            error: authInfo.error,
            emailVerified: null,
            lastSignInAt: null,
            providers: [],
            sessionCount: integer(sessions?.count),
          },
    });
  } catch (error) {
    console.error("[admin-members] detail failed", error instanceof Error ? error.message : "unknown");
    return adminJson({ error: "회원 상세 정보를 불러오지 못했습니다." }, 503);
  }
}

export async function PATCH(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const auth = await requireAdminRequest(request);
  if ("response" in auth) return auth.response;
  const id = await targetId(context);
  if (!id) return adminJson({ error: "회원 식별자를 확인해 주세요." }, 400);
  const parsed = await readAdminJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const reason = adminReason(parsed.value.reason);
  const requestId = adminRequestId(parsed.value.requestId);
  const expectedVersion = expectedMemberVersion(parsed.value.expectedVersion);
  if (!reason || !requestId || expectedVersion === null) {
    return adminJson({ error: "변경 사유와 최신 회원 버전을 확인해 주세요." }, 400);
  }
  const db = getD1();
  if (!db) return adminJson({ error: "회원 저장소에 연결할 수 없습니다." }, 503);

  try {
    await ensureDatabase(db);
    const current = await db.prepare(
      `SELECT id, email, role, status, status_reason, suspended_until, version
       FROM users WHERE id = ?`,
    ).bind(id).first<{
      id: string;
      email: string;
      role: string;
      status: string;
      status_reason: string;
      suspended_until: string | null;
      version: number;
    }>();
    if (!current) return adminJson({ error: "회원을 찾을 수 없습니다." }, 404);
    const action = parsed.value.action;
    const now = new Date().toISOString();
    if (action === "role") {
      const nextRole = parsed.value.role;
      if (nextRole !== "preacher" && nextRole !== "expert") {
        return adminJson({ error: "회원 역할을 확인해 주세요." }, 400);
      }
      const auditAction = "member.role_changed";
      const nextVersion = expectedVersion + 1;
      const beforeJson = safeJson({ role: current.role, version: expectedVersion });
      const afterJson = safeJson({ role: nextRole, version: nextVersion });
      const prior = await db.prepare(
        `SELECT actor_user_id, target_user_id, action, reason, after_json
         FROM admin_audit_logs
         WHERE request_id = ? LIMIT 1`,
      ).bind(requestId).first<AuditReplayRow>();
      if (prior) {
        if (!auditReplayMatches(prior, {
          actorUserId: auth.user.id,
          targetUserId: id,
          action: auditAction,
          reason,
          afterJson,
        })) {
          return adminJson({ error: "이미 다른 관리자 작업에 사용된 요청 번호입니다." }, 409);
        }
        return adminJson({
          updated: false,
          idempotent: true,
          version: integer(current.version),
          role: current.role === "expert" ? "expert" : "preacher",
        });
      }
      if (integer(current.version) !== expectedVersion) {
        return adminJson({ error: "다른 관리자가 먼저 변경했습니다. 새로고침 후 다시 시도해 주세요." }, 409);
      }
      if (current.role === nextRole) {
        return adminJson({ updated: false, version: expectedVersion, role: nextRole });
      }
      const results = await db.batch<{
        version: number;
        role: string;
        audit_count: number;
      }>([
        db.prepare("SELECT pg_advisory_xact_lock(?)").bind(
          stableAdvisoryLockKey(requestId),
        ),
        db.prepare("SELECT pg_advisory_xact_lock(?)").bind(
          stableAdvisoryLockKey(`member-role:${id}`),
        ),
        db.prepare(
          `WITH changed AS (
             UPDATE users
             SET role = ?, updated_at = ?, version = version + 1
             WHERE id = ? AND version = ?
               AND NOT EXISTS (
                 SELECT 1 FROM admin_audit_logs WHERE request_id = ?
               )
               AND NOT (
                 role = 'expert' AND ? = 'preacher' AND EXISTS (
                   SELECT 1 FROM consultations
                   WHERE expert_id = users.id
                     AND status IN ('assigned', 'in_progress')
                 )
               )
             RETURNING version, role
           ), audited AS (
             INSERT INTO admin_audit_logs
               (id, actor_user_id, target_user_id, action, entity_type, entity_id,
                reason, before_json, after_json, request_id, created_at)
             SELECT ?, ?, ?, 'member.role_changed', 'user', ?, ?, ?, ?, ?, ?
             FROM changed
             RETURNING id
           )
           SELECT changed.version, changed.role,
                  (SELECT COUNT(*) FROM audited) AS audit_count
           FROM changed`,
        ).bind(
          nextRole,
          now,
          id,
          expectedVersion,
          requestId,
          nextRole,
          crypto.randomUUID(), auth.user.id, id, id, reason, beforeJson,
          afterJson, requestId, now,
        ),
      ]);
      const changed = results[2]?.results[0];
      if (!changed || integer(changed.audit_count) !== 1) {
        const replay = await db.prepare(
          `SELECT actor_user_id, target_user_id, action, reason, after_json
           FROM admin_audit_logs
           WHERE request_id = ? LIMIT 1`,
        ).bind(requestId).first<AuditReplayRow>();
        if (replay && auditReplayMatches(replay, {
          actorUserId: auth.user.id,
          targetUserId: id,
          action: auditAction,
          reason,
          afterJson,
        })) {
          return adminJson({ updated: false, idempotent: true });
        }
        if (replay) {
          return adminJson({ error: "이미 다른 관리자 작업에 사용된 요청 번호입니다." }, 409);
        }
        if (current.role === "expert" && nextRole === "preacher") {
          const active = await db.prepare(
            `SELECT COUNT(*) AS count FROM consultations
             WHERE expert_id = ? AND status IN ('assigned', 'in_progress')`,
          ).bind(id).first<{ count: number }>();
          if (integer(active?.count) > 0) {
            return adminJson({
              error: `진행 중인 피드백 ${integer(active?.count)}건을 완료하거나 재배정한 뒤 역할을 변경해 주세요.`,
            }, 409);
          }
        }
        return adminJson({ error: "회원 정보가 변경되었습니다. 새로고침 후 다시 시도해 주세요." }, 409);
      }
      return adminJson({
        updated: true,
        role: changed.role === "expert" ? "expert" : "preacher",
        version: integer(changed.version),
      });
    }

    if (action === "status") {
      const nextStatus = parsed.value.status;
      if (nextStatus !== "active" && nextStatus !== "suspended") {
        return adminJson({ error: "회원 상태를 확인해 주세요." }, 400);
      }
      if (id === auth.user.id || isAdminEmail(current.email)) {
        return adminJson({ error: "관리자 계정은 이 화면에서 정지하거나 복구할 수 없습니다." }, 409);
      }
      let suspendedUntil: string | null = null;
      if (nextStatus === "suspended" && parsed.value.suspendedUntil) {
        const date = new Date(String(parsed.value.suspendedUntil));
        if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now() + 60_000) {
          return adminJson({ error: "정지 종료 시각은 현재보다 뒤여야 합니다." }, 400);
        }
        if (date.getTime() > Date.now() + 366 * 24 * 60 * 60 * 1_000) {
          return adminJson({ error: "정지 기간은 최대 1년까지 설정할 수 있습니다." }, 400);
        }
        suspendedUntil = date.toISOString();
      }
      const auditAction = nextStatus === "suspended"
        ? "member.suspended"
        : "member.reactivated";
      const nextVersion = expectedVersion + 1;
      const beforeJson = safeJson({
        status: current.status,
        statusReason: current.status_reason,
        suspendedUntil: current.suspended_until,
        version: expectedVersion,
      });
      const afterJson = safeJson({ status: nextStatus, suspendedUntil, version: nextVersion });
      const currentStatus = current.status === "suspended" &&
        (!current.suspended_until || current.suspended_until > now)
        ? "suspended"
        : "active";
      const prior = await db.prepare(
        `SELECT actor_user_id, target_user_id, action, reason, after_json
         FROM admin_audit_logs
         WHERE request_id = ? LIMIT 1`,
      ).bind(requestId).first<AuditReplayRow>();
      if (prior) {
        if (!auditReplayMatches(prior, {
          actorUserId: auth.user.id,
          targetUserId: id,
          action: auditAction,
          reason,
          afterJson,
        })) {
          return adminJson({ error: "이미 다른 관리자 작업에 사용된 요청 번호입니다." }, 409);
        }
        const sync = await synchronizeMemberStatus(db, id, auth.user.id, {
          version: nextVersion,
          status: nextStatus,
          suspendedUntil,
        });
        return adminJson({
          updated: false,
          idempotent: true,
          status: currentStatus,
          suspendedUntil: current.suspended_until,
          version: integer(current.version),
          authSync: sync.authSync,
          sessionSync: sync.sessionSync,
        });
      }
      if (integer(current.version) !== expectedVersion) {
        return adminJson({ error: "다른 관리자가 먼저 변경했습니다. 새로고침 후 다시 시도해 주세요." }, 409);
      }
      if (
        currentStatus === nextStatus &&
        (
          nextStatus === "active" ||
          (
            (current.suspended_until ?? null) === suspendedUntil &&
            current.status_reason === reason
          )
        )
      ) {
        return adminJson({
          updated: false,
          status: nextStatus,
          suspendedUntil: current.suspended_until,
          version: expectedVersion,
        });
      }
      const results = await db.batch<{
        version: number;
        status: string;
        suspended_until: string | null;
        audit_count: number;
      }>([
        db.prepare("SELECT pg_advisory_xact_lock(?)").bind(
          stableAdvisoryLockKey(requestId),
        ),
        db.prepare("SELECT pg_advisory_xact_lock(?)").bind(
          stableAdvisoryLockKey(`member-status:${id}`),
        ),
        db.prepare(
          `WITH changed AS (
             UPDATE users
             SET status = ?, status_reason = ?, suspended_until = ?,
                 status_changed_at = ?, status_changed_by = ?, updated_at = ?,
                 version = version + 1
             WHERE id = ? AND version = ?
               AND NOT EXISTS (
                 SELECT 1 FROM admin_audit_logs WHERE request_id = ?
               )
             RETURNING version, status, suspended_until
           ), audited AS (
             INSERT INTO admin_audit_logs
               (id, actor_user_id, target_user_id, action, entity_type, entity_id,
                reason, before_json, after_json, request_id, created_at)
             SELECT ?, ?, ?, ?, 'user', ?, ?, ?, ?, ?, ?
             FROM changed
             RETURNING id
           )
           SELECT changed.version, changed.status, changed.suspended_until,
                  (SELECT COUNT(*) FROM audited) AS audit_count
           FROM changed`,
        ).bind(
          nextStatus,
          nextStatus === "suspended" ? reason : "",
          suspendedUntil,
          now,
          auth.user.id,
          now,
          id,
          expectedVersion,
          requestId,
          crypto.randomUUID(),
          auth.user.id,
          id,
          auditAction,
          id,
          reason,
          beforeJson,
          afterJson,
          requestId,
          now,
        ),
      ]);
      const changed = results[2]?.results[0];
      if (!changed || integer(changed.audit_count) !== 1) {
        const replay = await db.prepare(
          `SELECT actor_user_id, target_user_id, action, reason, after_json
           FROM admin_audit_logs
           WHERE request_id = ? LIMIT 1`,
        ).bind(requestId).first<AuditReplayRow>();
        if (replay && auditReplayMatches(replay, {
          actorUserId: auth.user.id,
          targetUserId: id,
          action: auditAction,
          reason,
          afterJson,
        })) {
          const sync = await synchronizeMemberStatus(db, id, auth.user.id, {
            version: nextVersion,
            status: nextStatus,
            suspendedUntil,
          });
          const fresh = await db.prepare(
            `SELECT status, suspended_until, version FROM users WHERE id = ?`,
          ).bind(id).first<{
            status: string;
            suspended_until: string | null;
            version: number;
          }>();
          const freshStatus = fresh?.status === "suspended" &&
            (!fresh.suspended_until || fresh.suspended_until > new Date().toISOString())
            ? "suspended"
            : "active";
          return adminJson({
            updated: false,
            idempotent: true,
            status: freshStatus,
            suspendedUntil: fresh?.suspended_until ?? null,
            version: integer(fresh?.version),
            authSync: sync.authSync,
            sessionSync: sync.sessionSync,
          });
        }
        if (replay) {
          return adminJson({ error: "이미 다른 관리자 작업에 사용된 요청 번호입니다." }, 409);
        }
        return adminJson({ error: "회원 정보가 변경되었습니다. 새로고침 후 다시 시도해 주세요." }, 409);
      }
      const sync = await synchronizeMemberStatus(db, id, auth.user.id, {
        version: integer(changed.version),
        status: nextStatus,
        suspendedUntil,
      });
      return adminJson({
        updated: true,
        status: changed.status === "suspended" ? "suspended" : "active",
        suspendedUntil: changed.suspended_until,
        version: integer(changed.version),
        authSync: sync.authSync,
        sessionSync: sync.sessionSync,
      });
    }

    return adminJson({ error: "지원하지 않는 회원 관리 작업입니다." }, 400);
  } catch (error) {
    console.error("[admin-members] update failed", error instanceof Error ? error.message : "unknown");
    return adminJson({ error: "회원 정보를 변경하지 못했습니다." }, 503);
  }
}
