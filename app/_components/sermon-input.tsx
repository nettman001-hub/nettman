"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  requestScriptureNormalization,
  SCRIPTURE_NORMALIZATION_GRANT_INVALID,
  SermonClientError,
} from "@/app/_lib/sermon-client";
import {
  getSermonGenerationRunState,
  isSermonGenerationRunActive,
  startSermonGenerationRun,
  stopSermonGenerationRun,
  subscribeSermonGenerationRun,
  acknowledgeSermonGenerationRun,
  type SermonGenerationRunState,
} from "@/app/_lib/sermon-generation-runner";
import {
  createSermonGeneration,
  hasActiveScriptureNormalizationGrant,
  sermonGenerationUsesScripture,
  sermonDraftUrl,
} from "@/app/_lib/sermon-store";
import {
  EMPTY_SERMON_REFERENCE,
  isSermonOptionsComplete,
  type ReferenceFile,
  type SermonReference,
  type ScriptureNormalization,
} from "@/app/_lib/sermon-types";
import {
  OptionBadges,
  SermonLoading,
  SermonStateCard,
  useSermonWorkflow,
} from "./sermon-workflow";
import { useRegisterAiAgentPage } from "./ai-agent-provider";

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function SermonInput() {
  const router = useRouter();
  const { draft, ready, isGuest, clientUserScope, updateDraft } = useSermonWorkflow();
  const [scripture, setScripture] = useState("");
  const [clarifyState, setClarifyState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [clarifyQuestions, setClarifyQuestions] = useState<Array<{ heading: string; content: string }>>([]);
  const [clarifyError, setClarifyError] = useState("");
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
  const scriptureConfirmationDialogRef = useRef<HTMLDivElement>(null);
  const scriptureConfirmationButtonRef = useRef<HTMLButtonElement>(null);
  const [runState, setRunState] = useState<SermonGenerationRunState | null>(
    () => getSermonGenerationRunState(),
  );

  useEffect(() => {
    if (!draft || hydratedId.current === draft.id) return;
    hydratedId.current = draft.id;
    setPendingScriptureConfirmation(null);
    setScripture(draft.scripture);
    setReference(draft.reference);
  }, [draft]);

  useEffect(() => {
    if (!pendingScriptureConfirmation) return;
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    scriptureConfirmationButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !generating) {
        event.preventDefault();
        setPendingScriptureConfirmation(null);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = scriptureConfirmationDialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [generating, pendingScriptureConfirmation]);

  // The generation run lives in a module singleton so leaving this page (or
  // visiting another menu) no longer aborts it; this page only mirrors it.
  useEffect(() => subscribeSermonGenerationRun(setRunState), []);

  useEffect(() => {
    if (!draft || !runState || runState.draftId !== draft.id) return;
    if (runState.mode !== "initial") return;
    if (runState.status === "running") {
      setGenerating(true);
      setGenerationProgress(runState.completedCount);
      setGenerationStep(runState.step);
      return;
    }
    setGenerating(false);
    setStopping(false);
    setGenerationStep(null);
    if (runState.status === "completed") {
      acknowledgeSermonGenerationRun();
      router.push(sermonDraftUrl("/sermon/alternatives", draft.id));
      return;
    }
    if (runState.error) setError(runState.error);
    acknowledgeSermonGenerationRun();
  }, [draft, runState, router]);

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

  const agentRegistration = useMemo(() => {
    if (!ready || !draft) return null;
    const runActive =
      runState?.draftId === draft.id && runState.status === "running";
    return {
      surface: "sermon.input" as const,
      title: "설교 본문과 참고 자료 입력",
      resourceId: draft.id,
      version: draft.updatedAt,
      snapshot: {
        draftId: draft.id,
        topic: draft.options.topic,
        scripture,
        notes: {
          url: reference.url,
          notes: reference.notes.slice(0, 8_000),
          hasFile: Boolean(reference.file),
        },
        options: draft.options,
        generationStatus: {
          status: runActive ? "running" : draft.generation ? "paused" : "idle",
          completedCount: generationProgress,
          step: generationStep,
        },
      },
      capabilities: [
        "navigate",
        "sermon.input.patch",
        "sermon.generation.stop",
      ] as Array<
        "navigate" | "sermon.input.patch" | "sermon.generation.stop"
      >,
      suggestions: runActive
        ? [
            "현재 설교 생성 진행 상태를 설명해줘",
            "생성을 중지하면 어떤 결과가 보존되는지 알려줘",
          ]
        : [
            "입력한 본문 범위와 참고 메모를 점검해줘",
            "이 본문으로 설교를 준비할 때 보완할 메모를 제안해줘",
            "현재 옵션과 본문이 잘 맞는지 확인해줘",
          ],
      executeAction: async (proposal: {
        capability: string;
        args: Record<string, unknown>;
      }) => {
        if (proposal.capability === "sermon.generation.stop") {
          if (!isSermonGenerationRunActive(draft.id)) {
            throw new Error("현재 이 설교에서 진행 중인 생성 작업이 없습니다.");
          }
          setStopping(true);
          stopSermonGenerationRun();
          return {
            message:
              "설교 생성을 중지했습니다. 이미 완성된 초안은 보존되며 나중에 이어서 만들 수 있습니다.",
          };
        }
        if (proposal.capability !== "sermon.input.patch") {
          throw new Error("현재 화면에서는 이 작업을 적용할 수 없습니다.");
        }
        if (isSermonGenerationRunActive(draft.id)) {
          throw new Error("설교 생성 중에는 본문과 참고 메모를 변경할 수 없습니다.");
        }
        const patch = proposal.args.patch;
        if (!isRecord(patch)) {
          throw new Error("변경할 본문 입력 형식을 확인해 주세요.");
        }
        let applied = false;
        if (patch.scripture !== undefined) {
          if (typeof patch.scripture !== "string" || !validScriptureInput(patch.scripture)) {
            throw new Error("성경 본문은 2자 이상 120자 이하로 입력해 주세요.");
          }
          setScripture(patch.scripture.trim());
          setPendingScriptureConfirmation(null);
          applied = true;
        }
        if (patch.notes !== undefined) {
          if (typeof patch.notes !== "string" || patch.notes.length > 20_000) {
            throw new Error("참고 메모는 20,000자 이하로 입력해 주세요.");
          }
          setReference((current) => ({ ...current, notes: patch.notes as string }));
          applied = true;
        }
        if (patch.url !== undefined) {
          if (
            typeof patch.url !== "string" ||
            patch.url.length > 2_048 ||
            !validUrl(patch.url)
          ) {
            throw new Error("참고 URL은 올바른 HTTP 또는 HTTPS 주소로 입력해 주세요.");
          }
          setReference((current) => ({ ...current, url: (patch.url as string).trim() }));
          applied = true;
        }
        if (!applied) throw new Error("적용할 수 있는 본문 변경이 없습니다.");
        setSubmitted(false);
        setError("");
        return {
          message:
            "제안한 내용을 입력란에 반영했습니다. 확인한 뒤 기존 AI 설교 생성 버튼을 눌러 주세요.",
        };
      },
    };
  }, [
    draft,
    generationProgress,
    generationStep,
    ready,
    reference.file,
    reference.notes,
    reference.url,
    runState,
    scripture,
  ]);

  useRegisterAiAgentPage(agentRegistration);

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
    if (isSermonGenerationRunActive()) return;
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
      : {
          ...EMPTY_SERMON_REFERENCE,
          notes: reference.notes.trim(),
        };
    const expectedCount: 1 | 5 = isGuest ? 1 : 5;
    const controller = new AbortController();
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
        setGenerating(false);
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
      const activeGeneration = resumable && draft.generation
        ? draft.generation
        : createSermonGeneration("initial", expectedCount);
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

      startSermonGenerationRun({
        draftId: draft.id,
        mode: "initial",
        request: {
          draftId: draft.id,
          options: draft.options,
          scripture: canonicalScripture,
          scriptureNormalizationGrant: scriptureNormalization.grant ?? undefined,
          reference: cleanReference,
        },
        generation: activeGeneration,
        expectedCount,
        clientUserScope: clientUserScope ?? null,
        isGuest,
        canonicalScripture,
        scriptureNormalization,
      });
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
      setError(message);
      setGenerating(false);
      if (normalizationGrantInvalid) {
        updateDraft((current) => ({ ...current, scriptureNormalization: null }));
      }
    } finally {
      setNormalizingScripture(false);
    }
  };

  const stopGeneration = () => {
    if (!isSermonGenerationRunActive(draft?.id)) return;
    setStopping(true);
    stopSermonGenerationRun();
  };

  const pendingGeneration =
    draft.generation?.mode === "initial" ? draft.generation : null;
  const completedCount = generating
    ? generationProgress
    : pendingGeneration?.alternatives.length ?? 0;
  const hasSavedProgress =
    completedCount > 0 || Boolean(pendingGeneration?.parts.length);

  async function requestClarifyingQuestions() {
    if (clarifyState === "loading" || !draft) return;
    setClarifyState("loading");
    setClarifyError("");
    try {
      const response = await fetch("/api/sermon-resources", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          mode: "clarify",
          aiTier: draft.options.aiTier,
          scripture: scripture.trim(),
          notes: [
            draft.options.topic ? `설교 제목·방향: ${draft.options.topic}` : "",
            draft.options.worshipType ? `예배 유형: ${draft.options.worshipType}` : "",
            `청중: ${draft.options.audience} (${draft.options.audienceSituation})`,
            `설교 유형: ${draft.options.sermonType} · ${draft.options.duration}분 · ${draft.options.pointCount}대지`,
            reference.notes.trim() ? `메모: ${reference.notes.trim().slice(0, 2000)}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        }),
      });
      const body = (await response.json().catch(() => null)) as
        | { result?: { sections?: Array<{ heading: string; content: string }> }; error?: string }
        | null;
      if (!response.ok || !body?.result?.sections?.length) {
        throw new Error(body?.error || "보완 질문을 만들지 못했습니다.");
      }
      setClarifyQuestions(body.result.sections.slice(0, 3));
      setClarifyState("done");
    } catch (caught) {
      setClarifyError(
        caught instanceof Error ? caught.message : "보완 질문을 만들지 못했습니다.",
      );
      setClarifyState("error");
    }
  }

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

      <section className="sermon-form-card" aria-labelledby="clarify-title">
        <div className="sermon-section-heading">
          <span>질문</span>
          <div>
            <h3 id="clarify-title">AI 보완 질문 (선택)</h3>
            <p>입력이 빈약하거나 모호한 부분을 AI가 되물어 줍니다. 답을 아래 메모에 덧붙이면 초안이 더 깊어집니다.</p>
          </div>
        </div>
        <button
          type="button"
          className="sermon-secondary-button"
          onClick={() => void requestClarifyingQuestions()}
          disabled={clarifyState === "loading"}
        >
          {clarifyState === "loading" ? "질문 만드는 중…" : "보완 질문 받기"}
        </button>
        {clarifyState === "error" ? (
          <p className="sermon-field-error" role="alert">{clarifyError}</p>
        ) : null}
        {clarifyState === "done" && clarifyQuestions.length ? (
          <ul className="sermon-clarify-list">
            {clarifyQuestions.map((question) => (
              <li key={question.heading}>
                <strong>{question.heading}</strong>
                <p>{question.content}</p>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="sermon-field sermon-clarify-notes">
          <label htmlFor="reference-notes">보완 질문 답변 및 설교 메모</label>
          <textarea
            id="reference-notes"
            value={reference.notes}
            maxLength={20_000}
            onChange={(event) =>
              setReference((current) => ({ ...current, notes: event.target.value }))
            }
            placeholder="AI 보완 질문의 답변, 반드시 포함할 해석 포인트나 예화를 적어 주세요."
            rows={6}
          />
          <div className="sermon-field-meta">
            <span>개인정보나 비공개 자료는 넣지 마세요. 참고 자료 방식과 관계없이 초안 생성에 반영됩니다.</span>
            <span>{reference.notes.length.toLocaleString()}/20,000</span>
          </div>
        </div>
      </section>

      {pendingScriptureConfirmation ? (
        <div className="fixed inset-0 z-[90] grid place-items-center p-4 sm:p-6">
          <button
            type="button"
            className="absolute inset-0 cursor-default bg-[#102d24]/65 backdrop-blur-[2px]"
            aria-label="본문 범위 확인창 닫기"
            onClick={() => {
              if (!generating) setPendingScriptureConfirmation(null);
            }}
          />
          <div
            ref={scriptureConfirmationDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="scripture-confirmation-title"
            aria-describedby="scripture-confirmation-description"
            className="relative w-full max-w-md rounded-[1.5rem] border border-[#dfd3bf] bg-[#fffdf8] p-5 shadow-[0_28px_80px_rgba(13,39,31,.32)] sm:p-6"
          >
            <p className="text-[10px] font-extrabold tracking-[0.16em] text-[#9a632f] uppercase">
              본문 확인
            </p>
            <h2
              id="scripture-confirmation-title"
              className="mt-2 font-serif text-xl font-bold leading-snug text-[#254238] sm:text-2xl"
            >
              AI가 인식한 본문 범위를 확인해 주세요
            </h2>
            <p
              id="scripture-confirmation-description"
              className="mt-2 text-sm leading-6 text-[#68746e]"
            >
              두 범위가 맞는지 비교해 주세요. 다르면 창을 닫고 본문을 다시 입력할 수 있습니다.
            </p>
            <dl className="mt-5 grid gap-3">
              <div className="rounded-xl border border-[#e5dfd5] bg-white px-4 py-3">
                <dt className="text-[10px] font-extrabold text-[#858d88]">입력한 본문</dt>
                <dd className="mt-1 text-sm font-bold text-[#34483f]">
                  {pendingScriptureConfirmation.input}
                </dd>
              </div>
              <div className="rounded-xl border border-[#c9d9cf] bg-[#edf5ef] px-4 py-3">
                <dt className="text-[10px] font-extrabold text-[#557063]">AI가 인식한 본문</dt>
                <dd className="mt-1 text-base font-extrabold text-[#285343]">
                  {pendingScriptureConfirmation.canonical}
                </dd>
              </div>
            </dl>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <button
                type="button"
                className="inline-flex min-h-12 items-center justify-center rounded-xl border border-[#cfc7ba] bg-white px-4 text-sm font-extrabold text-[#536158] hover:bg-[#f6f2eb] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838]"
                onClick={() => setPendingScriptureConfirmation(null)}
                disabled={generating}
              >
                다시 입력
              </button>
              <button
                ref={scriptureConfirmationButtonRef}
                type="button"
                className="inline-flex min-h-12 items-center justify-center rounded-xl bg-[#285343] px-4 text-sm font-extrabold text-white hover:bg-[#204739] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838] focus-visible:ring-offset-2 disabled:opacity-55"
                onClick={() => void generate()}
                disabled={generating}
              >
                {generating ? "생성 준비 중…" : "이 범위로 생성"}
              </button>
            </div>
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
