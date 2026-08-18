import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { safeReturnPath } from "@/app/_lib/auth-user";
import {
  AUTH_SESSION_MAX_AGE_SECONDS,
  AUTH_SESSION_MODE_COOKIE,
  LEGACY_DEVICE_SESSION_COOKIE,
  getSiteOrigin,
} from "@/app/_lib/supabase/config";
import { createSupabaseServerClient } from "@/app/_lib/supabase/server";

function redirectResponse(request: Request, path: string) {
  const response = NextResponse.redirect(new URL(path, getSiteOrigin(request.url)), 303);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const flow = url.searchParams.get("flow");
  const next = safeReturnPath(url.searchParams.get("next") ?? "/home");
  const supabase = await createSupabaseServerClient();
  if (!code || !supabase) return redirectResponse(request, "/login?error=callback");

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return redirectResponse(request, "/login?error=callback");

  const cookieStore = await cookies();
  const secure = getSiteOrigin(request.url).startsWith("https://");
  cookieStore.set(LEGACY_DEVICE_SESSION_COOKIE, "", {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });

  if (flow === "signup") {
    await supabase.auth.signOut({ scope: "local" });
    cookieStore.set(AUTH_SESSION_MODE_COOKIE, "", {
      secure,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
    return redirectResponse(request, "/login?verified=1");
  }

  const persistent = flow === "oauth" && url.searchParams.get("remember") !== "0";
  cookieStore.set(AUTH_SESSION_MODE_COOKIE, persistent ? "persistent" : "session", {
    secure,
    sameSite: "lax",
    path: "/",
    ...(persistent ? { maxAge: AUTH_SESSION_MAX_AGE_SECONDS } : {}),
  });
  return redirectResponse(request, next);
}
