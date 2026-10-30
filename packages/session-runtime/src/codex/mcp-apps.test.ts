import test from "node:test";
import assert from "node:assert/strict";
import { McpApps } from "./mcp-apps.js";
import type { Json, JsonObject } from "../core/json.js";
const target = { threadId: "thread", turnId: "turn", itemId: "item" };
function fixture() {
  const calls: Array<{method: string;params: Json}> = [];
  let generation = 1, guard = () => {}, failCall = false;
  const server: JsonObject = { name: "local", authStatus: "notLoggedIn", tools: { show: { name: "show", inputSchema: { type: "object" }, _meta: { ui: { resourceUri: "ui://example", visibility: ["app", "model"] } } }, hidden: { name: "hidden", inputSchema: {}, _meta: { ui: { visibility: ["model"] } } } }, resources: [{ uri: "ui://example", name: "Example", mimeType: "text/html;profile=mcp-app" }] };
  let html = "<html><body>actual resource</body></html>", source: JsonObject = { type: "mcpToolCall", id: "item", server: "local", tool: "show", mcpAppResourceUri: "ui://example", arguments: { q: "captured" }, status: "completed", result: { content: [{ type: "text", text: "result" }], structuredContent: null, _meta: null } };
  const service = new McpApps({
    snapshot: () => ({ connected: true, generation, scope: "scope" }),
    readSource: async () => ({ item: source, scope: "scope" }),
    raw: async (method: string, params: Json, options?: {beforeSend?: () => void}): Promise<Json> => {
      guard(); options?.beforeSend?.(); calls.push({ method, params });
      if (method === "account/read") return { account: null };
      if (method === "mcpServerStatus/list") return { data: [server], nextCursor: null };
      if (method === "mcpServer/resource/read") return { contents: [{ uri: "ui://example", mimeType: "text/html;profile=mcp-app", text: html }],...(typeof (params as JsonObject).originCallId==="string"?{originCallId:(params as JsonObject).originCallId}:{}) };
      if (method === "mcpServer/tool/call") { if (failCall) throw new Error("connection closed after write"); return { content: [{type:"text",text:"accepted"}], isError: false }; }
      throw new Error("unexpected method " + method);
    },
  }) as any;
  return { service, calls, server, source, setHtml:(value:string)=>{html=value;}, setSource:(value:JsonObject)=>{source=value;}, setGeneration:()=>{generation++;}, setGuard:(value:()=>void)=>{guard=value;}, failCall:()=>{failCall=true;} };
}
test("MCP App loads only exact native item, catalog and resource identity with bounded initial tool data", async () => {
  const f = fixture(), context = await f.service.context(target);
  assert.match(context.contextToken, /^[a-f0-9]{64}$/);
  assert.equal(context.html, "<html><body>actual resource</body></html>");
  assert.deepEqual(context.toolInput, { q: "captured" });
  assert.equal(context.resourceUri, "ui://example");
  assert.ok(f.calls.every((call) => !/thread\/(resume|start)|turn\/start/.test(call.method)));
  await f.service.call({ contextToken: context.contextToken, threadId:"thread", tool: "show", arguments: { n: 1 }, intentId: "intent-one", confirmed: true });
  const call = f.calls.find((entry) => entry.method === "mcpServer/tool/call");
  assert.deepEqual(call?.params, { threadId: "thread", server: "local", tool: "show", arguments: { n: 1 } });
});
test("concurrent resource reads cannot publish contexts beyond the fixed App budget",async()=>{const f=fixture();for(let index=0;index<63;index++)await f.service.context(target);const results=await Promise.allSettled(Array.from({length:6},()=>f.service.context(target)));assert.equal(results.filter(value=>value.status==="fulfilled").length,1);assert.equal(results.filter(value=>value.status==="rejected").length,5);assert.ok(!f.calls.some(call=>/thread\/(resume|start)|turn\/start|mcpServer\/tool\/call/.test(call.method)));f.service.close();});
test("MCP App rejects native item/catalog disagreement and arbitrary tool or metadata forwarding", async () => {
  const f = fixture(); f.setSource({ ...f.source, mcpAppResourceUri: "ui://wrong" });
  await assert.rejects(f.service.context(target), /resource|catalog/i);
  f.setSource(f.source);
  const context = await f.service.context(target);
  for (const body of [
    { tool: "hidden" }, { threadId: "other", tool: "show" }, { tool: "not-in-catalog" }, { tool: "show", _meta: { secret: true } }, { tool: "show", confirmed: false },
  ]) await assert.rejects(f.service.call({ contextToken: context.contextToken, arguments: {}, intentId: "intent-one", confirmed: true, ...body }));
  assert.ok(!f.calls.some((entry) => entry.method === "mcpServer/tool/call"));
});
test("same-value account notifications and transport generation changes revoke widget writes", async () => {
  for (const invalidate of ["account", "transport"] as const) {
    const f = fixture(), context = await f.service.context(target);
    if (invalidate === "account") f.service.observe("codex:notification", "account/updated"); else f.setGeneration();
    await assert.rejects(f.service.call({ contextToken: context.contextToken, threadId:"thread", tool: "show", arguments: {}, intentId: "intent-one", confirmed: true }), /changed|expired|revoked/i);
    assert.ok(!f.calls.some((entry) => entry.method === "mcpServer/tool/call"));
  }
});
test("unknown tool receipts are never automatically reissued under the same submitted intent", async () => {
  const f = fixture(), context = await f.service.context(target);
  const body = { contextToken: context.contextToken, threadId:"thread", tool: "show", arguments: {}, intentId: "intent-one", confirmed: true };
  f.failCall();
  await assert.rejects(f.service.call(body));
  await assert.rejects(f.service.call(body), /already|unknown|submitted/i);
  assert.equal(f.calls.filter((entry) => entry.method === "mcpServer/tool/call").length, 1);
});
test("resource budget and synchronous pre-write revocation fail closed", async () => {
  const oversized = fixture(); oversized.setHtml("x".repeat(1_048_577));
  await assert.rejects(oversized.service.context(target), /large|budget/i);
  const f = fixture(), context = await f.service.context(target);
  f.setGuard(() => { f.service.observe("codex:notification", "account/updated"); });
  await assert.rejects(f.service.call({ contextToken: context.contextToken, threadId:"thread", tool: "show", arguments: {}, intentId: "intent-one", confirmed: true }));
  assert.ok(!f.calls.some((entry) => entry.method === "mcpServer/tool/call"));
});
test("hosted App tools require matching native connector and real link authority, never widget supplied metadata",async()=>{const f=fixture();f.server.name="codex_apps";f.setSource({...f.source,server:"codex_apps",appContext:{connectorId:"connector-test",resourceUri:"ui://example"}});const tool=(f.server.tools as JsonObject).show as JsonObject;tool._meta={ui:{resourceUri:"ui://example",visibility:["app","model"]},connector_id:"connector-test",link_id:"real-link"};const context=await f.service.context(target);await f.service.call({contextToken:context.contextToken,threadId:"thread",tool:"show",arguments:{},intentId:"hosted-intent",confirmed:true});const call=f.calls.find(entry=>entry.method==="mcpServer/tool/call");assert.deepEqual((call?.params as JsonObject)._meta,{_codex_apps:{resource_uri:"ui://example"},thread_id:"thread",threadId:"thread"});});
test("an already open widget reads a later exact native result without rereading its HTML resource",async()=>{const f=fixture(),context=await f.service.context(target),resourcesBefore=f.calls.filter(entry=>entry.method==="mcpServer/resource/read").length;f.setSource({...f.source,status:"completed",result:{content:[{type:"text",text:"late final native tool result"}]}});const result=await f.service.result({contextToken:context.contextToken});assert.equal(result.status,"completed");assert.match(JSON.stringify(result.toolResult),/late final native tool result/);assert.equal(f.calls.filter(entry=>entry.method==="mcpServer/resource/read").length,resourcesBefore);});
