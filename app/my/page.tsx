import type { Metadata } from "next";
import { AppNotice } from "@/app/_components/app-notice";
import { AppPageHeading } from "@/app/_components/app-page-heading";
import { AppShell } from "@/app/_components/app-shell";
import { requirePageUser } from "@/app/_lib/auth-user";
import { ProfileForm } from "./profile-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "계정 설정 | 로고스AI",
  description: "표시 이름, 사역 정보와 로그인 보안을 관리합니다.",
};

export default async function MyPage() {
  const user = await requirePageUser("/my");

  return (
    <AppShell
      active="my"
      user={{ id: user.id, displayName: user.name, email: user.email, isAdmin: user.isAdmin }}
    >
      <div className="mx-auto max-w-6xl px-4 py-7 sm:px-7 sm:py-10 lg:px-10">
        <AppPageHeading
          eyebrow="Account"
          title="계정 설정"
          description="설교 준비 공간의 기본 정보와 로그인 보안을 관리합니다."
        />

        {!user ? (
          <div className="mt-6">
            <AppNotice tone="warning" title="기기 저장 모드">
              로그인 전 변경 사항은 이 브라우저에만 저장됩니다. 계정에 연결하려면 <a href="/login" className="font-bold underline underline-offset-2">로그인해 주세요.</a>
            </AppNotice>
          </div>
        ) : null}

        <div className="mt-7 grid gap-6 xl:grid-cols-[minmax(0,1fr)_19rem]">
          <div className="space-y-6">
            <section className="rounded-[1.75rem] border border-[#ddd7cd] bg-white p-5 shadow-[0_16px_45px_rgba(39,50,44,.06)] sm:p-7" aria-label="기본 정보 수정">
              <ProfileForm
                initialName={user.name}
                email={user?.email ?? ""}
                signedIn={Boolean(user)}
                userScope={user.id}
              />
            </section>

            <section className="rounded-[1.75rem] border border-[#d9d1c5] bg-[#f5f1e9] p-5 sm:p-7" aria-labelledby="managed-ai-title">
              <p className="text-[10px] font-extrabold uppercase tracking-[.16em] text-[#a56732]">Managed AI</p>
              <h2 id="managed-ai-title" className="mt-2 font-serif text-xl font-bold text-[#294238]">AI 엔진은 관리자가 설정합니다</h2>
              <p className="mt-2 text-sm leading-6 text-[#647168]">사용자는 엔진, 모델, API 주소나 키를 변경할 수 없습니다. 관리자가 선택한 전역 AI 설정이 모든 설교 생성과 수정에 동일하게 적용됩니다.</p>
              {user.isAdmin ? <a href="/admin/ai" className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-[#315746] px-4 text-xs font-extrabold text-white hover:bg-[#25483a]">AI 엔진 관리 열기</a> : null}
            </section>
          </div>

          <aside className="space-y-5">
            <section className="rounded-[1.5rem] border border-[#d9d1c5] bg-[#ece4d8] p-5" aria-labelledby="security-title">
              <span className="grid size-10 place-items-center rounded-xl bg-white/65 text-sm font-black text-[#3c5e50]" aria-hidden="true">안</span>
              <h2 id="security-title" className="mt-5 font-serif text-xl font-bold text-[#294238]">로그인 보안</h2>
              <p className="mt-2 text-sm leading-6 text-[#647168]">
                이메일·Google 로그인과 비밀번호는 Supabase Auth에서 안전하게 관리됩니다.
              </p>
              <a href="/reset-password" className="mt-5 inline-flex min-h-10 w-full items-center justify-center rounded-xl border border-[#cbbdac] bg-white/60 px-4 text-xs font-extrabold text-[#3d584c] hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838]">
                비밀번호 변경
              </a>
            </section>

            <section className="rounded-[1.5rem] border border-[#dcd7ce] bg-white p-5" aria-labelledby="notification-shortcut-title">
              <p className="text-[10px] font-extrabold tracking-[0.16em] text-[#a56732] uppercase">Notifications</p>
              <h2 id="notification-shortcut-title" className="mt-2 font-serif text-lg font-bold text-[#294238]">완성 소식 받기</h2>
              <p className="mt-2 text-xs leading-5 text-[#78827c]">설교가 완성되었을 때 이메일과 브라우저 알림을 받을 수 있습니다.</p>
              <a href="/notifications" className="mt-4 inline-flex items-center gap-2 rounded-lg text-xs font-extrabold text-[#315746] hover:text-[#a2602c] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838]">알림 설정 열기 <span aria-hidden="true">→</span></a>
            </section>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}
