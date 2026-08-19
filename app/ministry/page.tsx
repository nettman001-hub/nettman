import type { Metadata } from "next";
import { AppPageHeading } from "@/app/_components/app-page-heading";
import { AppShell } from "@/app/_components/app-shell";
import { SermonResourceTool } from "@/app/_components/sermon-resource-tool";
import { requirePageUser } from "@/app/_lib/auth-user";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "사역 활용 | 로고스AI",
  description: "완성한 설교로 소그룹 질문지, 주보 요약과 숏폼 문구를 만듭니다.",
};

export default async function MinistryPage() {
  const user = await requirePageUser("/ministry");
  return (
    <AppShell
      active="ministry"
      user={{ id: user.id, displayName: user.name, email: user.email, isAdmin: user.isAdmin }}
    >
      <div className="mx-auto max-w-[90rem] px-4 py-7 sm:px-7 sm:py-10 xl:px-10">
        <AppPageHeading
          eyebrow="05 · Ministry"
          title="사역 활용"
          description="완성 설교를 소그룹 나눔 질문지, 주보용 요약문과 숏폼 문구로 재구성합니다."
        />
        <SermonResourceTool mode="ministry" />
      </div>
    </AppShell>
  );
}
