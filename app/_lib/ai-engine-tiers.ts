export const AI_ENGINE_TIERS = ["basic", "advanced", "reasoning"] as const;

export type AiEngineTier = (typeof AI_ENGINE_TIERS)[number];

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
