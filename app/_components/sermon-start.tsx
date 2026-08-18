"use client";

import { useRouter } from "next/navigation";
import { sermonDraftUrl } from "@/app/_lib/sermon-store";
import { SermonLoading, useSermonWorkflow } from "./sermon-workflow";

export function SermonStart() {
  const router = useRouter();
  const { draft, ready, createDraft } = useSermonWorkflow();

  if (!ready) return <SermonLoading />;

  const start = () => {
    const next = createDraft();
    router.push(sermonDraftUrl("/sermon/options", next.id));
  };
  const resumePath = draft
    ? draft.stage === "completed"
      ? "/sermon/complete"
      : draft.selectedAlternativeId
        ? "/sermon/edit"
        : draft.alternatives.length
          ? "/sermon/alternatives"
          : draft.scripture
            ? "/sermon/input"
            : "/sermon/options"
    : null;

  return (
    <div className="sermon-start-page">
      <section className="sermon-start-hero">
        <div>
          <p className="sermon-eyebrow">본문에서 삶으로</p>
          <h2 aria-label="한 편의 설교를, 다섯 가지 시선으로 시작합니다.">
            한 편의 설교를,
            <br />
            다섯 가지 시선으로
            <br />
            시작합니다.
          </h2>
          <p>
            주제와 본문을 알려주시면 도입·본론·결론·적용을 갖춘 다섯 개의
            초안을 준비합니다. 비교하고 다듬는 동안 선택한 내용은 이
            브라우저에 자동 저장됩니다.
          </p>
          <div className="sermon-button-row">
            <button className="sermon-button is-primary" type="button" onClick={start}>
              새 설교 시작
            </button>
            {draft && resumePath ? (
              <button
                className="sermon-button is-secondary"
                type="button"
                onClick={() => router.push(sermonDraftUrl(resumePath, draft.id))}
              >
                작성 중인 설교 이어가기
              </button>
            ) : null}
          </div>
        </div>
        <div className="sermon-start-quote" aria-label="설교 준비 원칙">
          <span aria-hidden="true">“</span>
          <blockquote>
            AI는 초안을 돕고,
            <br />
            최종 해석과 선포는 설교자가 책임집니다.
          </blockquote>
        </div>
      </section>

      <section className="sermon-process" aria-labelledby="sermon-process-title">
        <div>
          <p className="sermon-eyebrow">Five thoughtful steps</p>
          <h3 id="sermon-process-title">준비의 흐름</h3>
        </div>
        <ol>
          {[
            ["01", "방향 정하기", "주제·대상·분량과 설교의 온도를 정합니다."],
            ["02", "본문 놓기", "중심이 될 성경 구절과 참고 자료를 더합니다."],
            ["03", "대안 비교", "관점이 다른 다섯 초안을 읽고 하나를 고릅니다."],
            ["04", "목회적으로 수정", "최대 세 번, 필요한 부분을 구체적으로 다듬습니다."],
            ["05", "완성하고 저장", "최종 원고를 Word 또는 PDF로 준비합니다."],
          ].map(([number, title, description]) => (
            <li key={number}>
              <span>{number}</span>
              <h4>{title}</h4>
              <p>{description}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
