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
  getScripturePassage,
  resolveLooseScriptureReference,
  scripturePassagePromptBlock,
} from "../../_lib/bible/bible-text";
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
  scripture?: unknown;
  notes?: unknown;
  manuscript?: unknown;
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
  return (
    value === "study" ||
    value === "ministry" ||
    value === "critique" ||
    value === "clarify"
  );
}

function validatedSelections(mode: SermonResourceMode, value: unknown): string[] | null {
  // The critique rubric and clarify interview are fixed server-side.
  if (mode === "critique" || mode === "clarify") return [];
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
  if (!isMode(payload?.mode)) {
    return Response.json({ error: "작업 종류를 확인해 주세요." }, { status: 400 });
  }
  const mode = payload.mode;
  const sermonId = typeof payload?.sermonId === "string" ? payload.sermonId.trim() : "";
  if (mode === "ministry" && (!sermonId || sermonId.length > 100)) {
    return Response.json({ error: "설교와 작업 종류를 확인해 주세요." }, { status: 400 });
  }
  const selections = validatedSelections(mode, payload.selections);
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

  const requestedScripture =
    typeof payload.scripture === "string" ? payload.scripture.trim().slice(0, 120) : "";
  const requestedNotes =
    typeof payload.notes === "string" ? payload.notes.trim().slice(0, 2_000) : "";

  if (mode === "study") {
    // Study starts from a scripture reference, not a saved sermon: the user
    // types the passage and optional research notes.
    if (!requestedScripture) {
      return Response.json(
        { error: "연구할 성경 본문을 입력해 주세요. 예: 요한복음 3:16-20" },
        { status: 400 },
      );
    }
    const resolved = await resolveLooseScriptureReference(requestedScripture);
    if (!resolved) {
      return Response.json(
        {
          error:
            "성경 본문 표기를 해석하지 못했습니다. '요한복음 3:16-20', '시편 23', '창세기 1-2장' 같은 형식으로 입력해 주세요.",
        },
        { status: 400 },
      );
    }
    const passage = await getScripturePassage(resolved.canonical, { maxVerses: 120 });
    if (!passage) {
      return Response.json(
        { error: "해당 본문을 찾지 못했습니다. 장·절 범위를 확인해 주세요." },
        { status: 400 },
      );
    }
    source = {
      title: `${resolved.canonical} 본문 연구`,
      scripture: resolved.canonical,
      sermonType: "본문 연구",
      audience: "-",
      audienceSituation: "-",
      duration: 0,
      emotion: "-",
      manuscript: scripturePassagePromptBlock(passage),
      ...(requestedNotes ? { notes: requestedNotes } : {}),
    };
  } else if (mode === "clarify") {
    const notes =
      typeof payload.notes === "string" ? payload.notes.trim().slice(0, 4_000) : "";
    const summaryLines = [
      `설교 제목·방향: ${notes ? "" : "(메모 없음)"}`,
      requestedScripture ? `성경 본문: ${requestedScripture}` : "성경 본문: (미입력)",
      notes ? `설교자 입력 요약:
${notes}` : "",
    ].filter(Boolean);
    source = {
      title: "설교 준비 보완 질문",
      scripture: requestedScripture || "-",
      sermonType: "-",
      audience: "-",
      audienceSituation: "-",
      duration: 0,
      emotion: "-",
      manuscript: summaryLines.join("\n"),
    };
  } else if (mode === "critique") {
    const manuscriptInput =
      typeof payload.manuscript === "string" ? payload.manuscript.trim() : "";
    if (manuscriptInput.length < 300) {
      return Response.json(
        { error: "비평할 설교 원고를 300자 이상 붙여 넣어 주세요." },
        { status: 400 },
      );
    }
    if (manuscriptInput.length > 60_000) {
      return Response.json(
        { error: "원고가 너무 깁니다. 60,000자 이하로 줄여 주세요." },
        { status: 400 },
      );
    }
    let extraContext = "";
    let canonicalScripture = requestedScripture;
    if (requestedScripture) {
      const resolved = await resolveLooseScriptureReference(requestedScripture);
      if (resolved) {
        canonicalScripture = resolved.canonical;
        const passage = await getScripturePassage(resolved.canonical, { maxVerses: 80 });
        if (passage) extraContext = scripturePassagePromptBlock(passage);
      }
    }
    source = {
      title: "설교 비평",
      scripture: canonicalScripture || "-",
      sermonType: "-",
      audience: "-",
      audienceSituation: "-",
      duration: 0,
      emotion: "-",
      manuscript: manuscriptInput,
      ...(extraContext ? { extraContext } : {}),
    };
  }

  if (mode !== "ministry" && db) {
    // Profile still frames denominational emphasis for study and critique.
    try {
      await ensureDatabase(db);
      const profileRow = await db
        .prepare(
          `SELECT denomination, theology, ministry_role, church
           FROM user_profiles WHERE user_id = ?`,
        )
        .bind(user.id)
        .first<{
          denomination: string;
          theology: string;
          ministry_role: string;
          church: string;
        }>();
      if (profileRow) {
        profile = {
          denomination: profileRow.denomination || "",
          theology: profileRow.theology || "",
          ministryRole: profileRow.ministry_role || "",
          church: profileRow.church || "",
        };
      }
    } catch {
      // Profile framing is optional; generation proceeds without it.
    }
  }

  if (!db && !user.isDemo) {
    return Response.json({ error: "데이터 저장소에 연결할 수 없습니다." }, { status: 503 });
  }
  if (mode === "ministry" && !db) {
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
  } else if (mode === "ministry" && db) {
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
    return Response.json(
      { error: mode === "ministry" ? "선택한 설교를 찾을 수 없습니다." : "요청 내용을 확인해 주세요." },
      { status: 404 },
    );
  }
  if (!source.manuscript.trim()) {
    return Response.json({ error: "원고 또는 본문 내용을 확인할 수 없습니다." }, { status: 409 });
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
      mode,
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
    // Diagnostic whitelist log: name + short message only (no payloads, no
    // keys — provider error messages never carry credentials).
    const record = caught && typeof caught === "object" ? (caught as Record<string, unknown>) : {};
    console.warn("[sermon-resources] generation failed", {
      mode,
      engine: ai.engine,
      model: ai.model,
      errorName: typeof record.name === "string" ? record.name.slice(0, 60) : typeof caught,
      message:
        caught instanceof Error ? caught.message.slice(0, 200) : String(caught).slice(0, 120),
    });
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
