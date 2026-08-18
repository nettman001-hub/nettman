import type { Metadata } from "next";
import { AppShell } from "../_components/app-shell";
import { requirePageUser } from "../_lib/auth-user";
import { ConsultClient } from "./consult-client";

export const metadata: Metadata = {
  title: "전문가 상담",
  description: "완성한 설교를 목회 코치와 함께 점검합니다.",
};
export const dynamic = "force-dynamic";

export default async function ConsultPage() {
  const user = await requirePageUser("/consult");
  return (
    <AppShell active="consult" user={{ id: user.id, displayName: user.name, email: user.email, isAdmin: user.isAdmin }}>
      <ConsultClient signedIn />
    </AppShell>
  );
}
