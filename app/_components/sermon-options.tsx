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
  MAX_SERMON_TONE_LENGTH,
  SERMON_AUDIENCES,
  SERMON_DURATIONS,
  SERMON_POINT_COUNTS,
  SERMON_TONES,
  SERMON_TYPES,
  durationToTargetCharacters,
  isSermonOptionsComplete,
  isSermonToneValue,
  normalizeSermonAiTiers,
  type SermonOptions as SermonOptionsValue,
  type SermonTone,
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
  const aiTiers = normalizeSermonAiTiers({ aiTier: value.aiTier });
  return {
    ...value,
    topic: value.topic.trim(),
    tone: value.tone.trim(),
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
    setCustomToneSelected(
      Boolean(draft.options.tone) &&
        !SERMON_TONES.some((tone) => tone === draft.options.tone),
    );
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
      tone: isSermonToneValue(form.tone)
        ? ""
        : "감정선을 선택하거나 2자 이상 40자 이하로 직접 입력해 주세요.",
      sermonType: form.sermonType ? "" : "설교 유형을 선택해 주세요.",
      audience: form.audience ? "" : "설교 대상을 선택해 주세요.",
      pointCount: form.pointCount ? "" : "대지 수를 선택해 주세요.",
    }),
    [form],
  );
  const valid = isSermonOptionsComplete(form);
  const showToneError = submitted || (customToneSelected && form.tone.length > 0);

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
              <p>무엇을, 어떤 유형과 호흡으로 전할지 정합니다.</p>
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
            legend="설교 유형"
            name="sermon-type"
            value={form.sermonType}
            options={SERMON_TYPES}
            onChange={(value) => change("sermonType", value)}
            error={submitted ? errors.sermonType : ""}
          />
        </section>

        <section className="sermon-form-card" aria-labelledby="structure-options-title">
          <div className="sermon-section-heading">
            <span>02</span>
            <div>
              <h3 id="structure-options-title">구성 옵션</h3>
              <p>회중, 본론의 뼈대와 메시지의 감정선을 선택합니다.</p>
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
          <fieldset className="sermon-engine-stage is-single">
            <legend>다섯 초안 공통 엔진</legend>
            <p>선택한 등급은 1번째부터 5번째 초안까지 모두 동일하게 사용됩니다.</p>
            <div className="sermon-reference-choices is-engine-tiers">
              {AI_ENGINE_TIERS.map((tier) => {
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
                    <span>초안 1편당 {meta.tokenCost}토큰</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          <p className="sermon-engine-token-total">
            다섯 초안 예상 차감
            <strong>
              {AI_ENGINE_TIER_META[form.aiTier].tokenCost * 5}토큰
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
