import {
  adminJson,
  adminReason,
  adminRequestId,
  claimAdminAuditRequest,
  memberIdParam,
  readAdminJsonBody,
  requireAdminRequest,
} from "@/app/_lib/admin-actions";
import {
  confirmPortOneOrder,
  findPortOneOrder,
} from "@/app/_lib/portone-payments";
import { ensureDatabase, getD1 } from "@/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string; paymentId: string }>;
};

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const auth = await requireAdminRequest(request);
  if ("response" in auth) return auth.response;
  const params = await context.params;
  const userId = memberIdParam(params.id);
  const paymentId = /^[A-Za-z0-9_-]{1,100}$/.test(params.paymentId)
    ? params.paymentId
    : null;
  if (!userId || !paymentId) {
    return adminJson({ error: "회원 또는 결제 식별자를 확인해 주세요." }, 400);
  }
  const parsed = await readAdminJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const reason = adminReason(parsed.value.reason);
  const requestId = adminRequestId(parsed.value.requestId);
  if (!reason || !requestId) {
    return adminJson({ error: "결제 재검증 사유가 필요합니다." }, 400);
  }

  const db = getD1();
  if (!db) return adminJson({ error: "결제 저장소에 연결할 수 없습니다." }, 503);
  try {
    await ensureDatabase(db);
    const orderReference = await db.prepare(
      `SELECT payment_id FROM payment_orders
       WHERE user_id = ? AND provider = 'portone'
         AND (id = ? OR payment_id = ?)
       LIMIT 1`,
    ).bind(userId, paymentId, paymentId).first<{ payment_id: string }>();
    const order = orderReference
      ? await findPortOneOrder(db, orderReference.payment_id, userId)
      : null;
    if (!order) return adminJson({ error: "포트원 결제 주문을 찾을 수 없습니다." }, 404);
    const before = { status: order.status, paymentId: order.paymentId };
    const claim = await claimAdminAuditRequest(db, {
      actorUserId: auth.user.id,
      targetUserId: userId,
      action: "payment.reverification_requested",
      entityType: "payment_order",
      entityId: order.id,
      reason,
      before,
      after: { requested: true },
      requestId,
    });
    if (claim === "conflict") {
      return adminJson({ error: "이미 다른 관리자 작업에 사용된 요청 번호입니다." }, 409);
    }
    if (claim === "replay") {
      return adminJson({ reverified: false, idempotent: true });
    }
    const completed = await confirmPortOneOrder({ db, order });
    const refreshed = await findPortOneOrder(db, order.paymentId, userId);
    return adminJson({
      reverified: true,
      alreadyCompleted: completed.alreadyCompleted,
      status: refreshed?.status ?? order.status,
    });
  } catch (error) {
    console.error("[admin-members] payment reverify failed", error instanceof Error ? error.message : "unknown");
    return adminJson({ error: "결제사 확인 결과를 반영하지 못했습니다. 주문 상태와 서버 로그를 확인해 주세요." }, 502);
  }
}
