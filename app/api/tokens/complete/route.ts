import { resolveRequestUser, unauthorizedResponse } from "@/app/_lib/auth-user";
import {
  confirmPortOneOrder,
  findPortOneOrder,
} from "@/app/_lib/portone-payments";
import { ensureDatabase, getD1 } from "@/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function error(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request): Promise<Response> {
  const user = await resolveRequestUser(request);
  if (!user) return unauthorizedResponse();
  const db = getD1();
  if (!db) return error("토큰 지갑 저장소에 연결할 수 없습니다.", 503);

  let input: { paymentId?: unknown; transactionId?: unknown };
  try {
    input = (await request.json()) as typeof input;
  } catch {
    return error("결제번호를 확인해 주세요.");
  }
  const paymentId = typeof input.paymentId === "string" ? input.paymentId : "";
  const transactionId =
    typeof input.transactionId === "string" ? input.transactionId : undefined;
  if (!/^[A-Za-z0-9]{1,40}$/.test(paymentId)) {
    return error("결제번호 형식이 올바르지 않습니다.");
  }

  try {
    await ensureDatabase(db);
    const order = await findPortOneOrder(db, paymentId, user.id);
    if (!order) return error("현재 계정의 결제 주문을 찾지 못했습니다.", 404);
    const result = await confirmPortOneOrder({ db, order, transactionId });
    return Response.json({ completed: true, alreadyCompleted: result.alreadyCompleted });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "";
    if (message.includes("아직 완료되지")) {
      return error("결제가 아직 완료되지 않았습니다.", 409);
    }
    return error("결제 승인을 확인하지 못했습니다. 잠시 후 다시 확인해 주세요.", 502);
  }
}
