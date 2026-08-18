"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AI_ENGINE_TIERS,
  AI_ENGINE_TIER_META,
  type AiEngineTier,
} from "@/app/_lib/ai-engine-tiers";
import {
  AI_ENGINES,
  AI_ENGINE_PRESETS,
  aiReasoningEffortsForModel,
  type AiEngine,
  type AiPreferences,
} from "@/app/_lib/ai-config";
import type { AiModelCatalogEntry } from "@/app/_lib/ai-model-catalog";

type ServerSetting = {
  tier: AiEngineTier;
  preferences: AiPreferences;
  apiKeyConfigured: boolean;
  apiKeySource: "saved" | "environment" | null;
  apiKeyEnvironmentName: string;
};

type SettingsResponse = {
  settings: ServerSetting[];
  persistence: "database";
  encryptionConfigured: boolean;
};

type DraftSetting = ServerSetting & {
  apiKey: string;
  clearApiKey: boolean;
  models: AiModelCatalogEntry[];
  loadingModels: boolean;
};

type SaveFeedback = {
  type: "success" | "error";
  message: string;
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

function toDraftSettings(settings: ServerSetting[]): DraftSetting[] {
  return AI_ENGINE_TIERS.map((tier) => {
    const setting = settings.find((item) => item.tier === tier);
    if (!setting) throw new Error("AI 엔진 설정 응답이 올바르지 않습니다.");
    return {
      ...setting,
      apiKey: "",
      clearApiKey: false,
      models: [],
      loadingModels: false,
    };
  });
}

export function AdminAiEngineSettingsForm() {
  const [settings, setSettings] = useState<DraftSetting[]>([]);
  const [encryptionConfigured, setEncryptionConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saveFeedback, setSaveFeedback] = useState<SaveFeedback | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch("/api/admin/ai-settings", {
          cache: "no-store",
        });
        const body = await responseJson<SettingsResponse>(response);
        if (!cancelled) {
          setSettings(toDraftSettings(body.settings));
          setEncryptionConfigured(body.encryptionConfigured);
        }
      } catch (caught) {
        if (!cancelled) {
          setError(
            caught instanceof Error
              ? caught.message
              : "AI 설정을 불러오지 못했습니다.",
          );
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

  const enabledCount = useMemo(
    () => settings.filter((setting) => setting.preferences.enabled).length,
    [settings],
  );

  function updateSetting(
    tier: AiEngineTier,
    update: (setting: DraftSetting) => DraftSetting,
  ) {
    setSettings((current) =>
      current.map((setting) =>
        setting.tier === tier ? update(setting) : setting,
      ),
    );
    setNotice("");
    setSaveFeedback(null);
  }

  function selectEngine(tier: AiEngineTier, engine: AiEngine) {
    const preset = AI_ENGINE_PRESETS[engine];
    updateSetting(tier, (setting) => ({
      ...setting,
      preferences: {
        enabled: setting.preferences.enabled,
        engine,
        endpoint: preset.endpoint,
        model: preset.defaultModel,
        reasoningEffort: preset.defaultReasoningEffort,
      },
      apiKey: "",
      apiKeyConfigured: false,
      apiKeySource: null,
      clearApiKey: false,
      models: [],
    }));
  }

  async function loadModels(tier: AiEngineTier) {
    const setting = settings.find((item) => item.tier === tier);
    if (!setting || setting.loadingModels) return;
    updateSetting(tier, (current) => ({ ...current, loadingModels: true }));
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/ai-settings/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tier,
          engine: setting.preferences.engine,
          endpoint: setting.preferences.endpoint,
          ...(setting.preferences.engine === "custom"
            ? { apiKey: setting.apiKey }
            : setting.apiKey
              ? { apiKey: setting.apiKey }
              : {}),
        }),
      });
      const body = await responseJson<{ models: AiModelCatalogEntry[] }>(response);
      updateSetting(tier, (current) => ({
        ...current,
        models: body.models,
        preferences: {
          ...current.preferences,
          model: body.models.some(
            (model) => model.id === current.preferences.model,
          )
            ? current.preferences.model
            : (body.models[0]?.id ?? current.preferences.model),
        },
        loadingModels: false,
      }));
      setNotice(
        `${AI_ENGINE_TIER_META[tier].label} 모델 ${body.models.length.toLocaleString("ko-KR")}개를 불러왔습니다.`,
      );
    } catch (caught) {
      updateSetting(tier, (current) => ({
        ...current,
        loadingModels: false,
      }));
      setError(
        caught instanceof Error
          ? caught.message
          : "모델 목록을 불러오지 못했습니다.",
      );
    }
  }

  async function save() {
    if (saving || settings.length !== AI_ENGINE_TIERS.length) return;
    setSaving(true);
    setError("");
    setNotice("");
    setSaveFeedback(null);
    try {
      const response = await fetch("/api/admin/ai-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: settings.map((setting) => ({
            tier: setting.tier,
            ...setting.preferences,
            ...(setting.apiKey ? { apiKey: setting.apiKey } : {}),
            clearApiKey: setting.clearApiKey,
          })),
        }),
      });
      const body = await responseJson<SettingsResponse>(response);
      setSettings(toDraftSettings(body.settings));
      setEncryptionConfigured(body.encryptionConfigured);
      setSaveFeedback({
        type: "success",
        message: "세 가지 AI 엔진 설정과 API 키를 저장했습니다.",
      });
    } catch (caught) {
      setSaveFeedback({
        type: "error",
        message:
          caught instanceof Error
            ? caught.message
            : "AI 설정을 저장하지 못했습니다.",
      });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="rounded-[1.75rem] border border-[#ddd7cd] bg-white p-7 text-sm text-[#67736d]">
        관리자 AI 설정을 불러오는 중입니다…
      </div>
    );
  }
  if (!settings.length) {
    return (
      <div className="rounded-[1.75rem] border border-[#e2c6bb] bg-[#fff7f2] p-7 text-sm font-semibold text-[#984d34]">
        {error || "관리자 AI 설정을 불러오지 못했습니다."}
      </div>
    );
  }

  return (
    <section
      className="rounded-[1.75rem] border border-[#d8d4cc] bg-white p-6 shadow-[0_18px_55px_rgba(40,48,43,.07)] sm:p-8"
      aria-labelledby="admin-ai-title"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-extrabold uppercase tracking-[.18em] text-[#a96835]">
            Administrator only
          </p>
          <h2
            id="admin-ai-title"
            className="mt-2 font-serif text-3xl font-bold text-[#203a30]"
          >
            서비스 AI 엔진
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[#66736c]">
            기본·고급·고급 추론 엔진마다 제공자, 모델과 API 키를 별도로
            등록합니다. API 키는 암호화해 저장되며 저장 후 다시 표시되지
            않습니다.
          </p>
        </div>
        <span className="rounded-full bg-[#eaf5ed] px-4 py-2 text-xs font-extrabold text-[#2d6d48]">
          {enabledCount}개 엔진 사용 중
        </span>
      </div>

      {!encryptionConfigured ? (
        <p
          role="alert"
          className="mt-6 rounded-xl bg-[#fff0ea] px-4 py-3 text-sm font-semibold text-[#984d34]"
        >
          API 키 암호화 설정이 아직 준비되지 않았습니다. 배포 환경의
          AI_SETTINGS_ENCRYPTION_KEY를 먼저 등록해 주세요.
        </p>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="mt-6 rounded-xl bg-[#fff0ea] px-4 py-3 text-sm font-semibold text-[#984d34]"
        >
          {error}
        </p>
      ) : null}
      {notice ? (
        <p
          role="status"
          className="mt-6 rounded-xl bg-[#edf7f0] px-4 py-3 text-sm font-semibold text-[#2f6948]"
        >
          {notice}
        </p>
      ) : null}

      <div className="mt-7 grid gap-6">
        {settings.map((setting) => {
          const meta = AI_ENGINE_TIER_META[setting.tier];
          const preset = AI_ENGINE_PRESETS[setting.preferences.engine];
          const reasoningEfforts = aiReasoningEffortsForModel(
            setting.preferences.engine,
            setting.preferences.model,
          );
          const modelOptions = Array.from(
            new Map<string, AiModelCatalogEntry>([
              ...preset.modelSuggestions.map(
                (model): [string, AiModelCatalogEntry] => [
                  model,
                  { id: model, name: model },
                ],
              ),
              ...setting.models.map(
                (model): [string, AiModelCatalogEntry] => [model.id, model],
              ),
            ]).values(),
          );
          const keyStatus = setting.apiKey
            ? "새 키 저장 대기"
            : setting.clearApiKey
              ? "저장 시 삭제"
              : setting.apiKeyConfigured
                ? setting.apiKeySource === "saved"
                  ? "암호화 저장됨"
                  : "서버 환경변수 연결됨"
                : "미등록";

          return (
            <article
              key={setting.tier}
              className="rounded-2xl border border-[#ded9cf] bg-[#fcfbf8] p-5 sm:p-6"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h3 className="text-xl font-extrabold text-[#263f35]">
                    {meta.label}
                  </h3>
                  <p className="mt-1 text-sm text-[#6a756f]">
                    {meta.description} · 설교 1개당 {meta.tokenCost}토큰
                  </p>
                </div>
                <label className="flex items-center gap-2 text-sm font-extrabold text-[#34483f]">
                  <input
                    type="checkbox"
                    checked={setting.preferences.enabled}
                    onChange={(event) =>
                      updateSetting(setting.tier, (current) => ({
                        ...current,
                        preferences: {
                          ...current.preferences,
                          enabled: event.target.checked,
                        },
                      }))
                    }
                    className="size-4 accent-[#315746]"
                  />
                  사용
                </label>
              </div>

              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-extrabold text-[#34483f]">
                  AI 제공자
                  <select
                    value={setting.preferences.engine}
                    onChange={(event) =>
                      selectEngine(
                        setting.tier,
                        event.target.value as AiEngine,
                      )
                    }
                    className="mt-2 min-h-12 w-full rounded-xl border border-[#ccc8bf] bg-white px-4 text-sm font-bold outline-none focus:ring-2 focus:ring-[#b97838]"
                  >
                    {AI_ENGINES.map((engine) => (
                      <option key={engine} value={engine}>
                        {AI_ENGINE_PRESETS[engine].label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="text-sm font-extrabold text-[#34483f]">
                  추론 강도
                  <select
                    value={setting.preferences.reasoningEffort}
                    onChange={(event) =>
                      updateSetting(setting.tier, (current) => ({
                        ...current,
                        preferences: {
                          ...current.preferences,
                          reasoningEffort: event.target
                            .value as AiPreferences["reasoningEffort"],
                        },
                      }))
                    }
                    className="mt-2 min-h-12 w-full rounded-xl border border-[#ccc8bf] bg-white px-4 text-sm font-bold outline-none focus:ring-2 focus:ring-[#b97838]"
                  >
                    {reasoningEfforts.map((effort) => (
                      <option key={effort} value={effort}>
                        {effort}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="text-sm font-extrabold text-[#34483f] sm:col-span-2">
                  API 주소
                  <input
                    value={setting.preferences.endpoint}
                    readOnly={setting.preferences.engine !== "custom"}
                    onChange={(event) =>
                      updateSetting(setting.tier, (current) => ({
                        ...current,
                        preferences: {
                          ...current.preferences,
                          endpoint: event.target.value,
                        },
                      }))
                    }
                    className="mt-2 min-h-12 w-full rounded-xl border border-[#ccc8bf] bg-[#f7f5f1] px-4 text-sm font-semibold text-[#42554c] outline-none read-only:text-[#77817b] focus:ring-2 focus:ring-[#b97838]"
                  />
                </label>

                <label className="text-sm font-extrabold text-[#34483f] sm:col-span-2">
                  모델 ID
                  <span className="mt-2 flex gap-2">
                    <input
                      list={`admin-ai-models-${setting.tier}`}
                      value={setting.preferences.model}
                      onChange={(event) =>
                        updateSetting(setting.tier, (current) => ({
                          ...current,
                          preferences: {
                            ...current.preferences,
                            model: event.target.value,
                          },
                        }))
                      }
                      className="min-h-12 min-w-0 flex-1 rounded-xl border border-[#ccc8bf] bg-white px-4 text-sm font-bold outline-none focus:ring-2 focus:ring-[#b97838]"
                    />
                    <button
                      type="button"
                      onClick={() => void loadModels(setting.tier)}
                      disabled={setting.loadingModels}
                      className="min-h-12 rounded-xl border border-[#b9b3a8] px-4 text-xs font-extrabold text-[#315746] hover:bg-[#f3f1ec] disabled:opacity-50"
                    >
                      {setting.loadingModels ? "조회 중…" : "모델 ID 조회"}
                    </button>
                  </span>
                  <datalist id={`admin-ai-models-${setting.tier}`}>
                    {modelOptions.map((model) => (
                      <option
                        key={model.id}
                        value={model.id}
                        label={model.name}
                      />
                    ))}
                  </datalist>
                  {setting.models.length ? (
                    <select
                      aria-label={`${meta.label} 조회된 모델 ID`}
                      value={
                        setting.models.some(
                          (model) => model.id === setting.preferences.model,
                        )
                          ? setting.preferences.model
                          : ""
                      }
                      onChange={(event) =>
                        updateSetting(setting.tier, (current) => ({
                          ...current,
                          preferences: {
                            ...current.preferences,
                            model: event.target.value,
                          },
                        }))
                      }
                      className="mt-2 min-h-12 w-full rounded-xl border border-[#ccc8bf] bg-white px-4 text-sm font-bold outline-none focus:ring-2 focus:ring-[#b97838]"
                    >
                      <option value="">조회된 모델을 선택하세요</option>
                      {setting.models.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.name === model.id
                            ? model.id
                            : `${model.name} (${model.id})`}
                        </option>
                      ))}
                    </select>
                  ) : null}
                </label>

                <label className="text-sm font-extrabold text-[#34483f] sm:col-span-2">
                  {preset.keyLabel}
                  <input
                    type="password"
                    value={setting.apiKey}
                    autoComplete="new-password"
                    spellCheck={false}
                    onChange={(event) =>
                      updateSetting(setting.tier, (current) => ({
                        ...current,
                        apiKey: event.target.value,
                        clearApiKey: false,
                      }))
                    }
                    placeholder={
                      setting.apiKeyConfigured
                        ? "교체할 때만 새 API 키 입력"
                        : "API 키 입력"
                    }
                    className="mt-2 min-h-12 w-full rounded-xl border border-[#ccc8bf] bg-white px-4 font-mono text-sm outline-none focus:ring-2 focus:ring-[#b97838]"
                  />
                </label>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white px-4 py-3 text-xs font-semibold text-[#596861]">
                <span>
                  API 키 ·{" "}
                  <strong
                    className={
                      setting.apiKey || setting.apiKeyConfigured
                        ? "text-[#2d744c]"
                        : "text-[#a05235]"
                    }
                  >
                    {keyStatus}
                  </strong>
                </span>
                {setting.apiKeyConfigured ? (
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={setting.clearApiKey}
                      onChange={(event) =>
                        updateSetting(setting.tier, (current) => ({
                          ...current,
                          clearApiKey: event.target.checked,
                          apiKey: event.target.checked ? "" : current.apiKey,
                        }))
                      }
                      className="accent-[#9a4b38]"
                    />
                    등록된 키 삭제
                  </label>
                ) : (
                  <code>{setting.apiKeyEnvironmentName}</code>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {saveFeedback ? (
        <p
          role={saveFeedback.type === "error" ? "alert" : "status"}
          aria-live={saveFeedback.type === "error" ? "assertive" : "polite"}
          className={`mt-7 rounded-xl px-4 py-3 text-sm font-semibold ${
            saveFeedback.type === "error"
              ? "bg-[#fff0ea] text-[#984d34]"
              : "bg-[#edf7f0] text-[#2f6948]"
          }`}
        >
          {saveFeedback.message}
        </p>
      ) : null}

      <button
        type="button"
        onClick={() => void save()}
        disabled={saving || !encryptionConfigured}
        className={`${saveFeedback ? "mt-3" : "mt-7"} min-h-14 w-full rounded-2xl bg-[#172b24] px-6 text-base font-extrabold text-white shadow-[0_12px_25px_rgba(16,23,20,.18)] hover:bg-[#234438] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#d7a363] disabled:opacity-50`}
      >
        {saving
          ? "저장 중…"
          : saveFeedback?.type === "success"
            ? "저장 완료"
            : "세 엔진 설정 저장"}
      </button>
    </section>
  );
}
