import { create } from "zustand";
import { v4 as uuid } from "uuid";
import type {
  CodexEditorContext,
  CodexHostCommand,
  CodexHostEnvelope,
  CodexHostOwner,
  CodexHostStatus,
} from "@agent-orchestrator/shared";
import { composerDrafts } from "@session/components/codex/composer/v2/drafts";
import { useVsCodePanelStore } from "@session/stores/useVsCodePanelStore";
import { authHeaders } from "@session/hooks/runtime";
const canonicalCwd = (owner: CodexHostOwner) =>
  useVsCodePanelStore.getState().aliases[owner.cwd] ?? owner.cwd;
export const codexHostOwnerKey = (owner: CodexHostOwner) =>
  JSON.stringify([
    canonicalCwd(owner),
    owner.threadId,
    owner.draftOwner,
    owner.agentId ?? "",
  ]);
export const useCodexHostStore = create<{
  statuses: Record<string, CodexHostStatus>;
}>(() => ({ statuses: {} }));
const clients = new Map<string, EditorHostBridge>();
const disabled = {
  context: false,
  openLocation: false,
  showDiff: false,
  todoCodeLens: false,
  lsp: false,
};
const unavailable = (reason: string): CodexHostStatus => ({
  available: false,
  reason,
  capabilities: disabled,
  instanceId: null,
});
function status(owner: CodexHostOwner, value: CodexHostStatus) {
  useCodexHostStore.setState((s) => ({
    statuses: { ...s.statuses, [codexHostOwnerKey(owner)]: value },
  }));
}
export async function hostRequest<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch("/api/session/codex-host/" + path, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.message ?? result.error ?? "编辑器宿主连接失败");
  return result;
}
function validateContext(
  owner: CodexHostOwner,
  value: unknown,
): CodexEditorContext {
  if (!value || typeof value !== "object") throw new Error("编辑器上下文无效");
  const context = value as CodexEditorContext;
  if (
    typeof context.path !== "string" ||
    !context.path.startsWith(canonicalCwd(owner).replace(/\/$/, "") + "/") ||
    context.path.split("/").some((p) => p === ".." || p === ".") ||
    /[\x00-\x1f]/.test(context.path) ||
    typeof context.text !== "string" ||
    context.text.length > 180_000 ||
    context.text.includes("\0")
  )
    throw new Error("文件不属于原会话项目或文本过长");
  if (
    context.range &&
    (!Number.isInteger(context.range.start) ||
      !Number.isInteger(context.range.end) ||
      context.range.start < 1 ||
      context.range.end < context.range.start)
  )
    throw new Error("编辑器选区无效");
  return context;
}
/** Browser editor and VS Code use the same captured, device-persisted draft. */
export function addBrowserEditorContext(
  owner: CodexHostOwner,
  value: CodexEditorContext,
) {
  const context = validateContext(owner, value);
  composerDrafts.add(owner.draftOwner, {
    id: uuid(),
    kind: "file",
    name: context.path.split("/").pop() ?? context.path,
    path: context.path,
    text: context.text,
    ...(context.range
      ? { range: { start: context.range.start, end: context.range.end } }
      : {}),
  });
}
export class EditorHostBridge {
  private pending = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private stopped = false;
  private active = false;
  private key: string;
  private listener = (event: MessageEvent) => this.receive(event);
  constructor(
    private frame: HTMLIFrameElement,
    readonly owner: CodexHostOwner,
    readonly nonce: string = uuid(),
  ) {
    this.key = codexHostOwnerKey(owner);
    clients.get(this.key)?.dispose();
    clients.set(this.key, this);
    window.addEventListener("message", this.listener);
  }
  private send(
    type: CodexHostEnvelope["type"],
    payload?: unknown,
    requestId?: string,
  ) {
    if (this.frame.isConnected === false) return;
    // An iframe may finish unloading before React's passive cleanup runs.
    try {
      this.frame.contentWindow?.postMessage(
        {
          channel: "coding-kanban.codex-host",
          version: 1,
          nonce: this.nonce,
          owner: this.owner,
          type,
          payload,
          requestId,
        },
        location.origin,
      );
    } catch {
      /* Disposal still rejects all pending operations below. */
    }
  }
  async start(active: boolean) {
    try {
      const url = new URL(this.frame.src, location.href);
      if (
        url.origin !== location.origin ||
        !url.pathname.startsWith("/vscode/")
      )
        throw new Error("编辑器地址来源不匹配");
      const editorKey = url.searchParams.get("workspace");
      if (!editorKey) throw new Error("请重新连接以创建独立编辑工作区");
      status(
        this.owner,
        await hostRequest<CodexHostStatus>("bind", {
          nonce: this.nonce,
          owner: this.owner,
          editorKey,
        }),
      );
      if (this.stopped) return;
      const document = this.frame.contentDocument;
      if (
        !document ||
        this.frame.contentWindow?.location.origin !== location.origin
      )
        throw new Error("编辑器需在同源工作区中打开");
      let script = document.querySelector<HTMLScriptElement>(
        "script[data-codex-host-relay]",
      );
      if (!script) {
        script = document.createElement("script");
        script.dataset.codexHostRelay = "1";
        script.src = "/api/session/codex-host/relay.js";
        await new Promise<void>((resolve, reject) => {
          script!.onload = () => resolve();
          script!.onerror = () => {
            script!.remove();
            reject(new Error("编辑器宿主桥未能加载，请重新连接"));
          };
          (document.head ?? document.body).appendChild(script!);
        });
      }
      if (this.stopped) return;
      this.send("init");
      await this.setActive(active);
    } catch (error) {
      if (!this.stopped) status(this.owner, unavailable(String(error)));
    }
  }
  async setActive(active: boolean) {
    this.active = active;
    if (!this.stopped)
      await hostRequest("active", {
        nonce: this.nonce,
        owner: this.owner,
        active,
      }).catch((error) => status(this.owner, unavailable(String(error))));
  }
  reconnect() {
    return this.start(this.active);
  }
  receive(event: MessageEvent) {
    const message = event.data as CodexHostEnvelope;
    if (
      this.stopped ||
      event.source !== this.frame.contentWindow ||
      event.origin !== location.origin ||
      !message ||
      message.channel !== "coding-kanban.codex-host" ||
      message.version !== 1 ||
      message.nonce !== this.nonce ||
      !message.owner ||
      codexHostOwnerKey(message.owner) !== this.key
    )
      return;
    if (message.type === "context") {
      try {
        addBrowserEditorContext(
          this.owner,
          validateContext(this.owner, message.payload),
        );
      } catch (error) {
        status(this.owner, unavailable(String(error)));
      }
    } else if (message.type === "status" || message.type === "ready") {
      const value =
        message.type === "ready"
          ? (message.payload as { status?: CodexHostStatus })?.status
          : (message.payload as CodexHostStatus);
      if (message.error) status(this.owner, unavailable(message.error));
      else if (
        value &&
        typeof value.available === "boolean" &&
        value.capabilities &&
        Object.keys(disabled).every(
          (key) =>
            typeof value.capabilities[key as keyof typeof disabled] ===
            "boolean",
        )
      )
        status(this.owner, value);
    } else if (message.type === "result" && message.requestId) {
      const pending = this.pending.get(message.requestId);
      if (!pending) return;
      this.pending.delete(message.requestId);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error));
      else pending.resolve(message.payload);
    }
  }
  command(command: CodexHostCommand) {
    if (this.stopped) return Promise.reject(new Error("原编辑器会话已离开"));
    const requestId = uuid();
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error("编辑器操作超时，请重新连接"));
      }, 20_000);
      this.pending.set(requestId, { resolve, reject, timer });
      this.send("command", command, requestId);
    });
  }
  dispose() {
    if (this.stopped) return;
    this.send("dispose");
    this.stopped = true;
    window.removeEventListener("message", this.listener);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("原编辑器会话已离开，未修改其他会话"));
    }
    this.pending.clear();
    if (clients.get(this.key) === this) {
      clients.delete(this.key);
      status(
        this.owner,
        unavailable("在右侧打开该会话项目的 VS Code 后连接上下文"),
      );
    }
  }
}
export function editorHostCommand(
  owner: CodexHostOwner,
  command: CodexHostCommand,
) {
  const bridge = clients.get(codexHostOwnerKey(owner));
  if (!bridge)
    return Promise.reject(new Error("请在右侧打开原会话项目的 VS Code"));
  return bridge.command(command);
}
export function editorHostWorkspace<T>(
  owner: CodexHostOwner,
  action: Record<string, unknown>,
): Promise<T> {
  const bridge = clients.get(codexHostOwnerKey(owner));
  if (!bridge)
    return Promise.reject(new Error("请在右侧打开原会话项目的 VS Code"));
  return hostRequest<T>("workspace", {
    owner: bridge.owner,
    nonce: bridge.nonce,
    ...action,
  });
}
export function reconnectEditorHost(owner: CodexHostOwner) {
  const bridge = clients.get(codexHostOwnerKey(owner));
  if (!bridge)
    return Promise.reject(new Error("请在右侧打开原会话项目的 VS Code"));
  return bridge.reconnect();
}
