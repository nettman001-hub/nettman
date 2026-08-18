import { ensureDatabase, getD1 } from "../../../db";
import { getRequestUser, unauthorizedResponse } from "../../_lib/auth-user";

type ProfilePayload = {
  displayName?: string;
  role?: string;
  church?: string;
};

const allowedRoles = new Set([
  "담임목사",
  "부목사",
  "전도사",
  "강도사",
  "교회학교 교사",
  "기타 사역자",
]);

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return unauthorizedResponse();
  const db = getD1();
  if (!db) return Response.json({ displayName: user.name, role: "담임목사", church: "", demo: true });
  await ensureDatabase(db);
  const row = await db.prepare("SELECT display_name, ministry_role, church FROM user_profiles WHERE user_id = ?")
    .bind(user.id)
    .first<{ display_name: string; ministry_role: string; church: string }>();
  return Response.json(row ? {
    displayName: row.display_name,
    role: row.ministry_role,
    church: row.church,
  } : { displayName: user.name, role: "담임목사", church: "" });
}

export async function PUT(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return unauthorizedResponse();
  const payload = await request.json().catch(() => null) as ProfilePayload | null;
  const displayName = payload?.displayName?.trim() ?? "";
  const ministryRole = payload?.role?.trim() ?? "";
  const church = payload?.church?.trim() ?? "";
  if (displayName.length < 2 || displayName.length > 40) {
    return Response.json({ error: "표시 이름을 2자 이상 40자 이하로 입력해 주세요." }, { status: 400 });
  }
  if (!allowedRoles.has(ministryRole) || church.length > 60) {
    return Response.json({ error: "사역 역할과 공동체 이름을 확인해 주세요." }, { status: 400 });
  }
  const result = { displayName, role: ministryRole, church };
  const db = getD1();
  if (!db) return Response.json({ ...result, demo: true });
  await ensureDatabase(db);
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("INSERT INTO users (id, email, name, role, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET email=excluded.email, name=excluded.name")
      .bind(user.id, user.email, displayName, user.role, now),
    db.prepare(`INSERT INTO user_profiles (user_id, display_name, ministry_role, church, updated_at)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET display_name=excluded.display_name, ministry_role=excluded.ministry_role, church=excluded.church, updated_at=excluded.updated_at`)
      .bind(user.id, displayName, ministryRole, church, now),
  ]);
  return Response.json(result);
}
