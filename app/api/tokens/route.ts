import { resolveRequestUserResponse, unauthorizedResponse } from "@/app/_lib/auth-user";
import {
  ensureTokenWallet,
  getTokenWallet,
  TOKENS_PER_1000_KRW,
  TOPUP_PRESETS_KRW,
  SERMON_TOKEN_COSTS,
  tokenBillingConfigured,
  WELCOME_TOKEN_GRANT,
} from "@/app/_lib/token-wallet";
import { ensureDatabase, getD1 } from "@/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const auth = await resolveRequestUserResponse(request);
  if ("response" in auth) return auth.response;
  const { user } = auth;
  if (!user) return unauthorizedResponse();
  const db = getD1();
  if (!db && user.isDemo) {
    const now = new Date().toISOString();
    return Response.json({
      wallet: { balance: WELCOME_TOKEN_GRANT, lifetimePurchased: 0, lifetimeSpent: 0 },
      history: [{
        id: "demo-welcome",
        kind: "welcome",
        amount: WELCOME_TOKEN_GRANT,
        balanceAfter: WELCOME_TOKEN_GRANT,
        description: "가입 축하 기본 토큰",
        createdAt: now,
      }],
      pricing: {
        welcomeGrant: WELCOME_TOKEN_GRANT,
        tokensPer1000Krw: TOKENS_PER_1000_KRW,
        topupPresetsKrw: TOPUP_PRESETS_KRW,
        sermonCosts: SERMON_TOKEN_COSTS,
      },
      checkoutConfigured: false,
    });
  }
  if (!db) {
    return Response.json({ error: "토큰 지갑 저장소에 연결할 수 없습니다." }, { status: 503 });
  }

  try {
    await ensureDatabase(db);
    // Central auth already ensured the wallet for authenticated users in this
    // request, so a read is enough. Demo users skip persistence and keep the
    // ensure path.
    const wallet = user.isDemo
      ? await ensureTokenWallet(db, user.id)
      : await getTokenWallet(db, user.id);
    const history = await db
      .prepare(
        `SELECT id, kind, amount, balance_after, description, created_at
         FROM token_transactions
         WHERE user_id = ?
         ORDER BY created_at DESC
         LIMIT 30`,
      )
      .bind(user.id)
      .all<{
        id: string;
        kind: string;
        amount: number;
        balance_after: number;
        description: string;
        created_at: string;
      }>();

    return Response.json(
      {
        wallet,
        history: history.results.map((row) => ({
          id: row.id,
          kind: row.kind,
          amount: Number(row.amount),
          balanceAfter: Number(row.balance_after),
          description: row.description,
          createdAt: row.created_at,
        })),
        pricing: {
          welcomeGrant: WELCOME_TOKEN_GRANT,
          tokensPer1000Krw: TOKENS_PER_1000_KRW,
          topupPresetsKrw: TOPUP_PRESETS_KRW,
          sermonCosts: SERMON_TOKEN_COSTS,
        },
        checkoutConfigured: tokenBillingConfigured(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json({ error: "토큰 지갑을 불러오지 못했습니다." }, { status: 503 });
  }
}
