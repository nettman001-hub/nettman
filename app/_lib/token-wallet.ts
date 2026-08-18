import type { AiRequestConfig } from "./ai-config.ts";
import {
  isAiEngineTier,
  type AiEngineTier,
} from "./ai-engine-tiers.ts";
import {
  SERMON_TOKEN_MINIMUM_COSTS,
  sermonGenerationTokenCost,
  type SermonPricingDuration,
  type SermonPricingPointCount,
} from "./sermon-token-pricing.ts";

export const WELCOME_TOKEN_GRANT = 200;
export const TOKENS_PER_1000_KRW = 200;
export const MINIMUM_TOPUP_KRW = 1_000;
export const MAXIMUM_TOPUP_KRW = 500_000;
export const TOPUP_PRESETS_KRW = [1_000, 5_000, 10_000, 20_000, 50_000, 100_000] as const;

// Legacy Stripe exports are kept so historical routes and records remain readable.
export const TOKENS_PER_USD = 200;
export const MINIMUM_TOPUP_USD = 1;
export const MAXIMUM_TOPUP_USD = 500;
export const TOPUP_PRESETS_USD = [1, 5, 10, 20, 50, 100] as const;

export type SermonTokenTier = AiEngineTier;

/** Minimum prices retained under the historical API name for client compatibility. */
export const SERMON_TOKEN_COSTS: Record<SermonTokenTier, number> =
  SERMON_TOKEN_MINIMUM_COSTS;

export function tokenBillingConfigured(): boolean {
  return Boolean(
    process.env.PORTONE_STORE_ID?.trim() &&
    process.env.PORTONE_CHANNEL_KEY?.trim() &&
    process.env.PORTONE_API_SECRET?.trim() &&
    process.env.PORTONE_WEBHOOK_SECRET?.trim(),
  );
}

type AppDatabase = NonNullable<ReturnType<typeof import("@/db").getD1>>;

export type TokenWalletSnapshot = {
  balance: number;
  lifetimePurchased: number;
  lifetimeSpent: number;
};

export class InsufficientTokensError extends Error {
  readonly balance: number;
  readonly required: number;

  constructor(balance: number, required: number) {
    super(`토큰이 부족합니다. 현재 ${balance}토큰, 필요한 토큰은 ${required}토큰입니다.`);
    this.name = "InsufficientTokensError";
    this.balance = balance;
    this.required = required;
  }
}

function integer(value: unknown): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

function advisoryKey(referenceId: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < referenceId.length; index += 1) {
    hash ^= referenceId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash | 0;
}

function escapeSqlLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

type BillableAi = Pick<AiRequestConfig, "engine" | "model"> & {
  tier?: AiEngineTier;
};

export function tokenTierForAi(
  ai: BillableAi | null | undefined,
): SermonTokenTier {
  if (isAiEngineTier(ai?.tier)) return ai.tier;
  if (ai?.engine !== "deepseek") return "basic";
  return ai.model.trim().toLowerCase() === "deepseek-v4-pro"
    ? "reasoning"
    : "advanced";
}

export function sermonTokenCost(
  ai: BillableAi | null | undefined,
  duration: SermonPricingDuration,
  pointCount: SermonPricingPointCount,
): number {
  return sermonGenerationTokenCost(tokenTierForAi(ai), duration, pointCount);
}

export function tokensForUsd(usd: number): number {
  if (!Number.isInteger(usd) || usd < MINIMUM_TOPUP_USD || usd > MAXIMUM_TOPUP_USD) {
    throw new Error(`충전 금액은 $${MINIMUM_TOPUP_USD}부터 $${MAXIMUM_TOPUP_USD}까지의 정수로 입력해 주세요.`);
  }
  return usd * TOKENS_PER_USD;
}

export function tokensForKrw(amountKrw: number): number {
  if (
    !Number.isSafeInteger(amountKrw) ||
    amountKrw < MINIMUM_TOPUP_KRW ||
    amountKrw > MAXIMUM_TOPUP_KRW ||
    amountKrw % 1_000 !== 0
  ) {
    throw new Error(
      `충전 금액은 ${MINIMUM_TOPUP_KRW.toLocaleString("ko-KR")}원부터 ${MAXIMUM_TOPUP_KRW.toLocaleString("ko-KR")}원까지 1,000원 단위로 입력해 주세요.`,
    );
  }
  return (amountKrw / 1_000) * TOKENS_PER_1000_KRW;
}

export async function ensureTokenWallet(
  db: AppDatabase,
  userId: string,
): Promise<TokenWalletSnapshot> {
  const now = new Date().toISOString();
  await db.batch([
    db.prepare(
      `INSERT INTO token_wallets
        (user_id, balance, lifetime_purchased, lifetime_spent, created_at, updated_at)
       VALUES (?, ?, 0, 0, ?, ?)
       ON CONFLICT(user_id) DO NOTHING`,
    ).bind(userId, WELCOME_TOKEN_GRANT, now, now),
    db.prepare(
      `INSERT INTO token_transactions
        (id, user_id, kind, amount, balance_after, reference_id, description, metadata_json, created_at)
       SELECT ?, ?, 'welcome', ?, w.balance, ?, ?, '{}', ?
       FROM token_wallets w
       WHERE w.user_id = ?
       ON CONFLICT(reference_id) DO NOTHING`,
    ).bind(
      crypto.randomUUID(),
      userId,
      WELCOME_TOKEN_GRANT,
      `welcome:${userId}`,
      "가입 축하 기본 토큰",
      now,
      userId,
    ),
  ]);
  return getTokenWallet(db, userId);
}

export async function getTokenWallet(
  db: AppDatabase,
  userId: string,
): Promise<TokenWalletSnapshot> {
  const row = await db
    .prepare(
      `SELECT balance, lifetime_purchased, lifetime_spent
       FROM token_wallets WHERE user_id = ?`,
    )
    .bind(userId)
    .first<{ balance: number; lifetime_purchased: number; lifetime_spent: number }>();
  return {
    balance: integer(row?.balance),
    lifetimePurchased: integer(row?.lifetime_purchased),
    lifetimeSpent: integer(row?.lifetime_spent),
  };
}

export type TokenCharge = {
  referenceId: string;
  cost: number;
  balance: number;
  charged: boolean;
};

export async function chargeSermonTokens(args: {
  db: AppDatabase;
  userId: string;
  generationId: string;
  duration: SermonPricingDuration;
  pointCount: SermonPricingPointCount;
  ai?: BillableAi;
}): Promise<TokenCharge> {
  const { db, userId, generationId, duration, pointCount, ai } = args;
  await ensureTokenWallet(db, userId);
  const cost = sermonTokenCost(ai, duration, pointCount);
  const baseReferenceId = `sermon:${generationId}`;
  const priorCharges = await db
    .prepare(
      `SELECT charge.reference_id,
              -charge.amount AS charged_cost,
              CASE WHEN refund.reference_id IS NULL THEN 0 ELSE 1 END AS refunded
       FROM token_transactions charge
       LEFT JOIN token_transactions refund
         ON refund.reference_id = 'refund:' || charge.reference_id
       WHERE charge.user_id = ? AND charge.kind = 'generation'
         AND (charge.reference_id = ? OR charge.reference_id LIKE ? ESCAPE '\\')
       ORDER BY charge.created_at ASC`,
    )
    // The prefix also finds legacy per-position charges such as `sermon:<id>:1`,
    // preventing a resumed pre-migration run from being charged a second time.
    .bind(userId, baseReferenceId, `${escapeSqlLike(baseReferenceId)}:%`)
    .all<{ reference_id: string; charged_cost: number; refunded: number }>();
  const activeCharge = priorCharges.results.find((row) => integer(row.refunded) === 0);
  if (activeCharge) {
    const wallet = await getTokenWallet(db, userId);
    return {
      referenceId: activeCharge.reference_id,
      cost: integer(activeCharge.charged_cost),
      balance: wallet.balance,
      charged: false,
    };
  }
  const referenceId = priorCharges.results.length
    ? `${baseReferenceId}:retry:${priorCharges.results.length}`
    : baseReferenceId;
  const now = new Date().toISOString();
  const description = `설교 생성 ${duration}분 · ${pointCount}대지`;
  const metadata = JSON.stringify({
    generationId,
    duration,
    pointCount,
    tier: tokenTierForAi(ai),
    pricingVersion: 2,
  });
  const results = await db.batch<{ balance_after: number }>([
    db.prepare("SELECT pg_advisory_xact_lock(?)").bind(advisoryKey(referenceId)),
    db.prepare(
      `WITH debited AS (
         UPDATE token_wallets
         SET balance = balance - ?, lifetime_spent = lifetime_spent + ?, updated_at = ?
         WHERE user_id = ? AND balance >= ?
           AND NOT EXISTS (
             SELECT 1 FROM token_transactions WHERE reference_id = ?
           )
         RETURNING balance
       )
       INSERT INTO token_transactions
         (id, user_id, kind, amount, balance_after, reference_id, description, metadata_json, created_at)
       SELECT ?, ?, 'generation', ?, balance, ?, ?, ?, ? FROM debited
       ON CONFLICT(reference_id) DO NOTHING
       RETURNING balance_after`,
    ).bind(
      cost,
      cost,
      now,
      userId,
      cost,
      referenceId,
      crypto.randomUUID(),
      userId,
      -cost,
      referenceId,
      description,
      metadata,
      now,
    ),
  ]);
  const inserted = results[1]?.results[0];
  if (inserted) {
    return { referenceId, cost, balance: integer(inserted.balance_after), charged: true };
  }

  const existing = await db
    .prepare(
      `SELECT balance_after FROM token_transactions
       WHERE user_id = ? AND reference_id = ? AND kind = 'generation'`,
    )
    .bind(userId, referenceId)
    .first<{ balance_after: number }>();
  if (existing) {
    return { referenceId, cost, balance: integer(existing.balance_after), charged: false };
  }
  const wallet = await getTokenWallet(db, userId);
  throw new InsufficientTokensError(wallet.balance, cost);
}

export async function refundTokenCharge(args: {
  db: AppDatabase;
  userId: string;
  chargeReferenceId: string;
  reason: string;
}): Promise<boolean> {
  const { db, userId, chargeReferenceId, reason } = args;
  const referenceId = `refund:${chargeReferenceId}`;
  const now = new Date().toISOString();
  const results = await db.batch<{ balance_after: number }>([
    db.prepare("SELECT pg_advisory_xact_lock(?)").bind(advisoryKey(referenceId)),
    db.prepare(
      `WITH source AS (
         SELECT user_id, -amount AS refund_amount
         FROM token_transactions
         WHERE user_id = ? AND reference_id = ? AND kind = 'generation' AND amount < 0
       ), credited AS (
         UPDATE token_wallets w
         SET balance = w.balance + source.refund_amount,
             lifetime_spent = GREATEST(0, w.lifetime_spent - source.refund_amount),
             updated_at = ?
         FROM source
         WHERE w.user_id = source.user_id
           AND NOT EXISTS (
             SELECT 1 FROM token_transactions WHERE reference_id = ?
           )
         RETURNING w.balance, source.refund_amount
       )
       INSERT INTO token_transactions
         (id, user_id, kind, amount, balance_after, reference_id, description, metadata_json, created_at)
       SELECT ?, ?, 'refund', refund_amount, balance, ?, ?, ?, ? FROM credited
       ON CONFLICT(reference_id) DO NOTHING
       RETURNING balance_after`,
    ).bind(
      userId,
      chargeReferenceId,
      now,
      referenceId,
      crypto.randomUUID(),
      userId,
      referenceId,
      "설교 생성 실패 자동 환불",
      JSON.stringify({ chargeReferenceId, reason: reason.slice(0, 300) }),
      now,
    ),
  ]);
  return Boolean(results[1]?.results[0]);
}

export async function completeTokenTopup(args: {
  db: AppDatabase;
  topupId: string;
  checkoutSessionId: string;
  paymentIntentId?: string;
  usdCents: number;
  tokenAmount: number;
}): Promise<boolean> {
  const { db, topupId, checkoutSessionId, paymentIntentId, usdCents, tokenAmount } = args;
  const now = new Date().toISOString();
  const referenceId = `stripe:${checkoutSessionId}`;
  const results = await db.batch([
    db.prepare("SELECT pg_advisory_xact_lock(?)").bind(advisoryKey(referenceId)),
    db.prepare(
      `UPDATE token_topups
       SET status = 'processing', stripe_checkout_session_id = ?, stripe_payment_intent_id = ?
       WHERE id = ? AND status = 'pending' AND usd_cents = ? AND token_amount = ?
         AND (stripe_checkout_session_id IS NULL OR stripe_checkout_session_id = ?)`,
    ).bind(
      checkoutSessionId,
      paymentIntentId ?? null,
      topupId,
      usdCents,
      tokenAmount,
      checkoutSessionId,
    ),
    db.prepare(
      `UPDATE token_wallets w
       SET balance = w.balance + t.token_amount,
           lifetime_purchased = w.lifetime_purchased + t.token_amount,
           updated_at = ?
       FROM token_topups t
       WHERE t.id = ? AND t.status = 'processing' AND w.user_id = t.user_id`,
    ).bind(now, topupId),
    db.prepare(
      `INSERT INTO token_transactions
        (id, user_id, kind, amount, balance_after, reference_id, description, metadata_json, created_at)
       SELECT ?, t.user_id, 'topup', t.token_amount, w.balance, ?, ?, ?, ?
       FROM token_topups t
       JOIN token_wallets w ON w.user_id = t.user_id
       WHERE t.id = ? AND t.status = 'processing'
       ON CONFLICT(reference_id) DO NOTHING`,
    ).bind(
      crypto.randomUUID(),
      referenceId,
      `$${(usdCents / 100).toFixed(2)} 토큰 충전`,
      JSON.stringify({ topupId, checkoutSessionId, usdCents }),
      now,
      topupId,
    ),
    db.prepare(
      `UPDATE token_topups SET status = 'completed', completed_at = ?
       WHERE id = ? AND status = 'processing'`,
    ).bind(now, topupId),
  ]);
  return (results[4]?.meta.changes ?? 0) > 0;
}

export async function completePortOneTopup(args: {
  db: AppDatabase;
  orderId: string;
  paymentId: string;
  transactionId: string;
  amountKrw: number;
  tokenAmount: number;
}): Promise<boolean> {
  const { db, orderId, paymentId, transactionId, amountKrw, tokenAmount } = args;
  const now = new Date().toISOString();
  const referenceId = `portone:${paymentId}`;
  const results = await db.batch([
    db.prepare("SELECT pg_advisory_xact_lock(?)").bind(advisoryKey(referenceId)),
    db.prepare(
      `UPDATE payment_orders
       SET status = 'processing', transaction_id = ?
       WHERE id = ? AND payment_id = ? AND provider = 'portone'
         AND status IN ('pending', 'failed', 'cancelled')
         AND amount_krw = ? AND token_amount = ?`,
    ).bind(transactionId, orderId, paymentId, amountKrw, tokenAmount),
    db.prepare(
      `UPDATE token_wallets w
       SET balance = w.balance + p.token_amount,
           lifetime_purchased = w.lifetime_purchased + p.token_amount,
           updated_at = ?
       FROM payment_orders p
       WHERE p.id = ? AND p.status = 'processing' AND w.user_id = p.user_id`,
    ).bind(now, orderId),
    db.prepare(
      `INSERT INTO token_transactions
        (id, user_id, kind, amount, balance_after, reference_id, description, metadata_json, created_at)
       SELECT ?, p.user_id, 'topup', p.token_amount, w.balance, ?, ?, ?, ?
       FROM payment_orders p
       JOIN token_wallets w ON w.user_id = p.user_id
       WHERE p.id = ? AND p.status = 'processing'
       ON CONFLICT(reference_id) DO NOTHING`,
    ).bind(
      crypto.randomUUID(),
      referenceId,
      `${amountKrw.toLocaleString("ko-KR")}원 토큰 충전`,
      JSON.stringify({ orderId, paymentId, transactionId, amountKrw }),
      now,
      orderId,
    ),
    db.prepare(
      `UPDATE payment_orders SET status = 'completed', transaction_id = ?, completed_at = ?
       WHERE id = ? AND status = 'processing'`,
    ).bind(transactionId, now, orderId),
  ]);
  return (results[4]?.meta.changes ?? 0) > 0;
}
