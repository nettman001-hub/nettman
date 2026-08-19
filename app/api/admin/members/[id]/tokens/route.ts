import {
  adminJson,
  adminReason,
  adminRequestId,
  stableAdvisoryLockKey,
  memberIdParam,
  readAdminJsonBody,
  requireAdminRequest,
} from "@/app/_lib/admin-actions";
import { ensureTokenWallet } from "@/app/_lib/token-wallet";
import { ensureDatabase, getD1 } from "@/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function integer(value: unknown): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : 0;
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
  if (userId === auth.user.id) {
    return adminJson({ error: "관리자는 자신의 토큰을 직접 조정할 수 없습니다." }, 409);
  }

  const parsed = await readAdminJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const amount = integer(parsed.value.amount);
  const reason = adminReason(parsed.value.reason);
  const requestId = adminRequestId(parsed.value.requestId);
  if (!reason || !requestId || amount === 0 || Math.abs(amount) > 100_000) {
    return adminJson({
      error: "토큰은 한 번에 1~100,000개까지 지급하거나 회수할 수 있으며 사유가 필요합니다.",
    }, 400);
  }

  const db = getD1();
  if (!db) return adminJson({ error: "토큰 저장소에 연결할 수 없습니다." }, 503);
  try {
    await ensureDatabase(db);
    const target = await db.prepare(
      "SELECT id, email FROM users WHERE id = ?",
    ).bind(userId).first<{ id: string; email: string }>();
    if (!target) return adminJson({ error: "회원을 찾을 수 없습니다." }, 404);
    await ensureTokenWallet(db, userId);

    const existing = await db.prepare(
      `SELECT a.user_id, a.actor_user_id, a.amount, a.reason,
              a.transaction_id, t.balance_after
       FROM token_adjustments a
       LEFT JOIN token_transactions t ON t.id = a.transaction_id
       WHERE a.idempotency_key = ?`,
    ).bind(requestId).first<{
      user_id: string;
      actor_user_id: string;
      amount: number;
      reason: string;
      transaction_id: string;
      balance_after: number;
    }>();
    if (existing) {
      if (
        existing.user_id !== userId ||
        existing.actor_user_id !== auth.user.id ||
        integer(existing.amount) !== amount ||
        existing.reason !== reason
      ) {
        return adminJson({ error: "이미 다른 관리자 작업에 사용된 요청 번호입니다." }, 409);
      }
      return adminJson({
        adjusted: false,
        idempotent: true,
        amount,
        balance: integer(existing.balance_after),
        transactionId: existing.transaction_id,
      });
    }

    const now = new Date().toISOString();
    const transactionId = crypto.randomUUID();
    const adjustmentId = crypto.randomUUID();
    const referenceId = `admin-adjustment:${requestId}`;
    const description = amount > 0 ? "관리자 무료 토큰 지급" : "관리자 토큰 회수";
    const auditAction = amount > 0 ? "tokens.free_granted" : "tokens.reclaimed";
    const results = await db.batch<{
      transaction_id: string;
      balance_after: number;
      adjustment_count: number;
      audit_count: number;
    }>([
      db.prepare("SELECT pg_advisory_xact_lock(?)").bind(stableAdvisoryLockKey(requestId)),
      db.prepare(
        `WITH adjusted AS (
           UPDATE token_wallets
           SET balance = balance + ?, updated_at = ?
           WHERE user_id = ? AND balance + ? >= 0
             AND NOT EXISTS (
               SELECT 1 FROM token_adjustments WHERE idempotency_key = ?
             )
             AND NOT EXISTS (
               SELECT 1 FROM admin_audit_logs WHERE request_id = ?
             )
           RETURNING balance
         ), transaction_insert AS (
           INSERT INTO token_transactions
             (id, user_id, kind, amount, balance_after, reference_id,
              description, metadata_json, created_at)
           SELECT ?, ?, 'admin_adjustment', ?, adjusted.balance, ?, ?, ?, ?
           FROM adjusted
           RETURNING id, amount, balance_after
         ), adjustment_insert AS (
           INSERT INTO token_adjustments
             (id, user_id, amount, reason, actor_user_id, idempotency_key,
              transaction_id, created_at)
           SELECT ?, ?, ?, ?, ?, ?, transaction_insert.id, ?
           FROM transaction_insert
           RETURNING transaction_id
         ), audit_insert AS (
           INSERT INTO admin_audit_logs
             (id, actor_user_id, target_user_id, action, entity_type, entity_id,
              reason, before_json, after_json, request_id, created_at)
           SELECT ?, ?, ?, ?, 'token_wallet', ?, ?,
             '{"balance":' ||
               (transaction_insert.balance_after - transaction_insert.amount) || '}',
             '{"balance":' || transaction_insert.balance_after ||
               ',"amount":' || transaction_insert.amount || '}',
             ?, ?
           FROM transaction_insert
           INNER JOIN adjustment_insert
             ON adjustment_insert.transaction_id = transaction_insert.id
           RETURNING id
         )
         SELECT transaction_insert.id AS transaction_id,
                transaction_insert.balance_after,
                (SELECT COUNT(*) FROM adjustment_insert) AS adjustment_count,
                (SELECT COUNT(*) FROM audit_insert) AS audit_count
         FROM transaction_insert`,
      ).bind(
        amount,
        now,
        userId,
        amount,
        requestId,
        requestId,
        transactionId,
        userId,
        amount,
        referenceId,
        description,
        JSON.stringify({ actorUserId: auth.user.id, reason, requestId }),
        now,
        adjustmentId,
        userId,
        amount,
        reason,
        auth.user.id,
        requestId,
        now,
        crypto.randomUUID(),
        auth.user.id,
        userId,
        auditAction,
        userId,
        reason,
        requestId,
        now,
      ),
    ]);
    const adjusted = results[1]?.results[0];
    if (
      !adjusted ||
      integer(adjusted.adjustment_count) !== 1 ||
      integer(adjusted.audit_count) !== 1
    ) {
      const raced = await db.prepare(
        `SELECT a.user_id, a.actor_user_id, a.amount, a.reason,
                a.transaction_id, t.balance_after
         FROM token_adjustments a
         LEFT JOIN token_transactions t ON t.id = a.transaction_id
         WHERE a.idempotency_key = ?`,
      ).bind(requestId).first<{
        user_id: string;
        actor_user_id: string;
        amount: number;
        reason: string;
        transaction_id: string;
        balance_after: number;
      }>();
      if (
        raced &&
        raced.user_id === userId &&
        raced.actor_user_id === auth.user.id &&
        integer(raced.amount) === amount &&
        raced.reason === reason
      ) {
        return adminJson({
          adjusted: false,
          idempotent: true,
          amount,
          balance: integer(raced.balance_after),
          transactionId: raced.transaction_id,
        });
      }
      const conflictingAudit = await db.prepare(
        `SELECT target_user_id, action FROM admin_audit_logs
         WHERE request_id = ? LIMIT 1`,
      ).bind(requestId).first<{ target_user_id: string | null; action: string }>();
      if (conflictingAudit) {
        return adminJson({ error: "이미 다른 관리자 작업에 사용된 요청 번호입니다." }, 409);
      }
      const current = await db.prepare(
        "SELECT balance FROM token_wallets WHERE user_id = ?",
      ).bind(userId).first<{ balance: number }>();
      const currentBalance = integer(current?.balance);
      if (currentBalance + amount < 0) {
        return adminJson({
          error: `회수 후 잔액이 음수가 됩니다. 현재 잔액은 ${currentBalance.toLocaleString("ko-KR")}토큰입니다.`,
        }, 409);
      }
      return adminJson({ error: "토큰 잔액이 변경되었습니다. 새로고침 후 다시 시도해 주세요." }, 409);
    }
    return adminJson({
      adjusted: true,
      amount,
      balance: integer(adjusted.balance_after),
      transactionId: adjusted.transaction_id,
      freeGrant: amount > 0,
    });
  } catch (error) {
    console.error("[admin-members] token adjustment failed", error instanceof Error ? error.message : "unknown");
    return adminJson({ error: "토큰을 조정하지 못했습니다." }, 503);
  }
}
