import type { Metadata } from "next";
import { AppShell } from "@/app/_components/app-shell";
import { aiUserScope } from "@/app/_lib/ai-config";
import { requirePageUser } from "@/app/_lib/auth-user";
import { SermonHelperClient } from "./sermon-helper-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "설교도우미",
  description:
    "목회자가 본문을 묵상하고 회중을 생각하며 자기 설교를 직접 완성하도록 돕는 단계별 작업 공간입니다.",
};

type SermonHelperSearchParams = Promise<{
  id?: string | string[];
}>;

function safeProjectId(value: string | string[] | undefined): string | null {
  const projectId = Array.isArray(value) ? value[0] : value;
  return projectId && /^[A-Za-z0-9_-]{1,80}$/.test(projectId)
    ? projectId
    : null;
}

export default async function SermonHelperPage({
  searchParams,
}: {
  searchParams: SermonHelperSearchParams;
}) {
  const params = await searchParams;
  const projectId = safeProjectId(params.id);
  const returnPath = projectId
    ? `/sermon-helper?id=${encodeURIComponent(projectId)}`
    : "/sermon-helper";
  const user = await requirePageUser(returnPath);

  return (
    <AppShell
      active="sermon-helper"
      user={{
        id: user.id,
        displayName: user.name,
        email: user.email,
        isAdmin: user.isAdmin,
      }}
    >
      <SermonHelperClient
        initialProjectId={projectId}
        clientUserScope={aiUserScope(user.id)}
      />
    </AppShell>
  );
}
