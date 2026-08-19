import type { Metadata } from "next";
import { AuthAssurance, AuthCard } from "@/app/_components/auth-card";
import { AuthShell } from "@/app/_components/auth-shell";
import { hasSupabasePublicConfig } from "@/app/_lib/supabase/config";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = {
  title: "비밀번호 찾기 | 로고스AI",
  description: "가입한 이메일로 안전한 비밀번호 재설정 링크를 보냅니다.",
};

export default function ForgotPasswordPage() {
  return (
    <AuthShell>
      <AuthCard
        eyebrow="Account recovery"
        title="비밀번호를 잊으셨나요?"
        description="가입한 이메일을 입력하면 일회용 비밀번호 재설정 링크를 보내드립니다."
        footer={<a href="/login" className="font-bold text-[#2b5947] underline decoration-[#b9c9c1] underline-offset-4 hover:decoration-[#2b5947]">로그인 화면으로 돌아가기</a>}
      >
        <ForgotPasswordForm configured={hasSupabasePublicConfig()} />
        <AuthAssurance />
      </AuthCard>
    </AuthShell>
  );
}
