import { ensureDatabase, getD1 } from "../../../../../db";
import { createSermonDocx } from "../../../../_lib/docx";
import { demoSermons, safeJson, type SermonRecord, type SermonSections } from "../../../../_lib/data";
import { getRequestUser, unauthorizedResponse } from "../../../../_lib/auth-user";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getRequestUser(request);
  if (!user) return unauthorizedResponse();
  const { id } = await context.params;
  const db = getD1();
  let sermon: SermonRecord | undefined;
  if (!db) {
    sermon = demoSermons.find((item) => item.id === id) ?? demoSermons[0];
  } else {
    await ensureDatabase(db);
    const row = await db.prepare(`SELECT id, title, scripture, sermon_type, audience, audience_situation, point_count, duration, emotion, body_json, created_at, updated_at
      FROM sermons WHERE id = ? AND user_id = ? AND deleted_at IS NULL`).bind(id, user.id).first<Record<string, string | number>>();
    if (row) sermon = {
      id: String(row.id), title: String(row.title), scripture: String(row.scripture), sermonType: String(row.sermon_type),
      audience: String(row.audience), audienceSituation: String(row.audience_situation || "일반"), pointCount: Number(row.point_count), duration: Number(row.duration), emotion: String(row.emotion),
      sections: safeJson<SermonSections>(String(row.body_json), { introduction: "", body: [], conclusion: "", application: "" }),
      createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    };
  }
  if (!sermon) return Response.json({ error: "설교를 찾을 수 없습니다." }, { status: 404 });
  const file = createSermonDocx(sermon);
  const date = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()).replaceAll(". ", "-").replace(".", "");
  const safeTitle = sermon.title.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, "_").slice(0, 60);
  const filename = `설교_${safeTitle}_${date}.docx`;
  return new Response(Uint8Array.from(file).buffer, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "cache-control": "private, no-store",
    },
  });
}
