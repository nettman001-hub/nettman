import { ensureDatabase, getD1 } from "../../../db";
import { demoConsultations, type ConsultationRecord } from "../../_lib/data";
import {
  forbiddenResponse,
  resolveRequestUserResponse,
  serviceUnavailableResponse,
  unauthorizedResponse,
} from "../../_lib/auth-user";

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
