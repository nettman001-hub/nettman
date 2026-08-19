"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AI_ENGINES,
  AI_ENGINE_PRESETS,
  AI_MAX_OUTPUT_TOKENS_MAX,
  AI_MAX_OUTPUT_TOKENS_MIN,
  aiReasoningEffortsForModel,
  type AiEngine,
  type AiPreferences,
} from "@/app/_lib/ai-config";

type SettingsResponse = {
  preferences: AiPreferences;
  persistence: "database" | "environment";
  apiKeyConfigured: boolean;
  apiKeyEnvironmentName: string;
};

async function responseJson<T extends object>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as
    | T
    | { error?: string }
    | null;
  if (!response.ok) {
    throw new Error(
      body && "error" in body && body.error
        ? body.error
        : "요청을 처리하지 못했습니다.",
    );
  }
  return body as T;
}

export function AdminAiSettingsForm() {
  const [preferences, setPreferences] = useState<AiPreferences | null>(null);
  const [keyConfigured, setKeyConfigured] = useState<boolean | null>(null);
  const [keyEnvironmentName, setKeyEnvironmentName] = useState("OPENAI_API_KEY");
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch("/api/ai-settings", { cache: "no-store" });
        const body = await responseJson<SettingsResponse>(response);
        if (!cancelled) {
          setPreferences(body.preferences);
          setKeyConfigured(body.apiKeyConfigured);
          setKeyEnvironmentName(body.apiKeyEnvironmentName);
        }
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "AI 설정을 불러오지 못했습니다.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const reasoningEfforts = useMemo(
    () =>
      preferences
        ? aiReasoningEffortsForModel(preferences.engine, preferences.model)
        : [],
    [preferences],
  );

  function selectEngine(engine: AiEngine) {
    if (!preferences) return;
    const preset = AI_ENGINE_PRESETS[engine];
    setPreferences({
      enabled: preferences.enabled,
      engine,
      endpoint: preset.endpoint,
      model: preset.defaultModel,
      reasoningEffort: preset.defaultReasoningEffort,
      maxOutputTokens: preferences.maxOutputTokens,
    });
    setModels([]);
    setKeyConfigured(null);
    setKeyEnvironmentName(
      engine === "openai"
        ? "OPENAI_API_KEY"
        : engine === "anthropic"
          ? "ANTHROPIC_API_KEY"
          : engine === "gemini"
            ? "GEMINI_API_KEY"
            : engine === "openrouter"
              ? "OPENROUTER_API_KEY"
              : engine === "deepseek"
                ? "DEEPSEEK_API_KEY"
                : "CUSTOM_AI_API_KEY",
    );
  }

  async function loadModels() {
    if (!preferences || loadingModels) return;
    setLoadingModels(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/ai-settings/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          engine: preferences.engine,
          endpoint: preferences.endpoint,
        }),
      });
      const body = await responseJson<{ models: string[] }>(response);
      setModels(body.models);
      setNotice(`${body.models.length.toLocaleString("ko-KR")}개 모델을 불러왔습니다.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "모델 목록을 불러오지 못했습니다.");
    } finally {
      setLoadingModels(false);
    }
  }

  async function save() {
    if (!preferences || saving) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/ai-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(preferences),
      });
      const body = await responseJson<SettingsResponse>(response);
      setPreferences(body.preferences);
      setKeyConfigured(body.apiKeyConfigured);
      setKeyEnvironmentName(body.apiKeyEnvironmentName);
      setNotice("모든 사용자에게 적용할 AI 엔진 설정을 저장했습니다.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "AI 설정을 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="rounded-[1.75rem] border border-[#ddd7cd] bg-white p-7 text-sm text-[#67736d]">관리자 AI 설정을 불러오는 중입니다…</div>;
  }
  if (!preferences) {
    return <div className="rounded-[1.75rem] border border-[#e2c6bb] bg-[#fff7f2] p-7 text-sm font-semibold text-[#984d34]">{error || "관리자 AI 설정을 불러오지 못했습니다."}</div>;
  }

  const preset = AI_ENGINE_PRESETS[preferences.engine];
  const modelOptions = [...new Set([...models, ...preset.modelSuggestions])];

  return (
    <section className="rounded-[1.75rem] border border-[#d8d4cc] bg-white p-6 shadow-[0_18px_55px_rgba(40,48,43,.07)] sm:p-8" aria-labelledby="admin-ai-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-extrabold uppercase tracking-[.18em] text-[#a96835]">Administrator only</p>
          <h2 id="admin-ai-title" className="mt-2 font-serif text-3xl font-bold text-[#203a30]">전역 AI 엔진</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#66736c]">여기서 저장한 엔진과 모델이 모든 사용자의 설교 생성·수정에 동일하게 적용됩니다.</p>
        </div>
        <span className={`rounded-full px-4 py-2 text-xs font-extrabold ${preferences.enabled ? "bg-[#eaf5ed] text-[#2d6d48]" : "bg-[#f0efec] text-[#69736e]"}`}>
          {preferences.enabled ? "AI 사용 중" : "AI 사용 안 함"}
        </span>
      </div>

      {error ? <p role="alert" className="mt-6 rounded-xl bg-[#fff0ea] px-4 py-3 text-sm font-semibold text-[#984d34]">{error}</p> : null}
      {notice ? <p role="status" className="mt-6 rounded-xl bg-[#edf7f0] px-4 py-3 text-sm font-semibold text-[#2f6948]">{notice}</p> : null}

      <div className="mt-7 grid gap-5 sm:grid-cols-2">
        <label className="text-sm font-extrabold text-[#34483f]">
          AI 엔진
          <select
            value={preferences.engine}
            onChange={(event) => selectEngine(event.target.value as AiEngine)}
            className="mt-2 min-h-12 w-full rounded-xl border border-[#ccc8bf] bg-white px-4 text-sm font-bold outline-none focus:ring-2 focus:ring-[#b97838]"
          >
            {AI_ENGINES.map((engine) => (
              <option key={engine} value={engine}>{AI_ENGINE_PRESETS[engine].label}</option>
            ))}
          </select>
        </label>

        <label className="text-sm font-extrabold text-[#34483f]">
          추론 강도
          <select
            value={preferences.reasoningEffort}
            onChange={(event) => setPreferences({ ...preferences, reasoningEffort: event.target.value as AiPreferences["reasoningEffort"] })}
            className="mt-2 min-h-12 w-full rounded-xl border border-[#ccc8bf] bg-white px-4 text-sm font-bold outline-none focus:ring-2 focus:ring-[#b97838]"
          >
            {reasoningEfforts.map((effort) => <option key={effort} value={effort}>{effort}</option>)}
          </select>
        </label>

        <label className="sm:col-span-2 text-sm font-extrabold text-[#34483f]">
          최대 출력 토큰 (선택)
          <input
            type="number"
            inputMode="numeric"
            min={AI_MAX_OUTPUT_TOKENS_MIN}
            max={AI_MAX_OUTPUT_TOKENS_MAX}
            step={1}
            value={preferences.maxOutputTokens ?? ""}
            placeholder="자동(기본값)"
            onChange={(event) =>
              setPreferences({
                ...preferences,
                maxOutputTokens:
                  event.target.value === "" ? null : Number(event.target.value),
              })
            }
            className="mt-2 min-h-12 w-full rounded-xl border border-[#ccc8bf] bg-white px-4 text-sm font-bold outline-none focus:ring-2 focus:ring-[#b97838]"
          />
          <span className="mt-2 block text-xs font-medium leading-5 text-[#6a756f]">
            비워 두면 작업별 기본값을 사용합니다 ({AI_MAX_OUTPUT_TOKENS_MIN.toLocaleString("ko-KR")}–{AI_MAX_OUTPUT_TOKENS_MAX.toLocaleString("ko-KR")}). 너무 낮거나 모델 허용 범위를 넘으면 응답이 잘리거나 오류가 날 수 있습니다.
          </span>
        </label>

        <label className="sm:col-span-2 text-sm font-extrabold text-[#34483f]">
          API 주소
          <input
            value={preferences.endpoint}
            readOnly={preferences.engine !== "custom"}
            onChange={(event) => setPreferences({ ...preferences, endpoint: event.target.value })}
            className="mt-2 min-h-12 w-full rounded-xl border border-[#ccc8bf] bg-[#faf9f6] px-4 text-sm font-semibold text-[#42554c] outline-none read-only:text-[#77817b] focus:ring-2 focus:ring-[#b97838]"
          />
        </label>

        <label className="sm:col-span-2 text-sm font-extrabold text-[#34483f]">
          모델 ID
          <span className="mt-2 flex gap-2">
            <input
              list="admin-ai-models"
              value={preferences.model}
              onChange={(event) => setPreferences({ ...preferences, model: event.target.value })}
              className="min-h-12 min-w-0 flex-1 rounded-xl border border-[#ccc8bf] bg-white px-4 text-sm font-bold outline-none focus:ring-2 focus:ring-[#b97838]"
            />
            <button type="button" onClick={() => void loadModels()} disabled={loadingModels} className="min-h-12 rounded-xl border border-[#b9b3a8] px-4 text-xs font-extrabold text-[#315746] hover:bg-[#f3f1ec] disabled:opacity-50">
              {loadingModels ? "조회 중…" : "모델 조회"}
            </button>
          </span>
          <datalist id="admin-ai-models">
            {modelOptions.map((model) => <option key={model} value={model} />)}
          </datalist>
        </label>
      </div>

      <div className="mt-6 rounded-2xl bg-[#f5f3ee] p-5">
        <div className="flex items-start gap-3">
          <input
            id="admin-ai-enabled"
            type="checkbox"
            aria-label="전역 AI 엔진 사용"
            checked={preferences.enabled}
            onChange={(event) => setPreferences({ ...preferences, enabled: event.target.checked })}
            className="mt-1 size-4 accent-[#315746]"
          />
          <span>
            <span className="block text-sm font-extrabold text-[#2f453b]">전역 AI 엔진 사용</span>
            <span className="mt-1 block text-xs leading-5 text-[#707b75]">끄면 모든 사용자에게 로컬 기본 생성기가 적용됩니다.</span>
          </span>
        </div>
        <p className="mt-4 text-xs font-semibold text-[#596861]">
          서버 비밀값 · <code className="rounded bg-white px-1.5 py-1">{keyEnvironmentName}</code>
          <span className={`ml-2 ${keyConfigured === true ? "text-[#2d744c]" : keyConfigured === false ? "text-[#a05235]" : "text-[#7b837f]"}`}>
            {keyConfigured === true ? "연결됨" : keyConfigured === false ? "미연결" : "저장 시 확인"}
          </span>
        </p>
      </div>

      <button type="button" onClick={() => void save()} disabled={saving} className="mt-7 min-h-14 w-full rounded-2xl bg-[#172b24] px-6 text-base font-extrabold text-white shadow-[0_12px_25px_rgba(16,23,20,.18)] hover:bg-[#234438] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#d7a363] disabled:opacity-50">
        {saving ? "저장 중…" : "모든 사용자에게 적용"}
      </button>
    </section>
  );
}
