import type { Metadata } from "next";
import { AuthCard } from "@/app/_components/auth-card";
import { AuthShell } from "@/app/_components/auth-shell";
import { hasSupabasePublicConfig } from "@/app/_lib/supabase/config";
import { VerifyEmailForm } from "./verify-email-form";

export const metadata: Metadata = {
  title: "이메일 인증 | 설교가이드",
  description: "회원가입 이메일을 확인하고 계정을 활성화합니다.",
};

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string | string[] }>;
}) {
  const params = await searchParams;
  return (
    <AuthShell>
      <AuthCard
        eyebrow="Identity check"
        title="이메일을 확인해 주세요"
        description="받은 편지함의 인증 링크를 누르면 계정이 활성화됩니다. 메일이 보이지 않으면 스팸함을 확인하거나 링크를 다시 보내세요."
        footer={<a href="/login" className="font-bold text-[#2b5947] underline decoration-[#b9c9c1] underline-offset-4 hover:decoration-[#2b5947]">로그인 화면으로 돌아가기</a>}
      >
        <div className="text-center">
          <span aria-hidden="true" className="mx-auto grid size-16 place-items-center rounded-[1.35rem] bg-[#edf3ee] text-2xl font-bold text-[#315746]">@</span>
          <h2 className="mt-4 text-base font-extrabold text-[#2b4037]">인증 링크는 한 번만 사용할 수 있습니다</h2>
          <p className="mt-2 text-sm leading-6 text-[#69756f]">링크가 만료되었거나 이미 사용됐다면 아래에서 새 링크를 요청해 주세요.</p>
        </div>
        <VerifyEmailForm configured={hasSupabasePublicConfig()} initialEmail={first(params.email)} />
      </AuthCard>
    </AuthShell>
  );
}
