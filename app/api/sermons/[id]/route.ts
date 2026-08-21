import { ensureDatabase, getD1 } from "../../../../db";
import { demoSermons, safeJson, type SermonSections } from "../../../_lib/data";
import {
  resolveRequestUserResponse,
  serviceUnavailableResponse,
  unauthorizedResponse,
} from "../../../_lib/auth-user";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const expertDemo = new URL(request.url).searchParams.get("scope") === "expert";
  const auth = await resolveRequestUserResponse(request, {
    demoRole: expertDemo ? "expert" : "preacher",
  });
  if ("response" in auth) return auth.response;
  const { user } = auth;
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
      `SELECT s.id, s.draft_id, s.title, s.scripture, s.sermon_type, s.audience, s.audience_situation,
          s.point_count, s.duration, s.emotion, s.body_json,
          CASE WHEN EXISTS (
            SELECT 1 FROM sermon_helper_projects helper
             WHERE helper.completed_sermon_id = s.id AND helper.user_id = s.user_id
               AND helper.status = 'completed'
          ) THEN 'pastor_assisted' ELSE 'ai_generated' END AS authorship_mode,
          s.created_at, s.updated_at
       FROM sermons s
       WHERE s.id = ? AND s.deleted_at IS NULL AND ${ownershipClause}`,
    )
    .bind(id, user.id)
    .first<Record<string, string | number>>();

  if (!row) return Response.json({ error: "설교를 찾을 수 없습니다." }, { status: 404 });

  // Owners also receive the five drafts generated alongside this sermon so the
  // detail view can list the unchosen ones. Experts reviewing via consultations
  // only see the saved manuscript, and the draft join re-checks ownership.
  let alternatives: Array<{
    id: string;
    position: number;
    title: string;
    scripture: string;
    selected: boolean;
    sections: SermonSections;
  }> = [];
  if (user.role !== "expert" && row.draft_id) {
    const draftRows = await db
      .prepare(
        `SELECT a.id, a.position, a.title, a.scripture, a.body_json,
                d.selected_alternative_id
         FROM sermon_alternatives a
         INNER JOIN sermon_drafts d ON d.id = a.draft_id AND d.user_id = ?
         WHERE a.draft_id = ?
         ORDER BY a.position ASC`,
      )
      .bind(user.id, row.draft_id)
      .all<{
        id: string;
        position: number;
        title: string;
        scripture: string;
        body_json: string;
        selected_alternative_id: string | null;
      }>();
    alternatives = draftRows.results.map((draft) => {
      const sections = safeJson<{
        introduction: string;
        points: Array<{ heading: string; content: string }>;
        conclusion: string;
        application: string;
      }>(String(draft.body_json), {
        introduction: "",
        points: [],
        conclusion: "",
        application: "",
      });
      return {
        id: draft.id,
        position: Number(draft.position),
        title: draft.title,
        scripture: draft.scripture,
        selected: draft.selected_alternative_id === draft.id,
        sections: {
          introduction: sections.introduction,
          body: Array.isArray(sections.points) ? sections.points : [],
          conclusion: sections.conclusion,
          application: sections.application,
        },
      };
    });
  }

  return Response.json({
    alternatives,
    item: {
      id: row.id,
      title: row.title,
      scripture: row.scripture,
      sermonType: row.sermon_type,
      audience: row.audience,
      audienceSituation: row.audience_situation || "일반",
      pointCount: row.point_count,
      duration: row.duration,
      emotion: row.emotion,
      sections: safeJson<SermonSections>(String(row.body_json), {
        introduction: "",
        body: [],
        conclusion: "",
        application: "",
      }),
      authorshipMode: row.authorship_mode,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
  });
}
