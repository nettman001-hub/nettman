import { resolveRequestUserResponse, unauthorizedResponse } from "@/app/_lib/auth-user";
import {
  getPortOnePublicConfig,
  portOneCheckoutConfigured,
} from "@/app/_lib/portone-server";
import {
  ensureTokenWallet,
  MAXIMUM_TOPUP_KRW,
  MINIMUM_TOPUP_KRW,
  tokensForKrw,
} from "@/app/_lib/token-wallet";
import { ensureDatabase, getD1 } from "@/db";

export const runtime = "nodejs";

type PaymentMethod = "card" | "kakaopay" | "naverpay";

const easyPayProviders = {
  kakaopay: "KAKAOPAY",
  naverpay: "NAVERPAY",
} as const;

function error(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
}

function isPaymentMethod(value: unknown): value is PaymentMethod {
  return value === "card" || value === "kakaopay" || value === "naverpay";
}

function paymentOrigin(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) {
    try {
      const url = new URL(configured);
      if (url.protocol === "https:" || url.hostname === "localhost") return url.origin;
    } catch {
      // Fall back to the request URL for local development and previews.
    }
  }
  return new URL(request.url).origin;
}

export async function POST(request: Request): Promise<Response> {
  const auth = await resolveRequestUserResponse(request);
  if ("response" in auth) return auth.response;
  const { user } = auth;
  if (!user) return unauthorizedResponse();
  const config = getPortOnePublicConfig();
  if (!config || !portOneCheckoutConfigured()) {
    return error("결제 연결을 준비 중입니다. 잠시 후 다시 이용해 주세요.", 503);
  }
  const db = getD1();
  if (!db) return error("토큰 지갑 저장소에 연결할 수 없습니다.", 503);

  let input: { amountKrw?: unknown; paymentMethod?: unknown };
  try {
    input = (await request.json()) as typeof input;
  } catch {
    return error("충전 금액과 결제수단을 확인해 주세요.");
  }
  const amountKrw = Number(input.amountKrw);
  if (
    !Number.isSafeInteger(amountKrw) ||
    amountKrw < MINIMUM_TOPUP_KRW ||
    amountKrw > MAXIMUM_TOPUP_KRW ||
    amountKrw % 1_000 !== 0
  ) {
    return error(
      `충전 금액은 ${MINIMUM_TOPUP_KRW.toLocaleString("ko-KR")}원부터 ${MAXIMUM_TOPUP_KRW.toLocaleString("ko-KR")}원까지 1,000원 단위로 입력해 주세요.`,
    );
  }
  if (!isPaymentMethod(input.paymentMethod)) {
    return error("지원하지 않는 결제수단입니다.");
  }

  const paymentMethod = input.paymentMethod;
  const tokenAmount = tokensForKrw(amountKrw);
  const orderId = crypto.randomUUID();
  const paymentId = `sg${crypto.randomUUID().replaceAll("-", "")}`;
  const now = new Date().toISOString();
  try {
    await ensureDatabase(db);
    await ensureTokenWallet(db, user.id);
    await db
      .prepare(
        `INSERT INTO payment_orders
          (id, user_id, payment_id, provider, payment_method, amount_krw,
           token_amount, status, created_at)
         VALUES (?, ?, ?, 'portone', ?, ?, ?, 'pending', ?)`,
      )
      .bind(orderId, user.id, paymentId, paymentMethod, amountKrw, tokenAmount, now)
      .run();

    const origin = paymentOrigin(request);
    const redirectUrl = `${origin}/tokens?topup=return&paymentId=${paymentId}`;
    return Response.json({
      payment: {
        storeId: config.storeId,
        channelKey: config.channelKey,
        paymentId,
        orderName: `로고스AI ${tokenAmount.toLocaleString("ko-KR")}토큰`,
        totalAmount: amountKrw,
        currency: "KRW",
        payMethod: paymentMethod === "card" ? "CARD" : "EASY_PAY",
        customer: {
          customerId: user.id,
          fullName: user.name,
          email: user.email,
        },
        ...(paymentMethod === "card"
          ? {}
          : { easyPay: { easyPayProvider: easyPayProviders[paymentMethod] } }),
        redirectUrl,
        noticeUrls: [`${origin}/api/portone/webhook`],
      },
    }, { status: 201 });
  } catch {
    await db
      .prepare(
        `UPDATE payment_orders SET status = 'failed'
         WHERE id = ? AND user_id = ? AND status = 'pending'`,
      )
      .bind(orderId, user.id)
      .run()
      .catch(() => undefined);
    return error("결제 주문을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.", 502);
  }
}
