import { ensureDatabase, getD1 } from "../../../../db";
import { demoSermons, safeJson, type SermonSections } from "../../../_lib/data";
import {
  resolveRequestUser,
  serviceUnavailableResponse,
  unauthorizedResponse,
} from "../../../_lib/auth-user";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const expertDemo = new URL(request.url).searchParams.get("scope") === "expert";
  const user = await resolveRequestUser(request, {
    demoRole: expertDemo ? "expert" : "preacher",
  });
  if (!user) return unauthorizedResponse();
  const { id } = await context.params;
  const db = getD1();

  if (!db) {
    if (!user.isDemo) return serviceUnavailableResponse();
    const sermon = demoSermons.find((item) => item.id === id);
    if (!sermon) return Response.json({ error: "설교를 찾을 수 없습니다." }, { status: 404 });
    if (user.role === "expert" && id !== "demo-sermon-1" && id !== "demo-sermon-2") {
      return Response.json({ error: "설교를 찾을 수 없습니다." }, { status: 404 });
    }
    return Response.json({ item: sermon, demo: true });
  }

  await ensureDatabase(db);
  const ownershipClause =
    user.role === "expert"
      ? `EXISTS (
          SELECT 1 FROM consultations c
          WHERE c.sermon_id = s.id AND c.expert_id = ?
            AND c.status IN ('assigned', 'in_progress', 'completed')
        )`
      : "s.user_id = ?";
  const row = await db
    .prepare(
      `SELECT s.id, s.title, s.scripture, s.sermon_type, s.audience,
          s.point_count, s.duration, s.emotion, s.body_json,
          s.created_at, s.updated_at
       FROM sermons s
       WHERE s.id = ? AND s.deleted_at IS NULL AND ${ownershipClause}`,
    )
    .bind(id, user.id)
    .first<Record<string, string | number>>();

  if (!row) return Response.json({ error: "설교를 찾을 수 없습니다." }, { status: 404 });
  return Response.json({
    item: {
      id: row.id,
      title: row.title,
      scripture: row.scripture,
      sermonType: row.sermon_type,
      audience: row.audience,
      pointCount: row.point_count,
      duration: row.duration,
      emotion: row.emotion,
      sections: safeJson<SermonSections>(String(row.body_json), {
        introduction: "",
        body: [],
        conclusion: "",
        application: "",
      }),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
  });
}
