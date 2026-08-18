import { Suspense, type ReactNode } from "react";
import { AppShell } from "@/app/_components/app-shell";
import {
  SermonWorkflowProvider,
  SermonWorkflowShell,
} from "@/app/_components/sermon-workflow";
import { getPageUser } from "@/app/_lib/auth-user";
import { aiUserScope } from "@/app/_lib/ai-config";
import "./sermon.css";

export const dynamic = "force-dynamic";

export default async function SermonLayout({ children }: { children: ReactNode }) {
  const user = await getPageUser();
  return (
    <AppShell
      active="sermon"
      user={user ? { id: user.id, displayName: user.name, email: user.email, isAdmin: user.isAdmin } : null}
    >
      <Suspense
        fallback={
          <div className="sermon-workspace">
            <div className="sermon-state-card" role="status">
              설교 작업 공간을 준비하는 중입니다…
            </div>
          </div>
        }
      >
        <SermonWorkflowProvider
          isGuest={!user}
          displayName={user?.name ?? "방문자"}
          clientUserScope={user ? aiUserScope(user.id) : undefined}
        >
          <SermonWorkflowShell>{children}</SermonWorkflowShell>
        </SermonWorkflowProvider>
      </Suspense>
    </AppShell>
  );
}
