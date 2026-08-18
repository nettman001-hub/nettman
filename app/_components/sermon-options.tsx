"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { sermonDraftUrl } from "@/app/_lib/sermon-store";
import {
  AI_ENGINE_TIERS,
  AI_ENGINE_TIER_META,
  type AiEngineTier,
} from "@/app/_lib/ai-engine-tiers";
import {
  EMPTY_SERMON_OPTIONS,
  SERMON_ALTERNATIVE_POSITIONS,
  SERMON_AUDIENCES,
  SERMON_DURATIONS,
  SERMON_POINT_COUNTS,
  SERMON_TONES,
  SERMON_TYPES,
  durationToTargetCharacters,
  isSermonOptionsComplete,
  normalizeSermonAiTiers,
  type SermonOptions as SermonOptionsValue,
} from "@/app/_lib/sermon-types";
import { SermonLoading, useSermonWorkflow } from "./sermon-workflow";

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
  const aiTiers = normalizeSermonAiTiers(value);
  return {
    ...value,
    topic: value.topic.trim(),
    aiTier: aiTiers[0],
    aiTiers,
    targetCharacters: value.duration
      ? durationToTargetCharacters(value.duration)
      : null,
  };
}

export function SermonOptions() {
  const router = useRouter();
  const { draft, ready, createDraft, updateDraft } = useSermonWorkflow();
  const [form, setForm] = useState<SermonOptionsValue>({
    ...EMPTY_SERMON_OPTIONS,
    aiTiers: [...EMPTY_SERMON_OPTIONS.aiTiers],
  });
  const [submitted, setSubmitted] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [savedMessage, setSavedMessage] = useState("");
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
  }, [draft, dirty]);

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
        form.topic.trim().length >= 2 ? "" : "주제를 2자 이상 입력해 주세요.",
      duration: form.duration ? "" : "설교 분량을 선택해 주세요.",
      tone: form.tone ? "" : "감정선을 선택해 주세요.",
      sermonType: form.sermonType ? "" : "설교 유형을 선택해 주세요.",
      audience: form.audience ? "" : "설교 대상을 선택해 주세요.",
      pointCount: form.pointCount ? "" : "대지 수를 선택해 주세요.",
    }),
    [form],
  );
  const valid = isSermonOptionsComplete(form);

  if (!ready || !draft) return <SermonLoading label="옵션 입력란을 준비하는 중입니다" />;

  const change = <K extends keyof SermonOptionsValue>(
    key: K,
    value: SermonOptionsValue[K],
  ) => {
    setForm((current) => ({ ...current, [key]: value }));
    setDirty(true);
    setSavedMessage("");
  };

  const changeAiTier = (index: number, tier: AiEngineTier) => {
    setForm((current) => {
      const aiTiers = normalizeSermonAiTiers(current);
      aiTiers[index] = tier;
      return { ...current, aiTier: aiTiers[0], aiTiers };
    });
    setDirty(true);
    setSavedMessage("");
  };

  const save = (moveNext: boolean) => {
    setSubmitted(true);
    if (moveNext && !valid) return;
    const nextOptions = normalizedOptions(form);
    const changed = JSON.stringify(nextOptions) !== JSON.stringify(draft.options);

    updateDraft((current) => ({
      ...current,
      options: nextOptions,
      stage: moveNext ? "input" : changed ? "options" : current.stage,
      ...(changed
        ? {
            scripture: "",
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
              <p>무엇을, 어느 정도의 호흡과 온도로 전할지 정합니다.</p>
            </div>
          </div>

          <div className="sermon-field">
            <label htmlFor="sermon-topic">
              설교 주제 <span aria-hidden="true">*</span>
            </label>
            <input
              id="sermon-topic"
              value={form.topic}
              maxLength={100}
              onChange={(event) => change("topic", event.target.value)}
              placeholder="예: 하나님의 사랑, 성령의 열매"
              aria-invalid={submitted && Boolean(errors.topic)}
              aria-describedby={submitted && errors.topic ? "topic-error" : "topic-hint"}
            />
            <div className="sermon-field-meta">
              <span id="topic-hint">핵심 메시지가 드러나는 짧은 문장을 권합니다.</span>
              <span>{form.topic.length}/100</span>
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
            hint="내부적으로 1,600~8,000자의 목표 분량으로 변환됩니다."
            error={submitted ? errors.duration : ""}
          />
          <ChoiceGroup
            legend="감정선"
            name="tone"
            value={form.tone}
            options={SERMON_TONES}
            onChange={(value) => change("tone", value)}
            error={submitted ? errors.tone : ""}
          />
        </section>

        <section className="sermon-form-card" aria-labelledby="structure-options-title">
          <div className="sermon-section-heading">
            <span>02</span>
            <div>
              <h3 id="structure-options-title">구성 옵션</h3>
              <p>회중에게 맞는 설교 형식과 본론의 뼈대를 선택합니다.</p>
            </div>
          </div>
          <ChoiceGroup
            legend="설교 유형"
            name="sermon-type"
            value={form.sermonType}
            options={SERMON_TYPES}
            onChange={(value) => change("sermonType", value)}
            error={submitted ? errors.sermonType : ""}
          />
          <ChoiceGroup
            legend="설교 대상"
            name="audience"
            value={form.audience}
            options={SERMON_AUDIENCES}
            onChange={(value) => change("audience", value)}
            error={submitted ? errors.audience : ""}
          />
          <ChoiceGroup
            legend="대지 수"
            name="point-count"
            value={form.pointCount}
            options={SERMON_POINT_COUNTS}
            onChange={(value) => change("pointCount", value)}
            format={(value) => `${value}대지`}
            hint="선택한 수만큼 본론 소제목이 만들어집니다."
            error={submitted ? errors.pointCount : ""}
          />
        </section>

        <section className="sermon-form-card" aria-labelledby="engine-tier-title">
          <div className="sermon-section-heading">
            <span>03</span>
            <div>
              <h3 id="engine-tier-title">AI 엔진 선택</h3>
              <p>다섯 초안마다 생성 품질과 사용할 토큰을 따로 선택합니다.</p>
            </div>
          </div>
          <div className="sermon-engine-stage-list">
            {SERMON_ALTERNATIVE_POSITIONS.map((position, index) => (
              <fieldset className="sermon-engine-stage" key={position}>
                <legend>{position}단계 초안 엔진</legend>
                <p>{position}번째로 생성할 설교 초안에만 적용됩니다.</p>
                <div className="sermon-reference-choices is-engine-tiers">
                  {AI_ENGINE_TIERS.map((tier) => {
                    const meta = AI_ENGINE_TIER_META[tier];
                    return (
                      <label
                        key={tier}
                        className={form.aiTiers[index] === tier ? "is-selected" : ""}
                      >
                        <input
                          type="radio"
                          name={`ai-tier-${position}`}
                          value={tier}
                          checked={form.aiTiers[index] === tier}
                          onChange={() => changeAiTier(index, tier)}
                        />
                        <strong>{meta.label}</strong>
                        <span>{meta.description}</span>
                        <span>{meta.tokenCost}토큰</span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            ))}
          </div>
          <p className="sermon-engine-token-total">
            다섯 단계 예상 차감
            <strong>
              {form.aiTiers.reduce(
                (total, tier) => total + AI_ENGINE_TIER_META[tier].tokenCost,
                0,
              )}
              토큰
            </strong>
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
        </div>
        <div className="sermon-button-row">
          <button className="sermon-button is-secondary" type="button" onClick={() => save(false)}>
            임시 저장
          </button>
          <button className="sermon-button is-primary" type="submit" disabled={!valid}>
            본문 입력으로
          </button>
        </div>
      </footer>
    </form>
  );
}
