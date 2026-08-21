import { ensureDatabase, getD1 } from "../../../db";
import { demoSermons, safeJson, type SermonRecord, type SermonSections } from "../../_lib/data";
import { getRequestUserResponse, unauthorizedResponse } from "../../_lib/auth-user";
import { isSermonAudienceSituationValue } from "../../_lib/sermon-types";

type SermonRow = {
  id: string; title: string; scripture: string; sermon_type: string;
  audience: string; audience_situation: string; point_count: number; duration: number; emotion: string;
  body_json: string; authorship_mode: "pastor_assisted" | "ai_generated";
  created_at: string; updated_at: string;
};

function fromRow(row: SermonRow): SermonRecord {
  return {
    id: row.id,
    title: row.title,
    scripture: row.scripture,
    sermonType: row.sermon_type,
    audience: row.audience,
    audienceSituation: row.audience_situation || "일반",
    pointCount: row.point_count,
    duration: row.duration,
    emotion: row.emotion,
    sections: safeJson<SermonSections>(row.body_json, { introduction: "", body: [], conclusion: "", application: "" }),
    authorshipMode: row.authorship_mode,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function GET(request: Request) {
  const auth = await getRequestUserResponse(request);
  if ("response" in auth) return auth.response;
  const { user } = auth;
  if (!user) return unauthorizedResponse();
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim();
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
  const limit = 10;
  const offset = (page - 1) * limit;
  const db = getD1();

  if (!db) {
    const filtered = demoSermons.filter((sermon) =>
      !query || `${sermon.title} ${sermon.scripture}`.toLowerCase().includes(query.toLowerCase()),
    );
    return Response.json({
      items: filtered.slice(offset, offset + limit).map((sermon) => ({
        ...sermon,
        passage: sermon.scripture,
        status: "complete" as const,
      })),
      total: filtered.length,
      page,
      limit,
      demo: true,
    });
  }

  await ensureDatabase(db);
  const pattern = `%${query}%`;
  const where = query ? "AND (s.title LIKE ? OR s.scripture LIKE ? OR s.created_at LIKE ?)" : "";
  const selectColumns = `SELECT s.id, s.title, s.scripture, s.sermon_type, s.audience,
      s.audience_situation, s.point_count, s.duration, s.emotion, s.body_json,
      CASE WHEN EXISTS (
        SELECT 1 FROM sermon_helper_projects helper
         WHERE helper.completed_sermon_id = s.id AND helper.user_id = s.user_id
           AND helper.status = 'completed'
      ) THEN 'pastor_assisted' ELSE 'ai_generated' END AS authorship_mode,
      s.created_at, s.updated_at
    FROM sermons s`;
  const listStatement = query
    ? db.prepare(`${selectColumns} WHERE s.user_id = ? AND s.deleted_at IS NULL ${where} ORDER BY s.created_at DESC LIMIT ? OFFSET ?`).bind(user.id, pattern, pattern, pattern, limit, offset)
    : db.prepare(`${selectColumns} WHERE s.user_id = ? AND s.deleted_at IS NULL ORDER BY s.created_at DESC LIMIT ? OFFSET ?`).bind(user.id, limit, offset);
  const countStatement = query
    ? db.prepare(`SELECT COUNT(*) AS count FROM sermons s WHERE s.user_id = ? AND s.deleted_at IS NULL ${where}`).bind(user.id, pattern, pattern, pattern)
    : db.prepare("SELECT COUNT(*) AS count FROM sermons s WHERE s.user_id = ? AND s.deleted_at IS NULL").bind(user.id);
  const [rows, count] = await Promise.all([listStatement.all<SermonRow>(), countStatement.first<{ count: number }>()]);
  return Response.json({
    items: rows.results.map(fromRow).map((sermon) => ({
      ...sermon,
      passage: sermon.scripture,
      status: "complete" as const,
    })),
    total: count?.count ?? 0,
    page,
    limit,
  });
}

export async function POST(request: Request) {
  const auth = await getRequestUserResponse(request);
  if ("response" in auth) return auth.response;
  const { user } = auth;
  if (!user) return unauthorizedResponse();
  const payload = await request.json().catch(() => null) as Partial<SermonRecord> & { draftId?: string } | null;
  if (!payload?.title || !payload.scripture || !payload.sections || payload.title.trim().length < 2) {
    return Response.json({ error: "제목, 본문, 설교 내용을 확인해 주세요." }, { status: 400 });
  }
  const audienceSituation = typeof payload.audienceSituation === "string"
    ? payload.audienceSituation.trim()
    : "일반";
  if (!isSermonAudienceSituationValue(audienceSituation)) {
    return Response.json({ error: "청중 상황을 확인해 주세요." }, { status: 400 });
  }
  const now = new Date().toISOString();
  const id = payload.id || crypto.randomUUID();
  const sermon: SermonRecord = {
    id,
    title: payload.title.trim(),
    scripture: payload.scripture.trim(),
    sermonType: payload.sermonType || "강해",
    audience: payload.audience || "청장년",
    audienceSituation,
    pointCount: Math.min(4, Math.max(1, payload.pointCount || 3)),
    duration: Math.min(40, Math.max(5, payload.duration || 20)),
    emotion: payload.emotion || "따뜻함",
    sections: payload.sections,
    authorshipMode: "ai_generated",
    createdAt: payload.createdAt || now,
    updatedAt: now,
  };
  const db = getD1();
  if (!db) return Response.json({ item: sermon, demo: true }, { status: 201 });

  await ensureDatabase(db);
  const existing = payload.draftId
    ? await db.prepare("SELECT id, user_id FROM sermons WHERE draft_id = ?").bind(payload.draftId).first<{ id: string; user_id: string }>()
    : await db.prepare("SELECT id, user_id FROM sermons WHERE id = ?").bind(id).first<{ id: string; user_id: string }>();
  if (existing && existing.user_id !== user.id) {
    return Response.json({ error: "다른 계정의 설교에는 접근할 수 없습니다." }, { status: 403 });
  }
  await db.batch([
    db.prepare("INSERT INTO users (id, email, name, role, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET email = excluded.email, name = excluded.name").bind(user.id, user.email, user.name, user.role, now),
    db.prepare(`INSERT INTO sermons (id, user_id, draft_id, title, scripture, sermon_type, audience, audience_situation, point_count, duration, emotion, body_json, created_at, updated_at, deleted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      ON CONFLICT(draft_id) DO UPDATE SET title=excluded.title, scripture=excluded.scripture, sermon_type=excluded.sermon_type, audience=excluded.audience, audience_situation=excluded.audience_situation, point_count=excluded.point_count, duration=excluded.duration, emotion=excluded.emotion, body_json=excluded.body_json, updated_at=excluded.updated_at`).bind(
        id, user.id, payload.draftId ?? null, sermon.title, sermon.scripture, sermon.sermonType,
        sermon.audience, sermon.audienceSituation, sermon.pointCount, sermon.duration, sermon.emotion,
        JSON.stringify(sermon.sections), sermon.createdAt, sermon.updatedAt,
      ),
  ]);
  const saved = payload.draftId
    ? await db.prepare("SELECT id, created_at, updated_at FROM sermons WHERE draft_id = ? AND user_id = ?").bind(payload.draftId, user.id).first<{ id: string; created_at: string; updated_at: string }>()
    : await db.prepare("SELECT id, created_at, updated_at FROM sermons WHERE id = ? AND user_id = ?").bind(id, user.id).first<{ id: string; created_at: string; updated_at: string }>();
  if (!saved) return Response.json({ error: "저장 결과를 확인하지 못했습니다." }, { status: 503 });
  return Response.json({ item: { ...sermon, id: saved.id, createdAt: saved.created_at, updatedAt: saved.updated_at } }, { status: existing ? 200 : 201 });
}
