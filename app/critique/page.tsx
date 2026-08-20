import type { Metadata } from "next";
import { AppPageHeading } from "@/app/_components/app-page-heading";
import { AppShell } from "@/app/_components/app-shell";
import { SermonResourceTool } from "@/app/_components/sermon-resource-tool";
import { requirePageUser } from "@/app/_lib/auth-user";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "설교 비평",
  description: "직접 작성한 설교 원고를 설교학 루브릭으로 점검받습니다.",
};

export default async function CritiquePage() {
  const user = await requirePageUser("/critique");
  return (
    <AppShell
      active="critique"
      user={{ id: user.id, displayName: user.name, email: user.email, isAdmin: user.isAdmin }}
    >
      <div className="mx-auto max-w-[90rem] px-4 py-7 sm:px-7 sm:py-10 xl:px-10">
        <AppPageHeading
          eyebrow="06 · Critique"
          title="설교 비평"
          description="직접 쓴 원고를 붙여 넣으면 통일성, 본문 밀착도, 은혜-명령 순서, 적용 구체성 등 일곱 가지 축으로 점검해 드립니다. 최종 판단과 책임은 설교자에게 있습니다."
        />
        <SermonResourceTool mode="critique" />
      </div>
    </AppShell>
  );
}
