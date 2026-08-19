import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

test("admin member mutations require bounded same-origin audited requests", async () => {
  const [actions, authRoute, paymentRoute] = await Promise.all([
    source("app/_lib/admin-actions.ts"),
    source("app/api/admin/members/[id]/auth/route.ts"),
    source("app/api/admin/members/[id]/payments/[paymentId]/reverify/route.ts"),
  ]);

  assert.match(actions, /requireAdminMember\(request\)/);
  assert.match(actions, /sec-fetch-site/);
  assert.match(actions, /request\.body\.getReader\(\)/);
  assert.match(actions, /received > maxBytes/);
  assert.match(actions, /claimAdminAuditRequest/);
  assert.match(actions, /pg_advisory_xact_lock/);
  assert.match(actions, /ON CONFLICT\(request_id\) DO NOTHING/);

  for (const route of [authRoute, paymentRoute]) {
    const claim = route.indexOf("const claim = await claimAdminAuditRequest");
    const sideEffect = Math.max(
      route.indexOf("await confirmPortOneOrder"),
      route.indexOf("await sendAdminPasswordReset"),
    );
    assert.ok(claim >= 0 && sideEffect > claim);
    assert.match(route, /requestId/);
    assert.match(route, /reason/);
  }
});

test("free token adjustments atomically connect wallet, ledger, adjustment, and audit", async () => {
  const route = await source("app/api/admin/members/[id]/tokens/route.ts");

  assert.match(route, /WITH adjusted AS/);
  assert.match(route, /transaction_insert AS/);
  assert.match(route, /adjustment_insert AS/);
  assert.match(route, /audit_insert AS/);
  assert.match(route, /FROM transaction_insert[\s\S]*INNER JOIN adjustment_insert/);
  assert.match(route, /pg_advisory_xact_lock/);
  assert.match(route, /existing\.user_id !== userId/);
  assert.match(route, /existing\.actor_user_id !== auth\.user\.id/);
  assert.match(route, /existing\.reason !== reason/);
  assert.match(route, /admin_adjustment/);
  assert.doesNotMatch(route, /lifetime_purchased\s*=/);
});

test("role and status changes only audit rows returned by the guarded mutation", async () => {
  const [route, consultation] = await Promise.all([
    source("app/api/admin/members/[id]/route.ts"),
    source("app/api/consultations/[id]/route.ts"),
  ]);

  assert.match(route, /WITH changed AS/);
  assert.match(route, /FROM changed[\s\S]*RETURNING id/);
  assert.match(route, /member-role:\$\{id\}/);
  assert.match(route, /status IN \('assigned', 'in_progress'\)/);
  assert.match(route, /setAdminAuthSuspension/);
  assert.match(route, /revokeKnownUserSessions/);
  assert.match(route, /row\.actor_user_id === input\.actorUserId/);
  assert.match(route, /row\.reason === input\.reason/);
  assert.match(route, /row\.after_json === input\.afterJson/);
  assert.match(route, /withDatabaseAdvisoryLock/);
  assert.match(route, /member-status:\$\{userId\}/);
  assert.match(route, /integer\(latest\.version\) === expected\.version[\s\S]*latest\.status === expected\.status[\s\S]*latest\.suspended_until/);
  assert.match(route, /current\.suspended_until \?\? null\) === suspendedUntil[\s\S]*current\.status_reason === reason/);
  assert.match(route, /expected\.version/);
  assert.match(consultation, /member-role:\$\{user\.id\}/);
  const memberAuth = await source("app/_lib/admin-member-auth.ts");
  assert.match(memberAuth, /users\.status = 'suspended'/);
  assert.match(memberAuth, /users\.version = \?/);
  assert.match(consultation, /users\.role = 'expert'/);
  assert.match(consultation, /users\.status = 'suspended'/);
});

test("member administration schema and RLS bootstrap include sensitive tables", async () => {
  const [schema, runtimeDb, migration, secureTables, portone] = await Promise.all([
    source("db/schema.ts"),
    source("db/index.ts"),
    source("drizzle/0013_mysterious_purple_man.sql"),
    source("scripts/secure-supabase-tables.mjs"),
    source("app/_lib/portone-payments.ts"),
  ]);

  for (const table of [
    "user_auth_sessions",
    "admin_audit_logs",
    "token_adjustments",
  ]) {
    assert.match(schema, new RegExp(table));
    assert.match(runtimeDb, new RegExp(`"${table}"`));
    assert.match(migration, new RegExp(table));
    assert.match(secureTables, new RegExp(`"${table}"`));
  }
  assert.match(schema, /admin_adjustment/);
  assert.match(schema, /version: integer\("version"\)/);
  assert.doesNotMatch(portone, /\(\? IS NULL OR user_id = \?\)/);
});
