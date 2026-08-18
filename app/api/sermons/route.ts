import { ensureDatabase, getD1 } from "../../../db";
import { demoSermons, safeJson, type SermonRecord, type SermonSections } from "../../_lib/data";
import { getRequestUser, unauthorizedResponse } from "../../_lib/auth-user";

type SermonRow = {
  id: string; title: string; scripture: string; sermon_type: string;
  audience: string; point_count: number; duration: number; emotion: string;
  body_json: string; created_at: string; updated_at: string;
};

function fromRow(row: SermonRow): SermonRecord {
  return {
    id: row.id,
    title: row.title,
    scripture: row.scripture,
    sermonType: row.sermon_type,
    audience: row.audience,
    pointCount: row.point_count,
    duration: row.duration,
    emotion: row.emotion,
    sections: safeJson<SermonSections>(row.body_json, { introduction: "", body: [], conclusion: "", application: "" }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function GET(request: Request) {
  const user = await getRequestUser(request);
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
  const where = query ? "AND (title LIKE ? OR scripture LIKE ? OR created_at LIKE ?)" : "";
  const listStatement = query
    ? db.prepare(`SELECT id, title, scripture, sermon_type, audience, point_count, duration, emotion, body_json, created_at, updated_at FROM sermons WHERE user_id = ? AND deleted_at IS NULL ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).bind(user.id, pattern, pattern, pattern, limit, offset)
    : db.prepare("SELECT id, title, scripture, sermon_type, audience, point_count, duration, emotion, body_json, created_at, updated_at FROM sermons WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT ? OFFSET ?").bind(user.id, limit, offset);
  const countStatement = query
    ? db.prepare(`SELECT COUNT(*) AS count FROM sermons WHERE user_id = ? AND deleted_at IS NULL ${where}`).bind(user.id, pattern, pattern, pattern)
    : db.prepare("SELECT COUNT(*) AS count FROM sermons WHERE user_id = ? AND deleted_at IS NULL").bind(user.id);
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
  const user = await getRequestUser(request);
  if (!user) return unauthorizedResponse();
  const payload = await request.json().catch(() => null) as Partial<SermonRecord> & { draftId?: string } | null;
  if (!payload?.title || !payload.scripture || !payload.sections || payload.title.trim().length < 2) {
    return Response.json({ error: "제목, 본문, 설교 내용을 확인해 주세요." }, { status: 400 });
  }
  const now = new Date().toISOString();
  const id = payload.id || crypto.randomUUID();
  const sermon: SermonRecord = {
    id,
    title: payload.title.trim(),
    scripture: payload.scripture.trim(),
    sermonType: payload.sermonType || "강해",
    audience: payload.audience || "청장년",
    pointCount: Math.min(4, Math.max(1, payload.pointCount || 3)),
    duration: Math.min(40, Math.max(5, payload.duration || 20)),
    emotion: payload.emotion || "따뜻함",
    sections: payload.sections,
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
    db.prepare(`INSERT INTO sermons (id, user_id, draft_id, title, scripture, sermon_type, audience, point_count, duration, emotion, body_json, created_at, updated_at, deleted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      ON CONFLICT(draft_id) DO UPDATE SET title=excluded.title, scripture=excluded.scripture, sermon_type=excluded.sermon_type, audience=excluded.audience, point_count=excluded.point_count, duration=excluded.duration, emotion=excluded.emotion, body_json=excluded.body_json, updated_at=excluded.updated_at`).bind(
        id, user.id, payload.draftId ?? null, sermon.title, sermon.scripture, sermon.sermonType,
        sermon.audience, sermon.pointCount, sermon.duration, sermon.emotion,
        JSON.stringify(sermon.sections), sermon.createdAt, sermon.updatedAt,
      ),
  ]);
  const saved = payload.draftId
    ? await db.prepare("SELECT id, created_at, updated_at FROM sermons WHERE draft_id = ? AND user_id = ?").bind(payload.draftId, user.id).first<{ id: string; created_at: string; updated_at: string }>()
    : await db.prepare("SELECT id, created_at, updated_at FROM sermons WHERE id = ? AND user_id = ?").bind(id, user.id).first<{ id: string; created_at: string; updated_at: string }>();
  if (!saved) return Response.json({ error: "저장 결과를 확인하지 못했습니다." }, { status: 503 });
  return Response.json({ item: { ...sermon, id: saved.id, createdAt: saved.created_at, updatedAt: saved.updated_at } }, { status: existing ? 200 : 201 });
}
