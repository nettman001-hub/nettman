import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppShell } from "@/app/_components/app-shell";
import { requirePageUser } from "@/app/_lib/auth-user";
import { MemberDetailClient } from "./member-detail-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "회원 상세",
  description: "회원의 프로필, 서비스 활동과 관리자 작업 기록을 확인합니다.",
};

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function firstValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function safeMembersReturnPath(value: string): string {
  if (!value.startsWith("/admin/members") || value.startsWith("//")) {
    return "/admin/members";
  }
  try {
    const parsed = new URL(value, "https://app.local");
    if (parsed.origin !== "https://app.local" || parsed.pathname !== "/admin/members") {
      return "/admin/members";
    }
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return "/admin/members";
  }
}

export default async function AdminMemberDetailPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const query = await searchParams;
  const returnTo = safeMembersReturnPath(firstValue(query.return_to));
  const user = await requirePageUser(`/admin/members/${encodeURIComponent(id)}`);
  if (!user.isAdmin) redirect("/home");

  return (
    <AppShell
      active="admin-members"
      user={{
        id: user.id,
        displayName: user.name,
        email: user.email,
        isAdmin: user.isAdmin,
      }}
    >
      <MemberDetailClient memberId={id.slice(0, 200)} returnTo={returnTo} />
    </AppShell>
  );
}
