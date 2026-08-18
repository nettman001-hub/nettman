import type { Metadata } from "next";
import { AppShell } from "../../_components/app-shell";
import { requirePageUser } from "../../_lib/auth-user";
import { ConsultationRoom } from "./consultation-room";

export const metadata: Metadata = { title: "상담 대화" };
export const dynamic = "force-dynamic";

export default async function ConsultationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requirePageUser(`/consult/${encodeURIComponent(id)}`);
  return (
    <AppShell active="consult" user={{ id: user.id, displayName: user.name, email: user.email, isAdmin: user.isAdmin }}>
      <ConsultationRoom id={id} />
    </AppShell>
  );
}
