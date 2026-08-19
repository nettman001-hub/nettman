import {
  ensureDatabase,
  finishSermonResourceUsage,
  getD1,
  reserveSermonResourceUsage,
  SERMON_RESOURCE_DAILY_LIMIT,
  type SermonResourceReservation,
} from "../../../db";
import { isAiEngineTier, type AiEngineTier } from "../../_lib/ai-engine-tiers";
import { getRequestUserResponse, unauthorizedResponse } from "../../_lib/auth-user";
import { demoSermons, safeJson, type SermonSections } from "../../_lib/data";
import { getManagedAiRequestConfig } from "../../_lib/managed-ai-engines";
import { UserAiProviderError } from "../../_lib/openai-sermons";
import {
  generateSermonResource,
  MINISTRY_OUTPUT_TYPES,
  STUDY_OPTIONS,
  type SermonResourceMode,
  type SermonResourceProfile,
  type SermonResourceSource,
} from "../../_lib/sermon-resources";

type ResourcePayload = {
  sermonId?: unknown;
  mode?: unknown;
  selections?: unknown;
  aiTier?: unknown;
};

type SermonRow = {
  title: string;
  scripture: string;
  sermon_type: string;
  audience: string;
  audience_situation: string;
  duration: number;
  emotion: string;
  body_json: string;
};

const demoActiveUsers = new Set<string>();

function isNonContentCharacter(character: string): boolean {
  const code = character.codePointAt(0) ?? 0;
  return (
    code <= 31 ||
    (code >= 127 && code <= 159) ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2060 && code <= 0x206f) ||
    code === 0xfeff
  );
}

function hasVisibleText(value: string): boolean {
  return Array.from(value).some(
    (character) => !isNonContentCharacter(character) && !/\s/u.test(character),
  );
}

function isMode(value: unknown): value is SermonResourceMode {
  return value === "study" || value === "ministry";
}

function validatedSelections(mode: SermonResourceMode, value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 12) return null;
  const allowed = new Set<string>(mode === "study" ? STUDY_OPTIONS : MINISTRY_OUTPUT_TYPES);
  const selections = [...new Set(value.filter((item): item is string => typeof item === "string"))];
  return selections.length === value.length && selections.every((item) => allowed.has(item))
    ? selections
    : null;
}

function hasSectionContent(sections: SermonSections): boolean {
  return [
    sections.introduction,
    ...sections.body.map((point) => point.content),
    sections.conclusion,
    sections.application,
  ].some(hasVisibleText);
}

function manuscript(sections: SermonSections): string {
  if (!hasSectionContent(sections)) return "";
  return [
    `도입\n${sections.introduction}`,
    ...sections.body.map((point, index) => `${index + 1}. ${point.heading}\n${point.content}`),
    `결론\n${sections.conclusion}`,
    `적용\n${sections.application}`,
  ].join("\n\n");
}

function normalizedSections(value: unknown): SermonSections {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { introduction: "", body: [], conclusion: "", application: "" };
  }
  const record = value as Record<string, unknown>;
  const body = Array.isArray(record.body)
    ? record.body.flatMap((point) => {
        if (!point || typeof point !== "object" || Array.isArray(point)) return [];
        const item = point as Record<string, unknown>;
        return [{
          heading: typeof item.heading === "string" ? item.heading : "",
          content: typeof item.content === "string" ? item.content : "",
        }];
      })
    : [];
  return {
    introduction: typeof record.introduction === "string" ? record.introduction : "",
    body,
    conclusion: typeof record.conclusion === "string" ? record.conclusion : "",
    application: typeof record.application === "string" ? record.application : "",
  };
}

function sourceFromRow(row: SermonRow): SermonResourceSource {
  const sections = normalizedSections(safeJson<unknown>(row.body_json, {
    introduction: "",
    body: [],
    conclusion: "",
    application: "",
  }));
  return {
    title: row.title,
    scripture: row.scripture,
    sermonType: row.sermon_type,
    audience: row.audience,
    audienceSituation: row.audience_situation || "일반",
    duration: Number(row.duration),
    emotion: row.emotion,
    manuscript: manuscript(sections),
  };
}

export async function POST(request: Request): Promise<Response> {
  const auth = await getRequestUserResponse(request);
  if ("response" in auth) return auth.response;
  const { user } = auth;
  if (!user) return unauthorizedResponse();

  const payload = (await request.json().catch(() => null)) as ResourcePayload | null;
  const sermonId = typeof payload?.sermonId === "string" ? payload.sermonId.trim() : "";
  if (!sermonId || sermonId.length > 100 || !isMode(payload?.mode)) {
    return Response.json({ error: "설교와 작업 종류를 확인해 주세요." }, { status: 400 });
  }
  const selections = validatedSelections(payload.mode, payload.selections);
  if (!selections) {
    return Response.json({ error: "생성할 항목을 하나 이상 선택해 주세요." }, { status: 400 });
  }
  const aiTier: AiEngineTier = isAiEngineTier(payload.aiTier) ? payload.aiTier : "basic";
  const db = getD1();

  let source: SermonResourceSource | null = null;
  let profile: SermonResourceProfile = {
    denomination: "",
    theology: "",
    ministryRole: "",
    church: "",
  };

  if (!db) {
    if (!user.isDemo) {
      return Response.json({ error: "데이터 저장소에 연결할 수 없습니다." }, { status: 503 });
    }
    const sermon = demoSermons.find((item) => item.id === sermonId);
    if (sermon) {
      source = {
        title: sermon.title,
        scripture: sermon.scripture,
        sermonType: sermon.sermonType,
        audience: sermon.audience,
        audienceSituation: sermon.audienceSituation,
        duration: sermon.duration,
        emotion: sermon.emotion,
        manuscript: manuscript(sermon.sections),
      };
    }
  } else {
    await ensureDatabase(db);
    const [sermon, profileRow] = await Promise.all([
      db.prepare(
        `SELECT title, scripture, sermon_type, audience, audience_situation, duration, emotion, body_json
         FROM sermons
         WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
      ).bind(sermonId, user.id).first<SermonRow>(),
      db.prepare(
        `SELECT denomination, theology, ministry_role, church
         FROM user_profiles WHERE user_id = ?`,
      ).bind(user.id).first<{
        denomination: string;
        theology: string;
        ministry_role: string;
        church: string;
      }>(),
    ]);
    source = sermon ? sourceFromRow(sermon) : null;
    if (profileRow) {
      profile = {
        denomination: profileRow.denomination || "",
        theology: profileRow.theology || "",
        ministryRole: profileRow.ministry_role || "",
        church: profileRow.church || "",
      };
    }
  }

  if (!source) {
    return Response.json({ error: "선택한 설교를 찾을 수 없습니다." }, { status: 404 });
  }
  if (!source.manuscript.trim()) {
    return Response.json({ error: "완성된 설교 원고를 확인할 수 없습니다." }, { status: 409 });
  }

  const ai = await getManagedAiRequestConfig(db, aiTier);
  if (!ai) {
    return Response.json(
      { error: "선택한 AI 엔진이 아직 설정되지 않았습니다. 관리자에게 문의해 주세요." },
      { status: 503 },
    );
  }

  let resourceReservation: Extract<SermonResourceReservation, { ok: true }> | null = null;
  let demoReservation = false;
  if (db) {
    let reservation: SermonResourceReservation;
    try {
      reservation = await reserveSermonResourceUsage(db, user.id);
    } catch {
      return Response.json(
        { error: "무료 사용량을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요." },
        { status: 503 },
      );
    }
    if (!reservation.ok) {
      return Response.json(
        {
          error: reservation.reason === "daily_limit"
            ? `오늘의 무료 생성 ${SERMON_RESOURCE_DAILY_LIMIT}회를 모두 사용했습니다.`
            : "이미 다른 AI 자료를 생성하고 있습니다. 완료된 뒤 다시 시도해 주세요.",
          remainingToday: reservation.remainingToday,
          dailyLimit: reservation.dailyLimit,
        },
        { status: 429 },
      );
    }
    resourceReservation = reservation;
  } else {
    if (demoActiveUsers.has(user.id)) {
      return Response.json(
        { error: "이미 다른 AI 자료를 생성하고 있습니다. 완료된 뒤 다시 시도해 주세요." },
        { status: 429 },
      );
    }
    demoActiveUsers.add(user.id);
    demoReservation = true;
  }

  let succeeded = false;
  try {
    const result = await generateSermonResource({
      ai,
      mode: payload.mode,
      selections,
      source,
      profile,
      signal: request.signal,
    });
    const response = Response.json({
      result,
      source: { title: source.title, scripture: source.scripture },
      tier: aiTier,
      provider: ai.engine,
      model: ai.model,
      ...(resourceReservation
        ? {
            remainingToday: resourceReservation.remainingToday,
            dailyLimit: resourceReservation.dailyLimit,
          }
        : {}),
    });
    succeeded = true;
    return response;
  } catch (caught) {
    if (caught instanceof UserAiProviderError) {
      const status = caught.httpStatus && caught.httpStatus >= 400 && caught.httpStatus < 600
        ? caught.httpStatus
        : caught.code === "auth"
          ? 502
          : caught.code === "invalid_response"
            ? 502
            : 503;
      return Response.json({ error: caught.message }, { status });
    }
    if (caught instanceof DOMException && caught.name === "TimeoutError") {
      return Response.json({ error: "AI 생성 시간이 초과되었습니다. 다시 시도해 주세요." }, { status: 504 });
    }
    return Response.json({ error: "자료를 생성하지 못했습니다. 잠시 후 다시 시도해 주세요." }, { status: 500 });
  } finally {
    if (resourceReservation && db) {
      try {
        await finishSermonResourceUsage(db, resourceReservation, !succeeded);
      } catch {
        // A stale reservation is automatically reclaimed after the provider timeout window.
      }
    }
    if (demoReservation) demoActiveUsers.delete(user.id);
  }
}
