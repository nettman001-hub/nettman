import { createHmac, timingSafeEqual } from "node:crypto";

const PORTONE_API_ORIGIN = "https://api.portone.io";
const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

export type PortOnePayment = {
  id: string;
  status: string;
  storeId?: string;
  transactionId?: string;
  currency?: string;
  amount?: {
    total?: number;
  };
};

export type PortOnePublicConfig = {
  storeId: string;
  channelKey: string;
};

function environmentValue(name: string): string | null {
  return process.env[name]?.trim() || null;
}

export function getPortOnePublicConfig(): PortOnePublicConfig | null {
  const storeId = environmentValue("PORTONE_STORE_ID");
  const channelKey = environmentValue("PORTONE_CHANNEL_KEY");
  return storeId && channelKey ? { storeId, channelKey } : null;
}

export function getPortOneWebhookSecret(): string | null {
  return environmentValue("PORTONE_WEBHOOK_SECRET");
}

export function portOneCheckoutConfigured(): boolean {
  return Boolean(
    getPortOnePublicConfig() &&
    environmentValue("PORTONE_API_SECRET") &&
    getPortOneWebhookSecret(),
  );
}

export async function getPortOnePayment(paymentId: string): Promise<PortOnePayment> {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(paymentId)) {
    throw new Error("결제번호 형식이 올바르지 않습니다.");
  }
  const apiSecret = environmentValue("PORTONE_API_SECRET");
  if (!apiSecret) throw new Error("포트원 API 시크릿이 구성되지 않았습니다.");

  const response = await fetch(
    `${PORTONE_API_ORIGIN}/payments/${encodeURIComponent(paymentId)}`,
    {
      method: "GET",
      headers: {
        Authorization: `PortOne ${apiSecret}`,
        Accept: "application/json",
      },
      cache: "no-store",
    },
  );
  if (!response.ok) {
    throw new Error(`포트원 결제 조회에 실패했습니다. (${response.status})`);
  }
  const payment = (await response.json()) as Partial<PortOnePayment>;
  if (
    typeof payment.id !== "string" ||
    typeof payment.status !== "string" ||
    !payment.amount ||
    !Number.isSafeInteger(Number(payment.amount.total))
  ) {
    throw new Error("포트원 결제 조회 응답이 올바르지 않습니다.");
  }
  return payment as PortOnePayment;
}

export function verifyPaidPortOnePayment(args: {
  payment: PortOnePayment;
  paymentId: string;
  amountKrw: number;
  transactionId?: string | null;
}): string {
  const { payment, paymentId, amountKrw, transactionId } = args;
  const config = getPortOnePublicConfig();
  if (payment.id !== paymentId) throw new Error("결제번호가 주문과 일치하지 않습니다.");
  if (payment.status !== "PAID") throw new Error("결제가 아직 완료되지 않았습니다.");
  if (Number(payment.amount?.total) !== amountKrw) {
    throw new Error("결제 금액이 주문 금액과 일치하지 않습니다.");
  }
  if (payment.currency && payment.currency !== "KRW") {
    throw new Error("결제 통화가 원화가 아닙니다.");
  }
  if (config && payment.storeId && payment.storeId !== config.storeId) {
    throw new Error("결제 상점이 현재 서비스와 일치하지 않습니다.");
  }
  return payment.transactionId || transactionId || payment.id;
}

function decodeWebhookSecret(secret: string): Buffer | null {
  const encoded = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return null;
  const decoded = Buffer.from(encoded, "base64");
  return decoded.length ? decoded : null;
}

export function verifyPortOneWebhook(
  rawBody: string,
  headers: Headers,
  nowMilliseconds = Date.now(),
): boolean {
  const webhookId = headers.get("webhook-id");
  const timestamp = headers.get("webhook-timestamp");
  const signatureHeader = headers.get("webhook-signature");
  const secret = getPortOneWebhookSecret();
  if (!webhookId || !timestamp || !signatureHeader || !secret) return false;

  const timestampSeconds = Number(timestamp);
  if (
    !Number.isSafeInteger(timestampSeconds) ||
    Math.abs(Math.floor(nowMilliseconds / 1_000) - timestampSeconds) >
      WEBHOOK_TOLERANCE_SECONDS
  ) {
    return false;
  }
  const secretBytes = decodeWebhookSecret(secret);
  if (!secretBytes) return false;

  const expected = createHmac("sha256", secretBytes)
    .update(`${webhookId}.${timestamp}.${rawBody}`, "utf8")
    .digest();
  const signatures = signatureHeader
    .split(/\s+/)
    .map((entry) => entry.split(",", 2))
    .filter(([version, signature]) => version === "v1" && Boolean(signature))
    .map(([, signature]) => signature);

  return signatures.some((signature) => {
    try {
      const candidate = Buffer.from(signature, "base64");
      return candidate.length === expected.length && timingSafeEqual(candidate, expected);
    } catch {
      return false;
    }
  });
}
