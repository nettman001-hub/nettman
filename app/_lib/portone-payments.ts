import {
  getPortOnePayment,
  verifyPaidPortOnePayment,
} from "@/app/_lib/portone-server";
import {
  completePortOneTopup,
  ensureTokenWallet,
} from "@/app/_lib/token-wallet";

type AppDatabase = NonNullable<ReturnType<typeof import("@/db").getD1>>;

export type PortOneOrder = {
  id: string;
  userId: string;
  paymentId: string;
  paymentMethod: "card" | "kakaopay" | "naverpay";
  amountKrw: number;
  tokenAmount: number;
  status: "pending" | "processing" | "completed" | "failed" | "cancelled";
};

export async function findPortOneOrder(
  db: AppDatabase,
  paymentId: string,
  userId?: string,
): Promise<PortOneOrder | null> {
  const row = await db
    .prepare(
      `SELECT id, user_id, payment_id, payment_method, amount_krw, token_amount, status
       FROM payment_orders
       WHERE payment_id = ? AND provider = 'portone'
         AND (? IS NULL OR user_id = ?)`,
    )
    .bind(paymentId, userId ?? null, userId ?? null)
    .first<{
      id: string;
      user_id: string;
      payment_id: string;
      payment_method: PortOneOrder["paymentMethod"];
      amount_krw: number;
      token_amount: number;
      status: PortOneOrder["status"];
    }>();
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    paymentId: row.payment_id,
    paymentMethod: row.payment_method,
    amountKrw: Number(row.amount_krw),
    tokenAmount: Number(row.token_amount),
    status: row.status,
  };
}

export async function confirmPortOneOrder(args: {
  db: AppDatabase;
  order: PortOneOrder;
  transactionId?: string | null;
}): Promise<{ alreadyCompleted: boolean }> {
  const { db, order, transactionId } = args;
  if (order.status === "completed") return { alreadyCompleted: true };

  const payment = await getPortOnePayment(order.paymentId);
  const verifiedTransactionId = verifyPaidPortOnePayment({
    payment,
    paymentId: order.paymentId,
    amountKrw: order.amountKrw,
    transactionId,
  });
  await ensureTokenWallet(db, order.userId);
  const completed = await completePortOneTopup({
    db,
    orderId: order.id,
    paymentId: order.paymentId,
    transactionId: verifiedTransactionId,
    amountKrw: order.amountKrw,
    tokenAmount: order.tokenAmount,
  });
  if (completed) return { alreadyCompleted: false };

  const current = await findPortOneOrder(db, order.paymentId, order.userId);
  if (current?.status === "completed") return { alreadyCompleted: true };
  throw new Error("결제 완료 상태를 토큰 지갑에 반영하지 못했습니다.");
}
