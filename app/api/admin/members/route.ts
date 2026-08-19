import { adminJson, requireAdminRequest } from "@/app/_lib/admin-actions";
import { ensureDatabase, getD1 } from "@/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

function positiveInteger(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function integer(value: unknown): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

export async function GET(request: Request): Promise<Response> {
  const auth = await requireAdminRequest(request);
  if ("response" in auth) return auth.response;
  const db = getD1();
  if (!db) return adminJson({ error: "회원 저장소에 연결할 수 없습니다." }, 503);

  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  const role = url.searchParams.get("role");
  const status = url.searchParams.get("status");
  const denomination = (url.searchParams.get("denomination") ?? "").trim().slice(0, 40);
  const profile = url.searchParams.get("profile");
  const page = Math.min(10_000, positiveInteger(url.searchParams.get("page"), 1));
  const sort = url.searchParams.get("sort") ?? "registered_desc";
  const now = new Date().toISOString();
  const newMemberCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1_000).toISOString();

  const clauses: string[] = [];
  const bindings: unknown[] = [];
  if (query) {
    clauses.push(`(
      lower(u.email) LIKE ? OR lower(u.name) LIKE ? OR
      lower(COALESCE(p.display_name, '')) LIKE ? OR
      lower(COALESCE(p.church, '')) LIKE ?
    )`);
    const pattern = `%${query.toLowerCase()}%`;
    bindings.push(pattern, pattern, pattern, pattern);
  }
  if (role === "preacher" || role === "expert") {
    clauses.push("u.role = ?");
    bindings.push(role);
  }
  if (status === "suspended") {
    clauses.push("u.status = 'suspended' AND (u.suspended_until IS NULL OR u.suspended_until > ?)");
    bindings.push(now);
  } else if (status === "active") {
    clauses.push("NOT (u.status = 'suspended' AND (u.suspended_until IS NULL OR u.suspended_until > ?))");
    bindings.push(now);
  }
  if (denomination) {
    clauses.push("p.denomination = ?");
    bindings.push(denomination);
  }
  const completeProfile = `(
    COALESCE(p.display_name, '') <> '' AND COALESCE(p.ministry_role, '') <> '' AND
    COALESCE(p.denomination, '') <> '' AND COALESCE(p.theology, '') <> '' AND
    COALESCE(p.church, '') <> '' AND COALESCE(p.phone, '') <> ''
  )`;
  if (profile === "complete") clauses.push(completeProfile);
  if (profile === "incomplete") clauses.push(`NOT ${completeProfile}`);

  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const orderBy = {
    registered_desc: "u.created_at DESC, u.id DESC",
    activity_desc: "COALESCE(u.last_seen_at, u.created_at) DESC, u.id DESC",
    tokens_desc: "COALESCE(w.balance, 0) DESC, u.id DESC",
    name_asc: "lower(COALESCE(p.display_name, u.name)) ASC, u.id ASC",
  }[sort] ?? "u.created_at DESC, u.id DESC";

  try {
    await ensureDatabase(db);
    const [summaryResult, totalResult, membersResult] = await Promise.all([
      db.prepare(
        `SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN u.status = 'suspended' AND (u.suspended_until IS NULL OR u.suspended_until > ?) THEN 1 ELSE 0 END) AS suspended,
          SUM(CASE WHEN NOT (u.status = 'suspended' AND (u.suspended_until IS NULL OR u.suspended_until > ?)) THEN 1 ELSE 0 END) AS active,
          SUM(CASE WHEN u.role = 'preacher' THEN 1 ELSE 0 END) AS preachers,
          SUM(CASE WHEN u.role = 'expert' THEN 1 ELSE 0 END) AS experts,
          SUM(CASE WHEN u.created_at >= ? THEN 1 ELSE 0 END) AS new_30_days
         FROM users u`,
      ).bind(now, now, newMemberCutoff).first<Record<string, unknown>>(),
      db.prepare(
        `SELECT COUNT(*) AS count
         FROM users u
         LEFT JOIN user_profiles p ON p.user_id = u.id
         LEFT JOIN token_wallets w ON w.user_id = u.id
         ${where}`,
      ).bind(...bindings).first<{ count: number }>(),
      db.prepare(
        `SELECT
          u.id, u.email, u.name, u.role, u.status, u.status_reason,
          u.suspended_until, u.created_at, u.last_seen_at, u.version,
          COALESCE(p.display_name, u.name) AS display_name,
          COALESCE(p.ministry_role, '') AS ministry_role,
          COALESCE(p.denomination, '') AS denomination,
          COALESCE(p.theology, '') AS theology,
          COALESCE(p.church, '') AS church,
          CASE WHEN ${completeProfile} THEN 1 ELSE 0 END AS profile_complete,
          COALESCE(w.balance, 0) AS token_balance,
          COALESCE(w.lifetime_purchased, 0) AS lifetime_purchased,
          COALESCE(w.lifetime_spent, 0) AS lifetime_spent,
          (SELECT COUNT(*) FROM sermons s WHERE s.user_id = u.id AND s.deleted_at IS NULL) AS sermon_count,
          (SELECT COUNT(*) FROM consultations c WHERE c.user_id = u.id) AS consultation_count,
          (SELECT COUNT(*) FROM consultations c WHERE c.expert_id = u.id) AS expert_consultation_count
         FROM users u
         LEFT JOIN user_profiles p ON p.user_id = u.id
         LEFT JOIN token_wallets w ON w.user_id = u.id
         ${where}
         ORDER BY ${orderBy}
         LIMIT ? OFFSET ?`,
      ).bind(...bindings, PAGE_SIZE, (page - 1) * PAGE_SIZE).all<Record<string, unknown>>(),
    ]);

    const total = integer(totalResult?.count);
    const summary = summaryResult ?? {};
    return adminJson({
      summary: {
        total: integer(summary.total),
        active: integer(summary.active),
        suspended: integer(summary.suspended),
        preachers: integer(summary.preachers),
        experts: integer(summary.experts),
        new30Days: integer(summary.new_30_days),
      },
      members: membersResult.results.map((row) => {
        const effectiveStatus =
          row.status === "suspended" &&
          (!row.suspended_until || text(row.suspended_until) > now)
            ? "suspended"
            : "active";
        return {
          id: text(row.id),
          email: text(row.email),
          displayName: text(row.display_name),
          role: row.role === "expert" ? "expert" : "preacher",
          status: effectiveStatus,
          statusReason: text(row.status_reason),
          suspendedUntil: row.suspended_until ? text(row.suspended_until) : null,
          serviceRegisteredAt: text(row.created_at),
          lastSeenAt: row.last_seen_at ? text(row.last_seen_at) : null,
          version: integer(row.version),
          ministryRole: text(row.ministry_role),
          denomination: text(row.denomination),
          theology: text(row.theology),
          church: text(row.church),
          profileComplete: integer(row.profile_complete) === 1,
          tokenBalance: integer(row.token_balance),
          lifetimePurchased: integer(row.lifetime_purchased),
          lifetimeSpent: integer(row.lifetime_spent),
          sermonCount: integer(row.sermon_count),
          consultationCount: integer(row.consultation_count),
          expertConsultationCount: integer(row.expert_consultation_count),
        };
      }),
      pagination: {
        page,
        pageSize: PAGE_SIZE,
        total,
        totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      },
    });
  } catch (error) {
    console.error("[admin-members] list failed", error instanceof Error ? error.message : "unknown");
    return adminJson({ error: "회원 목록을 불러오지 못했습니다." }, 503);
  }
}
