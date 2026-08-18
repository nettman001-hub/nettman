import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  AUTH_SESSION_MODE_COOKIE,
  LEGACY_DEVICE_SESSION_COOKIE,
  getSupabasePublicConfig,
} from "./config";

const VALID_SESSION_MODES = new Set(["session", "persistent"]);

export async function updateSupabaseSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const config = getSupabasePublicConfig();

  response.cookies.set(LEGACY_DEVICE_SESSION_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  if (!config) return response;

  const supabase = createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, responseHeaders) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
        Object.entries(responseHeaders ?? {}).forEach(([key, value]) => {
          response.headers.set(key, value);
        });
        response.cookies.set(LEGACY_DEVICE_SESSION_COOKIE, "", {
          httpOnly: true,
          secure: true,
          sameSite: "lax",
          path: "/",
          maxAge: 0,
        });
      },
    },
  });

  // This validation must immediately follow client creation so refresh cookies
  // stay synchronized between the request, Server Components, and the browser.
  const { data } = await supabase.auth.getClaims();
  const mode = request.cookies.get(AUTH_SESSION_MODE_COOKIE)?.value;
  if (data?.claims && (!mode || !VALID_SESSION_MODES.has(mode))) {
    await supabase.auth.signOut({ scope: "local" });
    response.cookies.set(AUTH_SESSION_MODE_COOKIE, "", {
      secure: request.nextUrl.protocol === "https:",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
  }
  return response;
}
