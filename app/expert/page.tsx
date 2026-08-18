import type { Metadata } from "next";
import { AppShell } from "../_components/app-shell";
import { requirePageUser } from "../_lib/auth-user";
import { ExpertDashboard } from "./expert-dashboard";

export const metadata: Metadata = {
  title: "전문가 상담실",
  description: "대기 중이거나 내게 배정된 설교 상담을 검토합니다.",
};
export const dynamic = "force-dynamic";

export default async function ExpertPage() {
  const user = await requirePageUser("/expert", { demoRole: "expert" });
  return (
    <AppShell
      active="expert"
      user={{ id: user.id, displayName: user.name, email: user.email, isAdmin: user.isAdmin }}
    >
      {user.role === "expert" ? (
        <ExpertDashboard />
      ) : (
        <ExpertAccessDenied />
      )}
    </AppShell>
  );
}

function ExpertAccessDenied() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-8">
      <section className="rounded-[1.75rem] border border-[#e1c4b8] bg-white p-7 shadow-[0_18px_50px_rgba(39,50,44,.08)] sm:p-10">
        <p className="text-xs font-extrabold tracking-[0.16em] text-[#a55f42] uppercase">
          Expert access
        </p>
        <h1 className="mt-3 font-serif text-3xl font-bold text-[#294238]">
          전문가 전용 공간입니다
        </h1>
        <p className="mt-4 text-sm leading-7 text-[#69756f]">
          이 계정에는 전문가 권한이 없습니다. 설교 상담을 요청하려면 상담 메뉴를 이용해
          주세요. 전문가 등록이 필요한 경우 운영자에게 계정 권한을 요청해 주세요.
        </p>
        <a
          href="/consult"
          className="mt-7 inline-flex min-h-11 items-center justify-center rounded-xl bg-[#315746] px-5 text-sm font-extrabold text-white hover:bg-[#25483a] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838]"
        >
          내 상담으로 돌아가기
        </a>
      </section>
    </div>
  );
}
