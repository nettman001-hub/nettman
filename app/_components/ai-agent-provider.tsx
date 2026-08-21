"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  AI_AGENT_MAX_MESSAGES,
  type AgentActionProposal,
  type AiAgentApiRequest,
  type AiAgentApiResponse,
  type AiAgentMessage,
  type AiAgentPageContext,
} from "@/app/_lib/ai-agent-contract";
import {
  isAiEngineTier,
  type AiEngineTier,
} from "@/app/_lib/ai-engine-tiers";
import { notifyTokenWalletChanged } from "@/app/_lib/token-wallet-events";

const AI_AGENT_TIER_STORAGE_KEY = "logos-ai:agent-tier:v1";

export type AiAgentActionResult = {
  message?: string;
};

export type AiAgentPageRegistration = AiAgentPageContext & {
  suggestions?: readonly string[];
  executeAction?: (
    proposal: AgentActionProposal,
  ) => Promise<AiAgentActionResult>;
};

type UiAiAgentMessage = AiAgentMessage & {
  contextSignature?: string;
};

type WorkspaceRegistration = {
  authenticated: boolean;
  userScope?: string;
};

type ProposalState = "applying" | "applied" | "dismissed";

type AiAgentContextValue = {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  page: AiAgentPageRegistration | null;
  authenticated: boolean;
  messages: readonly UiAiAgentMessage[];
  tier: AiEngineTier;
  setTier: (tier: AiEngineTier) => void;
  pending: boolean;
  error: string | null;
  proposalStates: Readonly<Record<string, ProposalState>>;
  sendMessage: (content: string) => Promise<void>;
  stopResponse: () => void;
  applyProposal: (proposal: AgentActionProposal) => Promise<void>;
  dismissProposal: (proposalId: string) => void;
  clearConversation: () => void;
  registerPage: (page: AiAgentPageRegistration) => () => void;
  registerWorkspace: (workspace: WorkspaceRegistration) => () => void;
};

const AiAgentContext = createContext<AiAgentContextValue | null>(null);

function newIdentifier(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `agent-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function contextSignature(context: AiAgentPageContext): string {
  const snapshot = JSON.stringify(context.snapshot);
  let hash = 2_166_136_261;
  for (let index = 0; index < snapshot.length; index += 1) {
    hash ^= snapshot.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return JSON.stringify([
    context.surface,
    context.resourceId ?? "",
    context.version ?? "",
    (hash >>> 0).toString(36),
  ]);
}

function safeClientNavigationHref(value: unknown): value is string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return false;
  }
  try {
    const url = new URL(value, window.location.origin);
    return (
      url.origin === window.location.origin &&
      !/^\/(?:api|admin|auth|tokens)(?:\/|$)/.test(url.pathname)
    );
  } catch {
    return false;
  }
}

function latestMapValue<T>(map: Map<symbol, T>): T | null {
  let latest: T | null = null;
  for (const value of map.values()) latest = value;
  return latest;
}

function activePageRegistration(
  map: Map<symbol, AiAgentPageRegistration>,
): AiAgentPageRegistration | null {
  let latest: AiAgentPageRegistration | null = null;
  let specific: AiAgentPageRegistration | null = null;
  for (const value of map.values()) {
    latest = value;
    if (
      value.resourceId ||
      value.capabilities.some((capability) => capability !== "navigate") ||
      Object.keys(value.snapshot).length > 0
    ) {
      specific = value;
    }
  }
  return specific ?? latest;
}

function requestMessages(messages: readonly UiAiAgentMessage[]) {
  const selected: Array<{ role: "user" | "assistant"; content: string }> = [];
  let characters = 0;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) continue;
    const nextLength = characters + message.content.length;
    if (selected.length >= AI_AGENT_MAX_MESSAGES || nextLength > 12_000) break;
    selected.unshift({ role: message.role, content: message.content });
    characters = nextLength;
  }

  return selected;
}

function responseError(status: number, body: unknown): string {
  if (
    body &&
    typeof body === "object" &&
    "error" in body &&
    typeof body.error === "string" &&
    body.error.trim()
  ) {
    return body.error;
  }
  if (status === 401) return "로그인 후 AI 에이전트를 이용해 주세요.";
  if (status === 402) return "토큰이 부족합니다. 토큰을 충전한 뒤 다시 시도해 주세요.";
  if (status === 429) return "요청이 많습니다. 잠시 뒤 다시 시도해 주세요.";
  return "AI 에이전트가 응답하지 못했습니다. 잠시 뒤 다시 시도해 주세요.";
}

export function AiAgentProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [page, setPage] = useState<AiAgentPageRegistration | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceRegistration | null>(null);
  const [messages, setMessages] = useState<UiAiAgentMessage[]>([]);
  const [tier, setTierState] = useState<AiEngineTier>("basic");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposalStates, setProposalStates] = useState<
    Record<string, ProposalState>
  >({});
  const pageRegistrations = useRef(new Map<symbol, AiAgentPageRegistration>());
  const workspaceRegistrations = useRef(
    new Map<symbol, WorkspaceRegistration>(),
  );
  const sessionIdRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const userScopeRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(AI_AGENT_TIER_STORAGE_KEY);
      if (isAiEngineTier(saved)) setTierState(saved);
    } catch {
      // Browser privacy modes may reject localStorage. The default still works.
    }
  }, []);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const setTier = useCallback((nextTier: AiEngineTier) => {
    setTierState(nextTier);
    try {
      window.localStorage.setItem(AI_AGENT_TIER_STORAGE_KEY, nextTier);
    } catch {
      // Keeping the in-memory selection is sufficient when storage is blocked.
    }
  }, []);

  const registerPage = useCallback((nextPage: AiAgentPageRegistration) => {
    const registrationId = Symbol("ai-agent-page");
    pageRegistrations.current.set(registrationId, nextPage);
    setPage(activePageRegistration(pageRegistrations.current));
    return () => {
      pageRegistrations.current.delete(registrationId);
      setPage(activePageRegistration(pageRegistrations.current));
    };
  }, []);

  const registerWorkspace = useCallback(
    (nextWorkspace: WorkspaceRegistration) => {
      const registrationId = Symbol("ai-agent-workspace");
      workspaceRegistrations.current.set(registrationId, nextWorkspace);
      setWorkspace(nextWorkspace);

      if (userScopeRef.current !== nextWorkspace.userScope) {
        abortRef.current?.abort();
        sessionIdRef.current = null;
        userScopeRef.current = nextWorkspace.userScope;
        setMessages([]);
        setProposalStates({});
        setError(null);
      }

      return () => {
        workspaceRegistrations.current.delete(registrationId);
        setWorkspace(latestMapValue(workspaceRegistrations.current));
      };
    },
    [],
  );

  const close = useCallback(() => setIsOpen(false), []);
  const open = useCallback(() => setIsOpen(true), []);
  const toggle = useCallback(() => setIsOpen((current) => !current), []);

  const stopResponse = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPending(false);
    setError("응답 생성을 중지했습니다. 진행 중인 설교 생성은 계속됩니다.");
    window.setTimeout(() => notifyTokenWalletChanged(), 1_200);
  }, []);

  const sendMessage = useCallback(
    async (rawContent: string) => {
      const content = rawContent.trim();
      if (!content || pending) return;
      if (!workspace?.authenticated) {
        setError("로그인 후 AI 에이전트를 이용해 주세요.");
        return;
      }
      if (!page) {
        setError("현재 화면을 AI 에이전트에 연결하지 못했습니다.");
        return;
      }

      const userMessage: UiAiAgentMessage = {
        id: newIdentifier(),
        role: "user",
        content: content.slice(0, 2_000),
        createdAt: new Date().toISOString(),
      };
      const nextMessages = [...messages, userMessage];
      const messageId = newIdentifier();
      const controller = new AbortController();
      abortRef.current?.abort();
      abortRef.current = controller;
      sessionIdRef.current ??= newIdentifier();
      setMessages(nextMessages);
      setPending(true);
      setError(null);

      const request: AiAgentApiRequest = {
        sessionId: sessionIdRef.current,
        messageId,
        tier,
        context: {
          surface: page.surface,
          title: page.title,
          ...(page.resourceId ? { resourceId: page.resourceId } : {}),
          ...(page.version !== undefined ? { version: page.version } : {}),
          snapshot: page.snapshot,
          capabilities: page.capabilities,
        },
        messages: requestMessages(nextMessages),
      };

      try {
        const response = await fetch("/api/ai-agent", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
          signal: controller.signal,
        });
        const body = (await response.json().catch(() => null)) as
          | AiAgentApiResponse
          | {
              error?: string;
              wallet?: {
                balance: number;
                lifetimeSpent: number;
              };
            }
          | null;
        if (body && typeof body === "object" && "wallet" in body && body.wallet) {
          notifyTokenWalletChanged(body.wallet);
        }
        if (!response.ok || !body || !("answer" in body)) {
          throw new Error(responseError(response.status, body));
        }
        const assistantMessage: UiAiAgentMessage = {
          id: body.messageId || messageId,
          role: "assistant",
          content: body.answer,
          ...(body.proposal ? { proposal: body.proposal } : {}),
          createdAt: new Date().toISOString(),
          contextSignature: contextSignature(page),
        };
        setMessages((current) => [...current, assistantMessage]);
      } catch (requestError) {
        if (controller.signal.aborted) return;
        setError(
          requestError instanceof Error
            ? requestError.message
            : "AI 에이전트 요청을 처리하지 못했습니다.",
        );
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        if (!controller.signal.aborted) setPending(false);
      }
    },
    [messages, page, pending, tier, workspace?.authenticated],
  );

  const applyProposal = useCallback(
    async (proposal: AgentActionProposal) => {
      if (!page || !page.capabilities.includes(proposal.capability)) {
        setError("화면 내용이 바뀌었습니다. 현재 화면에서 다시 요청해 주세요.");
        return;
      }
      const sourceMessage = messages.find(
        (message) => message.proposal?.id === proposal.id,
      );
      if (
        sourceMessage?.contextSignature &&
        sourceMessage.contextSignature !== contextSignature(page)
      ) {
        setError("작업 대상이 바뀌었습니다. 현재 화면에서 다시 검토해 주세요.");
        return;
      }

      setProposalStates((current) => ({
        ...current,
        [proposal.id]: "applying",
      }));
      setError(null);
      try {
        let result: AiAgentActionResult = {};
        if (page.executeAction) {
          result = await page.executeAction(proposal);
        } else if (
          proposal.capability === "navigate" &&
          safeClientNavigationHref(proposal.args.href)
        ) {
          router.push(proposal.args.href);
          result = { message: "요청한 화면으로 이동했습니다." };
        } else {
          throw new Error("이 화면은 아직 해당 변경 작업을 지원하지 않습니다.");
        }
        setProposalStates((current) => ({
          ...current,
          [proposal.id]: "applied",
        }));
        if (result.message) {
          setMessages((current) => [
            ...current,
            {
              id: newIdentifier(),
              role: "assistant",
              content: result.message ?? "작업을 적용했습니다.",
              createdAt: new Date().toISOString(),
            },
          ]);
        }
      } catch (applyError) {
        setProposalStates((current) => {
          const next = { ...current };
          delete next[proposal.id];
          return next;
        });
        setError(
          applyError instanceof Error
            ? applyError.message
            : "제안한 작업을 적용하지 못했습니다.",
        );
      }
    },
    [messages, page, router],
  );

  const dismissProposal = useCallback((proposalId: string) => {
    setProposalStates((current) => ({
      ...current,
      [proposalId]: "dismissed",
    }));
  }, []);

  const clearConversation = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    sessionIdRef.current = null;
    setMessages([]);
    setProposalStates({});
    setPending(false);
    setError(null);
  }, []);

  const value = useMemo<AiAgentContextValue>(
    () => ({
      isOpen,
      open,
      close,
      toggle,
      page,
      authenticated: Boolean(workspace?.authenticated),
      messages,
      tier,
      setTier,
      pending,
      error,
      proposalStates,
      sendMessage,
      stopResponse,
      applyProposal,
      dismissProposal,
      clearConversation,
      registerPage,
      registerWorkspace,
    }),
    [
      applyProposal,
      clearConversation,
      close,
      dismissProposal,
      error,
      isOpen,
      messages,
      open,
      page,
      pending,
      proposalStates,
      registerPage,
      registerWorkspace,
      sendMessage,
      setTier,
      stopResponse,
      tier,
      toggle,
      workspace?.authenticated,
    ],
  );

  return (
    <AiAgentContext.Provider value={value}>
      {children}
    </AiAgentContext.Provider>
  );
}

export function useAiAgent(): AiAgentContextValue {
  const context = useContext(AiAgentContext);
  if (!context) {
    throw new Error("useAiAgent must be used inside AiAgentProvider");
  }
  return context;
}

export function useRegisterAiAgentPage(
  registration: AiAgentPageRegistration | null,
): void {
  const { registerPage } = useAiAgent();
  useEffect(() => {
    if (!registration) return;
    return registerPage(registration);
  }, [registerPage, registration]);
}

export function useRegisterAiAgentWorkspace(
  registration: WorkspaceRegistration,
): void {
  const { registerWorkspace } = useAiAgent();
  useEffect(
    () => registerWorkspace(registration),
    [registerWorkspace, registration],
  );
}
