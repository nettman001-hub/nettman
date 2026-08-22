export const AI_ENGINE_TIERS = ["basic", "advanced", "reasoning"] as const;

export type AiEngineTier = (typeof AI_ENGINE_TIERS)[number];

export const AI_ENGINE_SURFACES = ["sermon", "resource", "agent", "coach"] as const;

export type AiEngineSurface = (typeof AI_ENGINE_SURFACES)[number];

/** Public, non-secret runtime state used by every engine selector. */
export type AiEngineTierAvailability = {
  tier: AiEngineTier;
  /** Administrator-controlled allow/deny switch. */
  enabled: boolean;
  /** The saved provider configuration and required credential are usable. */
  configured: boolean;
  /** Provider policy by data surface; independent from enabled/configured. */
  availableFor: Record<AiEngineSurface, boolean>;
};

export type AiEngineTierAvailabilityResponse = {
  tiers: AiEngineTierAvailability[];
};

export const AI_ENGINE_TIER_META: Record<
  AiEngineTier,
  { label: string; description: string }
> = {
  basic: {
    label: "기본 엔진",
    description: "초안과 일반적인 설교 작성을 위한 엔진입니다.",
  },
  advanced: {
    label: "고급 엔진",
    description: "더 정교한 구성과 표현이 필요한 설교를 위한 엔진입니다.",
  },
  reasoning: {
    label: "고급 추론 엔진",
    description: "깊은 본문 분석과 복합적인 논리 전개를 위한 엔진입니다.",
  },
};

export function isAiEngineTier(value: unknown): value is AiEngineTier {
  return (
    typeof value === "string" &&
    (AI_ENGINE_TIERS as readonly string[]).includes(value)
  );
}

export function isAiEngineTierAvailabilityResponse(
  value: unknown,
): value is AiEngineTierAvailabilityResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const tiers = (value as { tiers?: unknown }).tiers;
  if (!Array.isArray(tiers) || tiers.length !== AI_ENGINE_TIERS.length) return false;

  const seen = new Set<AiEngineTier>();
  for (const entry of tiers) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    const candidate = entry as Record<string, unknown>;
    const availableFor = candidate.availableFor;
    if (
      !isAiEngineTier(candidate.tier) ||
      typeof candidate.enabled !== "boolean" ||
      typeof candidate.configured !== "boolean" ||
      !availableFor ||
      typeof availableFor !== "object" ||
      Array.isArray(availableFor) ||
      Object.keys(availableFor).length !== AI_ENGINE_SURFACES.length ||
      !AI_ENGINE_SURFACES.every(
        (surface) =>
          typeof (availableFor as Record<string, unknown>)[surface] === "boolean",
      ) ||
      seen.has(candidate.tier)
    ) {
      return false;
    }
    seen.add(candidate.tier);
  }
  return AI_ENGINE_TIERS.every((tier) => seen.has(tier));
}

export function isAiEngineTierAvailable(
  availability: AiEngineTierAvailability,
  surface: AiEngineSurface,
): boolean {
  return (
    availability.enabled &&
    availability.configured &&
    availability.availableFor[surface]
  );
}
