import { McpAppSourceReader } from "./mcp-app-source.js";
import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { bodyObject, HttpError, isObject, object, type Json, type JsonObject } from "../core/json.js";
import type { CodexService } from "./client.js";
import type { Rpc } from "./ownership.js";
import { readItemDetail } from "./item-detail.js";

type Target = { threadId: string; turnId: string; itemId: string };
type Connection = { connected: boolean; generation: number; scope?: string };
interface Options {
  raw: Rpc;
  snapshot: () => Connection;
  readSource: (target: Target, signal: AbortSignal) => Promise<{ item: JsonObject; scope?: string }>;
  now?: () => number;
}
interface Context {
  target: Target;
  epoch: number;
  connection: Connection;
  account: string;
  catalog: string;
  identity: string;
  server: string;
  tool: string;
  uri: string;
  tools: Set<string>;
  resources: Set<string>;
  expires: number;
  intents: Map<string, "pending" | "accepted" | "unknown">;
  revoked?: boolean;
  hostedAuthority?: {connectorId:string;linkId:string|null};
}
const short = (value: unknown, limit = 512): value is string => typeof value === "string" && value.length > 0 && value.length <= limit && !/[\x00-\x1f\x7f]/.test(value);
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function fail(message: string, status = 409): never { throw new HttpError(status, message); }
const targetBody = (value: JsonObject): Target => {
  if (Object.keys(value).some((key) => !["threadId", "turnId", "itemId"].includes(key)) || !short(value.threadId) || !short(value.turnId) || !short(value.itemId)) fail("Invalid MCP App source", 400);
  return value as unknown as Target;
};
const resourceUri = (tool: JsonObject) => {
  const meta = object(tool._meta), ui = object(meta.ui);
  return ui.resourceUri ?? meta["ui/resourceUri"] ?? meta["openai/outputTemplate"];
};
const sameConnection = (a: Connection, b: Connection) => a.connected && b.connected && a.generation === b.generation && a.scope === b.scope;

/** Explicit widget lifetime. This service never starts/resumes a thread or owns an execution scheduler. */
export class McpApps {
  private epoch = 0;
  private closed = false;
  private contexts = new Map<string, Context>();
  private active = new Set<AbortController>();
  private now: () => number;
  constructor(private readonly options: Options) { this.now = options.now ?? Date.now; }
  observe(event: string, method?: string) {
    if (event === "codex:disconnected" || ["account/updated", "account/login/completed", "mcpServer/oauthLogin/completed", "mcpServer/startupStatus/updated", "app/list/updated"].includes(method ?? "")) {
      this.epoch++; this.contexts.clear();
      for (const controller of this.active) controller.abort();
    }
  }
  close() { this.closed = true; this.observe("codex:disconnected"); }
  revoke(token: Json) { if (typeof token === "string") { const context = this.contexts.get(token); if (context) context.revoked = true; this.contexts.delete(token); } return {}; }
  private assert(context: Context) {
    if (this.closed || context.revoked || context.epoch !== this.epoch || context.expires <= this.now() || !sameConnection(context.connection, this.options.snapshot())) fail("MCP App context changed, expired or revoked");
  }
  private async account(signal: AbortSignal) { return hash(await this.options.raw("account/read", { refreshToken: false }, { signal })); }
  private async catalog(threadId: string, server: string, signal: AbortSignal) {
    const seen = new Set<string>(); let cursor: Json = null, found: JsonObject | undefined, total = 0;
    for (let page = 0; page < 8; page++) {
      const response = object(await this.options.raw("mcpServerStatus/list", { threadId, cursor, limit: 100 }, { signal }));
      if (!Array.isArray(response.data)) fail("Invalid MCP App catalog", 502);
      total += bytes(response.data); if (total > 1_048_576) fail("MCP App catalog exceeds budget", 413);
      for (const entry of response.data) if (object(entry).name === server) {
        if (found) fail("Ambiguous MCP App catalog", 502);
        found = object(entry);
      }
      cursor = response.nextCursor;
      if (cursor == null) { if (!found) fail("MCP App server missing from catalog", 404); return found; }
      if (!short(cursor, 4096) || seen.has(cursor) || page === 7) fail("Invalid MCP App catalog cursor", 502);
      seen.add(cursor);
    }
    return fail("MCP App catalog unavailable", 502);
  }
  private async resource(context: Context, uri: string, signal: AbortSignal) {
    const response = object(await this.options.raw("mcpServer/resource/read", {
      threadId: context.target.threadId, server: context.server, uri,
      ...(context.server === "codex_apps" ? { originCallId: context.target.itemId } : {}),
    }, { signal, beforeSend: () => this.assert(context) }));
    this.assert(context);
    if (bytes(response) > 2_097_152) fail("MCP App resource exceeds budget", 413);
    if (context.server === "codex_apps" && response.originCallId !== context.target.itemId) fail("MCP App resource origin identity unverified");
    if (!Array.isArray(response.contents) || response.contents.some((entry) => object(entry).uri !== uri)) fail("MCP App resource identity mismatch", 502);
    return response;
  }
  private async run<T>(signal: AbortSignal | undefined, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.closed) fail("MCP App service closed", 503);
    if (this.active.size >= 6) fail("MCP App requests busy", 429);
    const controller = new AbortController(), abort = () => controller.abort(signal?.reason);
    if (signal?.aborted) controller.abort(signal.reason);
    signal?.addEventListener("abort", abort, { once: true }); this.active.add(controller);
    const timer = setTimeout(() => controller.abort(new Error("MCP App request timeout")), 30_000); timer.unref();
    try { controller.signal.throwIfAborted(); return await work(controller.signal); }
    finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); this.active.delete(controller); }
  }
  async context(value: JsonObject, signal?: AbortSignal) {
    const target = targetBody(value);
    return this.run(signal, async (activeSignal) => {
      for (const [token, entry] of this.contexts) if (entry.expires <= this.now()) this.contexts.delete(token);
      if (this.contexts.size >= 64) fail("Too many open MCP Apps", 429);
      const epoch = this.epoch, account = await this.account(activeSignal), connection = this.options.snapshot();
      if (!connection.connected || !connection.scope) fail("MCP App connection unavailable", 503);
      const source = await this.options.readSource(target, activeSignal), item = source.item;
      if (source.scope !== connection.scope || item.id !== target.itemId || item.type !== "mcpToolCall" || !short(item.server) || !short(item.tool)) fail("MCP App source identity mismatch");
      const uri = object(item.appContext).resourceUri ?? item.mcpAppResourceUri;
      if (!short(uri, 4096) || !uri.startsWith("ui://")) fail("MCP App resource URI unsupported", 422);
      const catalog = await this.catalog(target.threadId, item.server, activeSignal), tool = object(object(catalog.tools)[item.tool]);
      if (resourceUri(tool) !== uri) fail("MCP App resource does not match tool catalog");
      let hostedAuthority: Context["hostedAuthority"];
      if (item.server === "codex_apps") {
        const connectorId=object(item.appContext).connectorId,meta=object(tool._meta),linkId=meta.link_id;
        if(!short(connectorId)||meta.connector_id!==connectorId||!(linkId===null||short(linkId)&&!linkId.startsWith("synthetic_link::")))fail("Hosted MCP App connector/link authority is unverified",422);
        hostedAuthority={connectorId,linkId:linkId as string|null};
      }
      const tools = new Set<string>(), resources = new Set<string>([uri]);
      for (const [key, entry] of Object.entries(object(catalog.tools))) {
        const ui = object(object(object(entry)._meta).ui), visibility = ui.visibility;
        const meta=object(object(entry)._meta);
        if (short(key) && (visibility === undefined || Array.isArray(visibility) && visibility.includes("app")) && (!hostedAuthority || meta.connector_id===hostedAuthority.connectorId && meta.link_id===hostedAuthority.linkId)) tools.add(key);
      }
      for (const entry of Array.isArray(catalog.resources) ? catalog.resources : []) {
        const known = object(entry).uri; if (short(known, 4096)) resources.add(known);
      }
      const context: Context = { target, epoch, account, connection, catalog: hash(catalog), identity: hash([epoch, account, connection, target, item.server, uri, hash(catalog)]),
        server: item.server, tool: item.tool, uri, tools, resources, ...(hostedAuthority?{hostedAuthority}:{}), expires: this.now() + 300_000, intents: new Map() };
      this.assert(context);
      const response = await this.resource(context, uri, activeSignal);
      const resource = (response.contents as Json[]).map(object).find((entry) => entry.uri === uri && ["text/html", "text/html;profile=mcp-app"].includes(String(entry.mimeType)) && typeof entry.text === "string");
      if (!resource || typeof resource.text !== "string") fail("MCP App returned an unsupported resource type", 422);
      if (Buffer.byteLength(resource.text) > 1_048_576) fail("MCP App HTML exceeds budget", 413);
      const toolInput = item.arguments ?? {}, toolResult = this.toolResult(item);
      if (bytes([toolInput, toolResult]) > 1_048_576) fail("MCP App initial tool data exceeds budget", 413);
      if (account !== await this.account(activeSignal)) fail("MCP App account changed");
      this.assert(context);
      if (this.contexts.size >= 64) fail("Too many open MCP Apps", 429);
      const token = randomBytes(32).toString("hex"); this.contexts.set(token, context);
      const meta = object(resource._meta);
      return { contextToken: token, identity: context.identity, server: context.server, tool: context.tool, resourceUri: uri,
        html: resource.text, csp: object(meta.ui).csp ?? meta["openai/widgetCSP"] ?? {}, toolInput, toolResult, toolInfo: tool };
    });
  }
  async result(value: JsonObject, signal?: AbortSignal) {
    if(Object.keys(value).some(key=>key!=="contextToken"))fail("Invalid MCP App result request",400);
    const context=this.get(value.contextToken);
    return this.run(signal,async activeSignal=>{await this.verify(context,activeSignal);const source=await this.options.readSource(context.target,activeSignal),item=source.item;
      if(source.scope!==context.connection.scope||item.type!=="mcpToolCall"||item.id!==context.target.itemId||item.server!==context.server||item.tool!==context.tool||(object(item.appContext).resourceUri??item.mcpAppResourceUri)!==context.uri)fail("MCP App result source identity changed");
      this.assert(context);const toolResult=this.toolResult(item);if(bytes(toolResult)>1_048_576)fail("MCP App tool result exceeds budget",413);return {status:item.status,toolResult};});
  }
  private toolResult(item:JsonObject):Json {if(isObject(item.result))return {...item.result,...(item.status==="failed"?{isError:true}:{})};if(item.error!=null)return {isError:true,content:[{type:"text",text:String(object(item.error).message??"Tool failed").slice(0,4000)}]};return null;}
  private get(token: Json): Context {
    const context = typeof token === "string" ? this.contexts.get(token) : undefined;
    if (!context) fail("MCP App context expired or revoked");
    this.assert(context); return context;
  }
  private async verify(context: Context, signal: AbortSignal) {
    this.assert(context);
    if (context.account !== await this.account(signal)) fail("MCP App account changed");
    const current = await this.catalog(context.target.threadId, context.server, signal);
    if (hash(current) !== context.catalog) fail("MCP App catalog changed");
    this.assert(context);
  }
  async read(value: JsonObject, signal?: AbortSignal) {
    if (Object.keys(value).some((key) => !["contextToken", "uri"].includes(key))) fail("Invalid MCP App resource request", 400);
    const context = this.get(value.contextToken), uri = value.uri ?? context.uri;
    if (!short(uri, 4096) || !context.resources.has(uri)) fail("MCP App resource is not in its catalog", 403);
    return this.run(signal, async (activeSignal) => { await this.verify(context, activeSignal); return this.resource(context, uri, activeSignal); });
  }
  async call(value: JsonObject, signal?: AbortSignal) {
    if (Object.keys(value).some((key) => !["contextToken", "threadId", "tool", "arguments", "intentId", "confirmed"].includes(key)) || value.confirmed !== true || !short(value.intentId, 128)) fail("MCP App tool requires explicit confirmed intent", 400);
    const context = this.get(value.contextToken);
    if (value.threadId !== context.target.threadId) fail("MCP App thread identity mismatch", 409);
    if (!short(value.tool) || !context.tools.has(value.tool)) fail("MCP App tool is not app-visible in its catalog", 403);
    if (context.server === "codex_apps" && !context.hostedAuthority) fail("Hosted MCP App connector/link authority is unverified", 422);
    if (bytes(value.arguments ?? {}) > 65_536) fail("MCP App tool arguments exceed budget", 413);
    if (context.intents.has(value.intentId)) fail("MCP App intent already submitted; outcome may be unknown");
    if (context.intents.size >= 128) fail("MCP App intent budget reached; reopen after checking results", 429);
    const intent = value.intentId; context.intents.set(intent, "pending");
    return this.run(signal, async (activeSignal) => {
      let sent = false;
      try {
        await this.verify(context, activeSignal);
        if(context.hostedAuthority) await this.resource(context,context.uri,activeSignal);
        const response = await this.options.raw("mcpServer/tool/call", { threadId: context.target.threadId, server: context.server, tool: value.tool, arguments: value.arguments ?? {}, ...(context.hostedAuthority?{_meta:{_codex_apps:{resource_uri:context.uri},thread_id:context.target.threadId,threadId:context.target.threadId}}:{}) }, {
          signal: activeSignal, beforeSend: () => { this.assert(context); sent = true; },
        });
        this.assert(context);
        if (bytes(response) > 2_097_152) fail("MCP App tool result exceeds budget", 413);
        context.intents.set(intent, "accepted"); return response;
      } catch (error) { if (sent) context.intents.set(intent, "unknown"); else context.intents.delete(intent); throw error; }
    });
  }
}

export function registerMcpAppRoutes(app: FastifyInstance, service: CodexService) {
  const source = new McpAppSourceReader(service.options.hub,()=>service.connectionSnapshot(),async(target,signal)=>{
      const controller = new AbortController(), abort = () => controller.abort(signal.reason);
      signal.addEventListener("abort",abort,{once:true});if(signal.aborted)abort();let reading:Awaited<ReturnType<typeof readItemDetail>>|undefined;
      try{reading=await readItemDetail(service.options,{...target,expectedType:"mcpToolCall"},controller.signal);const chunks:Buffer[]=[];let size=0;for await(const chunk of reading.body){size+=Buffer.byteLength(chunk);if(size>2097152){controller.abort();fail("MCP App source exceeds budget",413);}chunks.push(Buffer.from(chunk));}await reading.finished;return {item:object(object(JSON.parse(Buffer.concat(chunks).toString("utf8"))).item),scope:reading.metrics.nativeScope};}finally{signal.removeEventListener("abort",abort);if(reading)await reading.finished.catch(()=>{});}
    });
  const widgets = new McpApps({ raw: (method, params, options) => service.raw(method, params, options), snapshot: () => service.connectionSnapshot(),
    readSource: (target,signal)=>source.read(target,signal) });
  // EventHub invokes filters synchronously at publication, before any later JSONL write guard.
  const subscription = service.options.hub.subscribe({ agents: "codex", filter: (event) => { widgets.observe(event.event, typeof event.payload.method === "string" ? event.payload.method : undefined); return false; } });
  app.addHook("preClose", async () => { widgets.close(); source.close(); subscription.close(); });
  for (const action of ["context", "read", "result", "call", "revoke"] as const) app.post("/api/codex/mcp/app/" + action, { bodyLimit: 80_000 }, async (request, reply) => {
    reply.header("cache-control", "no-store");
    const body = bodyObject(request.body), controller = new AbortController();
    const abort = () => { if (!reply.raw.writableFinished) controller.abort(); };
    request.raw.once("aborted", abort); reply.raw.once("close", abort);
    try { return action === "revoke" ? widgets.revoke(body.contextToken) : await widgets[action](body, controller.signal); }
    finally { request.raw.off("aborted", abort); reply.raw.off("close", abort); }
  });
}
