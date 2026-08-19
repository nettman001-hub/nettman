import type { Metadata } from "next";
import { AiSessionBoundary } from "@/app/_components/ai-session-boundary";
import { AuthAssurance, AuthCard, AuthPrimaryLink } from "@/app/_components/auth-card";
import { AuthShell } from "@/app/_components/auth-shell";
import { SecureSignoutButton } from "@/app/_components/secure-signout-link";
import { getPageUser, safeReturnPath } from "@/app/_lib/auth-user";
import { hasSupabasePublicConfig } from "@/app/_lib/supabase/config";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "로그인 | 로고스AI",
  description: "이메일 또는 Google 계정으로 로고스AI에 로그인합니다.",
};

type LoginSearchParams = {
  error?: string | string[];
  password_updated?: string | string[];
  return_to?: string | string[];
  verified?: string | string[];
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<LoginSearchParams>;
}) {
  const [user, params] = await Promise.all([getPageUser(), searchParams]);
  const returnTo = safeReturnPath(first(params.return_to) ?? "/home");
  const initialNotice =
    first(params.password_updated) === "1"
      ? "비밀번호가 변경되었습니다. 새 비밀번호로 로그인해 주세요."
      : first(params.verified) === "1"
        ? "이메일 인증이 완료되었습니다. 이제 로그인할 수 있습니다."
        : undefined;
  const callbackError = first(params.error)
    ? "인증을 완료하지 못했습니다. 다시 시도해 주세요."
    : undefined;

  return (
    <AuthShell>
      <AiSessionBoundary />
      <AuthCard
        eyebrow="Welcome back"
        title={user ? "로그인되어 있습니다" : "다시, 말씀 앞에"}
        description={
          user
            ? `${user.name} 님의 준비 공간으로 바로 이어가세요.`
            : "이메일과 비밀번호를 기본으로 사용하거나 Google 계정으로 간편하게 연결할 수 있습니다."
        }
        footer={
          user ? (
            <SecureSignoutButton
              returnTo="/login"
              className="font-bold text-[#2b5947] underline decoration-[#b9c9c1] underline-offset-4 hover:decoration-[#2b5947]"
            >
              다른 계정으로 로그인
            </SecureSignoutButton>
          ) : (
            <>
              처음이신가요?{" "}
              <a href="/signup" className="font-bold text-[#2b5947] underline decoration-[#b9c9c1] underline-offset-4 hover:decoration-[#2b5947]">
                회원가입
              </a>
            </>
          )
        }
      >
        {user ? (
          <div>
            <div className="flex items-center gap-3 rounded-2xl bg-[#f2f5f1] p-4">
              <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-full bg-[#dce9e1] text-sm font-extrabold text-[#295341]">
                {user.name.slice(0, 2)}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-extrabold text-[#263b32]">{user.name}</p>
                <p className="truncate text-xs text-[#738078]">{user.email}</p>
              </div>
            </div>
            <div className="mt-5"><AuthPrimaryLink href={returnTo}>준비 공간으로 이동</AuthPrimaryLink></div>
          </div>
        ) : (
          <>
            <LoginForm
              configured={hasSupabasePublicConfig()}
              initialNotice={initialNotice ?? callbackError}
              returnTo={returnTo}
            />
            <AuthAssurance />
          </>
        )}
      </AuthCard>
    </AuthShell>
  );
}
