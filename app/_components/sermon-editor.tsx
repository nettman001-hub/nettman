"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { requestSermonRevision } from "@/app/_lib/sermon-client";
import {
  addSermonToHistory,
  sermonDraftUrl,
} from "@/app/_lib/sermon-store";
import {
  isSermonAlternative,
  sermonPlainText,
  type SermonRevision,
} from "@/app/_lib/sermon-types";
import {
  OptionBadges,
  SermonGuestGate,
  SermonLoading,
  SermonStateCard,
  useSermonWorkflow,
} from "./sermon-workflow";
import { useRegisterAiAgentPage } from "./ai-agent-provider";

const SECTION_OPTIONS: Array<{
  value: SermonRevision["section"];
  label: string;
}> = [
  { value: "introduction", label: "도입" },
  { value: "body", label: "본론" },
  { value: "conclusion", label: "결론" },
  { value: "application", label: "적용" },
];

function Paragraphs({ text }: { text: string }) {
  return (
    <>
      {text.split(/\n{2,}/).map((paragraph) => (
        <p key={paragraph.slice(0, 60)}>{paragraph}</p>
      ))}
    </>
  );
}

function sectionName(section: SermonRevision["section"]): string {
  return SECTION_OPTIONS.find((item) => item.value === section)?.label ?? section;
}

export function SermonEditor() {
  const router = useRouter();
  const {
    draft,
    ready,
    isGuest,
    clientUserScope,
    replaceDraft,
    updateDraft,
  } = useSermonWorkflow();
  const [section, setSection] = useState<SermonRevision["section"]>("body");
  const [instruction, setInstruction] = useState("");
  const [toneAdjustment, setToneAdjustment] = useState("");
  const [revising, setRevising] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [view, setView] = useState<"current" | "previous">("current");
  const [completing, setCompleting] = useState(false);

  const selected = useMemo(() => {
    if (!draft) return null;
    const latest = draft.versions.at(-1)?.sermon;
    return (
      latest ??
      draft.alternatives.find((item) => item.id === draft.selectedAlternativeId) ??
      null
    );
  }, [draft]);
  const previous = draft && draft.versions.length > 1 ? draft.versions.at(-2)?.sermon : null;
  const displayed = view === "previous" && previous ? previous : selected;
  const remaining = Math.max(0, 3 - (draft?.revisionCount ?? 0));
  const instructionValid = instruction.trim().length >= 10;

  const agentRegistration = useMemo(() => {
    if (!ready || !draft || !selected) return null;
    return {
      surface: "sermon.edit" as const,
      title: "설교 원고 검토와 수정",
      resourceId: draft.id,
      version: draft.updatedAt,
      snapshot: {
        draftId: draft.id,
        sermon: {
          id: selected.id,
          title: selected.title,
          summary: selected.summary,
          scripture: selected.scripture,
          introduction: selected.sections.introduction.slice(0, 3_000),
          points: selected.sections.points.map((point) => ({
            title: point.heading,
            content: point.content.slice(0, 3_000),
          })),
          conclusion: selected.sections.conclusion.slice(0, 3_000),
          application: selected.sections.application.slice(0, 3_000),
        },
        options: draft.options,
        revisionCount: draft.revisionCount,
        selectedSection: section,
        generationStatus: revising ? "revising" : "idle",
      },
      capabilities: ["navigate", "sermon.revision.prepare"] as Array<
        "navigate" | "sermon.revision.prepare"
      >,
      suggestions: [
        "현재 원고의 강점과 보완점을 진단해줘",
        "선택한 부분을 더 선명하게 다듬는 수정 지시를 제안해줘",
        "본문과 적용이 자연스럽게 이어지는지 검토해줘",
      ],
      executeAction: async (proposal: {
        capability: string;
        args: Record<string, unknown>;
      }) => {
        if (proposal.capability !== "sermon.revision.prepare") {
          throw new Error("현재 화면에서는 이 작업을 적용할 수 없습니다.");
        }
        if (revising || completing) {
          throw new Error("현재 진행 중인 작업이 끝난 뒤 수정 지시를 준비해 주세요.");
        }
        if (remaining === 0) {
          throw new Error("사용 가능한 AI 수정 횟수를 모두 사용했습니다.");
        }
        const nextSection = proposal.args.section;
        const nextInstruction = proposal.args.instruction;
        const nextTone = proposal.args.toneAdjustment;
        if (
          typeof nextSection !== "string" ||
          !SECTION_OPTIONS.some((item) => item.value === nextSection)
        ) {
          throw new Error("수정할 부분을 도입, 본론, 결론, 적용 중에서 선택해 주세요.");
        }
        if (
          typeof nextInstruction !== "string" ||
          nextInstruction.trim().length < 10 ||
          nextInstruction.length > 1_000
        ) {
          throw new Error("수정 지시는 10자 이상 1,000자 이하로 입력해 주세요.");
        }
        const allowedTones = [
          "",
          "더 부드럽게",
          "더 도전적으로",
          "더 간결하게",
          "더 구체적으로",
        ];
        if (
          nextTone !== undefined &&
          (typeof nextTone !== "string" || !allowedTones.includes(nextTone))
        ) {
          throw new Error("감정선 조정값을 화면에서 제공하는 항목 중 선택해 주세요.");
        }
        setSection(nextSection as SermonRevision["section"]);
        setInstruction(nextInstruction.trim());
        setToneAdjustment(typeof nextTone === "string" ? nextTone : "");
        setError("");
        setNotice("");
        return {
          message:
            "수정 지시를 입력란에 준비했습니다. 내용을 확인한 뒤 ‘AI로 수정하기’를 눌러 주세요.",
        };
      },
    };
  }, [completing, draft, ready, remaining, revising, section, selected]);

  useRegisterAiAgentPage(agentRegistration);

  if (!ready) return <SermonLoading />;
  if (!draft) {
    return (
      <SermonStateCard
        title="수정할 설교를 찾지 못했습니다"
        description="다섯 개 대안 중 한 편을 먼저 선택해 주세요."
      />
    );
  }
  if (isGuest) {
    return <SermonGuestGate returnTo={sermonDraftUrl("/sermon/edit", draft.id)} />;
  }
  if (!selected || !displayed) {
    return (
      <SermonStateCard
        title="선택한 설교가 없습니다"
        description="대안 목록에서 한 편을 선택해야 수정할 수 있습니다."
        href={sermonDraftUrl("/sermon/alternatives", draft.id)}
        action="대안 선택으로"
      />
    );
  }

  const revise = async () => {
    setError("");
    setNotice("");
    if (!instructionValid || remaining === 0 || revising || completing) return;
    setRevising(true);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 250_000);
    try {
      const result = await requestSermonRevision(
        {
          draftId: draft.id,
          sermon: selected,
          options: draft.options,
          section,
          instruction: instruction.trim(),
          toneAdjustment,
          revisionCount: draft.revisionCount,
        },
        controller.signal,
        clientUserScope ?? null,
      );
      if (!isSermonAlternative(result.sermon)) {
        throw new Error("수정 결과의 구조가 올바르지 않습니다. 다시 시도해 주세요.");
      }
      const revision: SermonRevision = {
        id: `revision-log-${Date.now()}`,
        section,
        instruction: instruction.trim(),
        toneAdjustment,
        createdAt: new Date().toISOString(),
      };
      // 이 성공 분기에서만 횟수를 차감합니다. 실패·타임아웃은 기존 상태를 유지합니다.
      updateDraft((current) => ({
        ...current,
        stage: "editing",
        revisionCount: current.revisionCount + 1,
        revisions: [...current.revisions, revision],
        versions: [
          ...current.versions,
          {
            id: `version-${Date.now()}`,
            sermon: result.sermon,
            instruction: revision.instruction,
            createdAt: revision.createdAt,
          },
        ],
      }));
      setInstruction("");
      setToneAdjustment("");
      setView("current");
      setNotice(
        remaining === 1
          ? "세 번째 수정을 반영했습니다. 이제 최종 원고를 확인해 주세요."
          : `수정을 반영했습니다. 수정 기회가 ${remaining - 1}회 남았습니다.`,
      );
    } catch (caught) {
      setError(
        caught instanceof DOMException && caught.name === "AbortError"
          ? "전체 수정 요청이 250초를 넘겼습니다. 횟수는 차감되지 않았습니다."
          : `${caught instanceof Error ? caught.message : "수정하지 못했습니다."} 횟수는 차감되지 않았습니다.`,
      );
    } finally {
      window.clearTimeout(timeout);
      setRevising(false);
    }
  };

  const complete = async () => {
    if (sermonPlainText(selected).trim().length < 10) {
      setError("설교 본문이 너무 짧아 완료할 수 없습니다.");
      return;
    }
    if (completing) return;
    setCompleting(true);
    setError("");
    const completedAt = new Date().toISOString();
    let savedSermonId: string | null = null;
    let saveMode: "server" | "local" = "server";
    let serverError = "";
    const saveController = new AbortController();
    const saveTimeout = window.setTimeout(() => saveController.abort(), 15_000);
    try {
      const response = await fetch("/api/sermons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftId: draft.id,
          title: selected.title,
          scripture: selected.scripture,
          sermonType: draft.options.sermonType,
          audience: draft.options.audience,
          audienceSituation: draft.options.audienceSituation,
          pointCount: selected.sections.points.length,
          duration: draft.options.duration,
          emotion: draft.options.tone,
          sections: {
            introduction: selected.sections.introduction,
            body: selected.sections.points,
            conclusion: selected.sections.conclusion,
            application: selected.sections.application,
          },
          createdAt: draft.createdAt,
        }),
        signal: saveController.signal,
      });
      const body = (await response.json().catch(() => null)) as
        | { item?: { id?: string }; error?: string }
        | null;
      if (!response.ok || !body?.item?.id) {
        throw new Error(body?.error || "서버 히스토리에 저장하지 못했습니다.");
      }
      savedSermonId = body.item.id;
    } catch (caught) {
      saveMode = "local";
      serverError =
        caught instanceof DOMException && caught.name === "AbortError"
          ? "서버 저장 시간이 초과되었습니다."
          : caught instanceof Error
          ? caught.message
          : "서버 히스토리에 저장하지 못했습니다.";
    } finally {
      window.clearTimeout(saveTimeout);
    }

    const completed = replaceDraft({
      ...draft,
      stage: "completed",
      completedAt,
      savedSermonId,
      saveMode,
    });
    if (saveMode === "local") {
      try {
        addSermonToHistory(completed);
      } catch {
        setError("서버와 브라우저 모두에 저장하지 못했습니다. 저장 공간을 확인한 뒤 다시 시도해 주세요.");
        setCompleting(false);
        return;
      }
      window.sessionStorage.setItem(
        `sermon-guide:save-warning:${draft.id}`,
        serverError,
      );
    } else {
      try {
        await fetch("/api/notifications/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sermonId: savedSermonId, title: selected.title }),
          keepalive: true,
        });
        if ("Notification" in window && window.Notification.permission === "granted") {
          new window.Notification("로고스AI", {
            body: `설교 ‘${selected.title}’이 완성되어 저장되었습니다.`,
            icon: "/favicon.svg",
            tag: `sermon-complete-${savedSermonId}`,
          });
        }
      } catch {
        window.sessionStorage.setItem(
          `sermon-guide:notification-warning:${draft.id}`,
          "설교는 저장되었지만 완성 알림을 예약하지 못했습니다.",
        );
      }
    }
    window.dispatchEvent(
      new CustomEvent("sermon:completed", {
        detail: { draftId: completed.id, completedAt },
      }),
    );
    router.push(sermonDraftUrl("/sermon/complete", draft.id));
  };

  return (
    <div className="sermon-editor-page">
      <section className="sermon-form-intro sermon-editor-intro">
        <div>
          <p className="sermon-eyebrow">Step 04 · Refine</p>
          <h2>설교자의 언어로 차분히 다듬어 주세요</h2>
          <p>
            원하는 부분과 방향을 구체적으로 적어 주세요. 성공한 수정만 횟수에
            반영되며, 세 번 전에도 언제든 완성할 수 있습니다.
          </p>
          <OptionBadges draft={draft} />
        </div>
        <div className="sermon-revision-meter" aria-label={`남은 수정 ${remaining}회`}>
          <strong>{remaining}</strong>
          <span>남은 수정</span>
          <div aria-hidden="true">
            {[0, 1, 2].map((index) => (
              <i key={index} className={index < remaining ? "is-available" : ""} />
            ))}
          </div>
        </div>
      </section>

      <div className="sermon-editor-grid">
        <aside className="sermon-editor-tools">
          <nav aria-label="설교 원고 섹션">
            <p className="sermon-eyebrow">Manuscript</p>
            <h3>원고 목차</h3>
            <a href="#editor-introduction">도입</a>
            <a href="#editor-body">본론</a>
            <a href="#editor-conclusion">결론</a>
            <a href="#editor-application">적용</a>
          </nav>

          {draft.revisions.length ? (
            <section className="sermon-revision-history" aria-labelledby="revision-history-title">
              <h3 id="revision-history-title">수정 지시 내역</h3>
              <ol>
                {draft.revisions.map((revision, index) => (
                  <li key={revision.id}>
                    <span>{index + 1}</span>
                    <div>
                      <strong>{sectionName(revision.section)}</strong>
                      <p>{revision.instruction}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
        </aside>

        <div className="sermon-editor-main">
          <section className="sermon-version-toolbar" aria-label="설교 버전 선택">
            <div>
              <span className="sermon-live-dot" aria-hidden="true" />
              <strong>{view === "previous" ? "이전 버전" : `현재 버전 · v${draft.versions.length}`}</strong>
            </div>
            {previous ? (
              <div className="sermon-segmented-control">
                <button
                  type="button"
                  className={view === "previous" ? "is-active" : ""}
                  onClick={() => setView("previous")}
                >
                  이전
                </button>
                <button
                  type="button"
                  className={view === "current" ? "is-active" : ""}
                  onClick={() => setView("current")}
                >
                  최신
                </button>
              </div>
            ) : null}
          </section>

          <article className="sermon-manuscript sermon-editor-manuscript">
            <header className="sermon-manuscript-title">
              <p>{displayed.scripture}</p>
              <h3>{displayed.title}</h3>
              {view === "previous" ? <span className="sermon-version-label">읽기 전용 이전 원고</span> : null}
            </header>
            <section id="editor-introduction">
              <span>01</span>
              <div>
                <h4>도입</h4>
                <Paragraphs text={displayed.sections.introduction} />
              </div>
            </section>
            <section id="editor-body">
              <span>02</span>
              <div>
                <h4>본론</h4>
                {displayed.sections.points.map((point, index) => (
                  <div className="sermon-manuscript-point" key={point.heading}>
                    <h5>
                      {index + 1}. {point.heading}
                    </h5>
                    <Paragraphs text={point.content} />
                  </div>
                ))}
              </div>
            </section>
            <section id="editor-conclusion">
              <span>03</span>
              <div>
                <h4>결론</h4>
                <Paragraphs text={displayed.sections.conclusion} />
              </div>
            </section>
            <section id="editor-application">
              <span>04</span>
              <div>
                <h4>적용</h4>
                <Paragraphs text={displayed.sections.application} />
              </div>
            </section>
          </article>
        </div>
      </div>

      <section className="sermon-revision-composer" aria-labelledby="revision-composer-title">
        <div className="sermon-section-heading">
          <span>수정</span>
          <div>
            <h3 id="revision-composer-title">어떻게 다듬을까요?</h3>
            <p>한 번에 한 가지 핵심 방향을 10자 이상으로 적으면 결과가 선명해집니다.</p>
          </div>
        </div>
        <div className="sermon-revision-fields">
          <div className="sermon-field">
            <label htmlFor="revision-section">수정할 부분</label>
            <select
              id="revision-section"
              value={section}
              onChange={(event) => setSection(event.target.value as SermonRevision["section"])}
              disabled={remaining === 0 || revising || completing}
            >
              {SECTION_OPTIONS.map((item) => (
                <option value={item.value} key={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
          <div className="sermon-field">
            <label htmlFor="tone-adjustment">감정선 조정</label>
            <select
              id="tone-adjustment"
              value={toneAdjustment}
              onChange={(event) => setToneAdjustment(event.target.value)}
              disabled={remaining === 0 || revising || completing}
            >
              <option value="">현재 감정선 유지</option>
              <option value="더 부드럽게">더 부드럽게</option>
              <option value="더 도전적으로">더 도전적으로</option>
              <option value="더 간결하게">더 간결하게</option>
              <option value="더 구체적으로">더 구체적으로</option>
            </select>
          </div>
          <div className="sermon-field is-full">
            <label htmlFor="revision-instruction">수정 내용</label>
            <textarea
              id="revision-instruction"
              value={instruction}
              minLength={10}
              maxLength={1_000}
              rows={5}
              disabled={remaining === 0 || revising || completing}
              onChange={(event) => setInstruction(event.target.value)}
              placeholder="예: 본론의 문제 해결 부분에 복음의 원리를 더 구체적으로 설명해 주세요."
              aria-describedby="revision-help"
            />
            <div className="sermon-field-meta" id="revision-help">
              <span>
                {remaining === 0
                  ? "수정 기회를 모두 사용했습니다. 최신 원고를 확인한 뒤 완성해 주세요."
                  : instruction.length > 0 && instruction.length < 10
                    ? `${10 - instruction.length}자 더 입력해 주세요.`
                    : "실패한 요청은 수정 횟수에서 차감되지 않습니다."}
              </span>
              <span>{instruction.length}/1,000</span>
            </div>
          </div>
        </div>
        {error ? (
          <div className="sermon-inline-alert is-error" role="alert">
            <div>
              <strong>수정 결과를 받지 못했습니다</strong>
              <p>{error}</p>
            </div>
            <button type="button" disabled={revising} onClick={() => void revise()}>
              다시 시도
            </button>
          </div>
        ) : null}
        {notice ? (
          <div className="sermon-inline-alert is-success" role="status" aria-live="polite">
            <strong>{notice}</strong>
          </div>
        ) : null}
        <div className="sermon-revision-actions">
          <button
            className="sermon-button is-secondary"
            type="button"
            disabled={revising || completing}
            onClick={() => router.push(sermonDraftUrl("/sermon/alternatives", draft.id))}
          >
            다른 설교 선택
          </button>
          <div className="sermon-button-row">
            <button
              className="sermon-button is-secondary"
              type="button"
              disabled={!instructionValid || remaining === 0 || revising || completing}
              onClick={() => void revise()}
            >
              {revising ? "수정 반영 중…" : `수정 요청 · ${remaining}회 남음`}
            </button>
            <button
              className="sermon-button is-primary"
              type="button"
              disabled={revising || completing}
              onClick={() => void complete()}
            >
              {completing ? "히스토리에 저장 중…" : "이대로 완성"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
