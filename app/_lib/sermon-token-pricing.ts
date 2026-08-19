import type { AiEngineTier } from "./ai-engine-tiers.ts";

export const SERMON_PRICING_DURATIONS = [10, 15, 20, 25, 30] as const;
export const SERMON_PRICING_POINT_COUNTS = [1, 2, 3, 4] as const;

export type SermonPricingDuration = (typeof SERMON_PRICING_DURATIONS)[number];
export type SermonPricingPointCount = (typeof SERMON_PRICING_POINT_COUNTS)[number];

/** Engine quality still affects cost, while draft count never does. */
export const SERMON_TOKEN_ENGINE_MULTIPLIERS: Record<AiEngineTier, number> = {
  basic: 1,
  advanced: 2,
  reasoning: 4,
};

export const SERMON_TOKEN_MINIMUM_COSTS: Record<AiEngineTier, number> = {
  basic: 15,
  advanced: 30,
  reasoning: 60,
};

/**
 * One token quote covers one complete generation run, including all five drafts.
 * The minimum is a 10-minute, 1-point sermon. Each extra main point adds two base
 * units before the selected engine multiplier is applied.
 */
export function sermonGenerationTokenCost(
  tier: AiEngineTier,
  duration: SermonPricingDuration,
  pointCount: SermonPricingPointCount,
): number {
  const baseUnits = duration + 5 + 2 * (pointCount - 1);
  return Math.max(
    SERMON_TOKEN_MINIMUM_COSTS[tier],
    SERMON_TOKEN_ENGINE_MULTIPLIERS[tier] * baseUnits,
  );
}
