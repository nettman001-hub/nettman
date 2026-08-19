import type { AiEngine, AiReasoningEffort, AiRequestConfig } from "./ai-config";
import {
  isAiEngineTier,
  type AiEngineTier,
} from "./ai-engine-tiers.ts";

export const SERMON_DURATIONS = [10, 15, 20, 25, 30] as const;
export const MAX_SERMON_TITLE_LENGTH = 100;
export const SERMON_TONES = ["위로", "도전", "권면"] as const;
export const MAX_SERMON_TONE_LENGTH = 40;
export const SERMON_TYPES = ["강해", "주제", "내러티브"] as const;
export const SERMON_AUDIENCES = ["청소년", "청년", "청장년", "장년"] as const;
export const SERMON_AUDIENCE_SITUATIONS = [
  "일반",
  "장례",
  "개업",
  "취업",
  "이사",
  "결혼",
  "출산",
  "자녀",
  "학업",
  "진로",
] as const;
export const MAX_SERMON_AUDIENCE_SITUATION_LENGTH = 40;
export const SERMON_POINT_COUNTS = [1, 2, 3, 4] as const;
export const SERMON_ALTERNATIVE_POSITIONS = [1, 2, 3, 4, 5] as const;

export type SermonDuration = (typeof SERMON_DURATIONS)[number];
export type SermonTone = (typeof SERMON_TONES)[number];
export type SermonType = (typeof SERMON_TYPES)[number];
export type SermonAudience = (typeof SERMON_AUDIENCES)[number];
export type SermonAudienceSituation =
  (typeof SERMON_AUDIENCE_SITUATIONS)[number];
export type SermonPointCount = (typeof SERMON_POINT_COUNTS)[number];
export type SermonAlternativePosition =
  (typeof SERMON_ALTERNATIVE_POSITIONS)[number];
export type SermonAiTiers = [
  AiEngineTier,
  AiEngineTier,
  AiEngineTier,
  AiEngineTier,
  AiEngineTier,
];

export type SermonStage =
  | "options"
  | "input"
  | "generating"
  | "alternatives"
  | "editing"
  | "completed";

export type ReferenceMode = "auto" | "manual";

export type ReferenceFile = {
  name: string;
  type: string;
  size: number;
  /** TXT 파일만 브라우저에서 안전하게 읽어 생성 요청에 포함합니다. */
  text?: string;
};

export type SermonOptions = {
  topic: string;
  /** 첫 번째 초안 엔진. 이전 저장 데이터와 수정 요청의 호환성을 위해 유지합니다. */
  aiTier: AiEngineTier;
  /** 이전 저장 데이터와 API 호환을 위한 다섯 칸짜리 미러입니다. 모든 값은 aiTier와 같습니다. */
  aiTiers: SermonAiTiers;
  duration: SermonDuration | null;
  targetCharacters: number | null;
  /** 기본 감정선 또는 사용자가 '기타'에 입력한 짧은 감정선입니다. */
  tone: string;
  sermonType: SermonType | "";
  audience: SermonAudience | "";
  /** 기본 청중 상황 또는 사용자가 '기타'에 입력한 짧은 상황입니다. */
  audienceSituation: string;
  pointCount: SermonPointCount | null;
  referenceMode: ReferenceMode;
};

export type SermonReference = {
  url: string;
  notes: string;
  file: ReferenceFile | null;
};

export type ScriptureNormalization = {
  input: string;
  canonical: string;
  normalizedAt: string;
  aiTier: AiEngineTier;
  clientUserScope: string | null;
  normalizedByAi: boolean;
  confirmedByUserAt: string | null;
  grant: string | null;
  grantExpiresAt: string | null;
};

export type NormalizeScriptureRequest = {
  draftId: string;
  scripture: string;
  aiTier: AiEngineTier;
  clientUserScope?: string;
};

export type NormalizeScriptureResponse = {
  scripture: string;
  normalizedByAi: boolean;
  grant: string | null;
  grantExpiresAt: string | null;
};

export type SermonPoint = {
  heading: string;
  content: string;
};

export type SermonSections = {
  introduction: string;
  points: SermonPoint[];
  conclusion: string;
  application: string;
};

export type SermonAlternative = {
  id: string;
  title: string;
  summary: string;
  scripture: string;
  sections: SermonSections;
};

export type SermonGenerationPart = {
  position: SermonAlternativePosition;
  step: number;
  payload: Record<string, unknown>;
};

export type SermonGeneration = {
  id: string;
  mode: "initial" | "regenerate";
  expectedCount: 1 | 5;
  alternatives: SermonAlternative[];
  parts: SermonGenerationPart[];
  startedAt: string;
};

export type SermonVersion = {
  id: string;
  sermon: SermonAlternative;
  createdAt: string;
  instruction?: string;
};

export type SermonRevision = {
  id: string;
  section: "introduction" | "body" | "conclusion" | "application";
  instruction: string;
  toneAdjustment: string;
  createdAt: string;
};

export type SermonDraft = {
  id: string;
  stage: SermonStage;
  createdAt: string;
  updatedAt: string;
  options: SermonOptions;
  scripture: string;
  scriptureNormalization: ScriptureNormalization | null;
  reference: SermonReference;
  alternatives: SermonAlternative[];
  generation: SermonGeneration | null;
  selectedAlternativeId: string | null;
  versions: SermonVersion[];
  revisions: SermonRevision[];
  revisionCount: number;
  completedAt: string | null;
  savedSermonId: string | null;
  saveMode: "server" | "local" | null;
};

/**
 * Authentication-bound pastoral settings that only a server route may attach
 * to an AI request. Contact details deliberately do not belong to this type.
 */
export type SermonPreacherContext = {
  denomination?: string;
  theology?: string;
  ministryRole?: string;
  church?: string;
};

export type GenerateSermonsRequest = {
  draftId: string;
  clientUserScope?: string;
  generationId?: string;
  alternativePosition?: SermonAlternativePosition;
  generationStep?: number;
  generationParts?: SermonGenerationPart[];
  existingTitles?: string[];
  options: SermonOptions;
  scripture: string;
  scriptureNormalizationGrant?: string;
  reference: SermonReference;
  /** Server-derived only. Routes must ignore a client-supplied value. */
  preacherContext?: SermonPreacherContext;
  ai?: AiRequestConfig;
};

export type GenerateSermonsResponse = {
  alternatives: SermonAlternative[];
  generationId?: string;
  position?: SermonAlternativePosition;
  generationStep?: number;
  generationStepCount?: number;
  generationParts?: SermonGenerationPart[];
  complete?: boolean;
  guestPreview?: boolean;
  provider: "local" | AiEngine;
  model?: string;
  reasoningEffort?: AiReasoningEffort;
};

export type ReviseSermonRequest = {
  draftId: string;
  clientUserScope?: string;
  sermon: SermonAlternative;
  options: SermonOptions;
  section: SermonRevision["section"];
  instruction: string;
  toneAdjustment: string;
  revisionCount: number;
  /** Server-derived only. Routes must ignore a client-supplied value. */
  preacherContext?: SermonPreacherContext;
  ai?: AiRequestConfig;
};

export type ReviseSermonResponse = {
  sermon: SermonAlternative;
  provider: "local" | AiEngine;
  model?: string;
  reasoningEffort?: AiReasoningEffort;
  revisionSummary: string;
};

export const EMPTY_SERMON_OPTIONS: SermonOptions = {
  topic: "",
  aiTier: "basic",
  aiTiers: ["basic", "basic", "basic", "basic", "basic"],
  duration: null,
  targetCharacters: null,
  tone: "",
  sermonType: "",
  audience: "",
  audienceSituation: "",
  pointCount: null,
  referenceMode: "auto",
};

export const EMPTY_SERMON_REFERENCE: SermonReference = {
  url: "",
  notes: "",
  file: null,
};

export function durationToTargetCharacters(duration: SermonDuration): number {
  return ({ 10: 3000, 15: 4000, 20: 5000, 25: 6500, 30: 8000 } as const)[
    duration
  ];
}

export function normalizeSermonAiTiers(value: {
  aiTier?: unknown;
  aiTiers?: unknown;
}): SermonAiTiers {
  const legacyTier =
    Array.isArray(value.aiTiers) &&
    value.aiTiers.length === SERMON_ALTERNATIVE_POSITIONS.length &&
    value.aiTiers.every(isAiEngineTier)
      ? value.aiTiers[0]
      : "basic";
  const selected = isAiEngineTier(value.aiTier) ? value.aiTier : legacyTier;
  return [selected, selected, selected, selected, selected];
}

export function isSermonToneValue(value: unknown): value is string {
  return isShortSafeOption(value, MAX_SERMON_TONE_LENGTH);
}

export function isSermonTitleValue(value: unknown): value is string {
  return isShortSafeOption(value, MAX_SERMON_TITLE_LENGTH);
}

export function isSermonAudienceSituationValue(
  value: unknown,
): value is string {
  return isShortSafeOption(value, MAX_SERMON_AUDIENCE_SITUATION_LENGTH);
}

function isShortSafeOption(value: unknown, maximumLength: number): value is string {
  if (typeof value !== "string") return false;
  const normalized = value.trim();
  return (
    normalized.length >= 2 &&
    normalized.length <= maximumLength &&
    ![...normalized].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    })
  );
}

export function sermonAiTierForPosition(
  options: Pick<SermonOptions, "aiTier" | "aiTiers">,
  position: SermonAlternativePosition,
): AiEngineTier {
  return normalizeSermonAiTiers(options)[position - 1];
}

export function isSermonOptionsComplete(options: SermonOptions): boolean {
  return (
    isSermonTitleValue(options.topic) &&
    isAiEngineTier(options.aiTier) &&
    normalizeSermonAiTiers(options).every(isAiEngineTier) &&
    SERMON_DURATIONS.includes(options.duration as SermonDuration) &&
    isSermonToneValue(options.tone) &&
    SERMON_TYPES.includes(options.sermonType as SermonType) &&
    SERMON_AUDIENCES.includes(options.audience as SermonAudience) &&
    isSermonAudienceSituationValue(options.audienceSituation) &&
    SERMON_POINT_COUNTS.includes(options.pointCount as SermonPointCount)
  );
}

export function sermonPlainText(sermon: SermonAlternative): string {
  const points = sermon.sections.points
    .map((point, index) => `${index + 1}. ${point.heading}\n${point.content}`)
    .join("\n\n");

  return [
    sermon.title,
    `본문: ${sermon.scripture}`,
    `도입\n${sermon.sections.introduction}`,
    `본론\n${points}`,
    `결론\n${sermon.sections.conclusion}`,
    `적용\n${sermon.sections.application}`,
  ].join("\n\n");
}

export function isSermonAlternative(value: unknown): value is SermonAlternative {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SermonAlternative>;
  return Boolean(
    typeof candidate.id === "string" &&
      typeof candidate.title === "string" &&
      typeof candidate.summary === "string" &&
      typeof candidate.scripture === "string" &&
      candidate.sections &&
      typeof candidate.sections.introduction === "string" &&
      Array.isArray(candidate.sections.points) &&
      candidate.sections.points.length > 0 &&
      candidate.sections.points.every(
        (point) =>
          point &&
          typeof point.heading === "string" &&
          typeof point.content === "string",
      ) &&
      typeof candidate.sections.conclusion === "string" &&
      typeof candidate.sections.application === "string",
  );
}
