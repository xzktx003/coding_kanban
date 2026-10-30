import { useProviderTranscriptVisibility } from "@session/hooks/useProviderTranscriptVisibility";
import {
  providerTranscriptKey,
  useProviderTranscriptStore,
} from "@session/services/sessionProviderTranscriptState";
import { ProviderTranscriptControls } from "@session/components/agent/ProviderTranscriptControls";
import { useSessionReadReceipt } from "@session/hooks/useSessionReadReceipt";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { CCMessage } from "@session/components/cc/session/messages";
import { PermissionRequestCard } from "@session/components/cc/session/messages/PermissionRequestCard";
import { useCCStore } from "@session/stores/cc";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import { useCCPermissionListener, useCCSessionListener } from "../hooks";
import type {
  CCMessage as CCMessageData,
  PermissionRequestMessage,
} from "../types/messages";
import type { PermissionDecision } from "../types/permission";
import { refreshClaudeHistory } from "@session/services/followedSessionAuxSync";
import { useClaudeConnectionStore } from "@session/services/claudeConnectionIdentity";
import { VirtualTranscriptList } from "@session/components/agent/VirtualTranscriptList";
import { CCScrollControls } from "./CCScrollControls";
import { buildMessageGroups, CCExploredMessageGroup } from "./messages/group";
import { buildInlineErrorsMap } from "./messages/inlineErrors";
import { buildToolResultsMap } from "./messages/toolResults";
import { ClaudeCardProvider } from "../presentation/CardContext";
import { Spinner } from "../presentation/Spinner";

const EMPTY_MESSAGES: CCMessageData[] = [];

interface CCSessionProps {
  /** When provided, renders in embedded (grid-card) mode for this specific session. */
  sessionId?: string;
  /**
   * Disable the internal event listeners. Use when a sibling standalone CCSession
   * is already listening to the same session to prevent double-writing messages.
   */
  disableListener?: boolean;
}

export default function CCSession({
  sessionId,
  disableListener = false,
}: CCSessionProps = {}) {
  const isEmbedded = !!sessionId;
  const recoveryError=useClaudeConnectionStore(s=>s.errors[sessionId??useCCStore.getState().activeSessionId??""]);

  const activeSessionId = useCCStore((s) =>
    sessionId ? null : s.activeSessionId,
  );
  const messages = useCCStore((s) =>
    sessionId
      ? (s.sessionMessagesMap[sessionId] ?? EMPTY_MESSAGES)
      : s.messages,
  );
  const isLoading = useCCStore((s) =>
    sessionId ? (s.sessionLoadingMap[sessionId] ?? false) : s.isLoading,
  );
  const permissionMode = useCCStore((s) => s.options.permissionMode);
  const {
    setLoading,
    setConnected,
    clearMessages,
    updateMessage,
    updateSessionMessage,
  } = useCCStore(
    useShallow((s) => ({
      setLoading: s.setLoading,
      setConnected: s.setConnected,
      clearMessages: s.clearMessages,
      updateMessage: s.updateMessage,
      updateSessionMessage: s.updateSessionMessage,
    })),
  );
  const cwd = useWorkspaceStore((s) => s.cwd);
  const openedSessionId = sessionId ?? activeSessionId;
  const transcriptOwner = openedSessionId
    ? providerTranscriptKey("cc", openedSessionId)
    : null;
  const restoreTranscript = useCallback(
    () =>
      openedSessionId
        ? refreshClaudeHistory(openedSessionId)
        : Promise.resolve(),
    [openedSessionId],
  );
  const loadEarlierTranscript = useCallback(() => {
    const cursor =
      transcriptOwner &&
      useProviderTranscriptStore.getState().entries[transcriptOwner]
        ?.nextCursor;
    return openedSessionId && cursor
      ? refreshClaudeHistory(openedSessionId, undefined, "interactive", cursor)
      : Promise.resolve();
  }, [openedSessionId, transcriptOwner]);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const latestRef = useRef<HTMLDivElement>(null);
  const transcriptVisible = useProviderTranscriptVisibility(
    transcriptOwner,
    "cc",
    openedSessionId,
    scrollContainerRef,
    messages.length > 0,
    restoreTranscript,
  );
  useSessionReadReceipt("cc", sessionId ?? activeSessionId, latestRef);
  const shouldAutoScrollRef = useRef(true);

  // Reset transient UI state when directory changes (standalone mode only).
  useEffect(() => {
    if (isEmbedded || !cwd || activeSessionId) return;
    clearMessages();
    setConnected(false);
    setLoading(false);
  }, [
    cwd,
    activeSessionId,
    clearMessages,
    setConnected,
    setLoading,
    isEmbedded,
  ]);

  const inlineErrorsMap = useMemo(
    () => buildInlineErrorsMap(messages),
    [messages],
  );

  // The aligned cards summarize their own result, so they need successful
  // results too — inlineErrorsMap carries only failures.
  const toolResultsMap = useMemo(
    () => buildToolResultsMap(messages),
    [messages],
  );

  const messageGroups = useMemo(() => buildMessageGroups(messages), [messages]);
  const groupKey = useCallback(
    (group: (typeof messageGroups)[number]) => {
      const index =
        group.kind === "explored" ? group.msgIndices[0] : group.msgIdx;
      return String((messages[index] as { uuid?: string }).uuid ?? index);
    },
    [messages],
  );

  const pendingPermissionIdx = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.type === "permission_request" && !m.resolved) return i;
    }
    return -1;
  }, [messages]);

  const handleResolvePermission = async (
    requestId: string,
    decision: PermissionDecision,
  ) => {
    const { resolveClaudePermission } = await import("@session/services/resolveClaudePermission");
    try {
      await resolveClaudePermission(requestId, decision);
    } catch (err) {
      console.error("Failed to resolve permission:", err);
      throw err;
    }
  };

  useCCSessionListener({ sessionId, disabled: disableListener });
  useCCPermissionListener({ sessionId, disabled: disableListener });

  return (
    <ClaudeCardProvider cwd={cwd}>
      <div
        className="flex flex-col h-full min-h-0 w-full max-w-4xl mx-auto"
        data-provider-transcript-owner={transcriptOwner ?? undefined}
        data-provider-transcript-visible={transcriptVisible}
      >
        {recoveryError&&<p role="status" className="mx-3 mb-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground">{recoveryError}</p>}
        <ProviderTranscriptControls
          owner={transcriptOwner}
          onEarlier={loadEarlierTranscript}
          onRetry={restoreTranscript}
        />
        {/* Scrollable content area */}
        <div className="flex-1 min-h-0 overflow-hidden relative">
          <div
            ref={scrollContainerRef}
            className="h-full overflow-y-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:display-none"
          >
            <div className="thread-surface flex flex-col gap-2 p-4">
              {/* Message list */}
              <VirtualTranscriptList
                owner={`cc:${openedSessionId}`}
                items={messageGroups}
                getKey={groupKey}
                scrollRef={scrollContainerRef}
                followingRef={shouldAutoScrollRef}
                renderRow={(group) => (
                  <div
                    key={
                      (
                        messages[
                          group.kind === "explored"
                            ? group.msgIndices[0]
                            : group.msgIdx
                        ] as { uuid?: string }
                      ).uuid ??
                      (group.kind === "explored"
                        ? group.msgIndices[0]
                        : group.msgIdx)
                    }
                    data-cc-message={
                      (
                        messages[
                          group.kind === "explored"
                            ? group.msgIndices[0]
                            : group.msgIdx
                        ] as { uuid?: string }
                      ).uuid
                    }
                  >
                    {group.kind === "explored" ? (
                      <CCExploredMessageGroup
                        key={`explored-${group.msgIndices[0]}`}
                        msgIndices={group.msgIndices}
                        messages={messages}
                        inlineErrorsMap={inlineErrorsMap}
                      />
                    ) : (
                      <CCMessage
                        key={group.msgIdx}
                        message={messages[group.msgIdx]}
                        index={group.msgIdx}
                        inlineErrors={inlineErrorsMap[group.msgIdx]}
                        toolResults={toolResultsMap[group.msgIdx]}
                        detailVisible={transcriptVisible}
                      />
                    )}
                  </div>
                )}
              />

              <div ref={latestRef} data-session-latest style={{ height: 1 }} />
              {/* Running indicator: the official glyph cycle and verb. */}
              {isLoading && (
                <div className="claude-presentation">
                  <Spinner permissionMode={permissionMode} />
                </div>
              )}
            </div>
          </div>

          {!isEmbedded && messages.length > 0 && (
            <CCScrollControls scrollContainerRef={scrollContainerRef} />
          )}
        </div>

        {pendingPermissionIdx !== -1 && (
          <PermissionRequestCard
            msg={messages[pendingPermissionIdx] as PermissionRequestMessage}
            onResolve={handleResolvePermission}
            active={transcriptVisible}
          />
        )}
      </div>
    </ClaudeCardProvider>
  );
}
