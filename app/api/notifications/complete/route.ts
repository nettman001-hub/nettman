import { ensureDatabase, getD1 } from "../../../../db";
import { getRequestUser, unauthorizedResponse } from "../../../_lib/auth-user";

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return unauthorizedResponse();
  const payload = await request.json().catch(() => null) as { sermonId?: string; title?: string } | null;
  if (!payload?.sermonId || !payload.title) return Response.json({ error: "알림 대상을 확인해 주세요." }, { status: 400 });
  const db = getD1();
  if (!db) return Response.json({ delivered: [], demo: true });
  await ensureDatabase(db);
  const preferences = await db.prepare("SELECT email_enabled, push_enabled, completion_enabled FROM notification_preferences WHERE user_id = ?").bind(user.id).first<{ email_enabled: number; push_enabled: number; completion_enabled: number }>();
  const enabled = preferences ? Boolean(preferences.completion_enabled) : true;
  if (!enabled) return Response.json({ delivered: [] });
  const channels = [
    (preferences?.email_enabled ?? 1) ? "email" : null,
    preferences?.push_enabled ? "push" : null,
  ].filter(Boolean) as string[];
  const now = new Date().toISOString();
  await db.batch(channels.map((channel) => db.prepare("INSERT INTO notification_deliveries (id, user_id, sermon_id, channel, status, attempt_count, error, created_at) VALUES (?, ?, ?, ?, 'queued', 0, NULL, ?)").bind(crypto.randomUUID(), user.id, payload.sermonId, channel, now)));
  return Response.json({ delivered: channels, queued: true });
}
