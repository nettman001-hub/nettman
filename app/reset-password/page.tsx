import type { Metadata } from "next";
import { AuthAssurance, AuthCard } from "@/app/_components/auth-card";
import { AuthShell } from "@/app/_components/auth-shell";
import { getPageUser } from "@/app/_lib/auth-user";
import { hasSupabasePublicConfig } from "@/app/_lib/supabase/config";
import { ResetPasswordForm } from "./reset-password-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "비밀번호 재설정",
  description: "이메일로 확인된 세션에서 새 비밀번호를 설정합니다.",
};

export default async function ResetPasswordPage() {
  const user = await getPageUser();
  const enabled = Boolean(user && !user.isDemo && hasSupabasePublicConfig());
  return (
    <AuthShell>
      <AuthCard
        eyebrow="Security first"
        title="새 비밀번호 설정"
        description="메일 링크로 확인된 계정에 새 비밀번호를 설정합니다. 변경이 끝나면 다시 로그인해 주세요."
        footer={<a href="/forgot-password" className="font-bold text-[#2b5947] underline decoration-[#b9c9c1] underline-offset-4 hover:decoration-[#2b5947]">새 재설정 링크 요청</a>}
      >
        <ResetPasswordForm enabled={enabled} />
        <AuthAssurance />
      </AuthCard>
    </AuthShell>
  );
}
