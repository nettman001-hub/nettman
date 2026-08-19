import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppShell } from "@/app/_components/app-shell";
import { requirePageUser } from "@/app/_lib/auth-user";
import {
  MEMBER_DENOMINATIONS,
  MEMBER_PROFILE_FILTERS,
  MEMBER_ROLES,
  MEMBER_SORTS,
  MEMBER_STATUSES,
  type MemberRole,
  type MemberStatus,
  type MemberListFilters,
} from "./member-types";
import { MembersClient } from "./members-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "회원 관리",
  description: "회원 정보, 역할, 이용 상태와 서비스 활동을 관리합니다.",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function firstValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function isMemberRole(value: string): value is MemberRole {
  return MEMBER_ROLES.some((item) => item === value);
}

function isMemberStatus(value: string): value is MemberStatus {
  return MEMBER_STATUSES.some((item) => item === value);
}

function isMemberDenomination(
  value: string,
): value is (typeof MEMBER_DENOMINATIONS)[number] {
  return MEMBER_DENOMINATIONS.some((item) => item === value);
}

function isMemberProfileFilter(
  value: string,
): value is (typeof MEMBER_PROFILE_FILTERS)[number] {
  return MEMBER_PROFILE_FILTERS.some((item) => item === value);
}

function isMemberSort(value: string): value is (typeof MEMBER_SORTS)[number] {
  return MEMBER_SORTS.some((item) => item === value);
}

function initialFilters(params: Record<string, string | string[] | undefined>): MemberListFilters {
  const role = firstValue(params.role);
  const status = firstValue(params.status);
  const denomination = firstValue(params.denomination);
  const profile = firstValue(params.profile);
  const sort = firstValue(params.sort);
  const requestedPage = Number(firstValue(params.page));
  return {
    query: firstValue(params.q).trim().slice(0, 120),
    role: isMemberRole(role) ? role : "all",
    status: isMemberStatus(status) ? status : "all",
    denomination: isMemberDenomination(denomination)
      ? denomination
      : "all",
    profile: isMemberProfileFilter(profile) ? profile : "all",
    sort: isMemberSort(sort) ? sort : "registered_desc",
    page:
      Number.isSafeInteger(requestedPage) && requestedPage > 0
        ? Math.min(requestedPage, 100_000)
        : 1,
  };
}

export default async function AdminMembersPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const user = await requirePageUser("/admin/members");
  if (!user.isAdmin) redirect("/home");
  const params = await searchParams;
  const cursor = firstValue(params.cursor).slice(0, 1_000);

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
      <MembersClient initialFilters={initialFilters(params)} initialCursor={cursor} />
    </AppShell>
  );
}
