import { reviseLocalSermon } from "@/app/_lib/sermon-content";
import {
  reviseAiSermon,
  UserAiProviderError,
} from "@/app/_lib/openai-sermons";
import { getRequestUserResponse, unauthorizedResponse } from "@/app/_lib/auth-user";
import { aiUserScope } from "@/app/_lib/ai-config";
import { getManagedAiRequestConfig } from "@/app/_lib/managed-ai-engines";
import { isAiEngineTier } from "@/app/_lib/ai-engine-tiers";
import { loadSermonPreacherContext } from "@/app/_lib/sermon-preacher-context";
import { ensureDatabase, getD1 } from "@/db";
import {
  durationToTargetCharacters,
  isSermonAlternative,
  isSermonOptionsComplete,
  isSermonTitleValue,
  normalizeSermonAiTiers,
  type ReviseSermonRequest,
  type SermonAlternative,
  type SermonAudience,
  type SermonDuration,
  type SermonOptions,
  type SermonPointCount,
  type SermonPreacherContext,
  type SermonType,
} from "@/app/_lib/sermon-types";

export const runtime = "nodejs";
export const maxDuration = 240;

const ALLOWED_SECTIONS = [
  "introduction",
  "body",
  "conclusion",
  "application",
] as const;

function error(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request): Promise<Response> {
  const auth = await getRequestUserResponse(request);
  if ("response" in auth) return auth.response;
  const { user } = auth;
  if (!user) return unauthorizedResponse();
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 1_500_000) {
    return error("수정할 설교가 너무 큽니다.", 413);
  }

  let input: Partial<ReviseSermonRequest>;
  try {
    input = (await request.json()) as Partial<ReviseSermonRequest>;
  } catch {
    return error("요청 형식을 확인해 주세요.");
  }

  if (input.clientUserScope !== aiUserScope(user.id)) {
    return error("로그인 계정이 다른 탭에서 변경되었습니다. 새로고침 후 다시 시도해 주세요.", 409);
  }

  if (!input.draftId || typeof input.draftId !== "string") {
    return error("설교 작업 식별자가 없습니다.");
  }
  if (!isSermonAlternative(input.sermon)) {
    return error("수정할 설교 본문을 찾지 못했습니다.");
  }
  if (!input.options) {
    return error("설교 옵션을 찾지 못했습니다.");
  }
  if (!isSermonTitleValue(input.options.topic)) {
    return error("설교 제목을 2자 이상 100자 이하로 입력해 주세요.");
  }
  if (!isAiEngineTier(input.options.aiTier)) {
    return error("사용할 AI 엔진 등급을 다시 선택해 주세요.");
  }
  if (
    !isSermonOptionsComplete(input.options) ||
    (input.options.referenceMode !== "auto" &&
      input.options.referenceMode !== "manual")
  ) {
    return error("저장된 설교 옵션을 다시 확인해 주세요.");
  }
  if (input.sermon.sections.points.length !== input.options.pointCount) {
    return error("설교 구성과 현재 원고의 대지 수가 일치하지 않습니다.");
  }
  const normalizedSermon: SermonAlternative = {
    id: input.sermon.id,
    title: input.sermon.title,
    summary: input.sermon.summary,
    scripture: input.sermon.scripture,
    sections: {
      introduction: input.sermon.sections.introduction,
      points: input.sermon.sections.points.map((point) => ({
        heading: point.heading,
        content: point.content,
      })),
      conclusion: input.sermon.sections.conclusion,
      application: input.sermon.sections.application,
    },
  };
  if (
    typeof input.section !== "string" ||
    !(ALLOWED_SECTIONS as readonly string[]).includes(input.section)
  ) {
    return error("수정할 부분을 다시 선택해 주세요.");
  }
  const instruction =
    typeof input.instruction === "string" ? input.instruction.trim() : "";
  if (instruction.length < 10) {
    return error("수정할 내용을 10자 이상 입력해 주세요.");
  }
  if (instruction.length > 1_000) {
    return error("수정 지시는 1,000자 이하로 입력해 주세요.");
  }
  if (!Number.isInteger(input.revisionCount) || (input.revisionCount ?? -1) < 0) {
    return error("수정 횟수를 확인해 주세요.");
  }
  if ((input.revisionCount ?? 3) >= 3) {
    return error("사용 가능한 수정 횟수를 모두 사용했습니다.", 409);
  }

  if (input.ai !== undefined) {
    return error("AI 엔진은 관리자만 설정할 수 있습니다.", 403);
  }

  const aiTiers = normalizeSermonAiTiers({ aiTier: input.options.aiTier });
  const duration = input.options.duration as SermonDuration;
  const normalizedOptions: SermonOptions = {
    topic: input.options.topic.trim(),
    aiTier: aiTiers[0],
    aiTiers,
    duration,
    targetCharacters: durationToTargetCharacters(duration),
    tone: input.options.tone.trim(),
    sermonType: input.options.sermonType as SermonType,
    audience: input.options.audience as SermonAudience,
    audienceSituation: input.options.audienceSituation.trim(),
    pointCount: input.options.pointCount as SermonPointCount,
    referenceMode: input.options.referenceMode,
  };

  const db = getD1();
  const userAi = await getManagedAiRequestConfig(db, normalizedOptions.aiTier);
  if (normalizedOptions.aiTier !== "basic" && !userAi) {
    return error("선택한 AI 엔진은 아직 관리자가 사용할 수 있도록 설정하지 않았습니다.", 409);
  }
  let serverRevisionCount = input.revisionCount as number;
  let preacherContext: SermonPreacherContext | undefined;
  if (db) {
    try {
      await ensureDatabase(db);
      const draft = await db.prepare("SELECT user_id, revision_count FROM sermon_drafts WHERE id = ?")
        .bind(input.draftId)
        .first<{ user_id: string; revision_count: number }>();
      if (!draft) return error("저장된 설교 작업을 찾지 못했습니다. 대안을 다시 생성해 주세요.", 404);
      if (draft.user_id !== user.id) return error("다른 계정의 설교 작업에는 접근할 수 없습니다.", 403);
      serverRevisionCount = Number(draft.revision_count);
      if (serverRevisionCount >= 3) {
        return error("사용 가능한 수정 횟수를 모두 사용했습니다.", 409);
      }
      preacherContext = await loadSermonPreacherContext(
        db,
        user.id,
        user.isDemo,
      );
    } catch {
      return error(
        "저장된 설교 작업과 신학 설정을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.",
        503,
      );
    }
  }

  const normalized: ReviseSermonRequest = {
    draftId: input.draftId,
    sermon: normalizedSermon,
    options: normalizedOptions,
    section: input.section as ReviseSermonRequest["section"],
    instruction,
    toneAdjustment:
      typeof input.toneAdjustment === "string"
        ? input.toneAdjustment.trim().slice(0, 100)
        : "",
    revisionCount: serverRevisionCount,
    ...(preacherContext ? { preacherContext } : {}),
  };
  let aiResult;
  try {
    aiResult = userAi
      ? await reviseAiSermon(normalized, userAi, request.signal)
      : null;
  } catch (caught) {
    if (caught instanceof UserAiProviderError) {
      return error(caught.message, caught.httpStatus);
    }
    return error("관리자 AI 엔진으로 설교를 수정하지 못했습니다.", 502);
  }
  const sermon = aiResult?.value ?? reviseLocalSermon(normalized);

  if (db) {
    const now = new Date().toISOString();
    const nextCount = serverRevisionCount + 1;
    try {
      const [updateResult] = await db.batch([
        db.prepare("UPDATE sermon_drafts SET revision_count = revision_count + 1, selected_alternative_id = ?, status = 'editing', updated_at = ? WHERE id = ? AND user_id = ? AND revision_count = ? AND revision_count < 3")
          .bind(sermon.id, now, normalized.draftId, user.id, serverRevisionCount),
        db.prepare("INSERT INTO sermon_versions (id, draft_id, version_number, instruction, title, body_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
          .bind(crypto.randomUUID(), normalized.draftId, nextCount, normalized.instruction, sermon.title, JSON.stringify(sermon), now),
      ]);
      if (!(updateResult.meta.changes ?? 0)) {
        return error("수정 횟수가 다른 화면에서 변경되었습니다. 새로고침 후 다시 시도해 주세요.", 409);
      }
    } catch {
      return error("수정 내용을 안전하게 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.", 503);
    }
  }

  return Response.json(
    {
      sermon,
      provider: aiResult?.engine ?? "local",
      ...(aiResult
        ? {
            model: aiResult.model,
            reasoningEffort: aiResult.reasoningEffort,
          }
        : {}),
      revisionCount: serverRevisionCount + 1,
      revisionSummary: `${instruction.slice(0, 80)}${instruction.length > 80 ? "…" : ""}`,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
