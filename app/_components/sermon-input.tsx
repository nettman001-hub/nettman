"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  requestScriptureNormalization,
  requestSermonGenerationSequence,
  SCRIPTURE_NORMALIZATION_GRANT_INVALID,
  SermonClientError,
} from "@/app/_lib/sermon-client";
import {
  createSermonGeneration,
  hasActiveScriptureNormalizationGrant,
  sermonGenerationUsesScripture,
  sermonDraftUrl,
} from "@/app/_lib/sermon-store";
import {
  EMPTY_SERMON_REFERENCE,
  isSermonAlternative,
  isSermonOptionsComplete,
  type ReferenceFile,
  type SermonGeneration,
  type SermonReference,
  type ScriptureNormalization,
} from "@/app/_lib/sermon-types";
import {
  OptionBadges,
  SermonLoading,
  SermonStateCard,
  useSermonWorkflow,
} from "./sermon-workflow";

const SUPPORTED_EXTENSIONS = ["pdf", "docx", "txt"];

function validScriptureInput(value: string): boolean {
  const normalized = value.trim();
  return normalized.length >= 2 && normalized.length <= 120;
}

function validUrl(value: string): boolean {
  if (!value.trim()) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function SermonInput() {
  const router = useRouter();
  const { draft, ready, isGuest, clientUserScope, updateDraft } = useSermonWorkflow();
  const [scripture, setScripture] = useState("");
  const [reference, setReference] = useState<SermonReference>({
    url: "",
    notes: "",
    file: null,
  });
  const [submitted, setSubmitted] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [normalizingScripture, setNormalizingScripture] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [pendingScriptureConfirmation, setPendingScriptureConfirmation] =
    useState<ScriptureNormalization | null>(null);
  const [generationStep, setGenerationStep] = useState<{
    position: number;
    completed: number;
    total: number;
  } | null>(null);
  const [error, setError] = useState("");
  const [fileError, setFileError] = useState("");
  const hydratedId = useRef<string | null>(null);
  const generationController = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!draft || hydratedId.current === draft.id) return;
    hydratedId.current = draft.id;
    setPendingScriptureConfirmation(null);
    setScripture(draft.scripture);
    setReference(draft.reference);
  }, [draft]);

  useEffect(() => {
    return () => generationController.current?.abort();
  }, []);

  useEffect(() => {
    const expectedCount = isGuest ? 1 : 5;
    if (
      draft?.stage === "generating" &&
      !draft.generation &&
      draft.alternatives.length === expectedCount
    ) {
      router.replace(sermonDraftUrl("/sermon/alternatives", draft.id));
    }
  }, [draft, isGuest, router]);

  const scriptureValid = useMemo(
    () => validScriptureInput(scripture),
    [scripture],
  );
  const urlValid = validUrl(reference.url);
  const canGenerate = scriptureValid && urlValid && !generating;

  if (!ready) return <SermonLoading />;
  if (!draft) {
    return (
      <SermonStateCard
        title="작성 중인 설교를 찾지 못했습니다"
        description="옵션 설정부터 다시 시작하면 새 초안이 안전하게 만들어집니다."
      />
    );
  }
  if (!isSermonOptionsComplete(draft.options)) {
    return (
      <SermonStateCard
        title="옵션 설정이 먼저 필요합니다"
        description="제목, 분량, 유형, 구성, 대상, 청중 상황과 감정선을 모두 정해 주세요."
        href={sermonDraftUrl("/sermon/options", draft.id)}
      />
    );
  }

  const attachFile = async (file: File | undefined) => {
    setFileError("");
    if (!file) return;
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!SUPPORTED_EXTENSIONS.includes(extension)) {
      setFileError("PDF, DOCX, TXT 파일만 첨부할 수 있습니다.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setFileError("파일은 10MB 이하만 첨부할 수 있습니다.");
      return;
    }
    let text: string | undefined;
    if (extension === "txt") {
      try {
        text = (await file.text()).slice(0, 50_000);
      } catch {
        setFileError("TXT 파일을 읽지 못했습니다. 다시 선택해 주세요.");
        return;
      }
    }
    const nextFile: ReferenceFile = {
      name: file.name,
      type: file.type || `application/${extension}`,
      size: file.size,
      text,
    };
    setReference((current) => ({ ...current, file: nextFile }));
  };

  const generate = async () => {
    if (generationController.current) return;
    setSubmitted(true);
    setError("");
    if (!canGenerate) return;
    setGenerating(true);
    setStopping(false);
    setGenerationStep(null);
    const scriptureInput = scripture.trim();
    const cleanReference = draft.options.referenceMode === "manual"
      ? {
          ...reference,
          url: reference.url.trim(),
          notes: reference.notes.trim(),
        }
      : { ...EMPTY_SERMON_REFERENCE };
    const expectedCount: 1 | 5 = isGuest ? 1 : 5;
    const controller = new AbortController();
    generationController.current = controller;
    let generation: SermonGeneration | null = null;
    try {
      const confirmedNormalization =
        pendingScriptureConfirmation?.input === scriptureInput &&
        pendingScriptureConfirmation.aiTier === draft.options.aiTier &&
        pendingScriptureConfirmation.clientUserScope === (clientUserScope ?? null) &&
        hasActiveScriptureNormalizationGrant(
          pendingScriptureConfirmation,
          pendingScriptureConfirmation.canonical,
          draft.options.aiTier,
          clientUserScope ?? null,
          false,
        )
          ? pendingScriptureConfirmation
          : null;
      const storedNormalization =
        draft.scriptureNormalization?.canonical === scriptureInput &&
        draft.scriptureNormalization.aiTier === draft.options.aiTier &&
        draft.scripture === scriptureInput &&
        hasActiveScriptureNormalizationGrant(
          draft.scriptureNormalization,
          scriptureInput,
          draft.options.aiTier,
          clientUserScope ?? null,
        )
          ? draft.scriptureNormalization
          : null;
      const reusableNormalization = confirmedNormalization ?? storedNormalization;
      setNormalizingScripture(!reusableNormalization);
      const normalizationResponse = reusableNormalization
        ? {
            scripture: reusableNormalization.canonical,
            normalizedByAi: reusableNormalization.normalizedByAi,
            grant: reusableNormalization.grant,
            grantExpiresAt: reusableNormalization.grantExpiresAt,
          }
        : await requestScriptureNormalization(
            {
              draftId: draft.id,
              scripture: scriptureInput,
              aiTier: draft.options.aiTier,
              clientUserScope: clientUserScope ?? undefined,
            },
            controller.signal,
          );
      const canonicalScripture = normalizationResponse.scripture;
      setNormalizingScripture(false);
      if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
      const normalizationCandidate = reusableNormalization ?? {
        input: scriptureInput,
        canonical: canonicalScripture,
        normalizedAt: new Date().toISOString(),
        aiTier: draft.options.aiTier,
        clientUserScope: clientUserScope ?? null,
        normalizedByAi: normalizationResponse.normalizedByAi,
        confirmedByUserAt:
          normalizationResponse.normalizedByAi && canonicalScripture === scriptureInput
            ? new Date().toISOString()
            : null,
        grant: normalizationResponse.grant,
        grantExpiresAt: normalizationResponse.grantExpiresAt,
      };
      if (
        !isGuest &&
        normalizationCandidate.normalizedByAi &&
        canonicalScripture !== scriptureInput &&
        !confirmedNormalization
      ) {
        setPendingScriptureConfirmation(normalizationCandidate);
        return;
      }
      const scriptureNormalization =
        normalizationCandidate.normalizedByAi &&
        !normalizationCandidate.confirmedByUserAt
          ? {
              ...normalizationCandidate,
              confirmedByUserAt: new Date().toISOString(),
            }
          : normalizationCandidate;
      setPendingScriptureConfirmation(null);
      setScripture(canonicalScripture);

      const resumable =
        draft.generation?.mode === "initial" &&
        draft.generation.expectedCount === expectedCount &&
        draft.generation.alternatives.length < expectedCount &&
        draft.scripture === canonicalScripture &&
        sermonGenerationUsesScripture(draft.generation, canonicalScripture) &&
        JSON.stringify(draft.reference) === JSON.stringify(cleanReference);
      generation = resumable && draft.generation
        ? draft.generation
        : createSermonGeneration("initial", expectedCount);
      const activeGeneration = generation;
      setGenerationProgress(activeGeneration.alternatives.length);
      updateDraft((current) => ({
        ...current,
        scripture: canonicalScripture,
        scriptureNormalization,
        reference: cleanReference,
        stage: "generating",
        alternatives: [],
        generation: activeGeneration,
        selectedAlternativeId: null,
        versions: [],
        revisions: [],
        revisionCount: 0,
        completedAt: null,
        savedSermonId: null,
        saveMode: null,
      }));

      const result = await requestSermonGenerationSequence(
        {
          draftId: draft.id,
          options: draft.options,
          scripture: canonicalScripture,
          scriptureNormalizationGrant: scriptureNormalization.grant ?? undefined,
          reference: cleanReference,
        },
        {
          generationId: activeGeneration.id,
          expectedCount,
          completed: activeGeneration.alternatives,
          completedParts: activeGeneration.parts,
          signal: controller.signal,
          clientUserScope: clientUserScope ?? null,
          onStepProgress: (parts, position, completed, total) => {
            if (controller.signal.aborted) return;
            setGenerationStep({ position, completed, total });
            updateDraft((current) =>
              current.generation?.id === activeGeneration.id
                ? {
                    ...current,
                    generation: { ...current.generation, parts },
                    stage: "generating",
                  }
                : current,
            );
          },
          onProgress: (alternatives, completedCount) => {
            if (controller.signal.aborted) return;
            setGenerationProgress(completedCount);
            setGenerationStep(null);
            updateDraft((current) =>
              current.generation?.id === activeGeneration.id
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
      if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
      if (
        result.alternatives.length !== expectedCount ||
        !result.alternatives.every(isSermonAlternative) ||
        result.alternatives.some(
          (alternative) => alternative.scripture !== canonicalScripture,
        ) ||
        new Set(result.alternatives.map((item) => item.title)).size !== expectedCount
      ) {
        throw new Error(
          isGuest
            ? "미리보기 초안을 준비하지 못했습니다. 다시 시도해 주세요."
            : "다섯 개의 서로 다른 초안을 준비하지 못했습니다. 다시 시도해 주세요.",
        );
      }
      updateDraft((current) => ({
        ...current,
        scripture: canonicalScripture,
        scriptureNormalization,
        reference: cleanReference,
        alternatives: result.alternatives,
        generation: null,
        selectedAlternativeId: null,
        versions: [],
        revisions: [],
        revisionCount: 0,
        stage: "alternatives",
        savedSermonId: null,
        saveMode: null,
      }));
      router.push(sermonDraftUrl("/sermon/alternatives", draft.id));
    } catch (caught) {
      const normalizationGrantInvalid =
        caught instanceof SermonClientError &&
        caught.code === SCRIPTURE_NORMALIZATION_GRANT_INVALID;
      const message =
        controller.signal.aborted ||
        (caught instanceof Error && caught.name === "AbortError")
          ? "초안 생성이 중단되었습니다. 완성된 초안부터 이어서 만들 수 있습니다."
          : caught instanceof Error
            ? caught.message
            : "설교 생성 중 오류가 발생했습니다.";
      const restartRequired =
        message.includes("새 초안 묶음") || message.includes("새 묶음으로 다시 시작");
      setError(message);
      updateDraft((current) => {
        const next =
          generation && current.generation?.id === generation.id
            ? {
                ...current,
                stage: "input" as const,
                generation: restartRequired ? null : current.generation,
              }
            : current;
        return normalizationGrantInvalid
          ? { ...next, scriptureNormalization: null }
          : next;
      });
    } finally {
      if (generationController.current === controller) {
        generationController.current = null;
      }
      setGenerating(false);
      setNormalizingScripture(false);
      setStopping(false);
      setGenerationStep(null);
    }
  };

  const stopGeneration = () => {
    const controller = generationController.current;
    if (!controller || controller.signal.aborted) return;
    setStopping(true);
    controller.abort();
  };

  const pendingGeneration =
    draft.generation?.mode === "initial" ? draft.generation : null;
  const completedCount = generating
    ? generationProgress
    : pendingGeneration?.alternatives.length ?? 0;
  const hasSavedProgress =
    completedCount > 0 || Boolean(pendingGeneration?.parts.length);

  return (
    <div className="sermon-input-page">
      <section className="sermon-form-intro">
        <p className="sermon-eyebrow">Step 02</p>
        <h2>말씀의 중심이 될 본문을 놓아 주세요</h2>
        <p>
          {isGuest
            ? "비회원 미리보기에서는 입력한 본문 범위를 그대로 보존합니다. 로그인하면 AI가 익숙한 장·절 표현을 표준 본문 표기로 확인합니다."
            : "익숙한 방식으로 장과 절을 입력하면 AI가 표준 본문 표기로 확인한 뒤 전체 범위를 보존해 초안을 준비합니다."}
        </p>
        <OptionBadges draft={draft} />
      </section>

      <section className="sermon-form-card sermon-input-card" aria-labelledby="scripture-title">
        <div className="sermon-section-heading">
          <span>말씀</span>
          <div>
            <h3 id="scripture-title">성경 본문</h3>
            <p>한 번에 한 본문을 중심으로 작성합니다.</p>
          </div>
        </div>
        <div className="sermon-field">
          <label htmlFor="scripture-input">
            본문 <span aria-hidden="true">*</span>
          </label>
          <input
            id="scripture-input"
            value={scripture}
            maxLength={120}
            onChange={(event) => {
              setScripture(event.target.value);
              setPendingScriptureConfirmation(null);
            }}
            placeholder="예: 요한복음 3장 16~17절"
            autoComplete="off"
            aria-invalid={submitted && !scriptureValid}
            aria-describedby="scripture-help"
          />
          <p id="scripture-help" className={submitted && !scriptureValid ? "sermon-field-error" : "sermon-field-hint"}>
            {submitted && !scriptureValid
              ? "책 이름과 장·절을 120자 이하로 입력해 주세요."
              : "요한복음 3:16-18 · 요한복음 3장 16절 · 요한복음 3장 16~17절 모두 입력할 수 있습니다."}
          </p>
        </div>
      </section>

      {pendingScriptureConfirmation ? (
        <div className="sermon-inline-alert" role="status">
          <div>
            <strong>AI가 인식한 본문 범위를 확인해 주세요</strong>
            <p>
              입력: {pendingScriptureConfirmation.input} · 인식 결과:{" "}
              {pendingScriptureConfirmation.canonical}
            </p>
            <p>범위가 맞으면 아래 버튼을 한 번 더 눌러 설교 생성을 시작합니다.</p>
          </div>
        </div>
      ) : null}

      {draft.options.referenceMode === "manual" ? (
        <section className="sermon-form-card" aria-labelledby="manual-reference-title">
          <div className="sermon-section-heading">
            <span>자료</span>
            <div>
              <h3 id="manual-reference-title">참고 자료</h3>
              <p>필요한 자료만 선택적으로 더하세요. 첨부 없이도 생성할 수 있습니다.</p>
            </div>
          </div>
          <div className="sermon-reference-fields">
            <div className="sermon-field">
              <label htmlFor="reference-url">자료 URL</label>
              <input
                id="reference-url"
                type="url"
                value={reference.url}
                maxLength={2048}
                onChange={(event) =>
                  setReference((current) => ({ ...current, url: event.target.value }))
                }
                placeholder="https://example.org/resource"
                aria-invalid={!urlValid}
              />
              {!urlValid ? (
                <p className="sermon-field-error" role="alert">
                  http:// 또는 https://로 시작하는 올바른 URL을 입력해 주세요.
                </p>
              ) : null}
            </div>
            <div className="sermon-field">
              <label htmlFor="reference-notes">직접 메모</label>
              <textarea
                id="reference-notes"
                value={reference.notes}
                maxLength={20_000}
                onChange={(event) =>
                  setReference((current) => ({ ...current, notes: event.target.value }))
                }
                placeholder="반드시 포함할 해석 포인트나 예화를 적어 주세요."
                rows={5}
              />
              <div className="sermon-field-meta">
                <span>개인정보나 비공개 자료는 넣지 않는 것을 권합니다.</span>
                <span>{reference.notes.length.toLocaleString()}/20,000</span>
              </div>
            </div>
            <div className="sermon-field">
              <label htmlFor="reference-file">파일 첨부</label>
              <div className="sermon-file-control">
                <input
                  id="reference-file"
                  type="file"
                  accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                  onChange={(event) => void attachFile(event.target.files?.[0])}
                />
                <span>PDF · DOCX · TXT / 최대 10MB</span>
              </div>
              {reference.file ? (
                <div className="sermon-file-chip">
                  <span>
                    {reference.file.name} · {(reference.file.size / 1024).toFixed(0)}KB
                  </span>
                  <button
                    type="button"
                    onClick={() => setReference((current) => ({ ...current, file: null }))}
                  >
                    제거
                  </button>
                </div>
              ) : null}
              {fileError ? (
                <p className="sermon-field-error" role="alert">
                  {fileError}
                </p>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      <section
        className={`sermon-generation-panel ${generating ? "is-loading" : ""}`}
        aria-live="polite"
      >
        <div>
          <p className="sermon-eyebrow">Five alternatives</p>
          <h3>
            {generating
              ? normalizingScripture
                ? "AI가 성경 본문 범위를 확인하고 있습니다"
                : `${isGuest ? "미리보기 1편" : "초안 5편"} 중 ${completedCount}개 완성`
              : pendingGeneration
                ? `${completedCount}개를 저장했습니다. 남은 초안을 이어 만드세요`
                : "서로 다른 다섯 방향을 준비합니다"}
          </h3>
          <p>
            {generating
              ? normalizingScripture
                ? "입력한 시작 절과 끝 절을 빠뜨리지 않고 표준 본문 표기로 정리합니다."
                : generationStep
                ? `${generationStep.position}번째 초안을 ${generationStep.completed}/${generationStep.total}단계로 나눠 만들고 있습니다. 완성된 단계는 바로 저장합니다.`
                : completedCount < (isGuest ? 1 : 5)
                ? `${completedCount + 1}번째 초안을 생성 중입니다. 한 편이 끝날 때마다 바로 저장합니다.`
                : "마지막 저장을 확인하고 있습니다."
              : isGuest
                ? "비회원은 생성 후 한 초안의 도입부터 첫 대지까지 한 번 미리 볼 수 있습니다."
                : pendingGeneration
                  ? "이미 완성된 초안은 지우지 않고 다음 번호부터 계속합니다."
                  : "각 초안을 하나씩 생성해 연결 끊김을 줄이고, 완성 즉시 보존합니다."}
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
        {generating ? <span className="sermon-spinner is-large" aria-hidden="true" /> : null}
      </section>

      {error ? (
        <div className="sermon-inline-alert is-error" role="alert">
          <div>
            <strong>{error.includes("중단되었습니다") ? "초안 생성을 중지했습니다" : "초안을 준비하지 못했습니다"}</strong>
            <p>{error}</p>
          </div>
          {error.includes("토큰") ? (
            <a href="/tokens">토큰 충전하기</a>
          ) : (
            <button type="button" onClick={() => void generate()} disabled={generating}>
              {hasSavedProgress ? "저장된 단계부터 이어 만들기" : "다시 시도"}
            </button>
          )}
        </div>
      ) : null}

      <footer className="sermon-form-actions">
        <button
          className="sermon-button is-secondary"
          type="button"
          disabled={generating}
          onClick={() => router.push(sermonDraftUrl("/sermon/options", draft.id))}
        >
          이전 단계
        </button>
        <div className="sermon-generate-actions">
          {generating ? (
            <button
              className="sermon-button is-danger"
              type="button"
              onClick={stopGeneration}
              disabled={stopping}
            >
              {stopping ? "중지 처리 중…" : "생성 중지"}
            </button>
          ) : null}
          <button
            className="sermon-button is-primary"
            type="button"
            onClick={() => void generate()}
            disabled={!canGenerate}
          >
            {generating
              ? normalizingScripture
                ? "본문 확인 중…"
                : `${completedCount}/${isGuest ? 1 : 5} 생성 중…`
              : pendingGeneration
                ? "남은 초안 이어 만들기"
                : pendingScriptureConfirmation
                  ? "확인한 본문으로 생성"
                : isGuest
                  ? "미리보기 생성"
                  : "AI 설교 생성"}
          </button>
        </div>
      </footer>
      <p className="sermon-ai-notice">
        AI 초안은 오류가 있을 수 있습니다. 선포 전 본문 문맥과 인용을 반드시 직접
        확인해 주세요.
      </p>
    </div>
  );
}
