import { createHmac, timingSafeEqual } from "node:crypto";
import type { AiEngineTier } from "./ai-engine-tiers.ts";

const GRANT_VERSION = 2;
const GRANT_TTL_MS = 24 * 60 * 60 * 1_000;
const MAX_GRANT_CHARACTERS = 4_096;

type ScriptureNormalizationGrantClaims = {
  version: typeof GRANT_VERSION;
  subject: string;
  draftId: string;
  aiTier: AiEngineTier;
  scripture: string;
  expiresAt: number;
};

function configuredSecret(providerApiKey?: string): string | null {
  const candidates = [
    process.env.SCRIPTURE_NORMALIZATION_SECRET,
    process.env.AI_SETTINGS_ENCRYPTION_KEY,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    providerApiKey,
  ];
  return candidates
    .map((value) => value?.trim() ?? "")
    .find((value) => value.length >= 32) ?? null;
}

export function scriptureNormalizationGrantConfigured(
  providerApiKey?: string,
): boolean {
  return configuredSecret(providerApiKey) !== null;
}

function signature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function isGrantClaims(value: unknown): value is ScriptureNormalizationGrantClaims {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const claims = value as Partial<ScriptureNormalizationGrantClaims>;
  return Boolean(
    claims.version === GRANT_VERSION &&
      typeof claims.subject === "string" &&
      claims.subject.length >= 1 &&
      claims.subject.length <= 200 &&
      typeof claims.draftId === "string" &&
      claims.draftId.length >= 8 &&
      claims.draftId.length <= 100 &&
      (claims.aiTier === "basic" ||
        claims.aiTier === "advanced" ||
        claims.aiTier === "reasoning") &&
      typeof claims.scripture === "string" &&
      claims.scripture.length >= 2 &&
      claims.scripture.length <= 120 &&
      typeof claims.expiresAt === "number" &&
      Number.isSafeInteger(claims.expiresAt),
  );
}

export function createScriptureNormalizationGrant(args: {
  subject: string;
  draftId: string;
  aiTier: AiEngineTier;
  scripture: string;
  providerApiKey?: string;
  now?: number;
}): { token: string; expiresAt: string } | null {
  const secret = configuredSecret(args.providerApiKey);
  if (!secret) return null;
  const expiresAt = (args.now ?? Date.now()) + GRANT_TTL_MS;
  const claims: ScriptureNormalizationGrantClaims = {
    version: GRANT_VERSION,
    subject: args.subject,
    draftId: args.draftId,
    aiTier: args.aiTier,
    scripture: args.scripture,
    expiresAt,
  };
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  return {
    token: `${payload}.${signature(payload, secret)}`,
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

export function verifyScriptureNormalizationGrant(args: {
  token: string;
  subject: string;
  draftId: string;
  aiTier: AiEngineTier;
  scripture: string;
  providerApiKey?: string;
  now?: number;
}): boolean {
  if (!args.token || args.token.length > MAX_GRANT_CHARACTERS) return false;
  const secret = configuredSecret(args.providerApiKey);
  if (!secret) return false;
  const parts = args.token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return false;
  const expected = Buffer.from(signature(parts[0], secret), "utf8");
  const candidate = Buffer.from(parts[1], "utf8");
  if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) {
    return false;
  }
  try {
    const claims = JSON.parse(
      Buffer.from(parts[0], "base64url").toString("utf8"),
    ) as unknown;
    if (!isGrantClaims(claims)) return false;
    return (
      claims.subject === args.subject &&
      claims.draftId === args.draftId &&
      claims.aiTier === args.aiTier &&
      claims.scripture === args.scripture &&
      claims.expiresAt > (args.now ?? Date.now())
    );
  } catch {
    return false;
  }
}
