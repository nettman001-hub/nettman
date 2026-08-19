"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  downloadSermonDocx,
  printSermonAsPdf,
} from "@/app/_lib/sermon-download";
import { sermonDraftUrl } from "@/app/_lib/sermon-store";
import {
  OptionBadges,
  SermonGuestGate,
  SermonLoading,
  SermonStateCard,
  useSermonWorkflow,
} from "./sermon-workflow";

function Paragraphs({ text }: { text: string }) {
  return (
    <>
      {text.split(/\n{2,}/).map((paragraph) => (
        <p key={paragraph.slice(0, 60)}>{paragraph}</p>
      ))}
    </>
  );
}

export function SermonComplete() {
  const router = useRouter();
  const { draft, ready, isGuest, createDraft, replaceDraft } = useSermonWorkflow();
  const [downloadError, setDownloadError] = useState("");
  const [downloadNotice, setDownloadNotice] = useState("");
  const [retryingSave, setRetryingSave] = useState(false);

  const sermon = useMemo(() => {
    if (!draft) return null;
    return (
      draft.versions.at(-1)?.sermon ??
      draft.alternatives.find((item) => item.id === draft.selectedAlternativeId) ??
      null
    );
  }, [draft]);

  if (!ready) return <SermonLoading />;
  if (!draft) {
    return (
      <SermonStateCard
        title="완성된 설교를 찾지 못했습니다"
        description="새 설교를 시작해 원고를 먼저 완성해 주세요."
      />
    );
  }
  if (isGuest) {
    return <SermonGuestGate returnTo={sermonDraftUrl("/sermon/complete", draft.id)} />;
  }
  if (!sermon || draft.stage !== "completed" || !draft.completedAt) {
    return (
      <SermonStateCard
        title="아직 최종 완료되지 않았습니다"
        description="수정 단계에서 원고를 확인한 뒤 ‘이대로 완성’을 눌러 주세요."
        href={sermonDraftUrl("/sermon/edit", draft.id)}
        action="수정 단계로"
      />
    );
  }

  const pdf = () => {
    setDownloadError("");
    setDownloadNotice("");
    try {
      printSermonAsPdf(sermon, draft.options);
      setDownloadNotice(
        "인쇄 창이 열렸습니다. 대상에서 ‘PDF로 저장’을 선택해 주세요.",
      );
    } catch (caught) {
      setDownloadError(
        caught instanceof Error ? caught.message : "PDF 준비에 실패했습니다.",
      );
    }
  };

  const word = () => {
    setDownloadError("");
    setDownloadNotice("");
    try {
      downloadSermonDocx(sermon, draft.options);
      setDownloadNotice("한글 서식을 포함한 Word 파일 다운로드를 시작했습니다.");
    } catch {
      setDownloadError("Word 파일을 만들지 못했습니다. 다시 시도해 주세요.");
    }
  };

  const startNew = () => {
    const next = createDraft();
    router.push(sermonDraftUrl("/sermon/options", next.id));
  };

  const retryServerSave = async () => {
    if (retryingSave) return;
    setRetryingSave(true);
    setDownloadError("");
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch("/api/sermons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftId: draft.id,
          title: sermon.title,
          scripture: sermon.scripture,
          sermonType: draft.options.sermonType,
          audience: draft.options.audience,
          audienceSituation: draft.options.audienceSituation,
          pointCount: sermon.sections.points.length,
          duration: draft.options.duration,
          emotion: draft.options.tone,
          sections: {
            introduction: sermon.sections.introduction,
            body: sermon.sections.points,
            conclusion: sermon.sections.conclusion,
            application: sermon.sections.application,
          },
          createdAt: draft.createdAt,
        }),
        signal: controller.signal,
      });
      const body = (await response.json().catch(() => null)) as
        | { item?: { id?: string }; error?: string }
        | null;
      if (!response.ok || !body?.item?.id) {
        throw new Error(body?.error || "계정 히스토리에 저장하지 못했습니다.");
      }
      replaceDraft({
        ...draft,
        savedSermonId: body.item.id,
        saveMode: "server",
      });
      window.sessionStorage.removeItem(`sermon-guide:save-warning:${draft.id}`);
      setDownloadNotice("계정 히스토리에 안전하게 저장했습니다.");
    } catch (caught) {
      setDownloadError(
        caught instanceof DOMException && caught.name === "AbortError"
          ? "서버 저장 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요."
          : caught instanceof Error
            ? caught.message
            : "계정 히스토리에 저장하지 못했습니다.",
      );
    } finally {
      window.clearTimeout(timeout);
      setRetryingSave(false);
    }
  };

  const completedLabel = new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date(draft.completedAt));

  return (
    <div className="sermon-complete-page">
      <section className="sermon-complete-hero">
        <div className="sermon-complete-mark" aria-hidden="true">
          <span>✓</span>
        </div>
        <div>
          <p className="sermon-eyebrow">Step 05 · Complete</p>
          <h2>설교가 완성되었습니다</h2>
          <p>
            {completedLabel}에 {draft.saveMode === "server" ? "계정 히스토리에" : "이 브라우저에 임시로"} 저장했습니다. 마지막으로 본문
            해석과 인용을 직접 확인한 뒤 선포해 주세요.
          </p>
        </div>
        <div className="sermon-complete-status">
          <span aria-hidden="true" />
          {draft.saveMode === "server" ? "저장 완료" : "로컬 임시 저장"}
        </div>
      </section>

      {draft.saveMode === "local" ? (
        <div className="sermon-inline-alert is-warning" role="status">
          <div>
            <strong>서버 연결 문제로 이 브라우저에 임시 보관했습니다</strong>
            <p>계정 히스토리에 표시하려면 서버 저장을 다시 시도해 주세요.</p>
          </div>
          <button type="button" disabled={retryingSave} onClick={() => void retryServerSave()}>
            {retryingSave ? "저장 중…" : "서버 저장 다시 시도"}
          </button>
        </div>
      ) : null}

      <section className="sermon-complete-summary" aria-labelledby="complete-summary-title">
        <div>
          <p>{sermon.scripture}</p>
          <h3 id="complete-summary-title">{sermon.title}</h3>
          <OptionBadges draft={draft} />
        </div>
        <dl>
          <div>
            <dt>수정 반영</dt>
            <dd>{draft.revisionCount}회</dd>
          </div>
          <div>
            <dt>원고 버전</dt>
            <dd>v{draft.versions.length}</dd>
          </div>
          <div>
            <dt>본문 구성</dt>
            <dd>{sermon.sections.points.length}대지</dd>
          </div>
        </dl>
      </section>

      <section className="sermon-download-panel" aria-labelledby="download-title">
        <div>
          <p className="sermon-eyebrow">Keep your manuscript</p>
          <h3 id="download-title">원고를 파일로 보관하세요</h3>
          <p>Word는 편집용 DOCX로, PDF는 브라우저의 인쇄 창을 통해 저장합니다.</p>
        </div>
        <div className="sermon-download-actions">
          <button className="sermon-download-button" type="button" onClick={pdf}>
            <span aria-hidden="true">PDF</span>
            <strong>PDF로 저장</strong>
            <small>A4 인쇄 서식</small>
          </button>
          <button className="sermon-download-button" type="button" onClick={word}>
            <span aria-hidden="true">DOCX</span>
            <strong>Word로 내려받기</strong>
            <small>한글 편집 서식</small>
          </button>
        </div>
      </section>

      {downloadError ? (
        <div className="sermon-inline-alert is-error" role="alert">
          <strong>{downloadError}</strong>
          <button type="button" onClick={() => setDownloadError("")}>
            닫기
          </button>
        </div>
      ) : null}
      {downloadNotice ? (
        <div className="sermon-inline-alert is-success" role="status" aria-live="polite">
          <strong>{downloadNotice}</strong>
        </div>
      ) : null}

      {draft.saveMode === "server" && draft.savedSermonId ? (
        <section
          className="mt-6 rounded-[1.6rem] border border-[#d7d0c5] bg-[#f7f2e9] p-5 shadow-[0_14px_36px_rgba(39,50,44,.06)] sm:p-7"
          aria-labelledby="follow-up-tools-title"
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="sermon-eyebrow">Continue your preparation</p>
              <h3 id="follow-up-tools-title" className="mt-1 font-serif text-2xl font-bold text-[#294238]">
                완성한 설교를 더 깊고 넓게 활용하세요
              </h3>
            </div>
            <p className="max-w-xl text-sm leading-6 text-[#68756e]">
              저장된 원고를 다시 선택할 필요 없이 본문 연구와 사역 자료 제작으로 이어갈 수 있습니다.
            </p>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <Link
              href={`/study?sermonId=${encodeURIComponent(draft.savedSermonId)}`}
              className="group rounded-2xl border border-[#cfd8d1] bg-white p-5 transition hover:-translate-y-0.5 hover:border-[#8da497] hover:shadow-[0_12px_26px_rgba(39,50,44,.08)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838]"
            >
              <span className="text-[10px] font-extrabold tracking-[0.14em] text-[#8b5a31] uppercase">04 · Study</span>
              <strong className="mt-2 block font-serif text-lg text-[#294238]">스터디로 이어가기</strong>
              <small className="mt-1 block text-xs leading-5 text-[#748079]">원문, 배경과 구조를 더 깊이 살펴봅니다.</small>
            </Link>
            <Link
              href={`/ministry?sermonId=${encodeURIComponent(draft.savedSermonId)}`}
              className="group rounded-2xl border border-[#d9cdbd] bg-white p-5 transition hover:-translate-y-0.5 hover:border-[#b69368] hover:shadow-[0_12px_26px_rgba(39,50,44,.08)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838]"
            >
              <span className="text-[10px] font-extrabold tracking-[0.14em] text-[#8b5a31] uppercase">05 · Ministry</span>
              <strong className="mt-2 block font-serif text-lg text-[#294238]">사역 활용으로 이어가기</strong>
              <small className="mt-1 block text-xs leading-5 text-[#748079]">질문지, 주보 요약과 숏폼 문구를 만듭니다.</small>
            </Link>
          </div>
        </section>
      ) : null}

      <article className="sermon-manuscript sermon-final-manuscript">
        <header className="sermon-manuscript-title">
          <p>최종 설교 원고</p>
          <h3>{sermon.title}</h3>
          <span>{sermon.scripture}</span>
        </header>
        <section>
          <span>01</span>
          <div>
            <h4>도입</h4>
            <Paragraphs text={sermon.sections.introduction} />
          </div>
        </section>
        <section>
          <span>02</span>
          <div>
            <h4>본론</h4>
            {sermon.sections.points.map((point, index) => (
              <div className="sermon-manuscript-point" key={point.heading}>
                <h5>
                  {index + 1}. {point.heading}
                </h5>
                <Paragraphs text={point.content} />
              </div>
            ))}
          </div>
        </section>
        <section>
          <span>03</span>
          <div>
            <h4>결론</h4>
            <Paragraphs text={sermon.sections.conclusion} />
          </div>
        </section>
        <section>
          <span>04</span>
          <div>
            <h4>적용</h4>
            <Paragraphs text={sermon.sections.application} />
          </div>
        </section>
      </article>

      <footer className="sermon-complete-footer">
        <div>
          {draft.savedSermonId ? (
            <Link className="sermon-button is-secondary" href={`/history/${draft.savedSermonId}`}>
              히스토리에서 보기
            </Link>
          ) : (
            <button
              className="sermon-button is-secondary"
              type="button"
              disabled={retryingSave}
              onClick={() => void retryServerSave()}
            >
              계정 히스토리에 저장
            </button>
          )}
          <button className="sermon-button is-primary" type="button" onClick={startNew}>
            새 설교 만들기
          </button>
        </div>
        <p>완성한 원고는 AI 초안입니다. 설교자의 신학적·목회적 검토가 필요합니다.</p>
      </footer>
    </div>
  );
}
