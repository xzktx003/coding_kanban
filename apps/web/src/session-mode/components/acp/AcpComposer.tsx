import { v4 as randomUUID } from "uuid";
import { useAgentInteractionVisible } from "@session/session-dom";
import { useStopAction } from "../common/useStopAction";
import { useSessionAttentionStore } from "@session/stores/useSessionAttentionStore";
import {
  moveImageDraft,
  ensureAttachmentDraft,
  useAttachmentDraftStore,
  useImageAttachments,
} from "../common/useImageAttachments";
import {
  readDraft,
  sessionDraftKey,
  useSessionDraftStore,
  useSessionTextDraft,
} from "@session/stores/useSessionDraftStore";
import { ImageAttachmentStrip } from "../common/ImageAttachmentStrip";
import { ArrowUp, Download, Square,ArchiveRestore } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@session/components/ui/button";
import { toast } from "@session/components/ui/use-toast";
import {
  acpCancel,
  acpPrompt,
  acpStart,
  acpStop,
} from "@session/services/apiAdapt/acp";
import { useWorkspaceStore } from "@session/stores";
import { useAcpStore } from "@session/stores/useAcpStore";
import { buildUrl } from "@session/hooks/runtime";
import { requestAcpConnectionRecovery } from "@session/services/acpConnectionRecoveryPointer";
import { AgentModelPanel } from "@session/components/agent/AgentModelPanel";
import { AgentModelTrigger } from "@session/components/agent/AgentModelTrigger";
import { captureBotOptions } from "@session/stores/useBotOptionsStore";
import { ComposerSheet } from "../codex/composer/v2/ComposerSheet";
import {acpDraftSessionId} from "@session/services/acpSessionIdentity";
import { AcpSessionControls } from "./AcpSessionControls";
import { useAcpAgents } from "./useAcpAgents";
import { runAcpSessionOperation } from "./sessionOperations";
import { hasPendingAcpSettings } from "./sessionSettings";

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
    historySessionId,
    sessionCwd,
    connecting,
    sessionTransition,
    sessionTransitionError,
    connectionRecovery,
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
  const owner = sessionDraftKey("acp", acpDraftSessionId(sessionId,historySessionId,connectionId), cwd, agentId);
  const { inputValue: text, setInputValue: setText } =
    useSessionTextDraft(owner);
  const attachments = useImageAttachments(owner);
  const legacyOwner=sessionDraftKey("acp",sessionId,cwd,agentId);
  const legacyText=useSessionDraftStore(state=>state.drafts[legacyOwner]?.text??"");
  const [legacyOpen,setLegacyOpen]=useState<string|null>(null);
  const [importingLegacy,setImportingLegacy]=useState(false);
  const importLegacy=async()=>{
    const captured={owner,legacyOwner,agentId,connectionId,sessionId,historySessionId,cwd,revision:readDraft(owner).revision};
    setImportingLegacy(true);
    try{
      await ensureAttachmentDraft(captured.legacyOwner);
      const current=useAcpStore.getState();
      if(!current.active||current.agentId!==captured.agentId||current.connectionId!==captured.connectionId||current.sessionId!==captured.sessionId||current.historySessionId!==captured.historySessionId||useWorkspaceStore.getState().cwd!==captured.cwd||readDraft(captured.owner).revision!==captured.revision)throw new Error("当前会话或草稿已变化，请重新核对后导入。");
      if(!readDraft(captured.legacyOwner).text&&!(useAttachmentDraftStore.getState().drafts[captured.legacyOwner]?.length)){toast({title:"未发现旧版草稿"});setLegacyOpen(null);return;}
      await moveImageDraft(captured.legacyOwner,captured.owner);
      useSessionDraftStore.getState().move(captured.legacyOwner,captured.owner);
      setLegacyOpen(null);
    }catch(error){toast({title:"旧草稿仍保留",description:String(error),variant:"destructive"});}
    finally{setImportingLegacy(false);}
  };
  const canInputImages = useAcpStore((s) => s.canInputImages);
  const settingsPending = useAcpStore(hasPendingAcpSettings);
  const readonlyWithoutConnection=useAcpStore(s=>!!s.inheritedHistory?.viewOnly&&!s.connectionId);
  const directoryMatches = (native: string | null, browsed: string | null) =>
    !!native &&
    !!browsed &&
    native.replace(/\/+$/, "") === browsed.replace(/\/+$/, "");
  const directoryError =
    connectionId && sessionId && !directoryMatches(sessionCwd, cwd)
      ? sessionCwd
        ? `当前会话位于 ${sessionCwd}，请切回该项目或新建会话。`
        : "会话目录尚未确认，请重新打开历史或新建会话。"
      : null;
  // Agent we already tried to auto-connect, so a failed start does not spin in
  // a retry loop. Cleared on an explicit restart.
  const attempted = useRef<string | null>(null);
  const preparingSends = useRef(new Set<string>());
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
    const original = useAcpStore.getState();
    const connectionEndpoint=buildUrl("/api/acp/connection-snapshot");
    setConnecting(true);
    return (
      (await runAcpSessionOperation("正在启动 Agent…", async (isLatest) => {
        const ownsSource = () =>
          isLatest() &&
          useAcpStore.getState().active === original.active &&
          useAcpStore.getState().agentId === agentId &&
          useAcpStore.getState().restartNonce === original.restartNonce &&
          useAcpStore.getState().connectionId === original.connectionId &&
          connectionEndpoint===buildUrl("/api/acp/connection-snapshot") &&
          useWorkspaceStore.getState().cwd === cwd;
        try {
          if (!ownsSource()) return null;
          const res = await acpStart(agentId, cwd);
          if (!ownsSource()) {
            // This start created an undelivered resource. Never stop an adopted
            // connection or any process discovered outside this request.
            if (connectionEndpoint===buildUrl("/api/acp/connection-snapshot")&&useAcpStore.getState().connectionId !== res.connectionId)
              await acpStop(res.connectionId).catch(() => {});
            return null;
          }
          if (res.sessionId) {
            const connectedOwner = sessionDraftKey(
              "acp",
              acpDraftSessionId(res.sessionId,res.historySessionId??res.session?.historySessionId,res.connectionId),
              cwd,
              agentId,
            );
            useSessionDraftStore.getState().move(owner, connectedOwner);
          }
          setConnection({
            connectionId: res.connectionId,
            runtimeInstance: res.runtimeInstance,
            connectionEndpoint,
            cwd,
            sessionId: res.sessionId,
            historySessionId:res.historySessionId??res.session?.historySessionId,
            agentTitle:
              res.initialize.agentInfo?.title ??
              res.initialize.agentInfo?.name ??
              agentId,
            authMethods: res.initialize.authMethods ?? [],
            canLoadSession:
              res.initialize.agentCapabilities?.loadSession === true,
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
              sessionDraftKey("acp", acpDraftSessionId(res.sessionId,res.historySessionId??res.session?.historySessionId,res.connectionId), cwd, agentId),
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
            ? { connectionId: res.connectionId, sessionId: res.sessionId, historySessionId:res.historySessionId??res.session?.historySessionId }
            : null;
        } catch (e) {
          if (!ownsSource()) return null;
          toast({
            title: "Failed to start agent",
            description: String(e),
            variant: "destructive",
          });
          return null;
        } finally {
          if (isLatest()) setConnecting(false);
        }
      })) ?? null
    );
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
      readonlyWithoutConnection ||
      connectionId ||
      connecting ||
      sessionTransition ||
      sessionTransitionError ||
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
    sessionTransition,
    sessionTransitionError,
    agent?.available,
    restartNonce,
    connect,
    interactionVisible,
    readonlyWithoutConnection,
  ]);

  const send = async () => {
    const trimmed = text.trim();
    if (
      (!trimmed && !attachments.paths.length) ||
      running ||
      readonlyWithoutConnection ||
      connecting ||
      sessionTransition ||
      sessionTransitionError ||
      hasPendingAcpSettings() ||
      attachments.blocked ||
      directoryError
    )
      return;
    if (attachments.paths.length && !canInputImages) {
      toast({ title: "当前 Agent 不支持图片输入", variant: "destructive" });
      return;
    }
    const submittedIds = attachments.attachments.map((a) => a.id);
    const snapshot = readDraft(owner);

    if (preparingSends.current.has(owner)) return;
    preparingSends.current.add(owner);
    const original = useAcpStore.getState();
    let live: {connectionId:string;sessionId:string;historySessionId?:string|null}|null = connectionId && sessionId ? { connectionId, sessionId,historySessionId } : null;
    const ownsTarget = () => {
      const current = useAcpStore.getState();
      return (
        !!live &&
        current.connectionId === live.connectionId &&
        current.sessionId === live.sessionId &&
        current.agentId === agentId
      );
    };
    const canSubmit = () => {
      const current = useAcpStore.getState();
      return (
        ownsTarget() &&
        current.active === original.active &&
        useWorkspaceStore.getState().cwd === cwd &&
        directoryMatches(current.sessionCwd, cwd) &&
        !current.running &&
        !current.sessionTransition &&
        !current.sessionTransitionError &&
        !hasPendingAcpSettings(current)
      );
    };
    let submittedOwner = owner;
    let dispatched = false;
    try {
      if (!live) {
        if (agent && !agent.available) {
          toast({
            title: `${agent.name} is not installed`,
            description: "Download it first.",
          });
          return;
        }
        live = await connect();
        if (!live || !canSubmit()) return;
      }
      submittedOwner = sessionDraftKey("acp", acpDraftSessionId(live.sessionId,live.historySessionId,live.connectionId), cwd, agentId);
      if (submittedOwner !== owner) {
        useSessionDraftStore.getState().move(owner, submittedOwner);
        await moveImageDraft(owner, submittedOwner);
      }
      // Preparation may await a connection or attachment storage. Never insert
      // a message or dispatch a prompt after the user has selected another target.
      if (!canSubmit()) return;
      const clientMessageId = randomUUID();
      addEntry({
        id: `u-${clientMessageId}`,
        clientMessageId,
        role: "user",
        text: trimmed,
        images: attachments.paths,
      });
      setRunning(true);
      dispatched = true;
      preparingSends.current.delete(owner);
      const result = await acpPrompt(
        live.connectionId,
        live.sessionId,
        trimmed,
        attachments.paths,
        clientMessageId,
      );
      useSessionDraftStore.getState().clearSubmitted(submittedOwner, snapshot);
      attachments.clear(submittedIds);
      if (result.stopReason === "end_turn")
        useSessionAttentionStore
          .getState()
          .complete("acp", `${agentId}:${acpDraftSessionId(live.sessionId,live.historySessionId,live.connectionId)}`, randomUUID());
    } catch (e) {
      if (ownsTarget()) {
        addEntry({ id: `e-${Date.now()}`, role: "error", text: String(e) });
      } else if (!live && useAcpStore.getState().agentId === agentId) {
        toast({
          title: "无法发送消息",
          description: String(e),
          variant: "destructive",
        });
      }
    } finally {
      preparingSends.current.delete(owner);
      if (dispatched && ownsTarget()) setRunning(false);
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
            aria-label="ACP 消息输入"
            aria-describedby={
              sessionTransition || sessionTransitionError || directoryError
                ? "acp-session-transition"
                : undefined
            }
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
            placeholder={readonlyWithoutConnection?"当前仅查看原记录；点击上方继续按钮后再发送。":"描述你想完成的任务…"}
            rows={2}
            className="w-full min-h-[44px] resize-none bg-transparent text-base md:text-sm outline-none placeholder:text-muted-foreground"
          />
          <ImageAttachmentStrip key={owner} compact draft={attachments} />
        </div>

        <div className="session-composer-toolbar">
          <div className="session-composer-policy">
            <AcpSessionControls />
            {sessionId&&legacyOwner!==owner&&<Button type="button" variant="ghost" className="min-h-11 min-w-11" title="找回旧版草稿" aria-label="找回旧版草稿" onClick={()=>setLegacyOpen(owner)}><ArchiveRestore size={16}/></Button>}
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
            {(connectionRecovery==="failed"||(sessionTransitionError&&connectionId))&&<Button type="button" size="sm" variant="ghost" className="min-h-11 text-xs" onClick={requestAcpConnectionRecovery}>重新核对连接</Button>}
            <span
              className="session-compact-status"
              id="acp-session-transition"
              role={
                sessionTransitionError ||
                directoryError ||
                attachments.storageError ||
                attachments.attachments.some((a) => a.status === "error")
                  ? "alert"
                  : "status"
              }
            >
              {directoryError
                ? directoryError
                : settingsPending
                  ? "正在应用会话设置…"
                  : sessionTransition
                    ? sessionTransition.label
                    : (sessionTransitionError ??
                      (attachments.storageError
                        ? "附件草稿保存失败，点击附件重试"
                        : attachments.attachments.some(
                              (a) => a.status === "error",
                            )
                          ? "图片上传失败，点击缩略图重试"
                          : attachments.blocked
                            ? "正在上传图片…"
                            : connecting
                              ? "正在启动 Agent…"
                              : agent && !agent.available && !connectionId
                                ? "Agent 尚未安装"
                                : running
                                  ? "运行中"
                                  : ""))}
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
                  readonlyWithoutConnection ||
                  connecting ||
                  Boolean(sessionTransition) ||
                  Boolean(sessionTransitionError) ||
                  settingsPending ||
                  Boolean(directoryError) ||
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
      {legacyOpen===owner&&<ComposerSheet title="找回旧版草稿" onClose={()=>setLegacyOpen(null)} description="旧版草稿未区分独立连接。请确认它属于当前会话后导入；现有草稿会保留。">
        <div className="space-y-3 p-3 text-sm"><p className="text-muted-foreground">当前会话：{agentId} · {sessionId}</p>{legacyText&&<pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md border p-2">{legacyText}</pre>}<Button disabled={importingLegacy} onClick={()=>void importLegacy()}>确认导入当前会话</Button></div>
      </ComposerSheet>}
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
