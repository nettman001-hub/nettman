import {
  getStripeClient,
  getStripeWebhookSecret,
  Stripe,
} from "@/app/_lib/stripe-server";
import { completeTokenTopup, ensureTokenWallet } from "@/app/_lib/token-wallet";
import { ensureDatabase, getD1 } from "@/db";

export const runtime = "nodejs";

function webhookError(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
}

function paymentIntentId(session: Stripe.Checkout.Session): string | undefined {
  return typeof session.payment_intent === "string"
    ? session.payment_intent
    : session.payment_intent?.id;
}

export async function POST(request: Request): Promise<Response> {
  const stripe = getStripeClient();
  const webhookSecret = getStripeWebhookSecret();
  const signature = request.headers.get("stripe-signature");
  if (!stripe || !webhookSecret) return webhookError("결제 웹훅이 구성되지 않았습니다.", 503);
  if (!signature) return webhookError("결제 서명이 없습니다.");

  const rawBody = await request.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      webhookSecret,
      undefined,
      Stripe.createSubtleCryptoProvider(),
    );
  } catch {
    return webhookError("결제 서명이 올바르지 않습니다.");
  }

  if (
    event.type !== "checkout.session.completed" &&
    event.type !== "checkout.session.async_payment_succeeded"
  ) {
    return Response.json({ received: true });
  }

  const session = event.data.object as Stripe.Checkout.Session;
  if (session.mode !== "payment" || session.payment_status !== "paid") {
    return Response.json({ received: true });
  }
  const topupId = session.metadata?.topup_id;
  const userId = session.metadata?.user_id;
  const usdCents = Number(session.metadata?.usd_cents);
  const tokenAmount = Number(session.metadata?.token_amount);
  if (
    !topupId ||
    !userId ||
    !Number.isSafeInteger(usdCents) ||
    !Number.isSafeInteger(tokenAmount) ||
    usdCents < 100 ||
    tokenAmount !== usdCents * 2 ||
    session.currency?.toLowerCase() !== "usd" ||
    session.amount_total !== usdCents
  ) {
    return webhookError("결제 정보가 충전 주문과 일치하지 않습니다.");
  }

  const db = getD1();
  if (!db) return webhookError("토큰 지갑 저장소에 연결할 수 없습니다.", 503);
  try {
    await ensureDatabase(db);
    const topup = await db
      .prepare(
        `SELECT user_id, usd_cents, token_amount, status
         FROM token_topups WHERE id = ?`,
      )
      .bind(topupId)
      .first<{ user_id: string; usd_cents: number; token_amount: number; status: string }>();
    if (
      !topup ||
      topup.user_id !== userId ||
      Number(topup.usd_cents) !== usdCents ||
      Number(topup.token_amount) !== tokenAmount
    ) {
      return webhookError("결제 정보가 충전 주문과 일치하지 않습니다.");
    }
    if (topup.status === "completed") return Response.json({ received: true });
    await ensureTokenWallet(db, userId);
    const completed = await completeTokenTopup({
      db,
      topupId,
      checkoutSessionId: session.id,
      paymentIntentId: paymentIntentId(session),
      usdCents,
      tokenAmount,
    });
    if (!completed) throw new Error("Top-up was not completed");
    return Response.json({ received: true });
  } catch {
    return webhookError("토큰 충전을 반영하지 못했습니다.", 500);
  }
}
