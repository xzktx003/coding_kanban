import { useAgentInteractionVisible } from "@session/session-dom";
import { useStopAction } from "../common/useStopAction";
import { useSessionAttentionStore } from "@session/stores/useSessionAttentionStore";
import {
  moveImageDraft,
  useImageAttachments,
} from "../common/useImageAttachments";
import {
  readDraft,
  sessionDraftKey,
  useSessionDraftStore,
  useSessionTextDraft,
} from "@session/stores/useSessionDraftStore";
import { ImageAttachmentStrip } from "../common/ImageAttachmentStrip";
import { ArrowUp, Download, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@session/components/ui/button";
import { toast } from "@session/components/ui/use-toast";
import { acpCancel, acpPrompt, acpStart } from "@session/services/apiAdapt/acp";
import { useWorkspaceStore } from "@session/stores";
import { useAcpStore } from "@session/stores/useAcpStore";
import { AgentModelPanel } from "@session/components/agent/AgentModelPanel";
import { AgentModelTrigger } from "@session/components/agent/AgentModelTrigger";
import { captureBotOptions } from "@session/stores/useBotOptionsStore";
import { ComposerSheet } from "../codex/composer/v2/ComposerSheet";
import { AcpSessionControls } from "./AcpSessionControls";
import { useAcpAgents } from "./useAcpAgents";

export function AcpComposer({
  targetLabel,
}: {
  targetLabel?: React.ReactNode;
}) {
  const [installInfoOpen, setInstallInfoOpen] = useState(false);
  const {
    agentId,
    connectionId,
    sessionId,
    connecting,
    running,
    setConnecting,
    setConnection,
    applySession,
    setRunning,
    addEntry,
    restartNonce,
  } = useAcpStore();
  const interactionVisible = useAgentInteractionVisible();
  const cwd = useWorkspaceStore((s) => s.cwd);
  const agents = useAcpAgents() ?? [];
  const owner = sessionDraftKey("acp", sessionId, cwd, agentId);
  const { inputValue: text, setInputValue: setText } =
    useSessionTextDraft(owner);
  const attachments = useImageAttachments(owner);
  const canInputImages = useAcpStore((s) => s.canInputImages);
  // Agent we already tried to auto-connect, so a failed start does not spin in
  // a retry loop. Cleared on an explicit restart.
  const attempted = useRef<string | null>(null);
  const seenRestart = useRef(restartNonce);

  const agent = agents.find((a) => a.id === agentId);
  const commandLine = agent ? [agent.command, ...agent.args].join(" ") : "";
  const { stopping, requestStop } = useStopAction(
    connectionId && sessionId ? `${connectionId}:${sessionId}` : null,
    running,
    async () => {
      if (!connectionId || !sessionId) throw new Error("尚未获取当前会话");
      await acpCancel(connectionId, sessionId);
    },
  );

  /** Start the agent and open a session. Returns the live ids, or null on failure. */
  const connect = useCallback(async () => {
    if (!cwd) {
      toast({ title: "Pick a workspace folder first", variant: "destructive" });
      return null;
    }
    attempted.current = agentId;
    setConnecting(true);
    try {
      const res = await acpStart(agentId, cwd);
      if (res.sessionId) {
        const connectedOwner = sessionDraftKey(
          "acp",
          res.sessionId,
          cwd,
          agentId,
        );
        useSessionDraftStore.getState().move(owner, connectedOwner);
      }
      setConnection({
        connectionId: res.connectionId,
        sessionId: res.sessionId,
        agentTitle:
          res.initialize.agentInfo?.title ??
          res.initialize.agentInfo?.name ??
          agentId,
        authMethods: res.initialize.authMethods ?? [],
        canLoadSession: res.initialize.agentCapabilities?.loadSession === true,
        canInputImages:
          (
            res.initialize.agentCapabilities?.promptCapabilities as
              | { image?: boolean }
              | undefined
          )?.image === true,
      });
      applySession(res.session);
      if (res.sessionId)
        await moveImageDraft(
          owner,
          sessionDraftKey("acp", res.sessionId, cwd, agentId),
        );
      // keke's own catalogue also configures bots, which are keke processes —
      // so a bot can be set up from this session without opening its chat.
      if (agentId === "keke")
        captureBotOptions("", res.initialize, res.session);
      if (res.sessionError) {
        addEntry({
          id: `start-${Date.now()}`,
          role: "error",
          text: res.sessionError,
        });
        return null;
      }
      return res.sessionId
        ? { connectionId: res.connectionId, sessionId: res.sessionId }
        : null;
    } catch (e) {
      setConnecting(false);
      toast({
        title: "Failed to start agent",
        description: String(e),
        variant: "destructive",
      });
      return null;
    }
  }, [
    agentId,
    cwd,
    owner,
    setConnecting,
    setConnection,
    applySession,
    addEntry,
  ]);

  // Connect as soon as an installed agent is picked, so its model / mode
  // controls are available before the first prompt.
  useEffect(() => {
    if (seenRestart.current !== restartNonce) {
      seenRestart.current = restartNonce;
      attempted.current = null;
    }
    if (
      !interactionVisible ||
      connectionId ||
      connecting ||
      !cwd ||
      !agent?.available
    )
      return;
    if (attempted.current === agentId) return;
    connect();
  }, [
    agentId,
    cwd,
    connectionId,
    connecting,
    agent?.available,
    restartNonce,
    connect,
    interactionVisible,
  ]);

  const send = async () => {
    const trimmed = text.trim();
    if (
      (!trimmed && !attachments.paths.length) ||
      running ||
      connecting ||
      attachments.blocked
    )
      return;
    if (attachments.paths.length && !canInputImages) {
      toast({ title: "当前 Agent 不支持图片输入", variant: "destructive" });
      return;
    }
    const submittedIds = attachments.attachments.map((a) => a.id);
    const snapshot = readDraft(owner);

    let live = connectionId && sessionId ? { connectionId, sessionId } : null;
    if (!live) {
      if (agent && !agent.available) {
        toast({
          title: `${agent.name} is not installed`,
          description: `Download it first.`,
        });
        return;
      }
      live = await connect();
      if (!live) return;
    }

    const submittedOwner = sessionDraftKey("acp", live.sessionId, cwd, agentId);
    if (submittedOwner !== owner) {
      useSessionDraftStore.getState().move(owner, submittedOwner);
      await moveImageDraft(owner, submittedOwner);
    }
    addEntry({
      id: `u-${Date.now()}`,
      role: "user",
      text: trimmed,
      images: attachments.paths,
    });
    setRunning(true);
    try {
      const result = await acpPrompt(
        live.connectionId,
        live.sessionId,
        trimmed,
        attachments.paths,
      );
      useSessionDraftStore.getState().clearSubmitted(submittedOwner, snapshot);
      attachments.clear(submittedIds);
      if (result.stopReason === "end_turn")
        useSessionAttentionStore
          .getState()
          .complete("acp", `${agentId}:${live.sessionId}`, crypto.randomUUID());
    } catch (e) {
      if (useAcpStore.getState().sessionId === live.sessionId) {
        addEntry({ id: `e-${Date.now()}`, role: "error", text: String(e) });
      }
    } finally {
      if (useAcpStore.getState().sessionId === live.sessionId)
        setRunning(false);
    }
  };

  return (
    <div
      className="session-acp-composer session-compact-composer"
      onPasteCapture={(event) => {
        const hasImage =
          Array.from(event.clipboardData.items).some((item) =>
            item.type.startsWith("image/"),
          ) ||
          Array.from(event.clipboardData.files).some((file) =>
            file.type.startsWith("image/"),
          );
        if (hasImage && !canInputImages) {
          event.preventDefault();
          toast({ title: "当前 Agent 不支持图片输入", variant: "destructive" });
          return;
        }
        attachments.onPaste(event);
      }}
    >
      <div className="session-composer-surface session-compact-frame">
        <div className="session-compact-body">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="描述你想完成的任务…"
            rows={2}
            className="w-full min-h-[44px] resize-none bg-transparent text-base md:text-sm outline-none placeholder:text-muted-foreground"
          />
          <ImageAttachmentStrip key={owner} compact draft={attachments} />
        </div>

        <div className="session-composer-toolbar">
          <div className="session-composer-policy">
            <AcpSessionControls />
            {agent && !agent.available && !connectionId && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setInstallInfoOpen(true)}
                aria-label="Agent 安装说明"
              >
                <Download size={16} />
              </Button>
            )}
          </div>

          <div className="session-compact-meta">
            {targetLabel}
            <span
              className="session-compact-status"
              role={
                attachments.storageError ||
                attachments.attachments.some((a) => a.status === "error")
                  ? "alert"
                  : "status"
              }
            >
              {attachments.storageError
                ? "附件草稿保存失败，点击附件重试"
                : attachments.attachments.some((a) => a.status === "error")
                  ? "图片上传失败，点击缩略图重试"
                  : attachments.blocked
                    ? "正在上传图片…"
                    : connecting
                      ? "正在启动 Agent…"
                      : agent && !agent.available && !connectionId
                        ? "Agent 尚未安装"
                        : running
                          ? "运行中"
                          : ""}
            </span>
          </div>
          <div className="session-composer-actions">
            <AgentModelPanel trigger={<AgentModelTrigger compact />} />
            {running ? (
              <Button
                onClick={requestStop}
                disabled={stopping || !connectionId || !sessionId}
                aria-label={stopping ? "正在停止" : "停止生成"}
                variant="destructive"
                size="icon"
                className="session-composer-stop"
                title={stopping ? "正在停止…" : "停止生成"}
              >
                <Square className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                onClick={() => send()}
                size="icon"
                className="session-composer-send"
                disabled={
                  connecting ||
                  attachments.blocked ||
                  (!text.trim() && attachments.paths.length === 0)
                }
                title="发送消息"
                aria-label="发送消息"
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
      {installInfoOpen && (
        <ComposerSheet
          title="Agent 安装说明"
          onClose={() => setInstallInfoOpen(false)}
        >
          {/* Uninstalled agents run through an npx download — never do that implicitly. */}
          {agent && !agent.available && !connectionId && (
            <div className="flex items-center gap-2 px-3 py-2 border-t bg-muted/30 text-xs">
              <span className="min-w-0 flex-1 text-muted-foreground">
                {agent.name} is not installed — starting it downloads{" "}
                <span className="font-mono">{commandLine}</span>
              </span>
              <Button
                size="sm"
                className="h-6 gap-1"
                disabled={connecting}
                onClick={() => connect()}
              >
                <Download className="h-3 w-3" />
                Download &amp; run
              </Button>
            </div>
          )}
        </ComposerSheet>
      )}
    </div>
  );
}
