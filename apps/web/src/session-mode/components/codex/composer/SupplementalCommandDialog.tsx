import { useEffect, useRef, useState } from "react";
import { useCodexStore } from "../stores/useCodexStore";
import { useThreadModelSettings } from "@session/hooks/useThreadModelSettings";
import { captureThreadModelSelection, flushThreadModelSettings } from "@session/stores/useThreadModelStore";
import { useSessionNameStore, SESSION_NAME_LIMIT } from "@session/stores/useSessionNameStore";
import { captureCodexOperationScope, isCodexOperationScopeCurrent, type CodexOperationScope } from "@session/services/codexOperationScope";
import { postJsonWithOptions, isExplicitRequestRejection } from "@session/services/apiAdapt/shared";
import { readWithDeadline } from "@session/services/sessionReadQueue";
import { isSessionInteractionVisible } from "@session/session-dom";
import { codexRuntimeState } from "@session/utils/codexRuntimeState";
import type { Personality } from "@session/bindings";
import type { ListMcpServerStatusResponse } from "@session/bindings/v2";
import { ComposerSheet } from "./v2/ComposerSheet";
import { forkSlashLocal, forkSlashWorktree, submitSlashRename } from "./slashCommands";

export type SupplementalCommandKind = "status" | "rename" | "fork" | "mcp" | "personality";
const titles = { status: "会话状态", rename: "重命名聊天", fork: "创建聊天分支", mcp: "MCP 服务器状态", personality: "个性" };

/** Optional command forms retain their captured target and never submit the composer. */
export function SupplementalCommandDialog({ kind, threadId, targetScope, onClose }: { kind: SupplementalCommandKind; threadId: string | null; targetScope?: CodexOperationScope; onClose: () => void }) {
  const [scope] = useState(() => targetScope ?? captureCodexOperationScope());
  const settings = useThreadModelSettings(threadId);
  const state = useCodexStore();
  const thread = state.threads.find((item) => item.id === threadId);
  const [name, setName] = useState(thread?.name || thread?.preview || "");
  const [personality, setPersonality] = useState<Personality | null>(settings.personality);
  const [busy, setBusy] = useState(false), [unknown, setUnknown] = useState(false), [error, setError] = useState<string | null>(null);
  const [servers, setServers] = useState<Array<{ name: string; auth: string; tools: number }> | null>(null);
  const [cursor, setCursor] = useState<string | null>(null), [nextCursor, setNextCursor] = useState<string | null>(null), [reload, setReload] = useState(0);
  const alive = useRef(true), pending = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (kind !== "mcp") return;
    const controller = new AbortController();
    setServers(null); setError(null);
    void readWithDeadline(signal => postJsonWithOptions<ListMcpServerStatusResponse>("/api/codex/mcp/status/list", { cursor, limit: 50, detail: "toolsAndAuthOnly", threadId }, { suppressToast: true, signal }), 10_000, controller.signal).then(result => {
      if (controller.signal.aborted || !alive.current) return;
      if (!isCodexOperationScopeCurrent(scope)) throw new Error("账号或运行服务已变化，请重新打开此面板。");
      if (!Array.isArray(result.data) || result.data.length > 50) throw new Error("MCP 状态响应无效。");
      setServers(result.data.map(server => ({ name: server.name, auth: server.authStatus, tools: Object.keys(server.tools ?? {}).length })));
      setNextCursor(result.nextCursor);
    }).catch(reason => { if (!controller.signal.aborted && alive.current) setError(reason instanceof Error ? reason.message : "无法读取 MCP 状态"); });
    return () => controller.abort();
  }, [kind, threadId, scope, cursor, reload]);
  const run = async (write: () => Promise<unknown>, native = true) => {
    if (pending.current || unknown) return;
    if (!isSessionInteractionVisible() || !isCodexOperationScopeCurrent(scope)) { setError("账号或运行服务已变化，尚未执行操作；请重新打开面板。"); return; }
    pending.current = true; setBusy(true); setError(null);
    try {
      await write();
      if (!alive.current || !isCodexOperationScopeCurrent(scope)) return;
      onClose();
    } catch (reason) {
      if (!alive.current) return;
      const uncertain = native && !isExplicitRequestRejection(reason);
      setUnknown(uncertain);
      setError(uncertain ? "操作结果尚未确认，请先核对会话；不会自动重复执行。" : reason instanceof Error ? reason.message : "操作失败");
    } finally { pending.current = false; if (alive.current) setBusy(false); }
  };
  const runtime = codexRuntimeState(state, threadId), usage = threadId ? state.tokenUsageMap[threadId] : null;
  return <ComposerSheet title={titles[kind]} onClose={onClose} description={kind === "status" || kind === "mcp" ? "只读查看当前官方服务报告的状态。" : "操作只针对打开面板时选择的会话，输入草稿保持不变。"}>
    <p className="text-xs text-muted-foreground break-all">{threadId ? `会话：${thread?.name || thread?.preview || threadId} · ${threadId}` : "新会话"}{thread?.cwd ? ` · ${thread.cwd}` : ""}</p>
    {kind === "status" && <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm"><dt>轮次</dt><dd>{runtime.running ? "运行中" : runtime.failed ? "失败" : runtime.known ? "空闲" : "尚未核实"}</dd><dt>模型</dt><dd>{settings.model || "尚未核实"}</dd><dt>推理强度</dt><dd>{settings.reasoningEffort ?? "默认"}</dd><dt>上下文用量</dt><dd>{usage ? `${usage.total.totalTokens.toLocaleString()} tokens${usage.modelContextWindow ? ` / ${usage.modelContextWindow.toLocaleString()}` : ""}` : "尚未收到用量数据"}</dd></dl>}
    {kind === "mcp" && <>{servers === null && !error ? <p role="status">正在读取 MCP 状态…</p> : servers?.length === 0 ? <p role="status">当前没有 MCP 服务器</p> : <ul className="space-y-3">{servers?.map(server => <li key={server.name}><strong>{server.name}</strong><p className="text-sm text-muted-foreground">认证：{server.auth} · {server.tools} 个工具</p></li>)}</ul>}<div className="flex gap-3"><button type="button" onClick={() => setReload(value => value + 1)}>重新读取</button>{cursor && <button type="button" onClick={() => setCursor(null)}>第一页</button>}{nextCursor && <button type="button" onClick={() => setCursor(nextCursor)}>下一页</button>}</div></>}
    {kind === "personality" && <><p className="text-sm text-muted-foreground">保存个性兼容偏好。当前官方服务已弃用 friendly/pragmatic 风格切换；此选择不会重写已有指令，也不保证改变回复风格。</p><fieldset disabled={busy || unknown} className="space-y-3">{([[null, "默认"], ["friendly", "亲和友善"], ["pragmatic", "务实"], ["none", "无"]] as const).map(([value, label]) => <label key={label} className="flex items-center gap-2"><input type="radio" name="composer-personality" checked={personality === value} onChange={() => setPersonality(value)} />{label}</label>)}</fieldset><button type="button" disabled={busy || unknown} onClick={() => void run(async () => { settings.setPersonality(personality); if (threadId) await flushThreadModelSettings(threadId, captureThreadModelSelection(threadId)); }, false)}>保存兼容偏好</button></>}
    {kind === "rename" && <form onSubmit={event => { event.preventDefault(); event.stopPropagation(); if (threadId && name.trim()) void run(async () => { await submitSlashRename(threadId, name); if (isCodexOperationScopeCurrent(scope)) { useSessionNameStore.getState().setName("codex", threadId, name.trim()); useCodexStore.setState(current => ({ threads: current.threads.map(item => item.id === threadId ? { ...item, name: name.trim() } : item) })); } }); }}><label className="grid gap-2">会话名称<input autoFocus value={name} maxLength={SESSION_NAME_LIMIT} disabled={busy || unknown || !threadId} onChange={event => setName(event.target.value)} className="rounded-lg border bg-background p-2" /></label><button type="submit" disabled={busy || unknown || !threadId || !name.trim()}>保存名称</button></form>}
    {kind === "fork" && <div className="space-y-3"><p>复制当前线程的历史，创建独立会话；原任务继续运行。</p><button type="button" disabled={busy || unknown || !threadId} onClick={() => threadId && void run(() => forkSlashLocal(threadId))}>在当前项目创建分支</button><button type="button" disabled={busy || unknown || !threadId || !thread?.cwd} onClick={() => threadId && void run(() => forkSlashWorktree(threadId))}>在新工作树创建分支</button></div>}
    {error && <p role="alert">{error}</p>}{busy && <p role="status">正在处理…</p>}
  </ComposerSheet>;
}
