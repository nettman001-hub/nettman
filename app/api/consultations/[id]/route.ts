import { ensureDatabase, getD1 } from "../../../../db";
import { stableAdvisoryLockKey } from "../../../_lib/admin-actions";
import { demoConsultations, type ConsultationRecord } from "../../../_lib/data";
import {
  forbiddenResponse,
  resolveRequestUserResponse,
  serviceUnavailableResponse,
  unauthorizedResponse,
} from "../../../_lib/auth-user";

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

const demoMessages = [
  {
    id: "m1",
    senderRole: "preacher",
    body: "설교 문안의 본론 흐름을 살펴봐 주실 수 있을까요?",
    section: "본론",
    createdAt: "2026-08-04T02:20:00.000Z",
  },
  {
    id: "m2",
    senderRole: "expert",
    body: "첫째 대지와 둘째 대지 사이에 본문 5절의 연결 문장을 더하면 흐름이 자연스럽겠습니다.",
    section: "본론",
    createdAt: "2026-08-05T08:30:00.000Z",
  },
];

function wantsExpertDemo(request: Request): boolean {
  return new URL(request.url).searchParams.get("scope") === "expert";
}

function localConsultation(id: string): ConsultationRecord | null {
  if (id === demoWaitingConsultation.id) return demoWaitingConsultation;
  return demoConsultations.find((item) => item.id === id) ?? null;
}

function serializeConsultation(row: ConsultationRow) {
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

async function findAccessibleConsultation(
  db: D1Database,
  id: string,
  user: { id: string; role: "preacher" | "expert" },
): Promise<ConsultationRow | null> {
  const select = `SELECT c.*, s.title AS sermon_title,
      COALESCE(expert_profile.display_name, expert.name) AS expert_name,
      COALESCE(requester_profile.display_name, requester.name) AS requester_name
    FROM consultations c
    INNER JOIN sermons s ON s.id = c.sermon_id AND s.deleted_at IS NULL
    LEFT JOIN users expert ON expert.id = c.expert_id
    LEFT JOIN user_profiles expert_profile ON expert_profile.user_id = expert.id
    LEFT JOIN users requester ON requester.id = c.user_id
    LEFT JOIN user_profiles requester_profile ON requester_profile.user_id = requester.id`;

  if (user.role === "expert") {
    return db
      .prepare(
        `${select}
         WHERE c.id = ? AND ((c.status = 'waiting' AND c.expert_id IS NULL) OR c.expert_id = ?)`,
      )
      .bind(id, user.id)
      .first<ConsultationRow>();
  }
  return db
    .prepare(`${select} WHERE c.id = ? AND c.user_id = ?`)
    .bind(id, user.id)
    .first<ConsultationRow>();
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await resolveRequestUserResponse(request, {
    demoRole: wantsExpertDemo(request) ? "expert" : "preacher",
  });
  if ("response" in auth) return auth.response;
  const { user } = auth;
  if (!user) return unauthorizedResponse();
  const { id } = await context.params;
  const db = getD1();

  if (!db) {
    if (!user.isDemo) return serviceUnavailableResponse();
    const item = localConsultation(id);
    if (!item) return Response.json({ error: "피드백을 찾을 수 없습니다." }, { status: 404 });
    return Response.json({
      item: {
        ...item,
        requesterName: "이은찬 전도사",
        expertName: item.status === "waiting" ? null : "김선우 목회코치",
      },
      messages: item.status === "waiting" ? [] : demoMessages,
      demo: true,
    });
  }

  await ensureDatabase(db);
  const consultation = await findAccessibleConsultation(db, id, user);
  if (!consultation) {
    return Response.json({ error: "피드백을 찾을 수 없습니다." }, { status: 404 });
  }

  const messages = await db
    .prepare(
      `SELECT id, sender_role, body, section, created_at
       FROM consultation_messages WHERE consultation_id = ? ORDER BY created_at ASC`,
    )
    .bind(id)
    .all<Record<string, string | null>>();

  return Response.json({
    item: serializeConsultation(consultation),
    messages: messages.results.map((row) => ({
      id: String(row.id),
      senderRole: String(row.sender_role),
      body: String(row.body),
      section: row.section,
      createdAt: String(row.created_at),
    })),
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const expertDemo = wantsExpertDemo(request);
  const auth = await resolveRequestUserResponse(request, {
    demoRole: expertDemo ? "expert" : "preacher",
  });
  if ("response" in auth) return auth.response;
  const { user } = auth;
  if (!user) return unauthorizedResponse();
  const { id } = await context.params;
  const payload = (await request.json().catch(() => null)) as {
    body?: string;
    section?: string;
    action?: "assign" | "complete";
  } | null;
  if (!payload) {
    return Response.json({ error: "요청 내용을 확인해 주세요." }, { status: 400 });
  }

  const db = getD1();
  const now = new Date().toISOString();
  if (!db && !user.isDemo) return serviceUnavailableResponse();

  if (payload.action === "assign") {
    if (user.role !== "expert") {
      return forbiddenResponse("전문가 계정만 대기 중인 피드백을 맡을 수 있습니다.");
    }
    if (!db) {
      if (id !== demoWaitingConsultation.id) {
        return Response.json({ error: "대기 중인 피드백을 찾을 수 없습니다." }, { status: 404 });
      }
      return Response.json({ status: "assigned", expertName: user.name, demo: true });
    }

    await ensureDatabase(db);
    const assignment = await db.batch([
      db.prepare("SELECT pg_advisory_xact_lock(?)").bind(
        stableAdvisoryLockKey(`member-role:${user.id}`),
      ),
      db.prepare(
        `UPDATE consultations SET expert_id = ?, status = 'assigned', updated_at = ?
         WHERE id = ? AND status = 'waiting' AND expert_id IS NULL
           AND EXISTS (
             SELECT 1 FROM users
             WHERE users.id = ? AND users.role = 'expert'
               AND NOT (
                 users.status = 'suspended' AND
                 (users.suspended_until IS NULL OR users.suspended_until > ?)
               )
           )`,
      ).bind(user.id, now, id, user.id, now),
    ]);
    const result = assignment[1];
    if (Number(result.meta.changes ?? 0) < 1) {
      const own = await db
        .prepare("SELECT status FROM consultations WHERE id = ? AND expert_id = ?")
        .bind(id, user.id)
        .first<{ status: string }>();
      if (own) return Response.json({ status: own.status, expertName: user.name });
      return Response.json(
        { error: "이미 다른 전문가가 맡았거나 대기 상태가 아닌 피드백입니다." },
        { status: 409 },
      );
    }
    return Response.json({ status: "assigned", expertName: user.name });
  }

  if (payload.action === "complete") {
    if (user.role !== "expert") {
      return forbiddenResponse("배정된 전문가만 피드백을 완료할 수 있습니다.");
    }
    if (!db) {
      const item = localConsultation(id);
      if (!item || item.status === "waiting") {
        return Response.json({ error: "배정된 피드백을 찾을 수 없습니다." }, { status: 404 });
      }
      return Response.json({ status: "completed", demo: true });
    }

    await ensureDatabase(db);
    const result = await db
      .prepare(
        `UPDATE consultations SET status = 'completed', updated_at = ?
         WHERE id = ? AND expert_id = ? AND status IN ('assigned', 'in_progress')`,
      )
      .bind(now, id, user.id)
      .run();
    if (Number(result.meta.changes ?? 0) < 1) {
      const own = await db
        .prepare("SELECT status FROM consultations WHERE id = ? AND expert_id = ?")
        .bind(id, user.id)
        .first<{ status: string }>();
      if (own?.status === "completed") return Response.json({ status: "completed" });
      return Response.json({ error: "완료할 수 있는 피드백을 찾을 수 없습니다." }, { status: 404 });
    }
    return Response.json({ status: "completed" });
  }

  const body = payload.body?.trim();
  if (!body || body.length > 2000) {
    return Response.json(
      { error: "메시지는 1~2,000자로 입력해 주세요." },
      { status: 400 },
    );
  }
  const section = payload.section?.trim().slice(0, 80) || null;
  const message = {
    id: crypto.randomUUID(),
    senderRole: user.role,
    body,
    section,
    createdAt: now,
  };

  if (!db) {
    const item = localConsultation(id);
    if (!item) return Response.json({ error: "피드백을 찾을 수 없습니다." }, { status: 404 });
    if (item.status === "completed") {
      return Response.json({ error: "완료된 피드백에는 메시지를 보낼 수 없습니다." }, { status: 409 });
    }
    if (item.status === "waiting") {
      return Response.json({ error: "전문가가 피드백을 맡은 뒤 메시지를 보낼 수 있습니다." }, { status: 409 });
    }
    return Response.json({ item: message, demo: true }, { status: 201 });
  }

  await ensureDatabase(db);
  const authorization =
    user.role === "expert"
      ? "c.expert_id = ?"
      : "c.user_id = ? AND c.expert_id IS NOT NULL";
  const insert = db
    .prepare(
      `INSERT INTO consultation_messages
       (id, consultation_id, sender_id, sender_role, body, section, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?
       WHERE EXISTS (
         SELECT 1 FROM consultations c
         WHERE c.id = ? AND ${authorization}
           AND c.status IN ('assigned', 'in_progress')
       )`,
    )
    .bind(
      message.id,
      id,
      user.id,
      user.role,
      body,
      section,
      now,
      id,
      user.id,
    );
  const update = db
    .prepare(
      `UPDATE consultations SET status = 'in_progress', updated_at = ?
       WHERE id = ? AND status IN ('assigned', 'in_progress')
         AND ${user.role === "expert" ? "expert_id = ?" : "user_id = ? AND expert_id IS NOT NULL"}`,
    )
    .bind(now, id, user.id);
  const results = await db.batch([insert, update]);
  if (Number(results[0]?.meta.changes ?? 0) < 1) {
    const visible = await findAccessibleConsultation(db, id, user);
    if (!visible) return Response.json({ error: "피드백을 찾을 수 없습니다." }, { status: 404 });
    if (visible.status === "completed") {
      return Response.json({ error: "완료된 피드백에는 메시지를 보낼 수 없습니다." }, { status: 409 });
    }
    return Response.json(
      { error: "전문가가 피드백을 맡은 뒤 메시지를 보낼 수 있습니다." },
      { status: 409 },
    );
  }

  return Response.json({ item: message }, { status: 201 });
}
