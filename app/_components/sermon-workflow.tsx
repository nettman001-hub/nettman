"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  createEmptySermonDraft,
  loadActiveSermonDraft,
  loadSermonDraft,
  persistSermonDraft,
  sermonDraftUrl,
} from "@/app/_lib/sermon-store";
import {
  isSermonOptionsComplete,
  normalizeSermonAiTiers,
  type SermonDraft,
} from "@/app/_lib/sermon-types";
import { AI_ENGINE_TIER_META } from "@/app/_lib/ai-engine-tiers";

type SermonContextValue = {
  draft: SermonDraft | null;
  ready: boolean;
  isGuest: boolean;
  clientUserScope?: string;
  displayName: string;
  storageError: string | null;
  createDraft: () => SermonDraft;
  replaceDraft: (draft: SermonDraft) => SermonDraft;
  updateDraft: (updater: (draft: SermonDraft) => SermonDraft) => void;
  clearStorageError: () => void;
};

const SermonContext = createContext<SermonContextValue | null>(null);

export function SermonWorkflowProvider({
  children,
  isGuest,
  displayName,
  clientUserScope,
}: {
  children: ReactNode;
  isGuest: boolean;
  displayName: string;
  clientUserScope?: string;
}) {
  const searchParams = useSearchParams();
  const queryDraftId = searchParams.get("draftId");
  const [draft, setDraft] = useState<SermonDraft | null>(null);
  const draftRef = useRef<SermonDraft | null>(null);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);

  useEffect(() => {
    setReady(false);
    const restored = queryDraftId
      ? loadSermonDraft(queryDraftId)
      : loadActiveSermonDraft();
    draftRef.current = restored;
    setDraft(restored);
    setReady(true);
  }, [queryDraftId]);

  const save = useCallback((nextDraft: SermonDraft): SermonDraft => {
    try {
      const persisted = persistSermonDraft(nextDraft);
      draftRef.current = persisted;
      setDraft(persisted);
      setStorageError(null);
      return persisted;
    } catch {
      draftRef.current = nextDraft;
      setDraft(nextDraft);
      setStorageError(
        "이 브라우저에 임시 저장하지 못했습니다. 저장 공간을 확인해 주세요.",
      );
      return nextDraft;
    }
  }, []);

  const createDraft = useCallback(() => {
    return save(createEmptySermonDraft());
  }, [save]);

  const updateDraft = useCallback(
    (updater: (current: SermonDraft) => SermonDraft) => {
      const current = draftRef.current;
      if (!current) return;
      const next = updater(current);
      try {
        const persisted = persistSermonDraft(next);
        draftRef.current = persisted;
        setDraft(persisted);
        setStorageError(null);
      } catch {
        draftRef.current = next;
        setDraft(next);
        setStorageError(
          "이 브라우저에 임시 저장하지 못했습니다. 저장 공간을 확인해 주세요.",
        );
      }
    },
    [],
  );

  const value = useMemo<SermonContextValue>(
    () => ({
      draft,
      ready,
      isGuest,
      clientUserScope,
      displayName,
      storageError,
      createDraft,
      replaceDraft: save,
      updateDraft,
      clearStorageError: () => setStorageError(null),
    }),
    [
      createDraft,
      clientUserScope,
      displayName,
      draft,
      isGuest,
      ready,
      save,
      storageError,
      updateDraft,
    ],
  );

  return <SermonContext.Provider value={value}>{children}</SermonContext.Provider>;
}

export function useSermonWorkflow(): SermonContextValue {
  const value = useContext(SermonContext);
  if (!value) {
    throw new Error("SermonWorkflowProvider 안에서 사용해야 합니다.");
  }
  return value;
}

const STEPS = [
  { label: "옵션 설정", short: "옵션", path: "/sermon/options" },
  { label: "본문 입력", short: "본문", path: "/sermon/input" },
  { label: "대안 선택", short: "대안", path: "/sermon/alternatives" },
  { label: "수정", short: "수정", path: "/sermon/edit" },
  { label: "완성", short: "완성", path: "/sermon/complete" },
] as const;

function activeStep(pathname: string): number {
  if (pathname.startsWith("/sermon/complete")) return 4;
  if (pathname.startsWith("/sermon/edit")) return 3;
  if (pathname.startsWith("/sermon/alternatives")) return 2;
  if (pathname.startsWith("/sermon/input")) return 1;
  return 0;
}

function maxAvailableStep(draft: SermonDraft | null, isGuest: boolean): number {
  if (!draft) return 0;
  if (draft.stage === "completed" && draft.completedAt) return 4;
  if (draft.selectedAlternativeId) return 3;
  if (draft.alternatives.length >= (isGuest ? 1 : 5)) return 2;
  if (isSermonOptionsComplete(draft.options)) return 1;
  return 0;
}

export function SermonWorkflowShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { draft, isGuest, storageError, clearStorageError } = useSermonWorkflow();
  const current = activeStep(pathname);
  const available = maxAvailableStep(draft, isGuest);

  return (
    <div className="sermon-workspace">
      <header className="sermon-workspace-header">
        <div>
          <p className="sermon-eyebrow">LOGOS AI</p>
          <h1>새 설교 준비</h1>
        </div>
        <p className="sermon-workspace-note">
          본문을 중심에 두고, 다섯 가지 방향을 차분히 비교해 보세요.
        </p>
      </header>

      <nav className="sermon-stepper" aria-label="설교 작성 진행 단계">
        <ol>
          {STEPS.map((step, index) => {
            const isCurrent = index === current;
            const isDone = index < current || available > index;
            const isAvailable = index <= available && Boolean(draft);
            const content = (
              <>
                <span className="sermon-step-number" aria-hidden="true">
                  {isDone && !isCurrent ? "✓" : index + 1}
                </span>
                <span className="sermon-step-copy">
                  <span>{step.label}</span>
                  <small>{isCurrent ? "현재 단계" : isDone ? "준비됨" : "대기"}</small>
                </span>
              </>
            );
            return (
              <li
                key={step.path}
                className={`${isCurrent ? "is-current" : ""} ${isDone ? "is-done" : ""}`}
              >
                {isAvailable && draft ? (
                  <Link
                    href={sermonDraftUrl(step.path, draft.id)}
                    aria-current={isCurrent ? "step" : undefined}
                  >
                    {content}
                  </Link>
                ) : (
                  <span aria-current={isCurrent ? "step" : undefined}>{content}</span>
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      {storageError ? (
        <div className="sermon-inline-alert is-warning" role="status">
          <span>{storageError}</span>
          <button type="button" onClick={clearStorageError} aria-label="알림 닫기">
            닫기
          </button>
        </div>
      ) : null}

      <main className="sermon-stage">{children}</main>
    </div>
  );
}

export function SermonLoading({ label = "설교 작업을 불러오는 중입니다" }) {
  return (
    <div className="sermon-state-card" role="status" aria-live="polite">
      <span className="sermon-spinner" aria-hidden="true" />
      <p>{label}</p>
    </div>
  );
}

export function SermonStateCard({
  title,
  description,
  href = "/sermon/options",
  action = "옵션 설정부터 시작",
}: {
  title: string;
  description: string;
  href?: string;
  action?: string;
}) {
  return (
    <section className="sermon-state-card" aria-labelledby="sermon-state-title">
      <span className="sermon-state-mark" aria-hidden="true">
        !
      </span>
      <h2 id="sermon-state-title">{title}</h2>
      <p>{description}</p>
      <Link className="sermon-button is-primary" href={href}>
        {action}
      </Link>
    </section>
  );
}

export function SermonGuestGate({ returnTo }: { returnTo: string }) {
  const signIn = `/login?return_to=${encodeURIComponent(returnTo)}`;
  return (
    <section className="sermon-state-card sermon-guest-gate" aria-labelledby="guest-gate-title">
      <span className="sermon-state-mark is-lock" aria-hidden="true">
        회원
      </span>
      <p className="sermon-eyebrow">계속 작성하기</p>
      <h2 id="guest-gate-title">로그인하면 수정과 저장을 이어갈 수 있어요</h2>
      <p>
        비회원 미리보기는 한 번만 제공되며, 수정·완성·파일 저장은 로그인 후
        사용할 수 있습니다.
      </p>
      <div className="sermon-button-row is-centered">
        <Link className="sermon-button is-primary" href={signIn}>
          로그인하고 계속
        </Link>
        <Link className="sermon-button is-secondary" href="/signup">
          처음 이용 안내
        </Link>
      </div>
    </section>
  );
}

export function OptionBadges({ draft }: { draft: SermonDraft }) {
  const selectedTier = normalizeSermonAiTiers(draft.options)[0];
  const items = [
    { key: "topic", label: draft.options.topic },
    { key: "engine", label: `AI ${AI_ENGINE_TIER_META[selectedTier].label}` },
    { key: "type", label: draft.options.sermonType },
    { key: "audience", label: draft.options.audience },
    { key: "audience-situation", label: draft.options.audienceSituation },
    {
      key: "points",
      label:
        draft.options.pointCount === 1
          ? "1포인트"
          : draft.options.pointCount
            ? `${draft.options.pointCount}대지`
            : "",
    },
    {
      key: "duration",
      label: draft.options.duration ? `${draft.options.duration}분` : "",
    },
    { key: "tone", label: draft.options.tone },
  ].filter((item) => Boolean(item.label));
  return (
    <ul className="sermon-badges" aria-label="선택한 설교 옵션">
      {items.map((item) => (
        <li key={item.key}>{item.label}</li>
      ))}
    </ul>
  );
}
