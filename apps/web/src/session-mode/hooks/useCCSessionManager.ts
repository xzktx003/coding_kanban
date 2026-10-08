import { toast } from "sonner";
import { useCallback, useRef } from "react";
import { fromSdkMessages } from "@session/components/cc/utils/fromSdkMessages";
import { refreshClaudeHistory } from "@session/services/followedSessionAuxSync";
import {
  ccGetSessionMessages,
  ccNewSession,
  ccResumeSession,
  ccSendMessage,
} from "@session/services";
import { gitCreateWorktree } from "@session/services/apiAdapt/git";
import { type CCOptions, useCCStore } from "@session/stores/cc";
import { useAgentCenterStore } from "@session/stores/useAgentCenterStore";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import { useAgentSettingsStore } from "@session/stores/useAgentSettingsStore";
import { useAcpStore } from "@session/stores/useAcpStore";
import type { CcAgentOptionsPayload } from "@session/types/cc/agentOptions";
import {
  CC_LISTENER_READY_EVENT,
  CC_PERMISSION_LISTENER_READY_EVENT,
  isCCListenerReady,
} from "@session/lib/ccListenerReadiness";

const LISTENER_READY_TIMEOUT_MS = 5000;

/**
 * Resolves once the listener for `eventName` reports readiness for `sessionId`,
 * or after `timeoutMs` as a safety net. Resolves with `false` when it timed out.
 */
function waitForListenerReady(
  eventName: string,
  sessionId: string,
  timeoutMs = LISTENER_READY_TIMEOUT_MS,
): Promise<boolean> {
  return new Promise((resolve) => {
    if (
      typeof window === "undefined" ||
      isCCListenerReady(eventName, sessionId)
    ) {
      resolve(true);
      return;
    }

    let done = false;
    const finish = (ready: boolean) => {
      if (done) return;
      done = true;
      window.removeEventListener(eventName, handleReady as EventListener);
      clearTimeout(timer);
      resolve(ready);
    };

    const handleReady = (event: Event) => {
      const customEvent = event as CustomEvent<{ sessionId?: string }>;
      if (customEvent.detail?.sessionId === sessionId) {
        finish(true);
      }
    };

    const timer = setTimeout(() => finish(false), timeoutMs);
    window.addEventListener(eventName, handleReady as EventListener);
  });
}

/** Waits for both the message and permission listeners of a session. */
async function waitForListeners(sessionId: string): Promise<void> {
  // Let React flush the effects that bind the listeners for this session.
  await new Promise((resolve) => setTimeout(resolve, 0));

  const [messageReady, permissionReady] = await Promise.all([
    waitForListenerReady(CC_LISTENER_READY_EVENT, sessionId),
    waitForListenerReady(CC_PERMISSION_LISTENER_READY_EVENT, sessionId),
  ]);

  if (!messageReady || !permissionReady) {
    throw new Error("消息连接尚未就绪，输入已保留，请重试");
  }
}

const OPTIONAL_OPTION_KEYS = [
  "fallbackModel",
  "maxTurns",
  "maxBudgetUsd",
  "maxThinkingTokens",
  "allowedTools",
  "disallowedTools",
] as const;

/** Builds the payload shared by `cc_new_session` and `cc_resume_session`. */
function buildAgentOptions(
  options: CCOptions,
  cwd: string,
  extra?: Partial<CcAgentOptionsPayload>,
): CcAgentOptionsPayload {
  const payload: CcAgentOptionsPayload = {
    cwd,
    permissionMode: options.permissionMode,
    ...extra,
  };

  // Only include model/effort if specified (otherwise use CLI default)
  if (options.model) payload.model = options.model;
  if (options.effort) payload.effort = options.effort;

  for (const key of OPTIONAL_OPTION_KEYS) {
    const value = options[key];
    if (value !== undefined) {
      Object.assign(payload, { [key]: value });
    }
  }

  return payload;
}

/**
 * Custom hook for managing Claude Code sessions
 * Handles session creation, resumption, and selection
 */
export function useCCSessionManager() {
  // Select per field: subscribing to the whole store re-renders every consumer
  // of this hook on any CC state change (messages streaming in, etc.).
  const options = useCCStore((s) => s.options);
  const isLoading = useCCStore((s) => s.isLoading);
  const setActiveSessionId = useCCStore((s) => s.setActiveSessionId);
  const setMessages = useCCStore((s) => s.setMessages);
  const setConnected = useCCStore((s) => s.setConnected);
  const setLoading = useCCStore((s) => s.setLoading);
  const setShowExamples = useCCStore((s) => s.setShowExamples);
  const addMessage = useCCStore((s) => s.addMessage);
  const switchToSession = useCCStore((s) => s.switchToSession);
  const setSessionLoading = useCCStore((s) => s.setSessionLoading);
  const setPendingNewSession = useCCStore((s) => s.setPendingNewSession);
  const removeActiveSessionId = useCCStore((s) => s.removeActiveSessionId);
  const addAgentCard = useAgentCenterStore((s) => s.addAgentCard);
  const setCurrentAgentCardId = useAgentCenterStore(
    (s) => s.setCurrentAgentCardId,
  );

  // Guards against concurrent resume/select calls clobbering each other's state.
  const inFlightRef = useRef<string | null>(null);

  const handleNewSession = useCallback(
    async (
      initialMessage?: string,
      initialImages: string[] = [],
      onCreated?: (id: string) => Promise<void>,
    ) => {
      const cwd = useWorkspaceStore.getState().cwd;
      let createdSessionId: string | null = null;
      const originalSessionId = useCCStore.getState().activeSessionId;
      const stillSelected = () =>
        useAgentSettingsStore.getState().selectedAgent === "cc" &&
        !useAcpStore.getState().active &&
        useWorkspaceStore.getState().cwd === cwd &&
        useCCStore.getState().activeSessionId === originalSessionId;
      try {
        setCurrentAgentCardId(null);
        setLoading(true);

        // If no initial message, just reset UI without creating backend session
        // Session will be created when user sends first message
        if (!initialMessage && !initialImages.length) {
          setActiveSessionId(null);
          setMessages([]);
          setConnected(false);
          setShowExamples(false);
          setLoading(false);
          return;
        }

        // Prepare worktree if enabled
        let sessionCwd = cwd;
        let sessionWorktreePath: string | undefined;
        if (options.worktreeMode === "worktree" && cwd?.trim()) {
          const worktreeKey = `cc-${crypto.randomUUID()}`;
          const prepared = await gitCreateWorktree(cwd, worktreeKey);
          sessionCwd = prepared.worktree_path;
          sessionWorktreePath = prepared.worktree_path;
        }

        if (!sessionCwd?.trim()) {
          throw new Error("请先选择项目目录");
        }

        const claudeAgentOptions = buildAgentOptions(options, sessionCwd);
        console.debug("ClaudeAgentOptions", claudeAgentOptions);

        // Backend creates the session and returns a UUID. Set up all state first so
        // the listener is ready before the first message arrives.
        const sessionId = await ccNewSession(claudeAgentOptions);
        createdSessionId = sessionId;

        const activate = stillSelected();
        if (activate) {
          setActiveSessionId(sessionId);
          setMessages([]);
          setShowExamples(false);
          setConnected(true);
        } else useCCStore.getState().addActiveSessionId(sessionId);
        useCCStore.getState().addMessageToSession(sessionId, {
          type: "user",
          text: initialMessage ?? "",
        });
        setSessionLoading(sessionId, true);
        addAgentCard(
          {
            kind: "cc",
            id: sessionId,
            preview: initialMessage,
            worktreePath: sessionWorktreePath,
            cwd: sessionCwd,
          },
          { activate },
        );
        if (activate) setCurrentAgentCardId(sessionId, "cc");
        await onCreated?.(sessionId);
        setPendingNewSession({
          session_id: sessionId,
          summary: initialMessage ?? "",
          last_modified: Date.now(),
          cwd: sessionCwd,
        });

        // Send the initial message only once the listeners are actually bound,
        // otherwise the first streamed events are dropped.
        await waitForListeners(sessionId);
        await ccSendMessage(sessionId, initialMessage ?? "", initialImages);
        return true;

        console.info("[useCCSessionManager] New session created", {
          sessionId,
          permissionMode: options.permissionMode,
        });
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "创建 Claude 会话失败",
        );
        if (
          [originalSessionId, createdSessionId].includes(
            useCCStore.getState().activeSessionId,
          )
        )
          setConnected(false);
        if (createdSessionId) setSessionLoading(createdSessionId, false);
        return false;
      } finally {
        if (
          [originalSessionId, createdSessionId].includes(
            useCCStore.getState().activeSessionId,
          )
        )
          setLoading(false);
      }
    },
    [
      options,
      addAgentCard,
      addMessage,
      setActiveSessionId,
      setConnected,
      setCurrentAgentCardId,
      setLoading,
      setMessages,
      setPendingNewSession,
      setSessionLoading,
      setShowExamples,
    ],
  );

  const handleResumeSession = useCallback(
    async (sessionId: string, projectPath?: string) => {
      if (inFlightRef.current === sessionId) {
        console.info(
          "[useCCSessionManager] Resume already in flight, ignoring",
          { sessionId },
        );
        return;
      }
      inFlightRef.current = sessionId;

      const effectiveCwd = projectPath ?? useWorkspaceStore.getState().cwd;
      try {
        console.info("[useCCSessionManager] Resume session start", {
          sessionId,
          cwd: effectiveCwd,
        });

        if (!effectiveCwd?.trim()) {
          console.error(
            "[useCCSessionManager] Cannot resume session without a working directory",
            {
              sessionId,
            },
          );
          return;
        }

        // Keep the workspace in sync with the session being opened; the composer
        // and the CC view read cwd from the store, not from this call's argument.
        if (useWorkspaceStore.getState().cwd !== effectiveCwd) {
          useWorkspaceStore.getState().setCwd(effectiveCwd);
        }

        setLoading(true);
        setMessages([]);
        setShowExamples(false);

        // Set session ID FIRST to ensure event listener is set up
        setActiveSessionId(sessionId);

        // Restore the transcript: resuming only spawns the client, the backend
        // does not replay past messages over the event stream.
        try {
          const history = await ccGetSessionMessages(sessionId);
          setMessages(fromSdkMessages(history, sessionId));
        } catch (err) {
          console.warn("[useCCSessionManager] Failed to load session history", {
            sessionId,
            err,
          });
        }

        // Wait for CC view listener readiness before replaying historical messages.
        await waitForListeners(sessionId);

        await ccResumeSession(
          sessionId,
          buildAgentOptions(options, effectiveCwd, {
            resume: sessionId,
            continueConversation: true,
          }),
        );
        console.info("[useCCSessionManager] Resume session success", {
          sessionId,
          cwd: effectiveCwd,
        });

        // Session history loaded, but not connected yet
        // Connection will happen when user sends first message
        setConnected(false);
      } catch (error) {
        console.error("[useCCSessionManager] Failed to resume session", {
          sessionId,
          cwd: effectiveCwd,
          error,
        });
        setConnected(false);
        setSessionLoading(sessionId, false);
        // setActiveSessionId already registered this id as "active"; drop it so a
        // later click retries the resume instead of switching to an empty session.
        removeActiveSessionId(sessionId);
      } finally {
        inFlightRef.current = null;
        setLoading(false);
      }
    },
    [
      options,
      setActiveSessionId,
      setConnected,
      setLoading,
      setMessages,
      setSessionLoading,
      setShowExamples,
      removeActiveSessionId,
    ],
  );

  const handleSessionSelect = useCallback(
    async (sessionId: string, projectPath?: string) => {
      console.info("[useCCSessionManager] Session selected", {
        sessionId,
        cwd: projectPath,
      });

      // If session is already active (in activeSessionIds), just switch to it — no backend resume needed
      const currentActiveSessionIds = useCCStore.getState().activeSessionIds;
      if (currentActiveSessionIds.includes(sessionId)) {
        console.info(
          "[useCCSessionManager] Session already active, switching without resume",
          {
            sessionId,
          },
        );
        if (projectPath && useWorkspaceStore.getState().cwd !== projectPath) {
          useWorkspaceStore.getState().setCwd(projectPath);
        }
        switchToSession(sessionId);
        return;
      }

      if (projectPath && useWorkspaceStore.getState().cwd !== projectPath)
        useWorkspaceStore.getState().setCwd(projectPath);
      switchToSession(sessionId);
      if (!useCCStore.getState().sessionMessagesMap[sessionId]?.length)
        await refreshClaudeHistory(sessionId);
    },
    [switchToSession],
  );

  const ensureSessionForSend = useCallback(
    async (sessionId: string, projectPath?: string) => {
      if (useCCStore.getState().activeSessionIds.includes(sessionId)) return;
      const directory = projectPath ?? useWorkspaceStore.getState().cwd;
      if (!directory?.trim()) throw new Error("请选择会话的项目目录");
      const capturedOptions = useCCStore.getState().options;
      await ccResumeSession(
        sessionId,
        buildAgentOptions(capturedOptions, directory, {
          resume: sessionId,
          continueConversation: true,
        }),
      );
      useCCStore.getState().addActiveSessionId(sessionId);
    },
    [],
  );

  return {
    handleNewSession,
    handleResumeSession,
    handleSessionSelect,
    ensureSessionForSend,
    isLoading,
  };
}
