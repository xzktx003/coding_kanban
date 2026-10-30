import { useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@session/components/ui/button";
import { useAgentInteractionVisible } from "@session/session-dom";
import { openEventStream } from "@session/lib/eventStream";
import { usePairingStore } from "@session/stores/usePairingStore";
import { useCodexStore } from "@session/components/codex/stores";
import { composerDrafts } from "@session/components/codex/composer/v2/drafts";
import { sessionDraftKey } from "@session/stores/useSessionDraftStore";
import { newSessionEditId } from "@session/services/sessionEditIdentity";
import { McpAppBridge, type McpAppContext } from "./bridge";
import { mcpAppSandboxUrl, normalizeMcpAppCsp } from "./sandbox";
import { createMcpAppTransport } from "./transport";
import { TranscriptDetailVisibility } from "@session/components/codex/hooks/transcriptDetailVisibility";
type Target = { threadId: string; turnId: string; itemId: string };
type ToolRequest = { tool: string; args: unknown; accept: () => void; cancel: () => void };
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
function ActiveMcpApp({ target, onClose, onInvalidate }: { target: Target; onClose: () => void; onInvalidate: () => void }) {
  const [context, setContext] = useState<McpAppContext | null>(null), [error, setError] = useState<string | null>(null), [ready, setReady] = useState(false), [height, setHeight] = useState(280), [tool, setTool] = useState<ToolRequest | null>(null), [closing, setClosing] = useState(false);
  const { i18n } = useTranslation();
  const locale = useRef(i18n.language); locale.current = i18n.language;
  const frame = useRef<HTMLIFrameElement>(null), bridge = useRef<McpAppBridge | null>(null), action = useRef<ToolRequest | null>(null);
  const [transport] = useState(createMcpAppTransport), live = useRef(false), abort = useRef<AbortController | null>(null);
  useEffect(() => {
    live.current = true;
    const controller = new AbortController(); abort.current = controller;
    let token: string | undefined,completed=false,resultRead=false;
    const updateResult=()=>{if(!token||!completed||resultRead||controller.signal.aborted)return;resultRead=true;void transport.request<{toolResult:unknown}>("result",{contextToken:token},controller.signal).then(value=>{if(!controller.signal.aborted&&live.current)bridge.current?.updateToolResult(value.toolResult);}).catch(reason=>{if(!controller.signal.aborted&&live.current)setError(reason instanceof Error?reason.message:String(reason));});};
    const invalidate = () => { controller.abort(); bridge.current?.close(); action.current?.cancel(); action.current = null; if (live.current) { setContext(null); setTool(null); onInvalidate(); } };
    const stopEvents = openEventStream({ agents: ["codex"], label: "mcp-app", onResync: invalidate, onEvent: (event) => {
      const payload=object(event.payload),method=payload.method,params=object(payload.params),item=object(params.item);
      if(method==="item/completed"&&params.threadId===target.threadId&&params.turnId===target.turnId&&item.id===target.itemId&&item.type==="mcpToolCall"){completed=true;updateResult();}
      if (event.event === "codex:disconnected" || ["account/updated", "account/login/completed", "mcpServer/oauthLogin/completed", "mcpServer/startupStatus/updated", "app/list/updated"].includes(String(method))) invalidate();
    } });
    const stopPairing = usePairingStore.subscribe(() => { if (!transport.current()) invalidate(); });
    const stopAccount = useCodexStore.subscribe((state, previous) => { if (state.accountNamespace !== previous.accountNamespace || state.hasAccount !== previous.hasAccount) invalidate(); });
    const restart = () => invalidate(); window.addEventListener("session-runtime-restarted", restart);
    void transport.request<McpAppContext>("context", target, controller.signal).then((value) => {
      token = value.contextToken;
      if (controller.signal.aborted || !live.current) { void transport.request("revoke", { contextToken: token }).catch(() => {}); return; }
      if (!/^[a-f0-9]{64}$/.test(value.contextToken) || !/^[a-f0-9]{64}$/.test(value.identity) || typeof value.html !== "string" || value.html.length > 1_048_576) throw new Error("应用资源响应无效");
      value.csp = normalizeMcpAppCsp(value.csp); setContext(value);queueMicrotask(updateResult);
    }).catch((reason) => { if (!controller.signal.aborted && live.current) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => {
      live.current = false; controller.abort(); bridge.current?.close(); bridge.current = null; action.current?.cancel(); action.current = null;
      stopEvents(); stopPairing(); stopAccount(); window.removeEventListener("session-runtime-restarted", restart);
      if (token) void transport.request("revoke", { contextToken: token }).catch(() => {});
    };
  }, [target.threadId, target.turnId, target.itemId, transport]);
  useLayoutEffect(() => {
    if (!context) return;
    const content = context, original = frame.current?.contentWindow;
    const send = (message: Record<string, unknown>) => original?.postMessage(message, "*");
    const append = async (name: string, value: unknown) => {
      if (!live.current || abort.current?.signal.aborted) throw new Error("应用已关闭");
      const text = JSON.stringify(value); if (text.length > 65_536) throw new Error("应用上下文过长");
      const owner = sessionDraftKey("codex", target.threadId), id = `mcp-app:${content.identity}:${name}`;
      const entry = { id, kind: "quote" as const, name, text, sourceThreadId: target.threadId, sourceItemId: target.itemId };
      if (composerDrafts.read(owner).contexts.some((context) => context.id === id)) composerDrafts.replace(owner, id, entry);
      else composerDrafts.add(owner, entry);
    };
    const hostContext = () => ({ theme: document.documentElement.classList.contains("dark") ? "dark" : "light", locale: locale.current, platform: "web", displayMode: "inline", availableDisplayModes: ["inline"], containerDimensions: { width: frame.current?.clientWidth ?? 600, maxHeight: 720 }, toolInfo: { tool: content.toolInfo } });
    const controller = new McpAppBridge({ context: content, send, hostContext,
      call: async (name, args) => {
        if (action.current) throw new Error("请先处理当前应用请求");
        await new Promise<void>((resolve, reject) => {
          const request = { tool: name, args, accept: resolve, cancel: () => reject(new Error("已取消应用工具请求")) };
          action.current = request; setTool(request);
        });
        action.current = null; setTool(null);
        if (!live.current || abort.current?.signal.aborted) throw new Error("应用已关闭");
        const intentId = newSessionEditId();
        try { return await transport.request("call", { contextToken: content.contextToken, threadId: target.threadId, tool: name, arguments: args, intentId, confirmed: true }, abort.current?.signal); }
        catch (reason) { if (live.current) setError("应用操作未完成或回执未知，请核对结果；系统不会自动重发。"); throw reason; }
      },
      read: (uri) => transport.request("read", { contextToken: content.contextToken, uri }, abort.current?.signal),
      openLink: async (href) => { if (!live.current || abort.current?.signal.aborted) throw new Error("应用已关闭"); window.open(href, "_blank", "noopener,noreferrer"); },
      modelContext: (value) => append("MCP 应用上下文", value), message: (value) => append("MCP 应用消息（待发送）", value),
      size: setHeight, ready: () => setReady(true),
    }); bridge.current = controller;
    const receive = (event: MessageEvent) => {
      if (event.source !== original || event.origin !== "null") return;
      const value = object(event.data);
      if (value.jsonrpc === "2.0" && value.method === "ui/notifications/sandbox-proxy-ready") { send({ jsonrpc: "2.0", method: "ui/notifications/sandbox-resource-ready", params: { html: content.html } }); return; }
      void controller.receive(value);
    };
    window.addEventListener("message", receive);
    const theme = new MutationObserver(() => controller.notifyContext()); theme.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => controller.notifyContext()); if (frame.current) resize?.observe(frame.current);
    return () => { controller.close(); if (bridge.current === controller) bridge.current = null; window.removeEventListener("message", receive); theme.disconnect(); resize?.disconnect(); };
  }, [context, target.threadId, target.itemId, transport]);
  useEffect(() => bridge.current?.notifyContext(), [i18n.language]);
  useEffect(() => {
    if (!context || ready) return;
    const timer = setTimeout(() => { setContext(null); setError("应用未在时限内完成连接，请关闭后重新打开。"); }, 10_000);
    return () => clearTimeout(timer);
  }, [context, ready]);
  async function close(){if(closing)return;setClosing(true);action.current?.cancel();action.current=null;await bridge.current?.teardown();if(live.current)onClose();}
  return <section className="my-2 rounded-lg border bg-background" aria-label="MCP 应用">
    <div className="flex items-center justify-between gap-2 border-b px-3 py-1"><span className="truncate text-sm">{context ? `${context.server} · ${context.tool}` : "应用"}</span><Button type="button" variant="ghost" size="sm" disabled={closing} onClick={()=>void close()}>{closing?"正在关闭…":"关闭应用"}</Button></div>
    {error && <p role="alert" className="px-3 py-2 text-sm text-destructive">{error}</p>}
    {!context && !error && <p role="status" className="p-3 text-sm text-muted-foreground">正在核对应用资源…</p>}
    {context && <><iframe ref={frame} title={`MCP 应用 ${context.tool}`} src={mcpAppSandboxUrl(context.csp as ReturnType<typeof normalizeMcpAppCsp>)} sandbox="allow-scripts allow-same-origin" referrerPolicy="no-referrer" className="block w-full border-0" style={{ height }} />{!ready && <p role="status" className="px-3 pb-2 text-xs text-muted-foreground">正在连接应用…</p>}</>}
    {tool && <div className="space-y-2 border-t p-3 text-sm"><p>应用请求调用 <strong>{tool.tool}</strong></p><pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2 text-xs">{JSON.stringify(tool.args, null, 2).slice(0, 2000)}</pre><div className="flex gap-2"><Button type="button" size="sm" onClick={() => tool.accept()}>允许本次调用</Button><Button type="button" size="sm" variant="outline" onClick={() => { tool.cancel(); action.current = null; setTool(null); }}>取消</Button></div></div>}
  </section>;
}
export function McpAppView({ threadId, turnId, itemId }: Target) {
  const [open, setOpen] = useState(false), [intersecting, setIntersecting] = useState(true), [documentVisible, setDocumentVisible] = useState(() => document.visibilityState !== "hidden");
  const [revoked, setRevoked] = useState(false);
  const [element, ref] = useState<HTMLDivElement | null>(null), interactionVisible = useAgentInteractionVisible(), transcriptVisible = useContext(TranscriptDetailVisibility);
  useEffect(() => { const update = () => setDocumentVisible(document.visibilityState !== "hidden"); document.addEventListener("visibilitychange", update); return () => document.removeEventListener("visibilitychange", update); }, []);
  useEffect(() => { if (!element || typeof IntersectionObserver === "undefined") return; const observer = new IntersectionObserver(([entry]) => { if (entry) setIntersecting(entry.isIntersecting); }); observer.observe(element); return () => observer.disconnect(); }, [element]);
  const target = { threadId, turnId, itemId };
  return <div ref={ref}>{revoked && <p role="alert" className="py-2 text-sm text-destructive">应用连接或账号已变化，请重新打开应用。</p>}{open && intersecting && documentVisible && interactionVisible && transcriptVisible ? <ActiveMcpApp key={JSON.stringify(target)} target={target} onClose={() => setOpen(false)} onInvalidate={() => { setRevoked(true); setOpen(false); }} /> : <Button type="button" variant="outline" size="sm" onClick={() => { setRevoked(false); setOpen((value) => !value); }}>{open ? "应用已暂停，点击关闭" : "打开应用"}</Button>}</div>;
}
