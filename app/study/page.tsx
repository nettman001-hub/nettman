import type { Metadata } from "next";
import { AppPageHeading } from "@/app/_components/app-page-heading";
import { AppShell } from "@/app/_components/app-shell";
import { SermonResourceTool } from "@/app/_components/sermon-resource-tool";
import { requirePageUser } from "@/app/_lib/auth-user";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "스터디 | 로고스AI",
  description: "완성한 설교와 성경 본문을 원문, 배경과 구조 관점에서 연구합니다.",
};

export default async function StudyPage() {
  const user = await requirePageUser("/study");
  return (
    <AppShell
      active="study"
      user={{ id: user.id, displayName: user.name, email: user.email, isAdmin: user.isAdmin }}
    >
      <div className="mx-auto max-w-[90rem] px-4 py-7 sm:px-7 sm:py-10 xl:px-10">
        <AppPageHeading
          eyebrow="04 · Study"
          title="스터디"
          description="원문 이해, 배경 이해와 구조 이해를 선택해 완성 설교의 본문 연구를 확장합니다."
        />
        <SermonResourceTool mode="study" />
      </div>
    </AppShell>
  );
}
