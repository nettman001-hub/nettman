import { getManagedAiEngineRuntime } from "@/app/_lib/managed-ai-engines";
import { getD1 } from "@/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
  Pragma: "no-cache",
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE_HEADERS });
}

/**
 * Public because the guest sermon preview renders the same selector. The
 * response deliberately contains only tier switches/readiness, never provider
 * URLs, model identifiers, credentials, or administrator identity.
 */
export async function GET(): Promise<Response> {
  const db = getD1();
  if (!db && process.env.NODE_ENV === "production") {
    return json(
      {
        error: "AI 엔진 상태 저장소에 연결할 수 없습니다.",
        code: "ai_engine_status_unavailable",
      },
      503,
    );
  }

  try {
    const runtimeState = await getManagedAiEngineRuntime(db);
    return json({ tiers: runtimeState.tiers });
  } catch {
    return json(
      {
        error: "AI 엔진 상태를 불러오지 못했습니다.",
        code: "ai_engine_status_unavailable",
      },
      503,
    );
  }
}
