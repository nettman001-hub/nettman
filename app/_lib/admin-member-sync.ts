import { stableAdvisoryLockKey } from "./admin-actions";
import type { AdminAuthDirectoryUser } from "./supabase/admin";
import { withDatabaseAdvisoryLock, type getD1 } from "@/db";

type AppDatabase = NonNullable<ReturnType<typeof getD1>>;

export type AdminMemberSyncResult = {
  authTotal: number;
  synchronized: number;
  created: number;
  updated: number;
  unchanged: number;
  conflicts: number;
  skipped: number;
  idempotent: boolean;
};

type ExistingMember = { id: string; email: string };
type PriorAudit = { actor_user_id: string; action: string; after_json: string };

const SYNC_ACTION = "member.auth_directory_synced";
const SYNC_REASON = "Supabase Auth 기존 회원 목록 동기화";
const UPSERT_CHUNK_SIZE = 100;

export class AdminMemberSyncRequestConflictError extends Error {
  constructor() {
    super("이미 다른 관리자 작업에 사용된 요청 번호입니다.");
    this.name = "AdminMemberSyncRequestConflictError";
  }
}

function integer(value: unknown): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function replayResult(json: string): AdminMemberSyncResult {
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    return {
      authTotal: integer(parsed.authTotal),
      synchronized: integer(parsed.synchronized),
      created: integer(parsed.created),
      updated: integer(parsed.updated),
      unchanged: integer(parsed.unchanged),
      conflicts: integer(parsed.conflicts),
      skipped: integer(parsed.skipped),
      idempotent: true,
    };
  } catch {
    return {
      authTotal: 0,
      synchronized: 0,
      created: 0,
      updated: 0,
      unchanged: 0,
      conflicts: 0,
      skipped: 0,
      idempotent: true,
    };
  }
}

export async function readAdminAuthDirectorySyncReplay(
  db: D1Database,
  actorUserId: string,
  requestId: string,
): Promise<AdminMemberSyncResult | null> {
  const prior = await db.prepare(
    `SELECT actor_user_id, action, after_json
     FROM admin_audit_logs WHERE request_id = ? LIMIT 1`,
  ).bind(requestId).first<PriorAudit>();
  if (!prior) return null;
  if (prior.actor_user_id !== actorUserId || prior.action !== SYNC_ACTION) {
    throw new AdminMemberSyncRequestConflictError();
  }
  return replayResult(prior.after_json);
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function normalizedEmail(value: string): string {
  return value.trim().toLowerCase();
}

async function upsertMemberChunk(
  db: D1Database,
  users: AdminAuthDirectoryUser[],
  now: string,
): Promise<void> {
  if (users.length === 0) return;

  const nowTime = Date.parse(now);
  const userValues = users
    .map(() => "(?, ?, ?, 'preacher', ?, ?, ?, ?, ?, NULL)")
    .join(", ");
  const userBindings = users.flatMap((user) => {
    const suspended = Boolean(
      user.bannedUntil && Date.parse(user.bannedUntil) > nowTime,
    );
    return [
      user.id,
      user.email,
      user.name,
      suspended ? "suspended" : "active",
      suspended ? "Supabase Auth 정지 상태 동기화" : null,
      suspended ? user.bannedUntil : null,
      user.createdAt ?? now,
      now,
    ];
  });
  await db.prepare(
    `INSERT INTO users
       (id, email, name, role, status, status_reason, suspended_until,
        created_at, updated_at, last_seen_at)
     VALUES ${userValues}
     ON CONFLICT(id) DO UPDATE SET
       email = excluded.email,
       updated_at = excluded.updated_at`,
  ).bind(...userBindings).run();
}

export async function synchronizeAdminAuthDirectory(
  db: AppDatabase,
  input: {
    actorUserId: string;
    requestId: string;
    users: AdminAuthDirectoryUser[];
    authTotal: number;
    skipped: number;
  },
): Promise<AdminMemberSyncResult> {
  return withDatabaseAdvisoryLock(
    db,
    stableAdvisoryLockKey("admin-auth-directory-sync"),
    async (lockedDb) => {
      const replay = await readAdminAuthDirectorySyncReplay(
        lockedDb,
        input.actorUserId,
        input.requestId,
      );
      if (replay) return replay;

      const existing = await lockedDb.prepare(
        "SELECT id, email FROM users",
      ).all<ExistingMember>();
      const ids = new Set(existing.results.map((member) => member.id));
      const membersById = new Map(
        existing.results.map((member) => [member.id, member] as const),
      );
      const emailOwners = new Map<string, Set<string>>();
      for (const member of existing.results) {
        const email = normalizedEmail(member.email);
        const owners = emailOwners.get(email) ?? new Set<string>();
        owners.add(member.id);
        emailOwners.set(email, owners);
      }
      const syncable: AdminAuthDirectoryUser[] = [];
      let created = 0;
      let updated = 0;
      let unchanged = 0;
      let conflicts = 0;

      for (const user of input.users) {
        const email = normalizedEmail(user.email);
        const idExists = ids.has(user.id);
        const owners = emailOwners.get(email) ?? new Set<string>();
        const hasForeignEmailOwner = [...owners].some((ownerId) => ownerId !== user.id);
        if (hasForeignEmailOwner) {
          conflicts += 1;
          continue;
        }
        if (idExists) {
          const current = membersById.get(user.id);
          if (current && normalizedEmail(current.email) === email) {
            unchanged += 1;
            continue;
          }
          updated += 1;
          owners.add(user.id);
          emailOwners.set(email, owners);
        } else {
          created += 1;
          ids.add(user.id);
          owners.add(user.id);
          emailOwners.set(email, owners);
        }
        syncable.push(user);
      }

      const now = new Date().toISOString();
      for (const chunk of chunks(syncable, UPSERT_CHUNK_SIZE)) {
        await upsertMemberChunk(lockedDb, chunk, now);
      }

      const result: AdminMemberSyncResult = {
        authTotal: input.authTotal,
        synchronized: created + updated + unchanged,
        created,
        updated,
        unchanged,
        conflicts,
        skipped: input.skipped,
        idempotent: false,
      };
      await lockedDb.prepare(
        `INSERT INTO admin_audit_logs
          (id, actor_user_id, target_user_id, action, entity_type, entity_id,
           reason, before_json, after_json, request_id, created_at)
         VALUES (?, ?, NULL, ?, 'user_directory', 'supabase_auth', ?, '{}', ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        input.actorUserId,
        SYNC_ACTION,
        SYNC_REASON,
        JSON.stringify(result),
        input.requestId,
        now,
      ).run();
      return result;
    },
  );
}
