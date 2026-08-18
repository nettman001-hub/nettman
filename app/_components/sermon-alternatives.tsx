"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { requestSermonGenerationSequence } from "@/app/_lib/sermon-client";
import {
  createSermonGeneration,
  sermonDraftUrl,
} from "@/app/_lib/sermon-store";
import { isSermonAlternative } from "@/app/_lib/sermon-types";
import {
  OptionBadges,
  SermonLoading,
  SermonStateCard,
  useSermonWorkflow,
} from "./sermon-workflow";

function excerpt(value: string): string {
  const sentences = value.match(/[^.!?。]+[.!?。]?/g) ?? [value];
  return sentences.slice(0, 2).join(" ").trim();
}

export function SermonAlternatives() {
  const router = useRouter();
  const { draft, ready, isGuest, clientUserScope, updateDraft } = useSermonWorkflow();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [generationStep, setGenerationStep] = useState<{
    position: number;
    completed: number;
    total: number;
  } | null>(null);
  const [error, setError] = useState("");
  const [guestMessage, setGuestMessage] = useState(false);
  const generationController = useRef<AbortController | null>(null);

  useEffect(() => {
    if (draft?.selectedAlternativeId) setSelectedId(draft.selectedAlternativeId);
  }, [draft?.selectedAlternativeId]);

  useEffect(() => {
    return () => generationController.current?.abort();
  }, []);

  if (!ready) return <SermonLoading />;
  if (!draft) {
    return (
      <SermonStateCard
        title="생성된 설교를 찾지 못했습니다"
        description="본문을 입력해 다섯 개의 초안을 먼저 만들어 주세요."
      />
    );
  }
  if (draft.alternatives.length < (isGuest ? 1 : 5)) {
    return (
      <SermonStateCard
        title={isGuest ? "미리보기 초안이 준비되지 않았습니다" : "다섯 개 초안이 아직 준비되지 않았습니다"}
        description="본문 입력 단계에서 다시 생성해 주세요."
        href={sermonDraftUrl("/sermon/input", draft.id)}
        action="본문 입력으로 돌아가기"
      />
    );
  }

  const choose = () => {
    if (!selectedId) return;
    if (isGuest) {
      setGuestMessage(true);
      return;
    }
    const selected = draft.alternatives.find((item) => item.id === selectedId);
    if (!selected) return;
    updateDraft((current) => ({
      ...current,
      selectedAlternativeId: selectedId,
      generation: null,
      versions: [
        {
          id: `version-${Date.now()}`,
          sermon: selected,
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

  const regenerate = async () => {
    if (generationController.current) return;
    if (isGuest) {
      setGuestMessage(true);
      return;
    }
    const resumable =
      draft.generation?.mode === "regenerate" &&
      draft.generation.expectedCount === 5 &&
      draft.generation.alternatives.length < 5;
    if (
      !resumable &&
      !window.confirm(
        "현재 다섯 초안을 새 결과로 바꿀까요? 새 다섯 편이 모두 완성될 때까지 현재 결과는 유지됩니다.",
      )
    ) {
      return;
    }
    const generation = resumable && draft.generation
      ? draft.generation
      : createSermonGeneration("regenerate", 5);
    setRegenerating(true);
    setGenerationStep(null);
    setGenerationProgress(generation.alternatives.length);
    setError("");
    updateDraft((current) => ({
      ...current,
      stage: "generating",
      generation,
    }));
    const controller = new AbortController();
    generationController.current = controller;
    try {
      const result = await requestSermonGenerationSequence(
        {
          draftId: draft.id,
          options: draft.options,
          scripture: draft.scripture,
          reference: draft.reference,
        },
        {
          generationId: generation.id,
          expectedCount: 5,
          completed: generation.alternatives,
          completedParts: generation.parts,
          signal: controller.signal,
          clientUserScope: clientUserScope ?? null,
          onStepProgress: (parts, position, completed, total) => {
            setGenerationStep({ position, completed, total });
            updateDraft((current) =>
              current.generation?.id === generation.id
                ? {
                    ...current,
                    generation: { ...current.generation, parts },
                    stage: "generating",
                  }
                : current,
            );
          },
          onProgress: (alternatives, completedCount) => {
            setGenerationProgress(completedCount);
            setGenerationStep(null);
            updateDraft((current) =>
              current.generation?.id === generation.id
                ? {
                    ...current,
                    generation: {
                      ...current.generation,
                      alternatives,
                      parts: current.generation.parts.filter(
                        (part) => part.position > completedCount,
                      ),
                    },
                    stage: "generating",
                  }
                : current,
            );
          },
        },
      );
      if (
        result.alternatives.length !== 5 ||
        !result.alternatives.every(isSermonAlternative)
      ) {
        throw new Error("다섯 초안을 모두 생성하지 못했습니다.");
      }
      updateDraft((current) => ({
        ...current,
        alternatives: result.alternatives,
        generation: null,
        selectedAlternativeId: null,
        versions: [],
        revisions: [],
        revisionCount: 0,
        completedAt: null,
        savedSermonId: null,
        saveMode: null,
        stage: "alternatives",
      }));
      setSelectedId(null);
    } catch (caught) {
      const message =
        caught instanceof DOMException && caught.name === "AbortError"
          ? "새 초안 생성이 중단되었습니다. 완성된 번호부터 이어서 만들 수 있습니다."
          : caught instanceof Error
            ? caught.message
            : "새 초안을 준비하지 못했습니다.";
      const restartRequired =
        message.includes("새 초안 묶음") || message.includes("새 묶음으로 다시 시작");
      setError(message);
      updateDraft((current) =>
        current.generation?.id === generation.id
          ? {
              ...current,
              stage: "alternatives",
              generation: restartRequired ? null : current.generation,
            }
          : current,
      );
    } finally {
      if (generationController.current === controller) {
        generationController.current = null;
      }
      setRegenerating(false);
      setGenerationStep(null);
    }
  };

  const pendingGeneration =
    draft.generation?.mode === "regenerate" ? draft.generation : null;
  const completedCount = regenerating
    ? generationProgress
    : pendingGeneration?.alternatives.length ?? 0;

  return (
    <div className="sermon-alternatives-page">
      <section className="sermon-form-intro sermon-results-intro">
        <div>
          <p className="sermon-eyebrow">Step 03 · {isGuest ? "Preview" : "Five directions"}</p>
          <h2>{isGuest ? "첫 설교 미리보기가 준비됐습니다" : "다섯 가지 설교 방향이 준비됐습니다"}</h2>
          <p>
            {isGuest
              ? "첫 번째 안의 도입과 첫 대지까지 확인할 수 있습니다. 전체 결과는 로그인 후 열립니다."
              : "제목과 도입을 살펴본 뒤 한 편을 선택하세요. 미리보기에서는 전체 구조를 편안하게 읽을 수 있습니다."}
          </p>
        </div>
        <OptionBadges draft={draft} />
      </section>

      {regenerating || pendingGeneration ? (
        <div className="sermon-generation-panel is-loading" role="status" aria-live="polite">
          <div>
            <p className="sermon-eyebrow">Regenerating</p>
            <h3>새 초안 5편 중 {completedCount}편을 완성했습니다</h3>
            <p>
              {regenerating
                ? generationStep
                  ? `${generationStep.position}번째 초안을 ${generationStep.completed}/${generationStep.total}단계로 나눠 만들고 있습니다. 현재 다섯 초안은 끝까지 유지됩니다.`
                  : `${Math.min(completedCount + 1, 5)}번째 초안을 생성 중입니다. 현재 다섯 초안은 새 묶음이 완성될 때까지 유지됩니다.`
                : "완성된 새 초안은 저장되어 있습니다. 남은 번호부터 이어서 만들 수 있습니다."}
            </p>
            {pendingGeneration?.alternatives.length ? (
              <ol className="sermon-generation-progress-list">
                {pendingGeneration.alternatives.map((alternative, index) => (
                  <li key={alternative.id}>
                    <span>{index + 1}</span>
                    <strong>{alternative.title}</strong>
                    <small>저장됨</small>
                  </li>
                ))}
              </ol>
            ) : null}
          </div>
          {regenerating ? <span className="sermon-spinner is-large" aria-hidden="true" /> : null}
        </div>
      ) : null}

      <fieldset className="sermon-alternative-fieldset" disabled={regenerating}>
        <legend className="sr-only">설교 초안 하나 선택</legend>
        <div className="sermon-alternative-list">
          {draft.alternatives.map((alternative, index) => {
            const selected = selectedId === alternative.id;
            const previewHref = sermonDraftUrl(
              "/sermon/alternatives/preview",
              draft.id,
              { alternativeId: alternative.id },
            );
            return (
              <article
                key={alternative.id}
                className={`sermon-alternative-card ${selected ? "is-selected" : ""}`}
              >
                <label className="sermon-alternative-select">
                  <input
                    type="radio"
                    name="alternative"
                    value={alternative.id}
                    checked={selected}
                    onChange={() => {
                      setSelectedId(alternative.id);
                      setGuestMessage(false);
                    }}
                  />
                  <span className="sermon-alternative-number">{String(index + 1).padStart(2, "0")}</span>
                  <span className="sr-only">{alternative.title} 선택</span>
                </label>
                <div className="sermon-alternative-content">
                  <div className="sermon-alternative-title-row">
                    <div>
                      <span className="sermon-card-kicker">대안 {index + 1}</span>
                      <h3>{alternative.title}</h3>
                    </div>
                    <span>{alternative.sections.points.length}대지</span>
                  </div>
                  <p className="sermon-alternative-summary">{alternative.summary}</p>
                  <blockquote>{excerpt(alternative.sections.introduction)}</blockquote>
                  <div className="sermon-alternative-actions">
                    <button
                      type="button"
                      className="sermon-text-button"
                      onClick={() => setSelectedId(alternative.id)}
                    >
                      {selected ? "선택됨" : "이 초안 선택"}
                    </button>
                    <Link className="sermon-text-button is-preview" href={previewHref}>
                      전체 미리보기
                    </Link>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </fieldset>

      {guestMessage ? (
        <div className="sermon-inline-alert is-warning" role="status">
          <div>
            <strong>비회원은 미리보기까지 이용할 수 있습니다</strong>
            <p>선택한 초안을 수정하고 저장하려면 로그인해 주세요.</p>
          </div>
          <Link href={`/login?return_to=${encodeURIComponent(sermonDraftUrl("/sermon/alternatives", draft.id))}`}>
            로그인
          </Link>
        </div>
      ) : null}
      {error ? (
        <div className="sermon-inline-alert is-error" role="alert">
          <div>
            <strong>새로 생성하지 못했습니다</strong>
            <p>{error}</p>
          </div>
          <button type="button" onClick={() => void regenerate()}>
            {completedCount ? "남은 초안 이어 만들기" : "다시 시도"}
          </button>
        </div>
      ) : null}

      <footer className="sermon-form-actions is-sticky">
        <button
          type="button"
          className="sermon-button is-secondary"
          onClick={() => void regenerate()}
          disabled={regenerating}
        >
          {isGuest
            ? "다른 초안은 로그인 후"
            : pendingGeneration
              ? "남은 초안 이어 만들기"
              : "새로 생성"}
        </button>
        <div>
          <p>{selectedId ? "선택한 설교로 수정 단계에 들어갑니다." : "초안 하나를 선택해 주세요."}</p>
          <button
            type="button"
            className="sermon-button is-primary"
            onClick={choose}
            disabled={!selectedId || regenerating}
          >
            {isGuest ? "선택 후 이용 안내" : "이 설교로 계속"}
          </button>
        </div>
      </footer>
    </div>
  );
}
