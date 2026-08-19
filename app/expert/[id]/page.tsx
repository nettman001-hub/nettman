import type { Metadata } from "next";
import { AppShell } from "../../_components/app-shell";
import { requirePageUser } from "../../_lib/auth-user";
import { ExpertConsultationRoom } from "./expert-consultation-room";

export const metadata: Metadata = { title: "설교 피드백 검토" };
export const dynamic = "force-dynamic";

export default async function ExpertConsultationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requirePageUser(`/expert/${encodeURIComponent(id)}`, {
    demoRole: "expert",
  });
  return (
    <AppShell
      active="expert"
      user={{ id: user.id, displayName: user.name, email: user.email, isAdmin: user.isAdmin }}
    >
      {user.role === "expert" ? (
        <ExpertConsultationRoom id={id} />
      ) : (
        <div className="mx-auto max-w-3xl px-4 py-16 sm:px-8">
          <section className="rounded-[1.75rem] border border-[#e1c4b8] bg-white p-8">
            <h1 className="font-serif text-3xl font-bold text-[#294238]">접근 권한이 없습니다</h1>
            <p className="mt-3 text-sm leading-7 text-[#69756f]">
              전문가로 등록된 계정만 피드백 원고와 대화 내용을 확인할 수 있습니다.
            </p>
            <a href="/consult" className="mt-6 inline-flex text-sm font-extrabold text-[#315746] underline">
              내 피드백으로 돌아가기
            </a>
          </section>
        </div>
      )}
    </AppShell>
  );
}
