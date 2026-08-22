"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { sermonDraftUrl } from "@/app/_lib/sermon-store";
import {
  AI_ENGINE_TIER_META,
  isAiEngineTier,
  type AiEngineTier,
} from "@/app/_lib/ai-engine-tiers";
import {
  SERMON_TOKEN_MINIMUM_COSTS,
  sermonGenerationTokenCost,
} from "@/app/_lib/sermon-token-pricing";
import {
  EMPTY_SERMON_OPTIONS,
  MAX_SERMON_AUDIENCE_SITUATION_LENGTH,
  MAX_SERMON_TITLE_LENGTH,
  MAX_SERMON_TONE_LENGTH,
  SERMON_AUDIENCE_SITUATIONS,
  SERMON_AUDIENCES,
  SERMON_DURATIONS,
  SERMON_POINT_COUNTS,
  SERMON_TONES,
  SERMON_TYPES,
  SERMON_WORSHIP_TYPES,
  durationToTargetCharacters,
  isSermonAudienceSituationValue,
  isSermonOptionsComplete,
  isSermonTitleValue,
  isSermonToneValue,
  normalizeSermonAiTiers,
  type SermonAudienceSituation,
  type SermonOptions as SermonOptionsValue,
  type SermonTone,
} from "@/app/_lib/sermon-types";
import { SermonLoading, useSermonWorkflow } from "./sermon-workflow";
import { useAiAgent, useRegisterAiAgentPage } from "./ai-agent-provider";

type ChoiceProps<T extends string | number> = {
  legend: string;
  name: string;
  value: T | "" | null;
  options: readonly T[];
  onChange: (value: T) => void;
  format?: (value: T) => string;
  hint?: string;
  error?: string;
};

function ChoiceGroup<T extends string | number>({
  legend,
  name,
  value,
  options,
  onChange,
  format = String,
  hint,
  error,
}: ChoiceProps<T>) {
  return (
    <fieldset className="sermon-fieldset" aria-describedby={error ? `${name}-error` : undefined}>
      <legend>
        {legend} <span aria-hidden="true">*</span>
      </legend>
      {hint ? <p className="sermon-field-hint">{hint}</p> : null}
      <div className="sermon-choice-grid">
        {options.map((option) => (
          <label key={option} className={value === option ? "is-selected" : ""}>
            <input
              type="radio"
              name={name}
              value={option}
              checked={value === option}
              onChange={() => onChange(option)}
            />
            <span>{format(option)}</span>
          </label>
        ))}
      </div>
      {error ? (
        <p className="sermon-field-error" id={`${name}-error`} role="alert">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

function normalizedOptions(value: SermonOptionsValue): SermonOptionsValue {
  const aiTiers = normalizeSermonAiTiers({ aiTier: value.aiTier });
  return {
    ...value,
    topic: value.topic.trim(),
    audienceSituation: value.audienceSituation.trim(),
    tone: value.tone.trim(),
    aiTier: aiTiers[0],
    aiTiers,
    targetCharacters: value.duration
      ? durationToTargetCharacters(value.duration)
      : null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function SermonOptions() {
  const router = useRouter();
  const { draft, ready, isGuest, createDraft, updateDraft } = useSermonWorkflow();
  const {
    engineAvailabilityStatus,
    availableEngineTiersFor,
    isEngineTierAvailableFor,
    engineAvailabilityNoticeFor,
    reloadEngineAvailability,
  } = useAiAgent();
  const selectableEngineTiers = useMemo(
    () => availableEngineTiersFor("sermon", isGuest),
    [availableEngineTiersFor, isGuest],
  );
  const engineAvailabilityNotice = engineAvailabilityNoticeFor(
    "sermon",
    isGuest,
  );
  const [form, setForm] = useState<SermonOptionsValue>({
    ...EMPTY_SERMON_OPTIONS,
    aiTiers: [...EMPTY_SERMON_OPTIONS.aiTiers],
  });
  const [submitted, setSubmitted] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [savedMessage, setSavedMessage] = useState("");
  const [customAudienceSituationSelected, setCustomAudienceSituationSelected] =
    useState(false);
  const [customToneSelected, setCustomToneSelected] = useState(false);
  const createdRef = useRef(false);

  useEffect(() => {
    if (!ready || draft) return;
    if (createdRef.current) return;
    createdRef.current = true;
    const next = createDraft();
    router.replace(sermonDraftUrl("/sermon/options", next.id));
  }, [createDraft, draft, ready, router]);

  useEffect(() => {
    if (!draft || dirty) return;
    const aiTiers = normalizeSermonAiTiers(draft.options);
    setForm({ ...draft.options, aiTier: aiTiers[0], aiTiers });
    setCustomAudienceSituationSelected(
      Boolean(draft.options.audienceSituation) &&
        !SERMON_AUDIENCE_SITUATIONS.some(
          (situation) => situation === draft.options.audienceSituation,
        ),
    );
    setCustomToneSelected(
      Boolean(draft.options.tone) &&
        !SERMON_TONES.some((tone) => tone === draft.options.tone),
    );
  }, [draft, dirty]);

  useEffect(() => {
    if (
      engineAvailabilityStatus !== "ready" ||
      !selectableEngineTiers.length ||
      isEngineTierAvailableFor(form.aiTier, "sermon", isGuest)
    ) {
      return;
    }
    const fallbackTier = selectableEngineTiers[0]!;
    const aiTiers = normalizeSermonAiTiers({ aiTier: fallbackTier });
    setForm((current) => ({
      ...current,
      aiTier: fallbackTier,
      aiTiers,
    }));
    setDirty(true);
    setSavedMessage(
      `${AI_ENGINE_TIER_META[fallbackTier].label}(으)로 안전하게 변경했습니다. 내용을 확인해 주세요.`,
    );
  }, [
    engineAvailabilityStatus,
    form.aiTier,
    isEngineTierAvailableFor,
    isGuest,
    selectableEngineTiers,
  ]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const errors = useMemo(
    () => ({
      topic:
        isSermonTitleValue(form.topic)
          ? ""
          : "설교 제목을 2자 이상 100자 이하로 입력해 주세요.",
      duration: SERMON_DURATIONS.some((duration) => duration === form.duration)
        ? ""
        : "설교 분량을 선택해 주세요.",
      tone: isSermonToneValue(form.tone)
        ? ""
        : "감정선을 선택하거나 2자 이상 40자 이하로 직접 입력해 주세요.",
      sermonType: SERMON_TYPES.some((sermonType) => sermonType === form.sermonType)
        ? ""
        : "설교 유형을 선택해 주세요.",
      audience: SERMON_AUDIENCES.some((audience) => audience === form.audience)
        ? ""
        : "설교 대상을 선택해 주세요.",
      audienceSituation: isSermonAudienceSituationValue(form.audienceSituation)
        ? ""
        : "청중 상황을 선택하거나 2자 이상 40자 이하로 직접 입력해 주세요.",
      pointCount: SERMON_POINT_COUNTS.some(
        (pointCount) => pointCount === form.pointCount,
      )
        ? ""
        : "설교 구성을 선택해 주세요.",
    }),
    [form],
  );
  const valid = isSermonOptionsComplete(form);
  const engineReady =
    engineAvailabilityStatus === "ready" &&
    isEngineTierAvailableFor(form.aiTier, "sermon", isGuest);
  const showToneError = submitted || (customToneSelected && form.tone.length > 0);
  const showAudienceSituationError =
    submitted ||
    (customAudienceSituationSelected && form.audienceSituation.length > 0);
  const estimatedTokenCost =
    engineReady && form.duration && form.pointCount
      ? sermonGenerationTokenCost(form.aiTier, form.duration, form.pointCount)
      : null;

  const agentRegistration = useMemo(() => {
    if (!ready || !draft) return null;
    return {
      surface: "sermon.options" as const,
      title: "설교 기본·구성 옵션",
      resourceId: draft.id,
      version: draft.updatedAt,
      snapshot: {
        draftId: draft.id,
        options: form,
        completion: { complete: valid, dirty },
        validation: errors,
        generationStatus: draft.generation ? "paused" : "idle",
      },
      capabilities: ["navigate", "sermon.options.patch"] as const,
      suggestions: [
        "현재 옵션에서 빠진 항목을 확인해줘",
        "이 설교 주제에 어울리는 구성을 제안해줘",
        "청중과 감정선을 더 선명하게 다듬어줘",
      ],
      executeAction: async (proposal: {
        capability: string;
        args: Record<string, unknown>;
      }) => {
        if (proposal.capability !== "sermon.options.patch") {
          throw new Error("현재 화면에서는 이 작업을 적용할 수 없습니다.");
        }
        const patch = proposal.args.patch;
        if (!isRecord(patch)) {
          throw new Error("변경할 설교 옵션 형식을 확인해 주세요.");
        }

        const next: Partial<SermonOptionsValue> = {};
        if (patch.topic !== undefined) {
          if (!isSermonTitleValue(patch.topic)) throw new Error(errors.topic);
          next.topic = patch.topic.trim();
        }
        if (patch.duration !== undefined) {
          if (!SERMON_DURATIONS.some((value) => value === patch.duration)) {
            throw new Error("설교 분량은 화면에서 제공하는 값만 선택할 수 있습니다.");
          }
          next.duration = patch.duration as SermonOptionsValue["duration"];
        }
        if (patch.sermonType !== undefined) {
          if (!SERMON_TYPES.some((value) => value === patch.sermonType)) {
            throw new Error("설교 유형은 화면에서 제공하는 값만 선택할 수 있습니다.");
          }
          next.sermonType = patch.sermonType as SermonOptionsValue["sermonType"];
        }
        if (patch.worshipType !== undefined) {
          if (!SERMON_WORSHIP_TYPES.some((value) => value === patch.worshipType)) {
            throw new Error("예배 유형은 화면에서 제공하는 값만 선택할 수 있습니다.");
          }
          next.worshipType = patch.worshipType as string;
        }
        if (patch.pointCount !== undefined) {
          if (!SERMON_POINT_COUNTS.some((value) => value === patch.pointCount)) {
            throw new Error("대지 수는 1개부터 4개까지만 선택할 수 있습니다.");
          }
          next.pointCount = patch.pointCount as SermonOptionsValue["pointCount"];
        }
        if (patch.audience !== undefined) {
          if (!SERMON_AUDIENCES.some((value) => value === patch.audience)) {
            throw new Error("설교 대상은 화면에서 제공하는 값만 선택할 수 있습니다.");
          }
          next.audience = patch.audience as SermonOptionsValue["audience"];
        }
        if (patch.audienceSituation !== undefined) {
          if (!isSermonAudienceSituationValue(patch.audienceSituation)) {
            throw new Error(errors.audienceSituation);
          }
          next.audienceSituation = patch.audienceSituation.trim();
        }
        if (patch.tone !== undefined) {
          if (!isSermonToneValue(patch.tone)) throw new Error(errors.tone);
          next.tone = patch.tone.trim();
        }
        if (patch.referenceMode !== undefined) {
          if (patch.referenceMode !== "auto" && patch.referenceMode !== "manual") {
            throw new Error("참고 자료 방식은 자동 또는 직접 입력만 선택할 수 있습니다.");
          }
          next.referenceMode = patch.referenceMode;
        }
        if (patch.aiTier !== undefined) {
          if (!isAiEngineTier(patch.aiTier)) {
            throw new Error("AI 엔진 등급을 다시 선택해 주세요.");
          }
          if (!isEngineTierAvailableFor(patch.aiTier, "sermon", isGuest)) {
            throw new Error(
              "관리자가 사용 중지했거나 연결을 완료하지 않은 AI 엔진은 선택할 수 없습니다.",
            );
          }
          next.aiTier = patch.aiTier;
          next.aiTiers = normalizeSermonAiTiers({ aiTier: patch.aiTier });
        }
        if (Object.keys(next).length === 0) {
          throw new Error("적용할 수 있는 옵션 변경이 없습니다.");
        }
        setForm((current) => ({ ...current, ...next }));
        if (typeof next.audienceSituation === "string") {
          setCustomAudienceSituationSelected(
            !SERMON_AUDIENCE_SITUATIONS.some(
              (value) => value === next.audienceSituation,
            ),
          );
        }
        if (typeof next.tone === "string") {
          setCustomToneSelected(
            !SERMON_TONES.some((value) => value === next.tone),
          );
        }
        setDirty(true);
        setSavedMessage("");
        return {
          message:
            "제안한 옵션을 입력란에 반영했습니다. 내용을 확인한 뒤 저장하거나 다음 단계로 이동해 주세요.",
        };
      },
    };
  }, [
    dirty,
    draft,
    errors,
    form,
    isEngineTierAvailableFor,
    isGuest,
    ready,
    valid,
  ]);

  useRegisterAiAgentPage(agentRegistration);

  if (!ready || !draft) return <SermonLoading label="옵션 입력란을 준비하는 중입니다" />;

  const change = <K extends keyof SermonOptionsValue>(
    key: K,
    value: SermonOptionsValue[K],
  ) => {
    setForm((current) => ({ ...current, [key]: value }));
    setDirty(true);
    setSavedMessage("");
  };

  const changeAiTier = (tier: AiEngineTier) => {
    if (!isEngineTierAvailableFor(tier, "sermon", isGuest)) return;
    setForm((current) => {
      const aiTiers = normalizeSermonAiTiers({ aiTier: tier });
      return { ...current, aiTier: tier, aiTiers };
    });
    setDirty(true);
    setSavedMessage("");
  };

  const selectTone = (tone: SermonTone | "기타") => {
    if (tone === "기타") {
      setCustomToneSelected(true);
      setDirty(true);
      setSavedMessage("");
      if (SERMON_TONES.some((preset) => preset === form.tone)) change("tone", "");
      return;
    }
    setCustomToneSelected(false);
    change("tone", tone);
  };

  const selectAudienceSituation = (
    situation: SermonAudienceSituation | "기타",
  ) => {
    if (situation === "기타") {
      setCustomAudienceSituationSelected(true);
      setDirty(true);
      setSavedMessage("");
      if (
        SERMON_AUDIENCE_SITUATIONS.some(
          (preset) => preset === form.audienceSituation,
        )
      ) {
        change("audienceSituation", "");
      }
      return;
    }
    setCustomAudienceSituationSelected(false);
    change("audienceSituation", situation);
  };

  const save = (moveNext: boolean) => {
    setSubmitted(true);
    if (moveNext && (!valid || !engineReady)) return;
    const nextOptions = normalizedOptions(form);
    const changed = JSON.stringify(nextOptions) !== JSON.stringify(draft.options);

    updateDraft((current) => ({
      ...current,
      options: nextOptions,
      stage: moveNext ? "input" : changed ? "options" : current.stage,
      ...(changed
        ? {
            scripture: "",
            scriptureNormalization: null,
            alternatives: [],
            generation: null,
            selectedAlternativeId: null,
            versions: [],
            revisions: [],
            revisionCount: 0,
            completedAt: null,
            savedSermonId: null,
            saveMode: null,
          }
        : {}),
    }));
    setDirty(false);
    if (moveNext) {
      router.push(sermonDraftUrl("/sermon/input", draft.id));
    } else {
      setSavedMessage("현재 옵션을 이 브라우저에 임시 저장했습니다.");
    }
  };

  return (
    <form
      className="sermon-form-layout"
      onSubmit={(event) => {
        event.preventDefault();
        save(true);
      }}
      noValidate
    >
      <section className="sermon-form-intro">
        <p className="sermon-eyebrow">Step 01</p>
        <h2>설교의 방향을 먼저 정해 주세요</h2>
        <p>
          선명한 방향이 있을수록 다섯 초안의 차이가 또렷해집니다. 이후 단계에서도
          언제든 이전으로 돌아와 다시 정할 수 있습니다.
        </p>
      </section>

      <div className="sermon-form-sections">
        <section className="sermon-form-card" aria-labelledby="basic-options-title">
          <div className="sermon-section-heading">
            <span>01</span>
            <div>
              <h3 id="basic-options-title">기본 옵션</h3>
              <p>제목, 유형, 분량과 본론의 구성을 정합니다.</p>
            </div>
          </div>

          <div className="sermon-field">
            <label htmlFor="sermon-topic">
              설교 제목 <span aria-hidden="true">*</span>
            </label>
            <input
              id="sermon-topic"
              value={form.topic}
              maxLength={MAX_SERMON_TITLE_LENGTH}
              onChange={(event) => change("topic", event.target.value)}
              placeholder="예: 하나님의 사랑으로 다시 걷는 길"
              aria-invalid={submitted && Boolean(errors.topic)}
              aria-describedby={submitted && errors.topic ? "topic-error" : "topic-hint"}
            />
            <div className="sermon-field-meta">
              <span id="topic-hint">핵심 메시지가 드러나는 짧은 제목을 권합니다.</span>
              <span>{form.topic.length}/{MAX_SERMON_TITLE_LENGTH}</span>
            </div>
            {submitted && errors.topic ? (
              <p id="topic-error" className="sermon-field-error" role="alert">
                {errors.topic}
              </p>
            ) : null}
          </div>

          <ChoiceGroup
            legend="예상 분량"
            name="duration"
            value={form.duration}
            options={SERMON_DURATIONS}
            onChange={(value) => change("duration", value)}
            format={(value) => `${value}분`}
            hint="내부적으로 3,000~8,000자의 목표 분량으로 변환됩니다."
            error={submitted ? errors.duration : ""}
          />
          <ChoiceGroup
            legend="설교 유형"
            name="sermon-type"
            value={form.sermonType}
            options={SERMON_TYPES}
            onChange={(value) => change("sermonType", value)}
            error={submitted ? errors.sermonType : ""}
          />
          <ChoiceGroup
            legend="예배 유형"
            name="worship-type"
            value={form.worshipType ?? "주일 대예배"}
            options={SERMON_WORSHIP_TYPES}
            onChange={(value) => change("worshipType", value)}
            hint="예배의 성격에 맞춰 어조와 적용의 결이 조정됩니다."
            error=""
          />
          <ChoiceGroup
            legend="설교 구성"
            name="point-count"
            value={form.pointCount}
            options={SERMON_POINT_COUNTS}
            onChange={(value) => change("pointCount", value)}
            format={(value) => (value === 1 ? "1포인트" : `${value}대지`)}
            hint="선택한 수만큼 본론 소제목이 만들어집니다."
            error={submitted ? errors.pointCount : ""}
          />
        </section>

        <section className="sermon-form-card" aria-labelledby="structure-options-title">
          <div className="sermon-section-heading">
            <span>02</span>
            <div>
              <h3 id="structure-options-title">구성 옵션</h3>
              <p>회중과 현장의 상황, 메시지의 감정선을 선택합니다.</p>
            </div>
          </div>
          <ChoiceGroup
            legend="설교 대상"
            name="audience"
            value={form.audience}
            options={SERMON_AUDIENCES}
            onChange={(value) => change("audience", value)}
            error={submitted ? errors.audience : ""}
          />
          <fieldset
            className="sermon-fieldset"
            aria-describedby={
              showAudienceSituationError && errors.audienceSituation
                ? "audience-situation-error"
                : undefined
            }
          >
            <legend>
              청중 상황 <span aria-hidden="true">*</span>
            </legend>
            <p className="sermon-field-hint">현장에 맞는 상황을 고르거나 직접 적어 주세요.</p>
            <div className="sermon-choice-grid">
              {SERMON_AUDIENCE_SITUATIONS.map((situation) => (
                <label
                  key={situation}
                  className={
                    !customAudienceSituationSelected &&
                    form.audienceSituation === situation
                      ? "is-selected"
                      : ""
                  }
                >
                  <input
                    type="radio"
                    name="audience-situation-mode"
                    value={situation}
                    checked={
                      !customAudienceSituationSelected &&
                      form.audienceSituation === situation
                    }
                    onChange={() => selectAudienceSituation(situation)}
                  />
                  <span>{situation}</span>
                </label>
              ))}
              <label className={customAudienceSituationSelected ? "is-selected" : ""}>
                <input
                  type="radio"
                  name="audience-situation-mode"
                  value="기타"
                  checked={customAudienceSituationSelected}
                  onChange={() => selectAudienceSituation("기타")}
                />
                <span>기타</span>
              </label>
            </div>
            {customAudienceSituationSelected ? (
              <div className="sermon-field sermon-custom-tone-input">
                <label htmlFor="custom-audience-situation">청중 상황 직접 입력</label>
                <input
                  id="custom-audience-situation"
                  value={form.audienceSituation}
                  maxLength={MAX_SERMON_AUDIENCE_SITUATION_LENGTH}
                  onChange={(event) =>
                    change("audienceSituation", event.target.value)
                  }
                  placeholder="예: 은퇴를 앞둔 성도들"
                  aria-invalid={
                    showAudienceSituationError &&
                    Boolean(errors.audienceSituation)
                  }
                  aria-describedby={
                    showAudienceSituationError && errors.audienceSituation
                      ? "audience-situation-error"
                      : "custom-audience-situation-hint"
                  }
                />
                <div
                  className="sermon-field-meta"
                  id="custom-audience-situation-hint"
                >
                  <span>2~40자의 짧고 구체적인 상황을 권합니다.</span>
                  <span>
                    {form.audienceSituation.length}/
                    {MAX_SERMON_AUDIENCE_SITUATION_LENGTH}
                  </span>
                </div>
              </div>
            ) : null}
            {showAudienceSituationError && errors.audienceSituation ? (
              <p
                className="sermon-field-error"
                id="audience-situation-error"
                role="alert"
              >
                {errors.audienceSituation}
              </p>
            ) : null}
          </fieldset>
          <fieldset
            className="sermon-fieldset"
            aria-describedby={showToneError && errors.tone ? "tone-error" : undefined}
          >
            <legend>
              감정선 <span aria-hidden="true">*</span>
            </legend>
            <p className="sermon-field-hint">기본 감정선을 고르거나 원하는 분위기를 직접 적어 주세요.</p>
            <div className="sermon-choice-grid">
              {SERMON_TONES.map((tone) => (
                <label
                  key={tone}
                  className={!customToneSelected && form.tone === tone ? "is-selected" : ""}
                >
                  <input
                    type="radio"
                    name="tone-mode"
                    value={tone}
                    checked={!customToneSelected && form.tone === tone}
                    onChange={() => selectTone(tone)}
                  />
                  <span>{tone}</span>
                </label>
              ))}
              <label className={customToneSelected ? "is-selected" : ""}>
                <input
                  type="radio"
                  name="tone-mode"
                  value="기타"
                  checked={customToneSelected}
                  onChange={() => selectTone("기타")}
                />
                <span>기타</span>
              </label>
            </div>
            {customToneSelected ? (
              <div className="sermon-field sermon-custom-tone-input">
                <label htmlFor="custom-tone">원하는 감정선 직접 입력</label>
                <input
                  id="custom-tone"
                  value={form.tone}
                  maxLength={MAX_SERMON_TONE_LENGTH}
                  onChange={(event) => change("tone", event.target.value)}
                  placeholder="예: 소망을 품은 차분한 권면"
                  aria-invalid={showToneError && Boolean(errors.tone)}
                  aria-describedby={showToneError && errors.tone ? "tone-error" : "custom-tone-hint"}
                />
                <div className="sermon-field-meta" id="custom-tone-hint">
                  <span>2~40자의 짧고 구체적인 분위기를 권합니다.</span>
                  <span>{form.tone.length}/{MAX_SERMON_TONE_LENGTH}</span>
                </div>
              </div>
            ) : null}
            {showToneError && errors.tone ? (
              <p className="sermon-field-error" id="tone-error" role="alert">
                {errors.tone}
              </p>
            ) : null}
          </fieldset>
        </section>

        <section className="sermon-form-card" aria-labelledby="engine-tier-title">
          <div className="sermon-section-heading">
            <span>03</span>
            <div>
              <h3 id="engine-tier-title">AI 엔진 선택</h3>
              <p>한 번 선택한 엔진을 다섯 개 초안 전체에 동일하게 적용합니다.</p>
            </div>
          </div>
          <fieldset
            className="sermon-engine-stage is-single"
            aria-describedby={engineAvailabilityNotice ? "sermon-engine-availability" : undefined}
          >
            <legend>다섯 초안 공통 엔진</legend>
            <p>선택한 등급은 1번째부터 5번째 초안까지 모두 동일하게 사용됩니다.</p>
            <div className="sermon-reference-choices is-engine-tiers">
              {selectableEngineTiers.map((tier) => {
                const meta = AI_ENGINE_TIER_META[tier];
                return (
                  <label key={tier} className={form.aiTier === tier ? "is-selected" : ""}>
                    <input
                      type="radio"
                      name="ai-tier"
                      value={tier}
                      checked={form.aiTier === tier}
                      onChange={() => changeAiTier(tier)}
                    />
                    <strong>{meta.label}</strong>
                    <span>{meta.description}</span>
                    <span>최소 {SERMON_TOKEN_MINIMUM_COSTS[tier]}토큰부터</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          {engineAvailabilityNotice ? (
            <div
              id="sermon-engine-availability"
              className="sermon-inline-alert is-warning"
              role={engineAvailabilityStatus === "error" ? "alert" : "status"}
            >
              <span>{engineAvailabilityNotice}</span>
              {engineAvailabilityStatus === "error" ? (
                <button type="button" onClick={() => void reloadEngineAvailability()}>
                  다시 확인
                </button>
              ) : null}
            </div>
          ) : null}
          <p className="sermon-engine-token-total">
            현재 조건 예상 차감
            <strong>{estimatedTokenCost === null ? "계산 전" : `${estimatedTokenCost}토큰`}</strong>
          </p>
          <p className="sermon-field-hint sermon-engine-pricing-note">
            {estimatedTokenCost === null
              ? engineReady
                ? "분량과 대지 수를 선택하면 예상 차감을 계산합니다."
                : "사용 가능한 AI 엔진을 확인한 뒤 예상 차감을 표시합니다."
              : `${AI_ENGINE_TIER_META[form.aiTier].label} · ${form.duration}분 · ${form.pointCount}대지 기준이며, 초안 개수와 관계없이 생성 1회만 차감합니다.`}
          </p>
        </section>

        <section className="sermon-form-card" aria-labelledby="reference-options-title">
          <div className="sermon-section-heading">
            <span>04</span>
            <div>
              <h3 id="reference-options-title">참고 자료</h3>
              <p>직접 준비한 자료가 있다면 다음 단계에서 더할 수 있습니다.</p>
            </div>
          </div>
          <fieldset className="sermon-fieldset">
            <legend>자료를 직접 입력하시겠어요?</legend>
            <div className="sermon-reference-choices">
              <label className={form.referenceMode === "auto" ? "is-selected" : ""}>
                <input
                  type="radio"
                  name="reference-mode"
                  checked={form.referenceMode === "auto"}
                  onChange={() => change("referenceMode", "auto")}
                />
                <strong>AI 기본 자료 사용</strong>
                <span>추가 자료 없이 본문과 설정만으로 초안을 만듭니다.</span>
              </label>
              <label className={form.referenceMode === "manual" ? "is-selected" : ""}>
                <input
                  type="radio"
                  name="reference-mode"
                  checked={form.referenceMode === "manual"}
                  onChange={() => change("referenceMode", "manual")}
                />
                <strong>직접 자료 추가</strong>
                <span>다음 단계에서 URL, 메모 또는 파일을 첨부합니다.</span>
              </label>
            </div>
          </fieldset>
        </section>
      </div>

      <footer className="sermon-form-actions">
        <div aria-live="polite">
          {savedMessage ? <p className="sermon-save-message">{savedMessage}</p> : null}
          {!valid ? <p>필수 옵션을 모두 선택하면 다음 단계로 갈 수 있습니다.</p> : null}
          {valid && !engineReady ? <p>사용 가능한 AI 엔진이 있어야 다음 단계로 갈 수 있습니다.</p> : null}
        </div>
        <div className="sermon-button-row">
          <button className="sermon-button is-secondary" type="button" onClick={() => save(false)}>
            임시 저장
          </button>
          <button className="sermon-button is-primary" type="submit" disabled={!valid || !engineReady}>
            본문 입력으로
          </button>
        </div>
      </footer>
    </form>
  );
}
