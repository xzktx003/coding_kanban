type RecordValue = Record<string, unknown>;
const object = (value: unknown): RecordValue => value !== null && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
export interface McpAppContext {
  contextToken: string; identity: string; server: string; tool: string; resourceUri: string; html: string;
  csp: unknown; toolInput: unknown; toolResult: unknown; toolInfo: unknown;
}
interface BridgeOptions {
  context: McpAppContext;
  send: (message: RecordValue) => void;
  hostContext: () => RecordValue;
  call: (tool: string, args: unknown) => Promise<unknown>;
  read: (uri: string) => Promise<unknown>;
  openLink: (href: string) => Promise<void>;
  modelContext: (params: RecordValue) => Promise<void>;
  message: (params: RecordValue) => Promise<void>;
  size: (height: number) => void;
  ready: () => void;
}
/** The host dispatches a fixed MCP Apps subset, never arbitrary native JSON-RPC. */
export class McpAppBridge {
  private phase: "new" | "initializing" | "ready" | "closing" | "closed" = "new";
  private ids = new Set<string>();
  private result:unknown;
  private teardownSent=false;
  private finishTeardown?:()=>void;
  constructor(private readonly options: BridgeOptions) {this.result=options.context.toolResult;}
  updateToolResult(value:unknown){this.result=value;if(this.ready&&value!=null)this.notify("ui/notifications/tool-result",value);}
  teardown(reason="user-close"):Promise<void>{if(this.phase==="closed")return Promise.resolve();if(this.phase==="closing")return Promise.resolve();this.phase="closing";return new Promise(resolve=>{const timer=setTimeout(()=>this.close(),300);this.finishTeardown=()=>{clearTimeout(timer);resolve();};this.teardownSent=true;this.options.send({jsonrpc:"2.0",id:"kanban-resource-teardown",method:"ui/resource-teardown",params:{reason}});});}
  get ready() { return this.phase === "ready"; }
  notifyContext() { if (this.ready) this.notify("ui/notifications/host-context-changed", this.options.hostContext()); }
  private notify(method: string, params: unknown) { this.options.send({ jsonrpc: "2.0", method, params }); }
  close() {if(this.phase!=="closed"&&!this.teardownSent){this.teardownSent=true;this.options.send({jsonrpc:"2.0",id:"kanban-resource-teardown",method:"ui/resource-teardown",params:{reason:"view-released"}});} this.phase = "closed"; this.ids.clear();this.finishTeardown?.();this.finishTeardown=undefined; }
  async receive(value: unknown) {
    if (this.phase === "closed" || !value || typeof value !== "object" || Array.isArray(value)) return;
    let message: RecordValue; try { if (JSON.stringify(value).length > 80_000) return; message = object(value); } catch { return; }
    if(message.jsonrpc==="2.0"&&this.phase==="closing"&&message.id==="kanban-resource-teardown"){this.close();return;}
    if (message.jsonrpc !== "2.0" || typeof message.method !== "string") return;
    const method = message.method, params = object(message.params), id = message.id;
    const hasId = (typeof id === "string" && id.length > 0 && id.length <= 128) || typeof id === "number" && Number.isSafeInteger(id);
    const reply = (result: unknown) => { if (this.phase !== "closed" && hasId) this.options.send({ jsonrpc: "2.0", id, result }); };
    const error = (code: number, text: string) => { if (this.phase !== "closed" && hasId) this.options.send({ jsonrpc: "2.0", id, error: { code, message: text.slice(0, 1000) } }); };
    if (method === "ui/initialize") {
      if (!hasId || this.phase !== "new") return error(-32600, "MCP App is already initialized");
      if (params.protocolVersion !== "2026-01-26" || typeof object(params.appInfo).name !== "string") return error(-32602, "Unsupported MCP Apps protocol");
      this.phase = "initializing";
      return reply({ protocolVersion: "2026-01-26", hostInfo: { name: "Coding Kanban", version: "0.1.0" }, hostCapabilities: { serverTools: {}, serverResources: {}, openLinks: {}, logging: {}, sandbox: { permissions: {}, csp: this.options.context.csp } }, hostContext: this.options.hostContext() });
    }
    if (method === "ui/notifications/initialized") {
      if (hasId || this.phase !== "initializing") return;
      this.phase = "ready"; this.options.ready();
      this.notify("ui/notifications/tool-input", { arguments: this.options.context.toolInput });
      if (this.result != null) this.notify("ui/notifications/tool-result", this.result);
      return;
    }
    if (!this.ready) return error(-32600, "MCP App has not completed initialization");
    if (method === "ui/notifications/size-changed") {
      if (!hasId && typeof params.height === "number" && Number.isFinite(params.height)) this.options.size(Math.max(100, Math.min(720, Math.ceil(params.height))));
      return;
    }
    if (method === "notifications/message") return;
    if (!hasId) return;
    const key = JSON.stringify(id);
    if (this.ids.has(key)) return error(-32600, "MCP App request already submitted");
    if (this.ids.size >= 256) return error(-32000, "MCP App request budget reached; reopen the app");
    this.ids.add(key);
    try {
      switch (method) {
        case "ping": return reply({});
        case "tools/call":
          if (typeof params.name !== "string" || Object.keys(params).some((key) => !["name", "arguments"].includes(key))) return error(-32602, "Invalid app tool request");
          return reply(await this.options.call(params.name, params.arguments ?? {}));
        case "resources/read":
          if (typeof params.uri !== "string" || Object.keys(params).some((key) => key !== "uri")) return error(-32602, "Invalid app resource request");
          return reply(await this.options.read(params.uri));
        case "ui/open-link": {
          if (typeof params.url !== "string") return error(-32602, "Invalid link");
          const url = new URL(params.url);
          if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return error(-32602, "Unsupported link");
          await this.options.openLink(url.href); return reply({});
        }
        case "ui/update-model-context": await this.options.modelContext(params); return reply({});
        case "ui/message":
          if (params.role !== "user" || !Array.isArray(params.content)) return error(-32602, "Invalid app message");
          await this.options.message(params); return reply({});
        case "ui/request-display-mode": return reply({ mode: "inline" });
        default: return error(-32601, "MCP App host method is unsupported");
      }
    } catch (cause) { error(-32000, cause instanceof Error ? cause.message : "MCP App request failed"); }
  }
}
