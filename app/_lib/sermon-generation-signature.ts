import type { AiEngineTier } from "./ai-engine-tiers.ts";
import type { GenerateSermonsRequest } from "./sermon-types.ts";

type SignatureConfig = {
  engine: string;
  endpoint: string;
  model: string;
  reasoningEffort: string;
  maxOutputTokens: number | null;
};

export type SermonGenerationSignatureConfigs = Record<
  AiEngineTier,
  SignatureConfig | undefined
>;

async function sha256Hex(payload: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function generationRequestIdentity(request: GenerateSermonsRequest): unknown {
  return {
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
      worshipType: request.options.worshipType,
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
  };
}

/** Byte-for-byte field order used by generation runs stored before v2. */
function legacyGenerationRequestIdentity(
  request: GenerateSermonsRequest,
): unknown {
  return {
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
  };
}

export async function sermonGenerationRequestSignature(
  request: GenerateSermonsRequest,
): Promise<string> {
  return sha256Hex(generationRequestIdentity(request));
}

export async function sermonGenerationSignature(
  managedAiConfigs: SermonGenerationSignatureConfigs,
  request: GenerateSermonsRequest,
): Promise<string> {
  const [requestSignature, providerSignature] = await Promise.all([
    sermonGenerationRequestSignature(request),
    sha256Hex({
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
    }),
  ]);
  return `v2.${requestSignature}.${providerSignature}`;
}

/** Exact v1 hash retained only to validate pre-v2 durable runs during replay. */
export async function sermonGenerationLegacySignature(
  managedAiConfigs: SermonGenerationSignatureConfigs,
  request: GenerateSermonsRequest,
): Promise<string> {
  return sha256Hex({
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
    ...(legacyGenerationRequestIdentity(request) as Record<string, unknown>),
  });
}

export function sermonGenerationRunRequestMatches(
  storedSignature: string,
  requestSignature: string,
): boolean | null {
  const match = /^v2\.([a-f0-9]{64})\.[a-f0-9]{64}$/.exec(storedSignature);
  if (!match) return null;
  return match[1] === requestSignature;
}
