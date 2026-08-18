import { ensureDatabase, getD1 } from "../../../db";
import { getRequestUser, unauthorizedResponse } from "../../_lib/auth-user";

const defaults = { emailEnabled: true, pushEnabled: false, completionEnabled: true };

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return unauthorizedResponse();
  const db = getD1();
  if (!db) return Response.json({ ...defaults, demo: true });
  await ensureDatabase(db);
  const row = await db.prepare("SELECT email_enabled, push_enabled, completion_enabled FROM notification_preferences WHERE user_id = ?").bind(user.id).first<{ email_enabled: number; push_enabled: number; completion_enabled: number }>();
  return Response.json(row ? {
    emailEnabled: Boolean(row.email_enabled), pushEnabled: Boolean(row.push_enabled), completionEnabled: Boolean(row.completion_enabled),
  } : defaults);
}

export async function PATCH(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return unauthorizedResponse();
  const payload = await request.json().catch(() => null) as Partial<typeof defaults> | null;
  if (!payload) return Response.json({ error: "설정 값을 확인해 주세요." }, { status: 400 });
  const values = {
    emailEnabled: payload.emailEnabled ?? defaults.emailEnabled,
    pushEnabled: payload.pushEnabled ?? defaults.pushEnabled,
    completionEnabled: payload.completionEnabled ?? defaults.completionEnabled,
  };
  const db = getD1();
  if (!db) return Response.json({ ...values, demo: true });
  await ensureDatabase(db);
  await db.prepare(`INSERT INTO notification_preferences (user_id, email_enabled, push_enabled, completion_enabled, updated_at)
    VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET email_enabled=excluded.email_enabled, push_enabled=excluded.push_enabled, completion_enabled=excluded.completion_enabled, updated_at=excluded.updated_at`)
    .bind(user.id, Number(values.emailEnabled), Number(values.pushEnabled), Number(values.completionEnabled), new Date().toISOString()).run();
  return Response.json(values);
}
