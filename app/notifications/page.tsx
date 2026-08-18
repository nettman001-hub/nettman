import type { Metadata } from "next";
import { AppNotice } from "@/app/_components/app-notice";
import { AppPageHeading } from "@/app/_components/app-page-heading";
import { AppShell } from "@/app/_components/app-shell";
import { requirePageUser } from "@/app/_lib/auth-user";
import { NotificationPreferencesForm } from "./notification-preferences-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "알림 설정 | 설교가이드",
  description: "설교 완성 알림을 받을 채널을 관리합니다.",
};

export default async function NotificationsPage() {
  const user = await requirePageUser("/notifications");

  return (
    <AppShell
      active="notifications"
      user={{ id: user.id, displayName: user.name, email: user.email, isAdmin: user.isAdmin }}
    >
      <div className="mx-auto max-w-6xl px-4 py-7 sm:px-7 sm:py-10 lg:px-10">
        <AppPageHeading
          eyebrow="Notifications"
          title="알림 설정"
          description="긴 생성 작업이 끝나는 순간을 놓치지 않도록 원하는 채널만 선택하세요."
        />

        {!user ? (
          <div className="mt-6">
            <AppNotice tone="warning" title="미리보기 모드입니다">
              브라우저 알림은 이 기기에서 시험할 수 있지만, 이메일 알림과 계정 간 동기화는 <a href="/login" className="font-bold underline underline-offset-2">로그인 후</a> 사용할 수 있습니다.
            </AppNotice>
          </div>
        ) : null}

        <div className="mt-7 grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <section className="rounded-[1.75rem] border border-[#ddd7cd] bg-white p-5 shadow-[0_16px_45px_rgba(39,50,44,.06)] sm:p-7" aria-label="알림 수신 설정">
            <NotificationPreferencesForm
              email={user?.email ?? ""}
              emailVerified={Boolean(user?.email)}
              signedIn={Boolean(user)}
            />
          </section>

          <aside className="space-y-5">
            <section className="overflow-hidden rounded-[1.5rem] bg-[#1e3f33] p-5 text-white shadow-[0_18px_45px_rgba(29,60,49,.14)]" aria-labelledby="preview-title">
              <p className="text-[10px] font-extrabold tracking-[0.16em] text-white uppercase">Preview</p>
              <h2 id="preview-title" className="mt-2 font-serif text-xl font-bold">완성 알림 미리보기</h2>
              <div className="mt-5 rounded-2xl bg-white p-4 text-[#263d33] shadow-xl">
                <div className="flex items-center gap-3">
                  <span aria-hidden="true" className="grid size-9 place-items-center rounded-xl bg-[#dfeae3] font-serif text-xs font-bold text-[#315746]">설</span>
                  <div>
                    <p className="text-xs font-extrabold">설교가 완성되었습니다</p>
                    <p className="mt-0.5 text-[10px] text-[#7c8580]">방금 전</p>
                  </div>
                </div>
                <p className="mt-3 text-xs leading-5 text-[#5f6c65]">‘은혜로 걷는 길’ 초안을 확인하고 최종 문안을 다듬어 보세요.</p>
              </div>
            </section>

            <section className="rounded-[1.5rem] border border-[#dcd7ce] bg-white p-5" aria-labelledby="privacy-title">
              <span aria-hidden="true" className="grid size-9 place-items-center rounded-xl bg-[#f2e7d8] text-xs font-black text-[#895b35]">개</span>
              <h2 id="privacy-title" className="mt-4 font-serif text-lg font-bold text-[#294238]">필요한 내용만</h2>
              <p className="mt-2 text-xs leading-5 text-[#78827c]">알림에는 설교 제목과 서비스 내부 링크만 담습니다. 설교 본문은 잠금 화면에 노출하지 않습니다.</p>
            </section>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}
