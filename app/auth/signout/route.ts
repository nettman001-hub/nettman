import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { safeReturnPath } from "@/app/_lib/auth-user";
import {
  AUTH_SESSION_MODE_COOKIE,
  LEGACY_DEVICE_SESSION_COOKIE,
  getSiteOrigin,
} from "@/app/_lib/supabase/config";
import { createSupabaseServerClient } from "@/app/_lib/supabase/server";

export async function POST(request: Request) {
  const requestOrigin = new URL(request.url).origin;
  const submittedOrigin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  const allowedOrigins = new Set([requestOrigin, getSiteOrigin(request.url)]);
  if (!submittedOrigin || !allowedOrigins.has(submittedOrigin) || (fetchSite && fetchSite !== "same-origin")) {
    return Response.json({ error: "허용되지 않은 로그아웃 요청입니다." }, { status: 403 });
  }

  const formData = await request.formData().catch(() => null);
  const returnToValue = formData?.get("return_to");
  const returnTo = safeReturnPath(typeof returnToValue === "string" ? returnToValue : "/");
  const supabase = await createSupabaseServerClient();
  if (supabase) await supabase.auth.signOut({ scope: "local" });

  const cookieStore = await cookies();
  const secure = getSiteOrigin(request.url).startsWith("https://");
  for (const name of [AUTH_SESSION_MODE_COOKIE, LEGACY_DEVICE_SESSION_COOKIE]) {
    cookieStore.set(name, "", {
      secure,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
      ...(name === LEGACY_DEVICE_SESSION_COOKIE ? { httpOnly: true } : {}),
    });
  }

  const response = NextResponse.redirect(new URL(returnTo, getSiteOrigin(request.url)), 303);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
