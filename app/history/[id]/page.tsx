import type { Metadata } from "next";
import { AppShell } from "../../_components/app-shell";
import { requirePageUser } from "../../_lib/auth-user";
import { HistoryDetailClient } from "./history-detail-client";

export const metadata: Metadata = { title: "설교 상세" };
export const dynamic = "force-dynamic";

export default async function HistoryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requirePageUser(`/history/${encodeURIComponent(id)}`);
  return (
    <AppShell active="history" user={{ id: user.id, displayName: user.name, email: user.email, isAdmin: user.isAdmin }}>
      <HistoryDetailClient id={id} />
    </AppShell>
  );
}
