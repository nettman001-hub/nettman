import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("central auth blocks suspended and revoked sessions without guest fallback", async () => {
  const source = await readFile(new URL("app/_lib/auth-user.ts", root), "utf8");

  assert.match(source, /claims\.session_id/);
  assert.match(source, /INSERT INTO user_auth_sessions/);
  assert.match(source, /ON CONFLICT\(user_id, session_id\)/);
  assert.match(source, /record\.revoked_at/);
  assert.match(source, /activeSuspension\(record\.status, record\.suspended_until\)/);
  assert.match(source, /NODE_ENV === "production"[\s\S]*account_store_unavailable/);
  assert.match(
    source,
    /getRequestUser[\s\S]*userOrThrow\(await persistAndResolveUser\(identity\.user\)\)/,
  );
  const requestResolver = source.slice(
    source.indexOf("export async function getRequestUser"),
    source.indexOf("export async function resolveRequestUser"),
  );
  assert.ok(requestResolver.indexOf("userOrThrow") < requestResolver.indexOf("localDemoIfAllowed"));
  assert.match(requestResolver, /identity\.kind === "unavailable"[\s\S]*throw new AuthUserAccessError/);
  assert.match(source, /export async function getRequestUserResponse/);
  assert.match(source, /export async function resolveRequestUserResponse/);
  assert.match(
    source,
    /error instanceof AuthUserAccessError[\s\S]*authUserAccessErrorResponse\(error\)/,
  );
});

test("existing API routes map central account-access failures without guest fallback", async () => {
  const routePaths = [
    "app/api/admin/ai-settings/models/route.ts",
    "app/api/admin/ai-settings/route.ts",
    "app/api/ai-settings/models/route.ts",
    "app/api/ai-settings/route.ts",
    "app/api/consultations/[id]/route.ts",
    "app/api/consultations/route.ts",
    "app/api/exports/[id]/word/route.ts",
    "app/api/notifications/complete/route.ts",
    "app/api/preferences/route.ts",
    "app/api/profile/route.ts",
    "app/api/sermon-resources/route.ts",
    "app/api/sermons/[id]/route.ts",
    "app/api/sermons/generate/route.ts",
    "app/api/sermons/normalize-scripture/route.ts",
    "app/api/sermons/revise/route.ts",
    "app/api/sermons/route.ts",
    "app/api/tokens/checkout/route.ts",
    "app/api/tokens/complete/route.ts",
    "app/api/tokens/route.ts",
  ];
  for (const routePath of routePaths) {
    const source = await readFile(new URL(routePath, root), "utf8");
    assert.doesNotMatch(
      source,
      /await\s+(?:getRequestUser|resolveRequestUser)\s*\(/,
      `${routePath} must not call a throwing resolver directly`,
    );
    assert.match(
      source,
      /(?:getRequestUserResponse|resolveRequestUserResponse)\s*\(/,
      `${routePath} must use the HTTP response adapter`,
    );
  }
});

test("Supabase admin helper is server configured and only returns allowlisted auth fields", async () => {
  const source = await readFile(new URL("app/_lib/supabase/admin.ts", root), "utf8");

  assert.match(source, /process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(source, /autoRefreshToken: false/);
  assert.match(source, /persistSession: false/);
  assert.match(source, /detectSessionInUrl: false/);
  assert.match(source, /export async function getAdminAuthUserInfo/);
  assert.match(source, /export async function sendAdminPasswordReset/);
  assert.match(source, /export async function resendAdminVerification/);
  assert.match(source, /export async function setAdminAuthSuspension/);
  assert.match(source, /ban_duration: duration/);
  assert.match(source, /client\.auth\.admin\.signOut\(targetAccessToken, "global"\)/);
  assert.doesNotMatch(source, /user_metadata|app_metadata|identities/);
  assert.doesNotMatch(source, /console\.(?:log|error|warn)/);
});

test("member admin guard separates email admin authority and app session revocation", async () => {
  const source = await readFile(new URL("app/_lib/admin-member-auth.ts", root), "utf8");

  assert.match(source, /if \(!user\.isAdmin\)/);
  assert.doesNotMatch(source, /user\.role === "expert"/);
  assert.match(source, /export async function revokeKnownUserSessions/);
  assert.match(source, /UPDATE user_auth_sessions/);
  assert.match(source, /revoked_at = \?, revoked_by = \?/);
  assert.match(source, /WHERE user_id = \? AND revoked_at IS NULL/);
  assert.match(source, /appRevoked: true/);
});
