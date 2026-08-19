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

test("server auth and database waits have bounded deadlines", async () => {
  const [
    timedFetch,
    server,
    supabaseProxy,
    rootProxy,
    authUser,
    database,
    securityScript,
  ] = await Promise.all([
    readFile(new URL("app/_lib/supabase/timed-fetch.ts", root), "utf8"),
    readFile(new URL("app/_lib/supabase/server.ts", root), "utf8"),
    readFile(new URL("app/_lib/supabase/proxy.ts", root), "utf8"),
    readFile(new URL("proxy.ts", root), "utf8"),
    readFile(new URL("app/_lib/auth-user.ts", root), "utf8"),
    readFile(new URL("db/index.ts", root), "utf8"),
    readFile(new URL("scripts/secure-supabase-tables.mjs", root), "utf8"),
  ]);

  assert.match(timedFetch, /SUPABASE_FETCH_TIMEOUT_MS = 12_000/);
  assert.match(timedFetch, /AbortSignal\.timeout\(SUPABASE_FETCH_TIMEOUT_MS\)/);
  assert.match(timedFetch, /AbortSignal\.any\(\[callerSignal, deadline\]\)/);
  assert.match(timedFetch, /input instanceof Request \? input\.signal/);
  assert.match(server, /global: \{ fetch: timedSupabaseFetch \}/);
  assert.match(supabaseProxy, /global: \{ fetch: timedSupabaseFetch \}/);
  assert.match(supabaseProxy, /catch \{[\s\S]*let the page or API authorization fail closed/);
  assert.ok(rootProxy.includes("api(?:/|$)"));
  assert.match(authUser, /async function hasValidSessionMode/);
  assert.match(authUser, /mode === "session" \|\| mode === "persistent"/);
  assert.match(
    authUser,
    /if \(!\(await hasValidSessionMode\(\)\)\)[\s\S]*return \{ kind: "anonymous" \};[\s\S]*supabase\.auth\.getClaims\(\)/,
  );
  assert.match(securityScript, /SET LOCAL statement_timeout = '30s'/);
  assert.match(securityScript, /SET LOCAL lock_timeout = '5s'/);
  assert.match(
    securityScript,
    /SET LOCAL idle_in_transaction_session_timeout = '45s'/,
  );
  assert.doesNotMatch(database, /connection:\s*\{[\s\S]*statement_timeout/);
  assert.match(database, /DATABASE_QUERY_TIMEOUT_MS = 15_000/);
  assert.match(database, /if \(settled\) return/);
  assert.match(database, /Promise\.resolve\(query\.cancel\(\)\)\.catch\(\(\) => undefined\)/);
  assert.match(database, /finally \{[\s\S]*settled = true;[\s\S]*clearTimeout\(deadline\)/);
  assert.equal(
    [...database.matchAll(/executeWithDatabaseDeadline\(/g)].length,
    3,
    "the shared deadline must wrap direct and transactional postgres queries",
  );
  assert.match(database, /set_config\('statement_timeout', '15s', true\)/);
  assert.match(database, /set_config\('lock_timeout', '5s', true\)/);
  assert.match(
    database,
    /set_config\('idle_in_transaction_session_timeout', \$1, true\)/,
  );
  assert.equal(
    [...database.matchAll(/applyTransactionDeadlines\(executeInTransaction, "30s"\)/g)]
      .length,
    1,
    "ordinary batches must install transaction-local 30 second idle limits",
  );
  assert.equal(
    [...database.matchAll(/applyTransactionDeadlines\(executeInTransaction, "60s"\)/g)]
      .length,
    1,
    "advisory-lock operations must allow the bounded external request window",
  );
  assert.doesNotMatch(database, /SET LOCAL/);

  for (const [table, column] of [
    ["users", "status"],
    ["users", "version"],
    ["user_auth_sessions", "session_id"],
    ["admin_audit_logs", "request_id"],
    ["token_adjustments", "idempotency_key"],
    ["user_profiles", "denomination"],
    ["user_profiles", "theology"],
    ["user_profiles", "phone"],
    ["global_ai_settings", "api_key_encrypted"],
    ["global_ai_settings", "max_output_tokens"],
    ["sermon_drafts", "active_generation_id"],
    ["sermon_drafts", "audience_situation"],
    ["sermons", "audience_situation"],
    ["sermon_resource_usage", "active_request_id"],
  ]) {
    assert.ok(
      database.includes(`["${table}", "${column}"]`),
      `schema readiness must include ${table}.${column}`,
    );
  }
  for (const indexName of [
    "idx_user_auth_sessions_user_session",
    "idx_admin_audit_logs_request",
    "idx_token_transactions_reference",
    "idx_token_adjustments_idempotency",
    "idx_token_adjustments_transaction",
  ]) {
    assert.ok(
      database.includes(`"${indexName}"`),
      `schema readiness must include unique index ${indexName}`,
    );
  }
  assert.match(database, /protected_table\.relrowsecurity/);
  assert.match(database, /index_metadata\.indisunique/);
  assert.match(database, /index_metadata\.indisvalid/);
  assert.match(database, /index_metadata\.indisready/);
  assert.match(
    database,
    /Number\(row\?\.rls_table_count[\s\S]*protectedTableNames\.length/,
  );
  assert.match(
    database,
    /Number\(row\?\.unique_index_count[\s\S]*requiredUniqueIndexNames\.length/,
  );
  const initialization = database.slice(database.indexOf("export async function ensureDatabase"));
  const readiness = initialization.indexOf("if (await hasCurrentDatabaseSchema(db))");
  const ddlBootstrap = initialization.indexOf("await db.batch([");
  assert.ok(readiness >= 0 && ddlBootstrap > readiness, "schema readiness must precede DDL bootstrap");
  assert.match(
    initialization.slice(readiness, ddlBootstrap),
    /schemaReady = true;[\s\S]*return;/,
  );
});
