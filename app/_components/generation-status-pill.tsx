"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  subscribeSermonGenerationRun,
  type SermonGenerationRunState,
} from "@/app/_lib/sermon-generation-runner";
import { sermonDraftUrl } from "@/app/_lib/sermon-store";

/**
 * Floating indicator for a generation run that keeps working while the user
 * browses other menus. Hidden on the sermon workflow pages, which render
 * their own progress UI.
 */
export function GenerationStatusPill() {
  const pathname = usePathname();
  const [runState, setRunState] = useState<SermonGenerationRunState | null>(null);

  useEffect(() => subscribeSermonGenerationRun(setRunState), []);

  if (!runState || runState.status !== "running") return null;
  // AppShell surfaces show this state in the sticky top bar, where it cannot
  // collide with the AI composer. Keep the floating fallback only on public
  // pages that do not render AppShell.
  if (
    pathname &&
    /^(?:\/(?:home|sermon|history|consult|expert|study|ministry|critique|tokens|my|notifications|admin))(?:\/|$)/.test(
      pathname,
    )
  ) {
    return null;
  }

  const target = sermonDraftUrl(
    runState.mode === "regenerate" ? "/sermon/alternatives" : "/sermon/input",
    runState.draftId,
  );
  return (
    <Link
      href={target}
      className="fixed bottom-5 right-5 z-50 inline-flex items-center gap-2.5 rounded-full bg-[#1d372d] px-4 py-2.5 text-xs font-extrabold text-white shadow-[0_12px_35px_rgba(20,40,32,.35)] transition-transform hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#e0ad6e]"
      aria-live="polite"
    >
      <span
        aria-hidden="true"
        className="size-2.5 animate-pulse rounded-full bg-[#e8c28d]"
      />
      설교 생성 중 {runState.completedCount}/{runState.expectedCount}
      <span className="font-semibold text-[#cfe0d4]">보러 가기 →</span>
    </Link>
  );
}
