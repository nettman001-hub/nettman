import type { Metadata } from "next";
import { AuthCard, AuthPrimaryLink } from "@/app/_components/auth-card";
import { AuthShell } from "@/app/_components/auth-shell";
import { getPageUser } from "@/app/_lib/auth-user";
import { hasSupabasePublicConfig } from "@/app/_lib/supabase/config";
import { SignupForm } from "./signup-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "회원가입 | 설교가이드",
  description: "이메일 인증 또는 Google 계정으로 설교가이드 계정을 만듭니다.",
};

export default async function SignupPage() {
  const user = await getPageUser();
  return (
    <AuthShell>
      <AuthCard
        eyebrow="Begin with clarity"
        title={user ? "준비가 끝났습니다" : "첫 설교부터 가볍게"}
        description={
          user
            ? "계정이 연결되어 있습니다. 새 설교를 시작하거나 저장된 작업을 확인하세요."
            : "이름·이메일·비밀번호로 가입하고 이메일 인증을 완료하세요. Google 계정으로도 바로 시작할 수 있습니다."
        }
        footer={
          <>
            이미 사용 중이신가요?{" "}
            <a href="/login" className="font-bold text-[#2b5947] underline decoration-[#b9c9c1] underline-offset-4 hover:decoration-[#2b5947]">로그인</a>
          </>
        }
      >
        {user ? <AuthPrimaryLink href="/sermon/options">새 설교 시작</AuthPrimaryLink> : <SignupForm configured={hasSupabasePublicConfig()} />}
      </AuthCard>
    </AuthShell>
  );
}
