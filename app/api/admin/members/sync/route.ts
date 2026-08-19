import {
  adminJson,
  adminRequestId,
  readAdminJsonBody,
  requireAdminRequest,
} from "@/app/_lib/admin-actions";
import {
  AdminMemberSyncRequestConflictError,
  readAdminAuthDirectorySyncReplay,
  synchronizeAdminAuthDirectory,
} from "@/app/_lib/admin-member-sync";
import { listAdminAuthDirectoryUsers } from "@/app/_lib/supabase/admin";
import { ensureDatabase, getD1 } from "@/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const auth = await requireAdminRequest(request);
  if ("response" in auth) return auth.response;
  const parsed = await readAdminJsonBody(request, 4_096);
  if (!parsed.ok) return parsed.response;
  const requestId = adminRequestId(parsed.value.requestId);
  if (!requestId) {
    return adminJson({ error: "회원 동기화 요청 번호를 확인해 주세요." }, 400);
  }

  const db = getD1();
  if (!db) return adminJson({ error: "회원 저장소에 연결할 수 없습니다." }, 503);

  try {
    await ensureDatabase(db);
    const replay = await readAdminAuthDirectorySyncReplay(
      db,
      auth.user.id,
      requestId,
    );
    if (replay) return adminJson({ ok: true, ...replay });
    const directory = await listAdminAuthDirectoryUsers();
    if (!directory.ok) {
      const status = directory.code === "rate_limited"
        ? 429
        : directory.available
          ? 502
          : 503;
      return adminJson({ error: directory.error, code: directory.code }, status);
    }
    const result = await synchronizeAdminAuthDirectory(db, {
      actorUserId: auth.user.id,
      requestId,
      users: directory.users,
      authTotal: directory.authTotal,
      skipped: directory.skipped,
    });
    return adminJson({ ok: true, ...result });
  } catch (error) {
    if (error instanceof AdminMemberSyncRequestConflictError) {
      return adminJson({ error: error.message }, 409);
    }
    console.error(
      "[admin-members] auth directory sync failed",
      error instanceof Error ? error.message : "unknown",
    );
    return adminJson({ error: "기존 가입 회원을 동기화하지 못했습니다." }, 503);
  }
}
