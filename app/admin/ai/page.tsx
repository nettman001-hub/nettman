import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppPageHeading } from "@/app/_components/app-page-heading";
import { AppShell } from "@/app/_components/app-shell";
import {
  loadAdminAiSettingsView,
  type AdminAiSettingsInitialState,
} from "@/app/_lib/admin-ai-settings-view";
import { requirePageUser } from "@/app/_lib/auth-user";
import { getD1 } from "@/db";
import { AdminAiEngineSettingsForm } from "./admin-ai-engine-settings-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "AI 엔진 관리",
  description: "관리자가 서비스 등급별 AI 엔진, 모델과 API 키를 설정합니다.",
};

export default async function AdminAiPage() {
  const user = await requirePageUser("/admin/ai");
  if (!user.isAdmin) redirect("/home");
  const db = getD1();
  let initialState: AdminAiSettingsInitialState;
  if (!db) {
    initialState = {
      ok: false,
      error: "AI 엔진 설정 저장소에 연결할 수 없습니다.",
    };
  } else {
    try {
      initialState = { ok: true, view: await loadAdminAiSettingsView(db) };
    } catch {
      initialState = {
        ok: false,
        error: "AI 엔진 설정을 불러오지 못했습니다.",
      };
    }
  }

  return (
    <AppShell
      active="admin-ai"
      user={{
        id: user.id,
        displayName: user.name,
        email: user.email,
        isAdmin: user.isAdmin,
      }}
    >
      <div className="mx-auto max-w-5xl px-4 py-7 sm:px-7 sm:py-10 lg:px-10">
        <AppPageHeading
          eyebrow="Administration"
          title="AI 엔진 관리"
          description="기본·고급·고급 추론 엔진의 제공자, 모델과 API 키를 각각 관리합니다."
        />
        <div className="mt-8">
          <AdminAiEngineSettingsForm initialState={initialState} />
        </div>
      </div>
    </AppShell>
  );
}
