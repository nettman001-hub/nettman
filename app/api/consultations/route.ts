import { ensureDatabase, getD1 } from "../../../db";
import { demoConsultations, type ConsultationRecord } from "../../_lib/data";
import {
  forbiddenResponse,
  resolveRequestUserResponse,
  serviceUnavailableResponse,
  unauthorizedResponse,
} from "../../_lib/auth-user";
import { getSiteOrigin } from "../../_lib/supabase/config";

type ConsultationRow = Record<string, string | number | null>;

const demoWaitingConsultation: ConsultationRecord = {
  id: "demo-consult-waiting",
  sermonId: "demo-sermon-2",
  sermonTitle: "광야에서도 길을 내시는 하나님",
  reason: "결론의 복음적 초점과 청중에게 건네는 적용 질문을 함께 점검하고 싶습니다.",
  status: "waiting",
  expertName: null,
  queuePosition: 1,
  createdAt: "2026-08-07T03:10:00.000Z",
  updatedAt: "2026-08-07T03:10:00.000Z",
};

function toConsultation(row: ConsultationRow) {
  return {
    id: String(row.id),
    sermonId: String(row.sermon_id),
    sermonTitle: String(row.sermon_title ?? "설교 피드백"),
    reason: String(row.reason),
    status: String(row.status),
    expertName: row.expert_name ? String(row.expert_name) : null,
    requesterName: row.requester_name ? String(row.requester_name) : null,
    queuePosition: Number(row.queue_position ?? 0),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function wantsExpertDemo(request: Request): boolean {
  return new URL(request.url).searchParams.get("scope") === "expert";
}

const MAX_DELETE_COUNT = 50;
const MAX_DELETE_REQUEST_BYTES = 8_192;

function sameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();
  if (!origin || (fetchSite && fetchSite !== "same-origin")) return false;
  try {
    const allowed = new Set([
      new URL(request.url).origin,
      getSiteOrigin(request.url),
    ]);
    return allowed.has(new URL(origin).origin);
  } catch {
    return false;
  }
}

async function readDeleteIds(request: Request): Promise<string[]> {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    throw new TypeError("content type");
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_DELETE_REQUEST_BYTES) {
    throw new RangeError("request too large");
  }
  const payload = JSON.parse(raw) as { ids?: unknown };
  if (!Array.isArray(payload.ids) || payload.ids.length < 1 || payload.ids.length > MAX_DELETE_COUNT) {
    throw new SyntaxError("invalid ids");
  }
  const ids = [...new Set(payload.ids.map((value) =>
    typeof value === "string" ? value.trim() : "",
  ))];
  if (
    ids.length < 1 ||
    ids.some((id) =>
      id.length > 120 ||
      Array.from(id).some((character) => {
        const code = character.charCodeAt(0);
        return code <= 31 || code === 127;
      }),
    )
  ) {
    throw new SyntaxError("invalid ids");
  }
  return ids;
}

export async function GET(request: Request) {
  const auth = await resolveRequestUserResponse(request, {
    demoRole: wantsExpertDemo(request) ? "expert" : "preacher",
  });
  if ("response" in auth) return auth.response;
  const { user } = auth;
  if (!user) return unauthorizedResponse();

  const db = getD1();
  if (!db) {
    if (!user.isDemo) return serviceUnavailableResponse();
    const items =
      user.role === "expert"
        ? [demoWaitingConsultation, ...demoConsultations]
        : demoConsultations;
    return Response.json({ items, demo: true });
  }

  await ensureDatabase(db);
  const select = `SELECT c.id, c.sermon_id, s.title AS sermon_title, c.reason,
      c.status, c.queue_position, c.created_at, c.updated_at,
      COALESCE(expert_profile.display_name, expert.name) AS expert_name,
      COALESCE(requester_profile.display_name, requester.name) AS requester_name
    FROM consultations c
    INNER JOIN sermons s ON s.id = c.sermon_id AND s.deleted_at IS NULL
    LEFT JOIN users expert ON expert.id = c.expert_id
    LEFT JOIN user_profiles expert_profile ON expert_profile.user_id = expert.id
    LEFT JOIN users requester ON requester.id = c.user_id
    LEFT JOIN user_profiles requester_profile ON requester_profile.user_id = requester.id`;

  const rows =
    user.role === "expert"
      ? await db
          .prepare(
            `${select}
             WHERE (c.status = 'waiting' AND c.expert_id IS NULL) OR c.expert_id = ?
             ORDER BY CASE c.status WHEN 'waiting' THEN 0 WHEN 'assigned' THEN 1
               WHEN 'in_progress' THEN 2 ELSE 3 END, c.updated_at DESC`,
          )
          .bind(user.id)
          .all<ConsultationRow>()
      : await db
          .prepare(`${select} WHERE c.user_id = ? ORDER BY c.updated_at DESC`)
          .bind(user.id)
          .all<ConsultationRow>();

  return Response.json({ items: rows.results.map(toConsultation) });
}

export async function POST(request: Request) {
  const auth = await resolveRequestUserResponse(request);
  if ("response" in auth) return auth.response;
  const { user } = auth;
  if (!user) return unauthorizedResponse();
  if (user.role !== "preacher") {
    return forbiddenResponse("설교 피드백 요청은 설교자 계정에서 만들 수 있습니다.");
  }

  const payload = (await request.json().catch(() => null)) as {
    sermonId?: string;
    reason?: string;
  } | null;
  const sermonId = payload?.sermonId?.trim();
  const reason = payload?.reason?.trim();
  if (!sermonId || !reason || reason.length < 10 || reason.length > 2000) {
    return Response.json(
      { error: "피드백받을 설교와 10~2,000자의 요청 사유를 입력해 주세요." },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();
  const item = {
    id: crypto.randomUUID(),
    sermonId,
    sermonTitle: "선택한 설교",
    reason,
    status: "waiting" as const,
    expertName: null,
    queuePosition: 1,
    createdAt: now,
    updatedAt: now,
  };

  const db = getD1();
  if (!db) {
    if (!user.isDemo) return serviceUnavailableResponse();
    return Response.json({ item, demo: true }, { status: 201 });
  }

  await ensureDatabase(db);
  const sermon = await db
    .prepare(
      "SELECT id, title FROM sermons WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
    )
    .bind(sermonId, user.id)
    .first<{ id: string; title: string }>();
  if (!sermon) {
    return Response.json({ error: "피드백받을 설교를 찾을 수 없습니다." }, { status: 404 });
  }

  const existing = await db
    .prepare("SELECT id FROM consultations WHERE sermon_id = ? AND user_id = ?")
    .bind(sermonId, user.id)
    .first<{ id: string }>();
  if (existing) {
    return Response.json(
      { error: "이 설교에는 이미 피드백 요청이 있습니다.", consultationId: existing.id },
      { status: 409 },
    );
  }

  const waiting = await db
    .prepare("SELECT COUNT(*) AS count FROM consultations WHERE status = 'waiting'")
    .first<{ count: number }>();
  item.queuePosition = Number(waiting?.count ?? 0) + 1;
  item.sermonTitle = sermon.title;

  await db
    .prepare(
      `INSERT INTO consultations
       (id, sermon_id, user_id, expert_id, reason, status, queue_position, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, 'waiting', ?, ?, ?)`,
    )
    .bind(item.id, sermonId, user.id, reason, item.queuePosition, now, now)
    .run();

  return Response.json({ item }, { status: 201 });
}

export async function DELETE(request: Request) {
  if (!sameOriginRequest(request)) {
    return Response.json({ error: "허용되지 않은 요청입니다." }, { status: 403 });
  }

  let ids: string[];
  try {
    ids = await readDeleteIds(request);
  } catch (error) {
    if (error instanceof TypeError) {
      return Response.json({ error: "JSON 형식으로 요청해 주세요." }, { status: 415 });
    }
    if (error instanceof RangeError) {
      return Response.json({ error: "한 번에 삭제할 수 있는 요청 크기를 초과했습니다." }, { status: 413 });
    }
    return Response.json(
      { error: `삭제할 피드백을 1~${MAX_DELETE_COUNT}개 선택해 주세요.` },
      { status: 400 },
    );
  }

  const auth = await resolveRequestUserResponse(request);
  if ("response" in auth) return auth.response;
  const { user } = auth;
  if (!user) return unauthorizedResponse();
  if (user.role !== "preacher") {
    return forbiddenResponse("본인이 요청한 피드백만 삭제할 수 있습니다.");
  }

  const db = getD1();
  if (!db) {
    if (!user.isDemo) return serviceUnavailableResponse();
    return Response.json({ deletedIds: ids, demo: true });
  }

  await ensureDatabase(db);
  const placeholders = ids.map(() => "?").join(", ");
  const ownedRows = await db
    .prepare(
      `SELECT id FROM consultations
       WHERE user_id = ? AND id IN (${placeholders})`,
    )
    .bind(user.id, ...ids)
    .all<{ id: string }>();
  const ownedIds = ownedRows.results.map((row) => String(row.id));
  if (ownedIds.length === 0) return Response.json({ deletedIds: [] });

  const ownedPlaceholders = ownedIds.map(() => "?").join(", ");
  await db.batch([
    db.prepare(
      `DELETE FROM consultation_messages
       WHERE consultation_id IN (${ownedPlaceholders})`,
    ).bind(...ownedIds),
    db.prepare(
      `DELETE FROM consultations
       WHERE user_id = ? AND id IN (${ownedPlaceholders})`,
    ).bind(user.id, ...ownedIds),
  ]);

  return Response.json({ deletedIds: ownedIds });
}
