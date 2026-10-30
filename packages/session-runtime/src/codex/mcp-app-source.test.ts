import assert from "node:assert/strict";
import test from "node:test";
import { EventHub } from "../core/events.js";
import type { CodexService } from "./client.js";
import { McpAppSourceReader } from "./mcp-app-source.js";

const target = { threadId: "thread", turnId: "turn", itemId: "item" };
function fixture() {
  const hub = new EventHub();
  const state: ReturnType<CodexService["connectionSnapshot"]> = {
    mode: "fixture", connected: true, generation: 1, scope: "private-domain", accountRevision: 1,
  };
  let fallbacks = 0;
  const reader = new McpAppSourceReader(hub, () => ({ ...state }), async () => {
    fallbacks++;
    return { item: { id: "item", type: "mcpToolCall", status: "fallback" }, scope: state.scope };
  });
  const publish = (status: string, extra = {}) => hub.publish("codex:notification", {
    method: "item/completed", params: { ...target, item: { id: "item", type: "mcpToolCall", status, ...extra } },
  });
  return { hub, state, reader, publish, fallbacks: () => fallbacks };
}
test("MCP source uses only the exact latest item from the existing bounded replay and releases its temporary subscription", async () => {
  const f = fixture();
  f.publish("old");
  f.hub.publish("codex:notification", { method: "item/completed", params: { ...target, threadId: "other", item: { id: "item", type: "mcpToolCall", status: "foreign" } } });
  f.publish("completed");
  assert.equal((await f.reader.read(target, new AbortController().signal)).item.status, "completed");
  assert.equal(f.fallbacks(), 0);
  assert.equal(f.hub.subscriberCount, 1);
  f.reader.close();
  assert.equal(f.hub.subscriberCount, 0);
});
test("same-value account events and native connection generations invalidate old replay without caching item bodies", async () => {
  const f = fixture();
  f.publish("completed");
  f.state.accountRevision++;
  f.hub.publish("codex:notification", { method: "account/updated", params: { account: null } });
  assert.equal((await f.reader.read(target, new AbortController().signal)).item.status, "fallback");
  f.publish("fresh");
  assert.equal((await f.reader.read(target, new AbortController().signal)).item.status, "fresh");
  f.state.generation++;
  assert.equal((await f.reader.read(target, new AbortController().signal)).item.status, "fallback");
  f.reader.close();
});
test("MCP source rejects oversized or aborted native item reads and never retains an extra subscription", async () => {
  const f = fixture();
  f.publish("completed", { result: "x".repeat(2 * 1024 * 1024) });
  await assert.rejects(f.reader.read(target, new AbortController().signal), /budget/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(f.reader.read(target, controller.signal), /abort/i);
  assert.equal(f.hub.subscriberCount, 1);
  f.reader.close();
});
test("fallback results cannot return after a same-value account revision or domain changed", async () => {
  const hub = new EventHub();
  const state: ReturnType<CodexService["connectionSnapshot"]> = { mode: "fixture", connected: true, generation: 1, accountRevision: 1, scope: "original" };
  let release!: (value: {item: {id:string;type:string};scope:string}) => void;
  const reader = new McpAppSourceReader(hub, () => ({...state}), () => new Promise(resolve => { release = resolve; }));
  const reading = reader.read(target, new AbortController().signal);
  state.accountRevision++;
  release({item:{id:"item",type:"mcpToolCall"},scope:"original"});
  await assert.rejects(reading, /identity changed/);
  reader.close();
});
