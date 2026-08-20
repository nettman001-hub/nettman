import { generateLocalSermons } from "@/app/_lib/sermon-content";
import {
  assembleAiSermonAlternative,
  generateAiSermonAlternative,
  generateAiSermonFragment,
  generateAiSermons,
  generateSermonDesignOutlines,
  isValidSermonGenerationFragment,
  planSermonGenerationSteps,
  type SermonDesignOutline,
  type SermonGenerationFragment,
  type SermonGenerationStep,
  UserAiProviderError,
} from "@/app/_lib/openai-sermons";
import { getRequestUserResponse } from "@/app/_lib/auth-user";
import {
  chargeSermonTokens,
  InsufficientTokensError,
  refundTokenCharge,
  type TokenCharge,
} from "@/app/_lib/token-wallet";
import {
  guestPreviewCookie,
  hasGuestPreviewCookie,
  limitedGuestPreview,
} from "@/app/_lib/guest-preview";
import {
  aiUserScope,
  usesFragmentedSermonGeneration,
} from "@/app/_lib/ai-config";
import {
  getManagedAiRequestConfigs,
  type ManagedAiRequestConfigs,
} from "@/app/_lib/managed-ai-engines";
import { isAiEngineTier } from "@/app/_lib/ai-engine-tiers";
import { verifyScriptureNormalizationGrant } from "@/app/_lib/scripture-normalization-grant";
import { loadSermonPreacherContext } from "@/app/_lib/sermon-preacher-context";
import { ensureDatabase, getD1 } from "@/db";
import {
  SERMON_AUDIENCES,
  SERMON_DURATIONS,
  SERMON_POINT_COUNTS,
  SERMON_TYPES,
  durationToTargetCharacters,
  isSermonAlternative,
  isSermonAudienceSituationValue,
  isSermonTitleValue,
  isSermonToneValue,
  normalizeSermonAiTiers,
  type GenerateSermonsRequest,
  type SermonAlternative,
  type SermonAudience,
  type SermonDuration,
  type SermonGenerationPart,
  type SermonPointCount,
  type SermonPreacherContext,
  type SermonType,
} from "@/app/_lib/sermon-types";

export const runtime = "nodejs";
export const maxDuration = 240;

const MAX_BODY_BYTES = 1_000_000;
const POSITION_LEASE_MS = 5 * 60 * 1_000;

type GenerationRunRow = {
  id: string;
  draft_id: string;
  user_id: string;
  expected_count: number;
  ai_signature: string;
  managed_allowed: number;
  status: string;
  provider: string;
  model: string | null;
  reasoning_effort: string | null;
};

type GenerationItemRow = {
  position: number;
  alternative_json: string;
};

type GenerationPartRow = {
  position: number;
  step: number;
  part_json: string;
  provider: string;
  model: string | null;
  reasoning_effort: string | null;
};

type DraftGenerationState = {
  user_id: string;
  active_generation_id: string | null;
};

function error(message: string, status = 400, code?: string): Response {
  return Response.json(
    { error: message, ...(code ? { code } : {}) },
    { status },
  );
}

function isOneOf(value: unknown, allowed: readonly unknown[]): boolean {
  return allowed.includes(value);
}

function validScriptureInput(value: string): boolean {
  return (
    value.length >= 2 &&
    value.length <= 120 &&
    ![...value].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    })
  );
}

function validGenerationId(value: string): boolean {
  return /^[A-Za-z0-9_-]{8,100}$/.test(value);
}

async function generationSignature(
  managedAiConfigs: ManagedAiRequestConfigs,
  request: GenerateSermonsRequest,
): Promise<string> {
  const payload = JSON.stringify({
    aiSchedule: request.options.aiTiers.map((tier) => {
      const ai = managedAiConfigs[tier];
      return ai
        ? {
            source: "administrator",
            tier,
            engine: ai.engine,
            endpoint: ai.endpoint,
            model: ai.model,
            reasoningEffort: ai.reasoningEffort,
            maxOutputTokens: ai.maxOutputTokens,
          }
        : { source: "local", tier };
    }),
    scripture: request.scripture,
    options: {
      topic: request.options.topic,
      aiTier: request.options.aiTier,
      aiTiers: request.options.aiTiers,
      duration: request.options.duration,
      targetCharacters: request.options.targetCharacters,
      tone: request.options.tone,
      sermonType: request.options.sermonType,
      audience: request.options.audience,
      audienceSituation: request.options.audienceSituation,
      pointCount: request.options.pointCount,
      referenceMode: request.options.referenceMode,
    },
    reference: {
      url: request.reference.url,
      notes: request.reference.notes,
      file: request.reference.file
        ? {
            name: request.reference.file.name,
            type: request.reference.file.type,
            size: request.reference.file.size,
            text: request.reference.file.text,
          }
        : null,
    },
    preacherContext: request.preacherContext ?? null,
  });
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(payload),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function parseGenerationAlternative(value: string): SermonAlternative | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isSermonAlternative(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function loadGenerationItems(
  db: D1Database,
  generationId: string,
): Promise<Array<{ position: number; alternative: SermonAlternative }>> {
  const rows = await db
    .prepare(
      "SELECT position, alternative_json FROM sermon_generation_items WHERE generation_id = ? ORDER BY position ASC",
    )
    .bind(generationId)
    .all<GenerationItemRow>();
  return rows.results.flatMap((row) => {
    const alternative = parseGenerationAlternative(row.alternative_json);
    return alternative ? [{ position: Number(row.position), alternative }] : [];
  });
}

function parseGenerationPartPayload(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

async function loadGenerationParts(
  db: D1Database,
  generationId: string,
  position: number,
): Promise<
  Array<{
    part: SermonGenerationPart;
    provider: string;
    model: string | null;
    reasoningEffort: string | null;
  }>
> {
  const rows = await db
    .prepare(
      `SELECT position, step, part_json, provider, model, reasoning_effort
       FROM sermon_generation_parts
       WHERE generation_id = ? AND position = ?
       ORDER BY step ASC`,
    )
    .bind(generationId, position)
    .all<GenerationPartRow>();
  return rows.results.flatMap((row) => {
    const payload = parseGenerationPartPayload(row.part_json);
    return payload
      ? [
          {
            part: {
              position: Number(row.position) as 1 | 2 | 3 | 4 | 5,
              step: Number(row.step),
              payload,
            },
            provider: row.provider,
            model: row.model,
            reasoningEffort: row.reasoning_effort,
          },
        ]
      : [];
  });
}

function normalizeClientGenerationParts(
  value: unknown,
  position: 1 | 2 | 3 | 4 | 5,
  beforeStep: number,
): SermonGenerationPart[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > beforeStep - 1) return null;
  const parts = value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const part = candidate as Partial<SermonGenerationPart>;
    if (
      part.position !== position ||
      !Number.isInteger(part.step) ||
      Number(part.step) < 1 ||
      Number(part.step) >= beforeStep ||
      !part.payload ||
      typeof part.payload !== "object" ||
      Array.isArray(part.payload)
    ) {
      return [];
    }
    return [part as SermonGenerationPart];
  });
  parts.sort((left, right) => left.step - right.step);
  if (
    parts.length !== value.length ||
    parts.some((part, index) => part.step !== index + 1)
  ) {
    return null;
  }
  return parts;
}

function validateGenerationPartSequence(
  request: GenerateSermonsRequest,
  plan: readonly SermonGenerationStep[],
  parts: readonly SermonGenerationPart[],
): SermonGenerationFragment[] | null {
  if (parts.length > plan.length) return null;
  const fragments: SermonGenerationFragment[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    const step = plan[index];
    if (
      !step ||
      part.step !== index + 1 ||
      !isValidSermonGenerationFragment(request, step, part.payload)
    ) {
      return null;
    }
    fragments.push(part.payload as unknown as SermonGenerationFragment);
  }
  return fragments;
}

function sameGenerationPart(
  left: SermonGenerationPart,
  right: SermonGenerationPart,
): boolean {
  return (
    left.position === right.position &&
    left.step === right.step &&
    JSON.stringify(left.payload) === JSON.stringify(right.payload)
  );
}

async function acquireGenerationPosition(args: {
  db: D1Database;
  generationId: string;
  draftId: string;
  userId: string;
  position: number;
}): Promise<string | null> {
  const leaseToken = crypto.randomUUID();
  const now = new Date();
  const nowIso = now.toISOString();
  const staleBefore = new Date(now.getTime() - POSITION_LEASE_MS).toISOString();
  const inserted = await args.db
    .prepare(
      `INSERT INTO sermon_generation_claims
        (id, generation_id, position, lease_token, updated_at)
       SELECT ?, ?, ?, ?, ?
       WHERE EXISTS (
         SELECT 1
         FROM sermon_generation_runs r
         JOIN sermon_drafts d ON d.id = r.draft_id
         WHERE r.id = ? AND r.draft_id = ? AND r.user_id = ?
           AND r.status = 'generating' AND d.user_id = ?
           AND d.active_generation_id = r.id
       )
       ON CONFLICT(generation_id, position) DO NOTHING`,
    )
    .bind(
      crypto.randomUUID(),
      args.generationId,
      args.position,
      leaseToken,
      nowIso,
      args.generationId,
      args.draftId,
      args.userId,
      args.userId,
    )
    .run();
  if ((inserted.meta.changes ?? 0) > 0) return leaseToken;

  const reclaimed = await args.db
    .prepare(
      `UPDATE sermon_generation_claims
       SET lease_token = ?, updated_at = ?
       WHERE generation_id = ? AND position = ? AND updated_at < ?
         AND EXISTS (
           SELECT 1
           FROM sermon_generation_runs r
           JOIN sermon_drafts d ON d.id = r.draft_id
           WHERE r.id = ? AND r.draft_id = ? AND r.user_id = ?
             AND r.status = 'generating' AND d.user_id = ?
             AND d.active_generation_id = r.id
         )`,
    )
    .bind(
      leaseToken,
      nowIso,
      args.generationId,
      args.position,
      staleBefore,
      args.generationId,
      args.draftId,
      args.userId,
      args.userId,
    )
    .run();
  return (reclaimed.meta.changes ?? 0) > 0 ? leaseToken : null;
}

async function releaseGenerationPosition(args: {
  db: D1Database;
  generationId: string;
  position: number;
  leaseToken: string;
}): Promise<void> {
  try {
    await args.db
      .prepare(
        `DELETE FROM sermon_generation_claims
         WHERE generation_id = ? AND position = ? AND lease_token = ?`,
      )
      .bind(args.generationId, args.position, args.leaseToken)
      .run();
  } catch {
    // A short lease makes an interrupted request recoverable even if cleanup fails.
  }
}

async function finalizeGeneration(args: {
  db: D1Database;
  generationId: string;
  draftId: string;
  userId: string;
  expectedCount: number;
  request: GenerateSermonsRequest;
}): Promise<SermonAlternative[] | null> {
  const items = await loadGenerationItems(args.db, args.generationId);
  if (
    items.length !== args.expectedCount ||
    items.some((item, index) => item.position !== index + 1) ||
    new Set(items.map((item) => item.alternative.title.trim())).size !== args.expectedCount
  ) {
    return null;
  }

  const now = new Date().toISOString();
  const activeDraft = `EXISTS (
    SELECT 1 FROM sermon_drafts
    WHERE id = ? AND user_id = ? AND active_generation_id = ?
  )`;
  const results = await args.db.batch([
    args.db
      .prepare(
        `UPDATE sermon_drafts SET updated_at = updated_at
         WHERE id = ? AND user_id = ? AND active_generation_id = ?`,
      )
      .bind(args.draftId, args.userId, args.generationId),
    args.db
      .prepare(
        `DELETE FROM sermon_alternatives
         WHERE draft_id = ? AND ${activeDraft}`,
      )
      .bind(
        args.draftId,
        args.draftId,
        args.userId,
        args.generationId,
      ),
    ...items.map(({ alternative, position }) =>
      args.db
        .prepare(
          `INSERT INTO sermon_alternatives
            (id, draft_id, position, title, scripture, introduction, body_json, created_at)
           SELECT ?, ?, ?, ?, ?, ?, ?, ?
           WHERE ${activeDraft}`,
        )
        .bind(
          alternative.id,
          args.draftId,
          position,
          alternative.title,
          alternative.scripture,
          alternative.sections.introduction,
          JSON.stringify(alternative.sections),
          now,
          args.draftId,
          args.userId,
          args.generationId,
        ),
    ),
    args.db
      .prepare(
        `DELETE FROM sermon_versions
         WHERE draft_id = ? AND ${activeDraft}`,
      )
      .bind(
        args.draftId,
        args.draftId,
        args.userId,
        args.generationId,
      ),
    args.db
      .prepare(
        `UPDATE sermon_generation_runs
         SET status = 'completed', updated_at = ?
         WHERE id = ? AND user_id = ? AND status = 'generating'
           AND ${activeDraft}`,
      )
      .bind(
        now,
        args.generationId,
        args.userId,
        args.draftId,
        args.userId,
        args.generationId,
      ),
    args.db
      .prepare(
        `UPDATE sermon_drafts
         SET topic = ?, scripture = ?, sermon_type = ?, audience = ?,
             audience_situation = ?, point_count = ?, duration = ?, emotion = ?, reference_mode = ?,
             status = 'alternatives_ready', active_generation_id = NULL,
             selected_alternative_id = NULL, revision_count = 0, updated_at = ?
         WHERE id = ? AND user_id = ? AND active_generation_id = ?`,
      )
      .bind(
        args.request.options.topic,
        args.request.scripture,
        args.request.options.sermonType,
        args.request.options.audience,
        args.request.options.audienceSituation,
        args.request.options.pointCount,
        args.request.options.duration,
        args.request.options.tone,
        args.request.options.referenceMode,
        now,
        args.draftId,
        args.userId,
        args.generationId,
      ),
  ]);
  const fenceChanged = results[0]?.meta.changes ?? 0;
  const runChanged = results[results.length - 2]?.meta.changes ?? 0;
  const draftChanged = results.at(-1)?.meta.changes ?? 0;
  if (fenceChanged < 1 || runChanged < 1 || draftChanged < 1) return null;
  return items.map((item) => item.alternative);
}

function generationResponse(args: {
  alternative?: SermonAlternative;
  generationId: string;
  position: 1 | 2 | 3 | 4 | 5;
  complete: boolean;
  provider: string;
  model?: string | null;
  reasoningEffort?: string | null;
  persistence: "database" | "local";
  guest?: boolean;
  generationStep?: number;
  generationStepCount?: number;
  generationParts?: SermonGenerationPart[];
}): Response {
  const alternatives = args.alternative
    ? args.guest
      ? limitedGuestPreview([args.alternative])
      : [args.alternative]
    : [];
  return Response.json(
    {
      alternatives,
      generationId: args.generationId,
      position: args.position,
      complete: args.complete,
      ...(args.generationStep
        ? {
            generationStep: args.generationStep,
            generationStepCount: args.generationStepCount,
            generationParts: args.generationParts ?? [],
          }
        : {}),
      ...(args.guest ? { guestPreview: true } : {}),
      provider: args.provider,
      ...(args.model ? { model: args.model } : {}),
      ...(args.reasoningEffort
        ? { reasoningEffort: args.reasoningEffort }
        : {}),
      persistence: args.persistence,
    },
    {
      headers: {
        "Cache-Control": "no-store",
        ...(args.guest ? { "Set-Cookie": guestPreviewCookie() } : {}),
      },
    },
  );
}

export async function GET(request: Request): Promise<Response> {
  const auth = await getRequestUserResponse(request);
  if ("response" in auth) return auth.response;
  const { user } = auth;
  if (!user) {
    return Response.json(
      { fragmented: false },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  const tier = new URL(request.url).searchParams.get("aiTier");
  if (!isAiEngineTier(tier)) return error("사용할 AI 엔진 등급을 다시 선택해 주세요.");
  try {
    const config = (await getManagedAiRequestConfigs(getD1()))[tier];
    return Response.json(
      { fragmented: usesFragmentedSermonGeneration(config) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return error("AI 엔진의 생성 방식을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.", 503);
  }
}

/**
 * The contrastive design contract is generated once per run and shared by all
 * five drafts. It lives in sermon_generation_parts at the reserved
 * (position 0, step 0) slot; failures degrade to design-free drafts.
 */
const SHARED_DESIGN_POSITION = 0;
const SHARED_DESIGN_STEP = 0;

function parseSharedSermonDesign(raw: unknown): SermonDesignOutline[] | null {
  if (typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 5) return null;
    return parsed as SermonDesignOutline[];
  } catch {
    return null;
  }
}

async function loadSharedSermonDesign(
  db: NonNullable<ReturnType<typeof getD1>>,
  generationId: string,
): Promise<SermonDesignOutline[] | null> {
  try {
    const row = await db
      .prepare(
        `SELECT part_json FROM sermon_generation_parts
         WHERE generation_id = ? AND position = ? AND step = ?`,
      )
      .bind(generationId, SHARED_DESIGN_POSITION, SHARED_DESIGN_STEP)
      .first<{ part_json: string }>();
    return row ? parseSharedSermonDesign(row.part_json) : null;
  } catch {
    return null;
  }
}

async function saveSharedSermonDesign(args: {
  db: NonNullable<ReturnType<typeof getD1>>;
  generationId: string;
  design: SermonDesignOutline[];
  provider: string;
  model: string | null;
  reasoningEffort: string | null;
  elapsedMs: number;
}): Promise<void> {
  try {
    await args.db
      .prepare(
        `INSERT INTO sermon_generation_parts
          (id, generation_id, position, step, part_json, provider, model,
           reasoning_effort, elapsed_ms, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(generation_id, position, step) DO NOTHING`,
      )
      .bind(
        crypto.randomUUID(),
        args.generationId,
        SHARED_DESIGN_POSITION,
        SHARED_DESIGN_STEP,
        JSON.stringify(args.design),
        args.provider,
        args.model,
        args.reasoningEffort,
        args.elapsedMs,
        new Date().toISOString(),
      )
      .run();
  } catch {
    // The design row is an enhancement; persistence failures stay silent.
  }
}

export async function POST(request: Request): Promise<Response> {
  const auth = await getRequestUserResponse(request);
  if ("response" in auth) return auth.response;
  const { user } = auth;
  if (!user && hasGuestPreviewCookie(request)) {
    return error("비회원 미리보기를 이미 사용했습니다. 로그인하면 계속 생성할 수 있습니다.", 429);
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    return error("생성 요청이 너무 큽니다. 참고 자료 내용을 줄여 주세요.", 413);
  }

  let input: Partial<GenerateSermonsRequest>;
  try {
    input = (await request.json()) as Partial<GenerateSermonsRequest>;
  } catch {
    return error("요청 형식을 확인해 주세요.");
  }

  const clientUserScope =
    typeof input.clientUserScope === "string" ? input.clientUserScope : undefined;
  if (
    (user && clientUserScope !== aiUserScope(user.id)) ||
    (!user && clientUserScope !== undefined)
  ) {
    return error("로그인 계정이 다른 탭에서 변경되었습니다. 새로고침 후 다시 시도해 주세요.", 409);
  }

  const generationId =
    typeof input.generationId === "string" ? input.generationId.trim() : undefined;
  const alternativePosition = input.alternativePosition;
  const splitGeneration = generationId !== undefined || alternativePosition !== undefined;
  if (
    splitGeneration &&
    (!generationId ||
      !validGenerationId(generationId) ||
      !Number.isInteger(alternativePosition) ||
      !isOneOf(alternativePosition, [1, 2, 3, 4, 5]))
  ) {
    return error("초안 생성 순서를 확인할 수 없습니다.");
  }
  const position = alternativePosition as 1 | 2 | 3 | 4 | 5 | undefined;
  const generationStep = input.generationStep;
  if (
    generationStep !== undefined &&
    (!splitGeneration ||
      !Number.isInteger(generationStep) ||
      Number(generationStep) < 1 ||
      Number(generationStep) > 100)
  ) {
    return error("초안의 세부 생성 순서를 확인할 수 없습니다.");
  }
  if (input.generationParts !== undefined && generationStep === undefined) {
    return error("저장된 초안 조각의 생성 순서가 없습니다.");
  }
  const expectedCount: 1 | 5 = user ? 5 : 1;
  if (splitGeneration && !user && position !== 1) {
    return error("비회원 미리보기는 첫 번째 초안만 생성할 수 있습니다.", 403);
  }
  if (user && !user.isDemo && !splitGeneration) {
    return error(
      "설교 생성 방식이 변경되었습니다. 화면을 새로고침한 뒤 다시 시작해 주세요.",
      409,
    );
  }

  const options = input.options;
  const scripture = typeof input.scripture === "string" ? input.scripture.trim() : "";
  if (!input.draftId || typeof input.draftId !== "string") {
    return error("설교 작업 식별자가 없습니다.");
  }
  if (!options || !isSermonTitleValue(options.topic)) {
    return error("설교 제목을 2자 이상 100자 이하로 입력해 주세요.");
  }
  const suppliedAiTiers = (options as { aiTiers?: unknown }).aiTiers;
  if (
    suppliedAiTiers !== undefined &&
    (!Array.isArray(suppliedAiTiers) ||
      suppliedAiTiers.length !== 5 ||
      !suppliedAiTiers.every(isAiEngineTier))
  ) {
    return error("AI 엔진 등급을 다시 선택해 주세요.");
  }
  if (!isAiEngineTier(options.aiTier) && suppliedAiTiers === undefined) {
    return error("사용할 AI 엔진 등급을 다시 선택해 주세요.");
  }
  const aiTiers = normalizeSermonAiTiers({
    aiTier: options.aiTier,
    aiTiers: suppliedAiTiers,
  });
  if (!isOneOf(options.duration, SERMON_DURATIONS)) {
    return error("설교 분량을 다시 선택해 주세요.");
  }
  if (!isSermonToneValue(options.tone)) {
    return error("설교 감정선은 2자 이상 40자 이하로 선택하거나 입력해 주세요.");
  }
  if (!isOneOf(options.sermonType, SERMON_TYPES)) {
    return error("설교 유형을 다시 선택해 주세요.");
  }
  if (!isOneOf(options.audience, SERMON_AUDIENCES)) {
    return error("설교 대상을 다시 선택해 주세요.");
  }
  if (!isSermonAudienceSituationValue(options.audienceSituation)) {
    return error(
      "청중 상황은 2자 이상 40자 이하로 선택하거나 입력해 주세요.",
    );
  }
  if (!isOneOf(options.pointCount, SERMON_POINT_COUNTS)) {
    return error("대지 수는 1개부터 4개까지 선택할 수 있습니다.");
  }
  if (options.referenceMode !== "auto" && options.referenceMode !== "manual") {
    return error("참고 자료 사용 방식을 다시 선택해 주세요.");
  }
  if (!validScriptureInput(scripture)) {
    return error("책 이름과 장·절을 120자 이하로 입력해 주세요.");
  }

  if (input.ai !== undefined) {
    return error("AI 엔진은 관리자만 설정할 수 있습니다.", 403);
  }
  const db = user ? getD1() : null;
  const managedAiConfigs: ManagedAiRequestConfigs = user
    ? await getManagedAiRequestConfigs(db)
    : { basic: undefined, advanced: undefined, reasoning: undefined };
  const selectedAiTier = aiTiers[0];
  if (user && selectedAiTier !== "basic" && !managedAiConfigs[selectedAiTier]) {
    return error(
      "선택한 AI 엔진은 아직 관리자가 사용할 수 있도록 설정하지 않았습니다.",
      409,
    );
  }
  const userAi = user ? managedAiConfigs[selectedAiTier] : undefined;
  if (user && userAi) {
    const normalizationGrant =
      typeof input.scriptureNormalizationGrant === "string"
        ? input.scriptureNormalizationGrant
        : "";
    if (
      !verifyScriptureNormalizationGrant({
        token: normalizationGrant,
        subject: user.id,
        draftId: input.draftId,
        aiTier: selectedAiTier,
        scripture,
        providerApiKey: userAi.apiKey,
      })
    ) {
      return error(
        "성경 본문 AI 확인 증표가 없거나 만료되었습니다. 본문 입력 화면에서 다시 확인해 주세요.",
        409,
        "scripture_normalization_grant_invalid",
      );
    }
  }
  if (
    generationStep !== undefined &&
    !usesFragmentedSermonGeneration(userAi)
  ) {
    return error("세부 단계 생성은 로컬 LLM(OpenAI 호환) 연결에서만 사용할 수 있습니다.");
  }
  if (
    usesFragmentedSermonGeneration(userAi) &&
    (!splitGeneration || generationStep === undefined)
  ) {
    return error(
      "로컬 LLM 생성 방식이 변경되었습니다. 저장된 진행 상태부터 다시 시도해 주세요.",
      409,
    );
  }

  const reference = input.reference ?? { url: "", notes: "", file: null };
  if (reference.url) {
    try {
      const url = new URL(reference.url);
      if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error();
    } catch {
      return error("참고 자료 URL을 올바르게 입력해 주세요.");
    }
  }
  if (reference.notes && reference.notes.length > 20_000) {
    return error("참고 자료 메모는 20,000자 이하로 입력해 주세요.");
  }
  if (reference.file && reference.file.size > 10 * 1024 * 1024) {
    return error("참고 파일은 10MB 이하만 사용할 수 있습니다.");
  }

  const existingTitles = Array.isArray(input.existingTitles)
    ? input.existingTitles
        .filter((title): title is string => typeof title === "string")
        .map((title) => title.trim().slice(0, 100))
        .filter(Boolean)
        .slice(0, 4)
    : [];
  let preacherContext: SermonPreacherContext | undefined;
  if (db && user && !user.isDemo) {
    try {
      await ensureDatabase(db);
      preacherContext = await loadSermonPreacherContext(
        db,
        user.id,
        user.isDemo,
      );
    } catch {
      return error(
        "저장된 신학 설정을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.",
        503,
      );
    }
  }
  const duration = options.duration as SermonDuration;
  const pointCount = options.pointCount as SermonPointCount;
  const normalized: GenerateSermonsRequest = {
    draftId: input.draftId,
    ...(generationId ? { generationId } : {}),
    ...(position ? { alternativePosition: position } : {}),
    existingTitles,
    scripture,
    ...(preacherContext ? { preacherContext } : {}),
    options: {
      topic: options.topic.trim(),
      aiTier: aiTiers[0],
      aiTiers,
      duration,
      targetCharacters: durationToTargetCharacters(duration),
      tone: options.tone.trim(),
      sermonType: options.sermonType as SermonType,
      audience: options.audience as SermonAudience,
      audienceSituation: options.audienceSituation.trim(),
      pointCount,
      referenceMode: options.referenceMode,
    },
    reference: {
      url: reference.url?.trim().slice(0, 2048) ?? "",
      notes: reference.notes?.trim().slice(0, 20_000) ?? "",
      file: reference.file
        ? {
            name: reference.file.name.slice(0, 180),
            type: reference.file.type.slice(0, 100),
            size: reference.file.size,
            text: reference.file.text?.slice(0, 50_000),
          }
        : null,
    },
  };

  const generationPlan = generationStep !== undefined
    ? planSermonGenerationSteps(normalized)
    : null;
  const requestedGenerationStep = generationStep !== undefined
    ? generationPlan?.[generationStep - 1]
    : undefined;
  if (generationStep !== undefined && !requestedGenerationStep) {
    return error("요청한 세부 생성 단계가 전체 설교 구성 범위를 벗어났습니다.");
  }
  const clientGenerationParts = generationStep !== undefined && position
    ? normalizeClientGenerationParts(input.generationParts, position, generationStep)
    : [];
  if (clientGenerationParts === null) {
    return error("저장된 설교 조각의 순서가 올바르지 않습니다. 마지막 저장 단계부터 다시 시도해 주세요.", 409);
  }
  const clientGenerationFragments = generationPlan
    ? validateGenerationPartSequence(
        normalized,
        generationPlan,
        clientGenerationParts,
      )
    : [];
  if (generationPlan && !clientGenerationFragments) {
    return error("저장된 설교 조각의 내용이 현재 생성 계획과 일치하지 않습니다. 새 초안 묶음으로 다시 시작해 주세요.", 409);
  }
  let acceptedGenerationParts = clientGenerationParts;
  let acceptedGenerationFragments = clientGenerationFragments ?? [];
  let acceptedPartProvider: string | null = null;
  let acceptedPartModel: string | null = null;
  let acceptedPartReasoningEffort: string | null = null;

  if (
    generationStep !== undefined &&
    !db &&
    acceptedGenerationParts.length !== generationStep - 1
  ) {
    return error("저장된 설교 조각이 일부 누락되었습니다. 화면에 저장된 마지막 단계부터 다시 시도해 주세요.", 409);
  }
  let databaseReady = false;
  let generationRun: GenerationRunRow | null = null;
  if (db && user) {
    try {
      await ensureDatabase(db);
      databaseReady = true;
      const existing = await db
        .prepare(
          "SELECT user_id, active_generation_id FROM sermon_drafts WHERE id = ?",
        )
        .bind(normalized.draftId)
        .first<DraftGenerationState>();
      if (existing && existing.user_id !== user.id) {
        return error("다른 계정의 설교 작업에는 접근할 수 없습니다.", 403);
      }

      if (splitGeneration && generationId && position) {
        const signature = await generationSignature(managedAiConfigs, normalized);
        generationRun = await db
          .prepare(
            `SELECT id, draft_id, user_id, expected_count, ai_signature,
                    managed_allowed, status, provider, model, reasoning_effort
             FROM sermon_generation_runs WHERE id = ?`,
          )
          .bind(generationId)
          .first<GenerationRunRow>();

        if (!generationRun) {
          if (position !== 1) {
            return error("첫 번째 초안부터 생성을 다시 이어 주세요.", 409);
          }
          const now = new Date().toISOString();
          const managedAllowed = 0;
          await db.batch([
            db
              .prepare(
                "INSERT INTO users (id, email, name, role, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET email=excluded.email, name=excluded.name",
              )
              .bind(user.id, user.email, user.name, user.role, now),
            db
              .prepare(
                `INSERT INTO sermon_drafts
                  (id, user_id, topic, scripture, sermon_type, audience, audience_situation, point_count,
                   duration, emotion, reference_mode, status, active_generation_id,
                   selected_alternative_id, revision_count, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'generating', ?, NULL, 0, ?, ?)
                 ON CONFLICT(id) DO NOTHING`,
              )
              .bind(
                normalized.draftId,
                user.id,
                normalized.options.topic,
                normalized.scripture,
                normalized.options.sermonType,
                normalized.options.audience,
                normalized.options.audienceSituation,
                normalized.options.pointCount,
                normalized.options.duration,
                normalized.options.tone,
                normalized.options.referenceMode,
                generationId,
                now,
                now,
              ),
            db
              .prepare(
                `INSERT INTO sermon_generation_runs
                  (id, draft_id, user_id, expected_count, ai_signature, managed_allowed,
                   status, provider, model, reasoning_effort, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, 'generating', 'pending', NULL, NULL, ?, ?)
                 ON CONFLICT(id) DO NOTHING`,
              )
              .bind(
                generationId,
                normalized.draftId,
                user.id,
                expectedCount,
                signature,
                managedAllowed,
                now,
                now,
              ),
            db
              .prepare(
                `UPDATE sermon_generation_runs
                 SET status = 'superseded', updated_at = ?
                 WHERE draft_id = ? AND user_id = ? AND id <> ? AND status = 'generating'
                   AND EXISTS (
                     SELECT 1 FROM sermon_generation_runs current_run
                     WHERE current_run.id = ? AND current_run.draft_id = ?
                       AND current_run.user_id = ? AND current_run.status = 'generating'
                   )`,
              )
              .bind(
                now,
                normalized.draftId,
                user.id,
                generationId,
                generationId,
                normalized.draftId,
                user.id,
              ),
            db
              .prepare(
                `DELETE FROM sermon_generation_claims
                 WHERE generation_id IN (
                   SELECT id FROM sermon_generation_runs
                   WHERE draft_id = ? AND user_id = ? AND status = 'superseded'
                 )`,
              )
              .bind(normalized.draftId, user.id),
            db
              .prepare(
                `UPDATE sermon_drafts
                 SET status = 'generating', active_generation_id = ?, updated_at = ?
                 WHERE id = ? AND user_id = ?
                   AND EXISTS (
                     SELECT 1 FROM sermon_generation_runs current_run
                     WHERE current_run.id = ? AND current_run.draft_id = ?
                       AND current_run.user_id = ? AND current_run.status = 'generating'
                   )`,
              )
              .bind(
                generationId,
                now,
                normalized.draftId,
                user.id,
                generationId,
                normalized.draftId,
                user.id,
              ),
          ]);
          const reservedDraft = await db
            .prepare(
              "SELECT user_id, active_generation_id FROM sermon_drafts WHERE id = ?",
            )
            .bind(normalized.draftId)
            .first<DraftGenerationState>();
          if (!reservedDraft || reservedDraft.user_id !== user.id) {
            return error("다른 계정의 설교 작업에는 접근할 수 없습니다.", 403);
          }
          if (reservedDraft.active_generation_id !== generationId) {
            return error("더 새로운 생성 작업이 시작되었습니다. 새 초안 묶음으로 다시 시작해 주세요.", 409);
          }
          generationRun = await db
            .prepare(
              `SELECT id, draft_id, user_id, expected_count, ai_signature,
                      managed_allowed, status, provider, model, reasoning_effort
               FROM sermon_generation_runs WHERE id = ?`,
            )
            .bind(generationId)
            .first<GenerationRunRow>();
        }

        if (!generationRun) {
          return error("초안 생성 묶음을 준비하지 못했습니다. 다시 시도해 주세요.", 503);
        }
        if (
          generationRun.user_id !== user.id ||
          generationRun.draft_id !== normalized.draftId
        ) {
          return error("다른 계정이나 설교 작업의 생성 묶음에는 접근할 수 없습니다.", 403);
        }
        if (
          generationRun.expected_count !== expectedCount ||
          generationRun.ai_signature !== signature
        ) {
          return error("생성 도중 AI 설정이 변경되었습니다. 새 초안 묶음으로 다시 시작해 주세요.", 409);
        }

        const draftState = await db
          .prepare(
            "SELECT user_id, active_generation_id FROM sermon_drafts WHERE id = ?",
          )
          .bind(normalized.draftId)
          .first<DraftGenerationState>();
        if (!draftState || draftState.user_id !== user.id) {
          return error("설교 작업의 생성 상태를 확인할 수 없습니다.", 409);
        }
        const items = await loadGenerationItems(db, generationId);
        const cached = items.find((item) => item.position === position)?.alternative;
        if (generationStep !== undefined && generationPlan) {
          const storedPartRecords = await loadGenerationParts(
            db,
            generationId,
            position,
          );
          const storedParts = storedPartRecords.map((record) => record.part);
          const storedFragments = validateGenerationPartSequence(
            normalized,
            generationPlan,
            storedParts,
          );
          if (!storedFragments) {
            return error("서버에 저장된 설교 조각의 순서나 내용이 올바르지 않습니다. 새 초안 묶음으로 다시 시작해 주세요.", 409);
          }
          if (storedParts.length >= generationStep - 1) {
            acceptedGenerationParts = storedParts;
            acceptedGenerationFragments = storedFragments;
          } else if (
            clientGenerationParts.length === generationStep - 1 &&
            storedParts.every((part, index) =>
              sameGenerationPart(part, clientGenerationParts[index]),
            )
          ) {
            // Repair a partially unavailable persistence layer from the validated
            // browser copy on the next successful step.
            acceptedGenerationParts = clientGenerationParts;
            acceptedGenerationFragments = clientGenerationFragments ?? [];
          } else {
            return error("저장된 설교 조각이 일부 누락되었습니다. 마지막 저장 단계부터 다시 시도해 주세요.", 409);
          }
          const latestStored = storedPartRecords.at(-1);
          if (latestStored) {
            acceptedPartProvider = latestStored.provider;
            acceptedPartModel = latestStored.model;
            acceptedPartReasoningEffort = latestStored.reasoningEffort;
          }
        }
        if (generationRun.status === "completed") {
          if (!cached) {
            return error("완료된 초안 묶음의 저장 상태가 올바르지 않습니다.", 409);
          }
          return generationResponse({
            alternative: cached,
            generationId,
            position,
            complete: position === expectedCount,
            provider: generationRun.provider === "pending" ? "local" : generationRun.provider,
            model: generationRun.model,
            reasoningEffort: generationRun.reasoning_effort,
            persistence: "database",
            ...(generationStep !== undefined && generationPlan
              ? {
                  generationStep,
                  generationStepCount: generationPlan.length,
                  generationParts: acceptedGenerationParts,
                }
              : {}),
          });
        }
        if (
          generationRun.status !== "generating" ||
          draftState.active_generation_id !== generationId
        ) {
          return error("더 새로운 생성 작업이 시작되었습니다. 새 초안 묶음으로 다시 시작해 주세요.", 409);
        }
        if (
          generationStep !== undefined &&
          generationPlan &&
          acceptedGenerationParts.length >= generationStep
        ) {
          if (generationStep < generationPlan.length) {
            return generationResponse({
              generationId,
              position,
              complete: false,
              provider:
                acceptedPartProvider ??
                (generationRun.provider === "pending" ? userAi!.engine : generationRun.provider),
              model: acceptedPartModel ?? generationRun.model,
              reasoningEffort:
                acceptedPartReasoningEffort ?? generationRun.reasoning_effort,
              persistence: "database",
              generationStep,
              generationStepCount: generationPlan.length,
              generationParts: acceptedGenerationParts,
            });
          }
          if (!cached) {
            return error("마지막 설교 조각은 저장되었지만 완성 원고를 확인하지 못했습니다. 같은 단계를 다시 시도해 주세요.", 503);
          }
        }
        if (cached) {
          if (position === expectedCount) {
            const completed = await finalizeGeneration({
              db,
              generationId,
              draftId: normalized.draftId,
              userId: user.id,
              expectedCount,
              request: normalized,
            });
            if (!completed) {
              return error("더 새로운 생성 작업이 시작되었습니다. 새 초안 묶음으로 다시 시작해 주세요.", 409);
            }
          }
          return generationResponse({
            alternative: cached,
            generationId,
            position,
            complete: position === expectedCount,
            provider: generationRun.provider === "pending" ? "local" : generationRun.provider,
            model: generationRun.model,
            reasoningEffort: generationRun.reasoning_effort,
            persistence: "database",
            ...(generationStep !== undefined && generationPlan
              ? {
                  generationStep,
                  generationStepCount: generationPlan.length,
                  generationParts: acceptedGenerationParts,
                }
              : {}),
          });
        }
        if (
          items.length !== position - 1 ||
          items.some((item, index) => item.position !== index + 1)
        ) {
          return error(`${items.length + 1}번째 초안부터 순서대로 이어서 생성해 주세요.`, 409);
        }
        normalized.existingTitles = items.map((item) => item.alternative.title);
      }
    } catch (caught) {
      if (caught instanceof Response) return caught;
      databaseReady = false;
      if (userAi || splitGeneration) {
        return error("설교 생성 진행 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.", 503);
      }
    }
  }

  let positionLeaseToken: string | null = null;
  if (
    splitGeneration &&
    db &&
    user &&
    databaseReady &&
    generationRun &&
    generationId &&
    position
  ) {
    try {
      positionLeaseToken = await acquireGenerationPosition({
        db,
        generationId,
        draftId: normalized.draftId,
        userId: user.id,
        position,
      });
    } catch {
      return error("초안 생성 순서를 예약하지 못했습니다. 잠시 후 다시 시도해 주세요.", 503);
    }
    if (!positionLeaseToken) {
      return error("이 순번의 초안은 이미 생성 중입니다. 잠시 후 다시 시도해 주세요.", 409);
    }
  }

  try {
    if (
      splitGeneration &&
      position &&
      generationStep !== undefined &&
      acceptedGenerationFragments.length !== generationStep - 1
    ) {
      return error("설교 조각이 생성 순서대로 준비되지 않았습니다. 마지막 저장 단계부터 다시 시도해 주세요.", 409);
    }

    let tokenCharge: TokenCharge | null = null;
    if (user && !user.isDemo) {
      if (!db || !databaseReady) {
        return error("토큰 잔액을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.", 503);
      }
      try {
        tokenCharge = await chargeSermonTokens({
          db,
          userId: user.id,
          generationId: generationId!,
          duration,
          pointCount,
          ai: userAi,
        });
      } catch (caught) {
        if (caught instanceof InsufficientTokensError) {
          return Response.json(
            {
              error: caught.message,
              code: "insufficient_tokens",
              balance: caught.balance,
              required: caught.required,
              topUpUrl: "/tokens",
            },
            { status: 402, headers: { "Cache-Control": "no-store" } },
          );
        }
        return error("토큰을 차감하지 못했습니다. 잠시 후 다시 시도해 주세요.", 503);
      }
    }

    async function refundFailedGeneration(reason: string): Promise<void> {
      if (
        !tokenCharge ||
        !tokenCharge.charged ||
        !db ||
        !user ||
        (position !== undefined && position > 1) ||
        (generationStep !== undefined && generationStep > 1)
      ) {
        return;
      }
      await refundTokenCharge({
        db,
        userId: user.id,
        chargeReferenceId: tokenCharge.referenceId,
        reason,
      }).catch(() => undefined);
    }

    const useManagedAi = false;

  let alternatives: SermonAlternative[] = [];
  let provider = "local";
  let model: string | undefined;
  let reasoningEffort: string | undefined;
  let generatedGenerationPart: SermonGenerationPart | null = null;
  let generationPartElapsedMs = 0;
  try {
    if (
      splitGeneration &&
      position &&
      generationStep !== undefined &&
      generationPlan &&
      requestedGenerationStep
    ) {
      if (acceptedGenerationFragments.length !== generationStep - 1) {
        return error("설교 조각이 생성 순서대로 준비되지 않았습니다. 마지막 저장 단계부터 다시 시도해 주세요.", 409);
      }
      const fragmentStartedAt = Date.now();
      const aiResult = await generateAiSermonFragment(
        normalized,
        position,
        requestedGenerationStep,
        acceptedGenerationFragments,
        userAi,
        request.signal,
      );
      generationPartElapsedMs = Date.now() - fragmentStartedAt;
      if (!aiResult) {
        await refundFailedGeneration("AI 공급자가 첫 생성 결과를 반환하지 않음");
        return error("관리자 AI 엔진이 현재 설교 조각을 반환하지 않았습니다. 같은 단계부터 다시 시도해 주세요.", 502);
      }
      generatedGenerationPart = {
        position,
        step: generationStep,
        payload: aiResult.value as unknown as Record<string, unknown>,
      };
      acceptedGenerationParts = [
        ...acceptedGenerationParts.slice(0, generationStep - 1),
        generatedGenerationPart,
      ];
      acceptedGenerationFragments = [
        ...acceptedGenerationFragments,
        aiResult.value,
      ];
      provider = aiResult.engine;
      model = aiResult.model;
      reasoningEffort = aiResult.reasoningEffort;
      if (generationStep === generationPlan.length) {
        alternatives = [
          assembleAiSermonAlternative(
            normalized,
            position,
            acceptedGenerationFragments,
            `sermon-${generationId}-${position}`,
          ),
        ];
      }
    } else if (splitGeneration && position) {
      let sharedDesign: SermonDesignOutline[] | null = null;
      if ((userAi || useManagedAi) && db && generationId) {
        sharedDesign = await loadSharedSermonDesign(db, generationId);
        if (!sharedDesign && position === 1) {
          const designStartedAt = Date.now();
          const designResult = await generateSermonDesignOutlines(
            normalized,
            userAi,
            request.signal,
          );
          if (designResult) {
            sharedDesign = designResult.value;
            await saveSharedSermonDesign({
              db,
              generationId,
              design: designResult.value,
              provider: designResult.engine,
              model: designResult.model ?? null,
              reasoningEffort: designResult.reasoningEffort ?? null,
              elapsedMs: Date.now() - designStartedAt,
            });
          }
        }
      }
      const aiResult = userAi || useManagedAi
        ? await generateAiSermonAlternative(
            normalized,
            position,
            userAi,
            request.signal,
            sharedDesign?.[position - 1],
          )
        : null;
      alternatives = [
        aiResult?.value ?? generateLocalSermons(normalized)[position - 1],
      ];
      provider = aiResult?.engine ?? "local";
      model = aiResult?.model;
      reasoningEffort = aiResult?.reasoningEffort;
    } else {
      const aiResult = userAi || useManagedAi
        ? await generateAiSermons(normalized, userAi, request.signal)
        : null;
      alternatives = aiResult?.value ?? generateLocalSermons(normalized);
      provider = aiResult?.engine ?? "local";
      model = aiResult?.model;
      reasoningEffort = aiResult?.reasoningEffort;
    }
  } catch (caught) {
    await refundFailedGeneration(
      caught instanceof Error ? caught.message : "AI 공급자 호출 실패",
    );
    if (caught instanceof UserAiProviderError) {
      return error(caught.message, caught.httpStatus);
    }
    return error("관리자 AI 엔진으로 설교를 생성하지 못했습니다.", 502);
  }

  let persistence: "database" | "local" = "local";
  if (db && user && databaseReady) {
    try {
      const now = new Date().toISOString();
      const userStatement = db
        .prepare(
          "INSERT INTO users (id, email, name, role, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET email=excluded.email, name=excluded.name",
        )
        .bind(user.id, user.email, user.name, user.role, now);

      if (splitGeneration && generationId && position && generationRun) {
        if (!positionLeaseToken) {
          return error("초안 생성 순서를 확인하지 못했습니다. 다시 시도해 주세요.", 409);
        }
        if (
          generationStep !== undefined &&
          generationPlan &&
          generatedGenerationPart
        ) {
          const finalAlternative = alternatives[0];
          const partStatements = acceptedGenerationParts.map((part) =>
            db
              .prepare(
                `INSERT INTO sermon_generation_parts
                  (id, generation_id, position, step, part_json, provider, model,
                   reasoning_effort, elapsed_ms, created_at)
                 SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
                 WHERE EXISTS (
                   SELECT 1
                   FROM sermon_generation_runs r
                   JOIN sermon_drafts d ON d.id = r.draft_id
                   JOIN sermon_generation_claims c
                     ON c.generation_id = r.id AND c.position = ?
                   WHERE r.id = ? AND r.draft_id = ? AND r.user_id = ?
                     AND r.status = 'generating' AND d.user_id = ?
                     AND d.active_generation_id = r.id AND c.lease_token = ?
                 )
                 ON CONFLICT(generation_id, position, step) DO NOTHING`,
              )
              .bind(
                crypto.randomUUID(),
                generationId,
                position,
                part.step,
                JSON.stringify(part.payload),
                provider,
                model ?? null,
                reasoningEffort ?? null,
                part.step === generationStep ? generationPartElapsedMs : 0,
                now,
                position,
                generationId,
                normalized.draftId,
                user.id,
                user.id,
                positionLeaseToken,
              ),
          );
          const finalAlternativeStatements = finalAlternative
            ? [
                db
                  .prepare(
                    `INSERT INTO sermon_generation_items
                      (id, generation_id, position, alternative_json, created_at)
                     SELECT ?, ?, ?, ?, ?
                     WHERE EXISTS (
                       SELECT 1
                       FROM sermon_generation_runs r
                       JOIN sermon_drafts d ON d.id = r.draft_id
                       JOIN sermon_generation_claims c
                         ON c.generation_id = r.id AND c.position = ?
                       WHERE r.id = ? AND r.draft_id = ? AND r.user_id = ?
                         AND r.status = 'generating' AND d.user_id = ?
                         AND d.active_generation_id = r.id AND c.lease_token = ?
                     )
                     ON CONFLICT(generation_id, position) DO NOTHING`,
                  )
                  .bind(
                    crypto.randomUUID(),
                    generationId,
                    position,
                    JSON.stringify(finalAlternative),
                    now,
                    position,
                    generationId,
                    normalized.draftId,
                    user.id,
                    user.id,
                    positionLeaseToken,
                  ),
              ]
            : [];
          const stageResults = await db.batch([
            userStatement,
            db
              .prepare(
                `UPDATE sermon_drafts SET updated_at = updated_at
                 WHERE id = ? AND user_id = ? AND active_generation_id = ?`,
              )
              .bind(normalized.draftId, user.id, generationId),
            ...partStatements,
            ...finalAlternativeStatements,
            db
              .prepare(
                `UPDATE sermon_generation_runs
                 SET provider = ?, model = ?, reasoning_effort = ?, updated_at = ?
                 WHERE id = ? AND user_id = ? AND status = 'generating'
                   AND EXISTS (
                     SELECT 1
                     FROM sermon_drafts d
                     JOIN sermon_generation_claims c
                       ON c.generation_id = ? AND c.position = ?
                     WHERE d.id = ? AND d.user_id = ?
                       AND d.active_generation_id = ? AND c.lease_token = ?
                   )`,
              )
              .bind(
                provider,
                model ?? null,
                reasoningEffort ?? null,
                now,
                generationId,
                user.id,
                generationId,
                position,
                normalized.draftId,
                user.id,
                generationId,
                positionLeaseToken,
              ),
            db
              .prepare(
                `DELETE FROM sermon_generation_claims
                 WHERE generation_id = ? AND position = ? AND lease_token = ?`,
              )
              .bind(generationId, position, positionLeaseToken),
          ]);
          if ((stageResults[1]?.meta.changes ?? 0) < 1) {
            return error("더 새로운 생성 작업이 시작되었습니다. 새 초안 묶음으로 다시 시작해 주세요.", 409);
          }

          const savedPartRecords = await loadGenerationParts(
            db,
            generationId,
            position,
          );
          const savedParts = savedPartRecords.map((record) => record.part);
          const savedFragments = validateGenerationPartSequence(
            normalized,
            generationPlan,
            savedParts,
          );
          if (!savedFragments || savedParts.length !== generationStep) {
            return error("완성된 설교 조각의 저장 결과를 확인하지 못했습니다. 같은 단계부터 다시 시도해 주세요.", 503);
          }
          acceptedGenerationParts = savedParts;
          acceptedGenerationFragments = savedFragments;
          const latestSavedPart = savedPartRecords.at(-1);
          persistence = "database";

          if (!finalAlternative) {
            return generationResponse({
              generationId,
              position,
              complete: false,
              provider: latestSavedPart?.provider ?? provider,
              model: latestSavedPart?.model ?? model,
              reasoningEffort:
                latestSavedPart?.reasoningEffort ?? reasoningEffort,
              persistence,
              generationStep,
              generationStepCount: generationPlan.length,
              generationParts: acceptedGenerationParts,
            });
          }

          const savedItem = await db
            .prepare(
              "SELECT alternative_json FROM sermon_generation_items WHERE generation_id = ? AND position = ?",
            )
            .bind(generationId, position)
            .first<{ alternative_json: string }>();
          const savedAlternative = savedItem
            ? parseGenerationAlternative(savedItem.alternative_json)
            : null;
          if (!savedAlternative) {
            return error("완성된 초안의 저장 결과를 확인하지 못했습니다. 같은 단계부터 다시 시도해 주세요.", 503);
          }
          if (position === expectedCount) {
            const completed = await finalizeGeneration({
              db,
              generationId,
              draftId: normalized.draftId,
              userId: user.id,
              expectedCount,
              request: normalized,
            });
            if (!completed) {
              return error("더 새로운 생성 작업이 시작되었습니다. 새 초안 묶음으로 다시 시작해 주세요.", 409);
            }
          }
          return generationResponse({
            alternative: savedAlternative,
            generationId,
            position,
            complete: position === expectedCount,
            provider: latestSavedPart?.provider ?? provider,
            model: latestSavedPart?.model ?? model,
            reasoningEffort:
              latestSavedPart?.reasoningEffort ?? reasoningEffort,
            persistence,
            generationStep,
            generationStepCount: generationPlan.length,
            generationParts: acceptedGenerationParts,
          });
        }
        const alternative = alternatives[0];
        const stageResults = await db.batch([
          userStatement,
          db
            .prepare(
              `UPDATE sermon_drafts SET updated_at = updated_at
               WHERE id = ? AND user_id = ? AND active_generation_id = ?`,
            )
            .bind(
              normalized.draftId,
              user.id,
              generationId,
            ),
          db
            .prepare(
              `INSERT INTO sermon_generation_items
                (id, generation_id, position, alternative_json, created_at)
               SELECT ?, ?, ?, ?, ?
               WHERE EXISTS (
                 SELECT 1
                 FROM sermon_generation_runs r
                 JOIN sermon_drafts d ON d.id = r.draft_id
                 JOIN sermon_generation_claims c
                   ON c.generation_id = r.id AND c.position = ?
                 WHERE r.id = ? AND r.draft_id = ? AND r.user_id = ?
                   AND r.status = 'generating' AND d.user_id = ?
                   AND d.active_generation_id = r.id AND c.lease_token = ?
               )
               ON CONFLICT(generation_id, position) DO NOTHING`,
            )
            .bind(
              crypto.randomUUID(),
              generationId,
              position,
              JSON.stringify(alternative),
              now,
              position,
              generationId,
              normalized.draftId,
              user.id,
              user.id,
              positionLeaseToken,
            ),
          db
            .prepare(
              `UPDATE sermon_generation_runs
               SET provider = ?, model = ?, reasoning_effort = ?, updated_at = ?
               WHERE id = ? AND user_id = ? AND status = 'generating'
                 AND EXISTS (
                   SELECT 1
                   FROM sermon_drafts d
                   JOIN sermon_generation_claims c
                     ON c.generation_id = ? AND c.position = ?
                   WHERE d.id = ? AND d.user_id = ?
                     AND d.active_generation_id = ? AND c.lease_token = ?
                 )`,
            )
            .bind(
              provider,
              model ?? null,
              reasoningEffort ?? null,
              now,
              generationId,
              user.id,
              generationId,
              position,
              normalized.draftId,
              user.id,
              generationId,
              positionLeaseToken,
            ),
          db
            .prepare(
              `DELETE FROM sermon_generation_claims
               WHERE generation_id = ? AND position = ? AND lease_token = ?`,
            )
            .bind(generationId, position, positionLeaseToken),
        ]);
        if ((stageResults[1]?.meta.changes ?? 0) < 1) {
          return error("더 새로운 생성 작업이 시작되었습니다. 새 초안 묶음으로 다시 시작해 주세요.", 409);
        }
        const savedItem = await db
          .prepare(
            "SELECT alternative_json FROM sermon_generation_items WHERE generation_id = ? AND position = ?",
          )
          .bind(generationId, position)
          .first<{ alternative_json: string }>();
        const savedAlternative = savedItem
          ? parseGenerationAlternative(savedItem.alternative_json)
          : null;
        if (!savedAlternative) {
          return error("완성된 초안의 저장 결과를 확인하지 못했습니다. 같은 초안을 다시 시도해 주세요.", 503);
        }
        alternatives = [savedAlternative];
        if (position === expectedCount) {
          const completed = await finalizeGeneration({
            db,
            generationId,
            draftId: normalized.draftId,
            userId: user.id,
            expectedCount,
            request: normalized,
          });
          if (!completed) {
            return error("더 새로운 생성 작업이 시작되었습니다. 새 초안 묶음으로 다시 시작해 주세요.", 409);
          }
        }
        persistence = "database";
      } else {
        await db.batch([
          userStatement,
          db
            .prepare(
              `INSERT INTO sermon_drafts
                (id, user_id, topic, scripture, sermon_type, audience, audience_situation, point_count,
                 duration, emotion, reference_mode, status, selected_alternative_id,
                 revision_count, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'alternatives_ready', NULL, 0, ?, ?)
               ON CONFLICT(id) DO UPDATE SET
                 topic=excluded.topic, scripture=excluded.scripture,
                 sermon_type=excluded.sermon_type, audience=excluded.audience,
                 audience_situation=excluded.audience_situation,
                 point_count=excluded.point_count, duration=excluded.duration,
                 emotion=excluded.emotion, reference_mode=excluded.reference_mode,
                 status='alternatives_ready', selected_alternative_id=NULL,
                 revision_count=0, updated_at=excluded.updated_at`,
            )
            .bind(
              normalized.draftId,
              user.id,
              normalized.options.topic,
              normalized.scripture,
              normalized.options.sermonType,
              normalized.options.audience,
              normalized.options.audienceSituation,
              normalized.options.pointCount,
              normalized.options.duration,
              normalized.options.tone,
              normalized.options.referenceMode,
              now,
              now,
            ),
          db
            .prepare("DELETE FROM sermon_alternatives WHERE draft_id = ?")
            .bind(normalized.draftId),
          db
            .prepare("DELETE FROM sermon_versions WHERE draft_id = ?")
            .bind(normalized.draftId),
          ...alternatives.map((alternative, index) =>
            db
              .prepare(
                `INSERT INTO sermon_alternatives
                  (id, draft_id, position, title, scripture, introduction, body_json, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              )
              .bind(
                alternative.id,
                normalized.draftId,
                index + 1,
                alternative.title,
                alternative.scripture,
                alternative.sections.introduction,
                JSON.stringify(alternative.sections),
                now,
              ),
          ),
        ]);
        persistence = "database";
      }
    } catch {
      if (splitGeneration) {
        return error("완성된 초안의 진행 상태를 저장하지 못했습니다. 같은 초안을 다시 시도해 주세요.", 503);
      }
      persistence = "local";
    }
  }

  if (splitGeneration && generationId && position) {
    return generationResponse({
      alternative: alternatives[0],
      generationId,
      position,
      complete:
        generationStep !== undefined && generationPlan
          ? generationStep === generationPlan.length && position === expectedCount
          : position === expectedCount,
      provider,
      model,
      reasoningEffort,
      persistence,
      guest: !user,
      ...(generationStep !== undefined && generationPlan
        ? {
            generationStep,
            generationStepCount: generationPlan.length,
            generationParts: acceptedGenerationParts,
          }
        : {}),
    });
  }

  const responseAlternatives = user ? alternatives : limitedGuestPreview(alternatives);
  return Response.json(
    {
      alternatives: responseAlternatives,
      ...(!user ? { guestPreview: true } : {}),
      provider,
      ...(model ? { model } : {}),
      ...(reasoningEffort ? { reasoningEffort } : {}),
      persistence,
    },
    {
      headers: {
        "Cache-Control": "no-store",
        ...(!user ? { "Set-Cookie": guestPreviewCookie() } : {}),
      },
    },
  );
  } finally {
    if (db && generationId && position && positionLeaseToken) {
      await releaseGenerationPosition({
        db,
        generationId,
        position,
        leaseToken: positionLeaseToken,
      });
    }
  }
}
