"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  useRegisterAiAgentPage,
  type AiAgentPageRegistration,
} from "../_components/ai-agent-provider";
import { loadLocalSermonRecords } from "../_lib/sermon-store";

type RecentSermon = {
  id: string;
  title: string;
  passage: string;
  updatedAt: string;
  status: "draft" | "complete";
};

const STORAGE_KEY = "sermon-guide.recent-sermons.v1";
const HOME_AGENT_DESTINATIONS = new Set([
  "/home",
  "/sermon/options",
  "/history",
  "/study",
  "/critique",
  "/ministry",
  "/consult",
]);

function isRecentSermon(value: unknown): value is RecentSermon {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    typeof item.title === "string" &&
    typeof item.passage === "string" &&
    typeof item.updatedAt === "string" &&
    (item.status === "draft" || item.status === "complete")
  );
}

function readLocalSermons(): RecentSermon[] {
  const completed = loadLocalSermonRecords().map((sermon) => ({
    id: sermon.id,
    title: sermon.title,
    passage: sermon.scripture,
    updatedAt: sermon.updatedAt,
    status: "complete" as const,
  }));
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return completed.slice(0, 3);
    const parsed: unknown = JSON.parse(raw);
    const drafts = Array.isArray(parsed) ? parsed.filter(isRecentSermon) : [];
    const seen = new Set(completed.map((item) => item.id));
    return [...completed, ...drafts.filter((item) => !seen.has(item.id))]
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
      .slice(0, 3);
  } catch {
    return completed.slice(0, 3);
  }
}

export function HomeRecentSermons() {
  const router = useRouter();
  const [items, setItems] = useState<RecentSermon[]>([]);
  const [state, setState] = useState<"loading" | "synced" | "local">("loading");

  useEffect(() => {
    const localItems = readLocalSermons();
    setItems(localItems);

    const controller = new AbortController();

    async function load() {
      try {
        const response = await fetch("/api/sermons?limit=3", {
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("unavailable");
        const payload: unknown = await response.json();
        const values = Array.isArray(payload)
          ? payload
          : payload && typeof payload === "object" && "items" in payload
            ? (payload as { items: unknown }).items
            : [];
        const nextItems = Array.isArray(values)
          ? values.filter(isRecentSermon).slice(0, 3)
          : [];
        const seen = new Set(nextItems.map((item) => item.id));
        setItems([...nextItems, ...localItems.filter((item) => !seen.has(item.id))]
          .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
          .slice(0, 3));
        setState("synced");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState("local");
      }
    }

    void load();
    return () => controller.abort();
  }, []);

  const agentRegistration = useMemo<AiAgentPageRegistration>(
    () => ({
      surface: "home",
      title: "홈 · 최근 설교",
      snapshot: {
        summary: {
          loadState: state,
          recentCount: items.length,
          completeCount: items.filter((item) => item.status === "complete").length,
          draftCount: items.filter((item) => item.status === "draft").length,
        },
        recentSermons: items.map((item) => ({
          id: item.id,
          title: item.title,
          scripture: item.passage,
          updatedAt: item.updatedAt,
          status: item.status,
        })),
      },
      capabilities: ["navigate", "history.open"],
      suggestions: [
        "최근 설교를 보고 다음 작업을 추천해줘",
        "최근 완성 설교 중 다시 살펴볼 원고를 골라줘",
        "작성 중인 설교가 있으면 이어서 여는 방법을 알려줘",
      ],
      executeAction: async (proposal) => {
        if (proposal.capability === "history.open") {
          const sermonId = proposal.args.sermonId;
          if (
            typeof sermonId !== "string" ||
            !items.some((item) => item.id === sermonId && item.status === "complete")
          ) {
            throw new Error("현재 표시된 완성 설교 중에서 다시 선택해 주세요.");
          }
          router.push(`/history/${encodeURIComponent(sermonId)}`);
          return { message: "선택한 최근 설교를 열었습니다." };
        }
        if (proposal.capability === "navigate") {
          const href = proposal.args.href;
          const recentHrefs = new Set(
            items.map((item) =>
              item.status === "complete"
                ? `/history/${encodeURIComponent(item.id)}`
                : `/sermon/edit?draftId=${encodeURIComponent(item.id)}`,
            ),
          );
          if (
            typeof href !== "string" ||
            (!HOME_AGENT_DESTINATIONS.has(href) && !recentHrefs.has(href))
          ) {
            throw new Error("홈에서 확인할 수 있는 작업이나 최근 설교를 선택해 주세요.");
          }
          router.push(href);
          return { message: "요청한 화면으로 이동했습니다." };
        }
        throw new Error("홈에서는 이 작업을 적용할 수 없습니다.");
      },
    }),
    [items, router, state],
  );

  useRegisterAiAgentPage(agentRegistration);

  if (state === "loading") {
    return (
      <div className="grid gap-3" aria-label="최근 설교를 불러오는 중" aria-busy="true">
        {[0, 1].map((item) => (
          <div
            key={item}
            className="h-[5.75rem] animate-pulse rounded-2xl border border-[#e1ddd4] bg-[#faf9f6]"
          />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="rounded-[1.4rem] border border-dashed border-[#cfc8bc] bg-[#faf8f3] px-5 py-7 text-center">
        <span
          aria-hidden="true"
          className="mx-auto grid size-11 place-items-center rounded-2xl bg-[#e8efe9] font-serif font-bold text-[#315746]"
        >
          01
        </span>
        <p className="mt-3 text-sm font-extrabold text-[#34463e]">
          아직 저장된 설교가 없습니다
        </p>
        <p className="mt-1 text-xs leading-5 text-[#7a837e]">
          첫 설교를 시작하면 진행 중인 초안과 완성본이 이곳에 표시됩니다.
        </p>
        <a
          href="/sermon/options"
          className="mt-4 inline-flex min-h-10 items-center justify-center rounded-xl bg-[#285343] px-4 text-xs font-bold text-white hover:bg-[#1f4537] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838] focus-visible:ring-offset-2"
        >
          첫 설교 만들기
        </a>
        {state === "local" ? (
          <p className="mt-3 text-[11px] text-[#928772]" role="status">
            서버 연결 전에는 이 기기에 저장된 작업만 표시됩니다.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div>
      <ul className="divide-y divide-[#e4dfd6]">
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={
                item.status === "complete"
                  ? `/history/${encodeURIComponent(item.id)}`
                  : `/sermon/edit?draftId=${encodeURIComponent(item.id)}`
              }
              className="group flex items-center gap-4 rounded-xl px-1 py-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838]"
            >
              <span
                aria-hidden="true"
                className={`grid size-10 shrink-0 place-items-center rounded-xl text-[10px] font-black ${
                  item.status === "complete"
                    ? "bg-[#e4eee7] text-[#315746]"
                    : "bg-[#f7e8d5] text-[#935f33]"
                }`}
              >
                {item.status === "complete" ? "완료" : "초안"}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-extrabold leading-5 text-[#2c4037] group-hover:text-[#a2612d]">
                  {item.title}
                </span>
                <span className="mt-1 block text-xs leading-5 text-[#7b837e]">
                  {item.passage} · {item.updatedAt}
                </span>
              </span>
              <span aria-hidden="true" className="text-lg text-[#9ca49f] transition-transform group-hover:translate-x-1">
                →
              </span>
            </a>
          </li>
        ))}
      </ul>
      {state === "local" ? (
        <p className="mt-3 text-[11px] text-[#928772]" role="status">
          서버 연결 전에는 이 기기에 저장된 작업만 표시됩니다.
        </p>
      ) : null}
    </div>
  );
}
