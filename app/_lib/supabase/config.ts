export const AUTH_SESSION_MODE_COOKIE = "sermon-guide-session-mode";
export const AUTH_SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
export const LEGACY_DEVICE_SESSION_COOKIE = "__Host-sermon-guide-device";

export type SupabasePublicConfig = {
  url: string;
  publishableKey: string;
};

function usableEnvironmentValue(value: string | undefined): string | null {
  const normalized = value?.trim();
  if (!normalized || normalized === "[SENSITIVE]" || normalized === "undefined") {
    return null;
  }
  return normalized;
}

export function getSupabasePublicConfig(): SupabasePublicConfig | null {
  const url = usableEnvironmentValue(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const publishableKey =
    usableEnvironmentValue(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) ??
    usableEnvironmentValue(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  if (!url || !publishableKey) return null;

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") return null;
  } catch {
    return null;
  }
  return { url: url.replace(/\/$/, ""), publishableKey };
}

export function hasSupabasePublicConfig(): boolean {
  return getSupabasePublicConfig() !== null;
}

export function getSiteOrigin(requestUrl?: string): string {
  const configured = usableEnvironmentValue(process.env.NEXT_PUBLIC_SITE_URL);
  const productionHost = usableEnvironmentValue(
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
  );
  const candidates = [
    requestUrl,
    configured,
    productionHost ? `https://${productionHost}` : null,
    "http://localhost:3000",
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      return new URL(candidate).origin;
    } catch {
      // Try the next trusted fallback.
    }
  }
  return "http://localhost:3000";
}
