"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  SERMON_GUEST_PREVIEW_KEY,
  sermonDraftUrl,
} from "@/app/_lib/sermon-store";
import {
  SermonLoading,
  SermonStateCard,
  useSermonWorkflow,
} from "./sermon-workflow";

type GuestPreviewRecord = {
  draftId: string;
  alternativeId: string;
  usedAt: string;
};

function Paragraphs({ text }: { text: string }) {
  return (
    <>
      {text.split(/\n{2,}/).map((paragraph) => (
        <p key={paragraph.slice(0, 60)}>{paragraph}</p>
      ))}
    </>
  );
}

export function SermonPreview() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const alternativeId = searchParams.get("alternativeId");
  const { draft, ready, isGuest, updateDraft } = useSermonWorkflow();
  const [checkingGuestLimit, setCheckingGuestLimit] = useState(true);
  const [guestAllowed, setGuestAllowed] = useState(false);
  const closeButton = useRef<HTMLButtonElement>(null);

  const alternative = useMemo(
    () => draft?.alternatives.find((item) => item.id === alternativeId) ?? null,
    [alternativeId, draft?.alternatives],
  );

  const close = () => {
    if (!draft) {
      router.replace("/sermon/alternatives");
      return;
    }
    router.replace(sermonDraftUrl("/sermon/alternatives", draft.id));
  };

  useEffect(() => {
    if (!ready || !draft || !alternativeId) return;
    if (!isGuest) {
      setGuestAllowed(true);
      setCheckingGuestLimit(false);
      return;
    }
    try {
      const raw = window.localStorage.getItem(SERMON_GUEST_PREVIEW_KEY);
      const used = raw ? (JSON.parse(raw) as GuestPreviewRecord) : null;
      if (!used) {
        const next: GuestPreviewRecord = {
          draftId: draft.id,
          alternativeId,
          usedAt: new Date().toISOString(),
        };
        window.localStorage.setItem(SERMON_GUEST_PREVIEW_KEY, JSON.stringify(next));
        setGuestAllowed(true);
      } else {
        setGuestAllowed(
          used.draftId === draft.id && used.alternativeId === alternativeId,
        );
      }
    } catch {
      // 저장소가 차단된 브라우저에서도 전체가 아닌 제한 미리보기만 허용합니다.
      setGuestAllowed(true);
    }
    setCheckingGuestLimit(false);
  }, [alternativeId, draft, isGuest, ready]);

  useEffect(() => {
    if (!ready) return;
    closeButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // close는 현재 draftId를 의도적으로 캡처합니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, draft?.id]);

  if (!ready || checkingGuestLimit) return <SermonLoading label="미리보기를 여는 중입니다" />;
  if (!draft || !alternative) {
    return (
      <SermonStateCard
        title="미리볼 설교를 찾지 못했습니다"
        description="대안 목록에서 설교 하나를 다시 선택해 주세요."
        href={draft ? sermonDraftUrl("/sermon/alternatives", draft.id) : "/sermon/options"}
        action="대안 목록으로"
      />
    );
  }

  const select = () => {
    if (isGuest) return;
    updateDraft((current) => ({
      ...current,
      selectedAlternativeId: alternative.id,
      generation: null,
      versions: [
        {
          id: `version-${Date.now()}`,
          sermon: alternative,
          createdAt: new Date().toISOString(),
        },
      ],
      revisions: [],
      revisionCount: 0,
      completedAt: null,
      savedSermonId: null,
      saveMode: null,
      stage: "editing",
    }));
    router.push(sermonDraftUrl("/sermon/edit", draft.id));
  };

  return (
    <div
      className="sermon-preview-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section
        className="sermon-preview-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sermon-preview-title"
      >
        <header className="sermon-preview-header">
          <div>
            <p className="sermon-eyebrow">Sermon preview</p>
            <h2 id="sermon-preview-title">설교 미리보기</h2>
          </div>
          <button ref={closeButton} type="button" onClick={close} aria-label="미리보기 닫기">
            닫기 <span aria-hidden="true">×</span>
          </button>
        </header>

        {!guestAllowed ? (
          <div className="sermon-preview-limit">
            <span className="sermon-state-mark is-lock" aria-hidden="true">
              1회
            </span>
            <p className="sermon-eyebrow">Preview used</p>
            <h3>비회원 미리보기를 이미 사용했습니다</h3>
            <p>
              로그인하면 다섯 설교 전문을 비교하고, 원하는 초안을 세 번까지
              수정할 수 있습니다.
            </p>
            <div className="sermon-button-row is-centered">
              <Link
                className="sermon-button is-primary"
                href={`/login?return_to=${encodeURIComponent(sermonDraftUrl("/sermon/alternatives", draft.id))}`}
              >
                로그인하고 계속
              </Link>
              <button className="sermon-button is-secondary" type="button" onClick={close}>
                대안 목록으로
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="sermon-preview-scroll">
              <article className="sermon-manuscript">
                <header className="sermon-manuscript-title">
                  <p>{alternative.scripture}</p>
                  <h3>{alternative.title}</h3>
                  <ul>
                    <li>{draft.options.audience}</li>
                    <li>{draft.options.duration}분</li>
                    <li>{draft.options.sermonType}</li>
                    <li>{alternative.sections.points.length}대지</li>
                  </ul>
                </header>

                <section id="preview-introduction">
                  <span>01</span>
                  <div>
                    <h4>도입</h4>
                    <Paragraphs text={alternative.sections.introduction} />
                  </div>
                </section>

                <section id="preview-body">
                  <span>02</span>
                  <div>
                    <h4>본론</h4>
                    {(isGuest
                      ? alternative.sections.points.slice(0, 1)
                      : alternative.sections.points
                    ).map((point, index) => (
                      <div className="sermon-manuscript-point" key={point.heading}>
                        <h5>
                          {index + 1}. {point.heading}
                        </h5>
                        <Paragraphs text={point.content} />
                      </div>
                    ))}
                  </div>
                </section>

                {isGuest ? (
                  <aside className="sermon-preview-membership-wall">
                    <p className="sermon-eyebrow">첫 대지까지 미리보기</p>
                    <h4>결론과 적용, 나머지 대지는 로그인 후 확인할 수 있어요</h4>
                    <p>전체 결과 비교와 수정, 저장 기능도 함께 열립니다.</p>
                    <Link
                      className="sermon-button is-primary"
                      href={`/login?return_to=${encodeURIComponent(sermonDraftUrl("/sermon/alternatives", draft.id))}`}
                    >
                      로그인하고 전체 보기
                    </Link>
                  </aside>
                ) : (
                  <>
                    <section id="preview-conclusion">
                      <span>03</span>
                      <div>
                        <h4>결론</h4>
                        <Paragraphs text={alternative.sections.conclusion} />
                      </div>
                    </section>
                    <section id="preview-application">
                      <span>04</span>
                      <div>
                        <h4>적용</h4>
                        <Paragraphs text={alternative.sections.application} />
                      </div>
                    </section>
                  </>
                )}
              </article>
            </div>

            <footer className="sermon-preview-actions">
              <p>
                {isGuest
                  ? "비회원 미리보기에서는 저장과 다운로드를 제공하지 않습니다."
                  : "이 초안을 선택하면 최대 세 번까지 목회적으로 다듬을 수 있습니다."}
              </p>
              <div className="sermon-button-row">
                <button className="sermon-button is-secondary" type="button" onClick={close}>
                  닫기
                </button>
                {isGuest ? (
                  <Link
                    className="sermon-button is-primary"
                    href={`/login?return_to=${encodeURIComponent(sermonDraftUrl("/sermon/alternatives", draft.id))}`}
                  >
                    로그인 후 선택
                  </Link>
                ) : (
                  <button className="sermon-button is-primary" type="button" onClick={select}>
                    이 설교 선택
                  </button>
                )}
              </div>
            </footer>
          </>
        )}
      </section>
    </div>
  );
}
