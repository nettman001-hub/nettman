import { getSiteOrigin } from "@/app/_lib/supabase/config";
import { requireAdminMember } from "@/app/_lib/admin-member-auth";
import type { AppUser } from "@/app/_lib/auth-user";
import { getD1 } from "@/db";

type AppDatabase = NonNullable<ReturnType<typeof getD1>>;

export const ADMIN_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
};

export function adminJson(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: ADMIN_NO_STORE_HEADERS,
  });
}

function sameOriginMutation(request: Request): boolean {
  if (request.method === "GET" || request.method === "HEAD") return true;
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (!origin || (fetchSite && fetchSite !== "same-origin")) return false;
  const allowed = new Set([
    new URL(request.url).origin,
    getSiteOrigin(request.url),
  ]);
  return allowed.has(origin);
}

export async function requireAdminRequest(
  request: Request,
): Promise<{ user: AppUser } | { response: Response }> {
  const auth = await requireAdminMember(request);
  if (!auth.ok) return { response: auth.response };
  if (!sameOriginMutation(request)) {
    return {
      response: adminJson({ error: "허용되지 않은 관리자 요청입니다." }, 403),
    };
  }
  return { user: auth.user };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export async function readAdminJsonBody(
  request: Request,
  maxBytes = 32_768,
): Promise<
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; response: Response }
> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    return {
      ok: false,
      response: adminJson({ error: "관리자 요청이 너무 큽니다." }, 413),
    };
  }
  let body: unknown;
  try {
    if (!request.body) throw new Error("missing body");
    const reader = request.body.getReader();
    const decoder = new TextDecoder();
    let raw = "";
    let received = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      received += chunk.value.byteLength;
      if (received > maxBytes) {
        await reader.cancel();
        return {
          ok: false,
          response: adminJson({ error: "관리자 요청이 너무 큽니다." }, 413),
        };
      }
      raw += decoder.decode(chunk.value, { stream: true });
    }
    raw += decoder.decode();
    body = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      response: adminJson({ error: "요청 형식을 확인해 주세요." }, 400),
    };
  }
  if (!isRecord(body)) {
    return {
      ok: false,
      response: adminJson({ error: "요청 형식을 확인해 주세요." }, 400),
    };
  }
  return { ok: true, value: body };
}

export function stableAdvisoryLockKey(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash | 0;
}

export function memberIdParam(value: string): string | null {
  const normalized = value.trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : null;
}

export function adminReason(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length < 5 || normalized.length > 500) return null;
  return normalized;
}

export function adminRequestId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return /^[A-Za-z0-9_-]{8,100}$/.test(normalized) ? normalized : null;
}

export function expectedMemberVersion(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function safeJson(value: unknown): string {
  return JSON.stringify(value ?? null).slice(0, 8_000);
}

export function adminAuditStatement(
  db: AppDatabase,
  input: {
    id?: string;
    actorUserId: string;
    targetUserId: string | null;
    action: string;
    entityType?: string;
    entityId?: string | null;
    reason: string;
    before?: unknown;
    after?: unknown;
    requestId: string;
    createdAt?: string;
  },
) {
  return db.prepare(
    `INSERT INTO admin_audit_logs
      (id, actor_user_id, target_user_id, action, entity_type, entity_id,
       reason, before_json, after_json, request_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    input.id ?? crypto.randomUUID(),
    input.actorUserId,
    input.targetUserId,
    input.action,
    input.entityType ?? "user",
    input.entityId ?? input.targetUserId,
    input.reason,
    safeJson(input.before),
    safeJson(input.after),
    input.requestId,
    input.createdAt ?? new Date().toISOString(),
  );
}

export async function claimAdminAuditRequest(
  db: AppDatabase,
  input: {
    actorUserId: string;
    targetUserId: string | null;
    action: string;
    entityType?: string;
    entityId?: string | null;
    reason: string;
    before?: unknown;
    after?: unknown;
    requestId: string;
  },
): Promise<"claimed" | "replay" | "conflict"> {
  const entityType = input.entityType ?? "user";
  const entityId = input.entityId ?? input.targetUserId;
  const beforeJson = safeJson(input.before);
  const afterJson = safeJson(input.after);
  const now = new Date().toISOString();
  const results = await db.batch<{ id: string }>([
    db.prepare("SELECT pg_advisory_xact_lock(?)").bind(
      stableAdvisoryLockKey(input.requestId),
    ),
    db.prepare(
      `INSERT INTO admin_audit_logs
        (id, actor_user_id, target_user_id, action, entity_type, entity_id,
         reason, before_json, after_json, request_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(request_id) DO NOTHING
       RETURNING id`,
    ).bind(
      crypto.randomUUID(),
      input.actorUserId,
      input.targetUserId,
      input.action,
      entityType,
      entityId,
      input.reason,
      beforeJson,
      afterJson,
      input.requestId,
      now,
    ),
  ]);
  if (results[1]?.results[0]?.id) return "claimed";

  const prior = await db.prepare(
    `SELECT actor_user_id, target_user_id, action, entity_type, entity_id,
            reason, before_json, after_json
     FROM admin_audit_logs WHERE request_id = ? LIMIT 1`,
  ).bind(input.requestId).first<Record<string, unknown>>();
  if (!prior) return "conflict";
  return prior.actor_user_id === input.actorUserId &&
    prior.target_user_id === input.targetUserId &&
    prior.action === input.action &&
    prior.entity_type === entityType &&
    prior.entity_id === entityId &&
    prior.reason === input.reason &&
    prior.before_json === beforeJson &&
    prior.after_json === afterJson
    ? "replay"
    : "conflict";
}
