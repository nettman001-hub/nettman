import type { Metadata } from "next";
import { AppShell } from "../_components/app-shell";
import { requirePageUser } from "../_lib/auth-user";
import { HistoryClient } from "./history-client";

export const metadata: Metadata = { title: "내 설교" };
export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const user = await requirePageUser("/history");
  return (
    <AppShell active="history" user={{ id: user.id, displayName: user.name, email: user.email, isAdmin: user.isAdmin }}>
      <HistoryClient />
    </AppShell>
  );
}
