import {
  confirmPortOneOrder,
  findPortOneOrder,
} from "@/app/_lib/portone-payments";
import {
  getPortOnePublicConfig,
  verifyPortOneWebhook,
} from "@/app/_lib/portone-server";
import { ensureDatabase, getD1 } from "@/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PortOneWebhook = {
  type?: string;
  data?: {
    storeId?: string;
    paymentId?: string;
    transactionId?: string;
  };
};

function error(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();
  if (!verifyPortOneWebhook(rawBody, request.headers)) {
    return error("결제 웹훅 서명이 올바르지 않습니다.");
  }

  let webhook: PortOneWebhook;
  try {
    webhook = JSON.parse(rawBody) as PortOneWebhook;
  } catch {
    return error("결제 웹훅 본문이 올바르지 않습니다.");
  }
  const config = getPortOnePublicConfig();
  if (!config || webhook.data?.storeId !== config.storeId) {
    return error("결제 상점 정보가 일치하지 않습니다.");
  }
  const paymentId = webhook.data?.paymentId;
  if (!paymentId || !/^[A-Za-z0-9]{1,40}$/.test(paymentId)) {
    return Response.json({ received: true });
  }

  const supportedTypes = new Set([
    "Transaction.Paid",
    "Transaction.Failed",
    "Transaction.Cancelled",
  ]);
  if (!webhook.type || !supportedTypes.has(webhook.type)) {
    return Response.json({ received: true });
  }

  const db = getD1();
  if (!db) return error("토큰 지갑 저장소에 연결할 수 없습니다.", 503);
  try {
    await ensureDatabase(db);
    const order = await findPortOneOrder(db, paymentId);
    if (!order) return Response.json({ received: true });

    if (webhook.type === "Transaction.Paid") {
      await confirmPortOneOrder({
        db,
        order,
        transactionId: webhook.data?.transactionId,
      });
      return Response.json({ received: true });
    }

    const nextStatus =
      webhook.type === "Transaction.Cancelled" ? "cancelled" : "failed";
    await db
      .prepare(
        `UPDATE payment_orders SET status = ?
         WHERE id = ? AND status IN ('pending', 'failed', 'cancelled')`,
      )
      .bind(nextStatus, order.id)
      .run();
    return Response.json({ received: true });
  } catch {
    return error("결제 웹훅을 처리하지 못했습니다.", 500);
  }
}
