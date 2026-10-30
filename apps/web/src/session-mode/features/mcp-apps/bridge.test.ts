import { expect, it, vi } from "vitest";
import { McpAppBridge, type McpAppContext } from "./bridge";
const context: McpAppContext = { contextToken: "a".repeat(64), identity: "b".repeat(64), server: "local", tool: "show", resourceUri: "ui://app", html: "", csp: {}, toolInput: { captured: true }, toolResult: { content: [{ type: "text", text: "result" }] }, toolInfo: {} };
function fixture() {
  const options = { context, send: vi.fn(), hostContext: () => ({ theme: "dark" }), call: vi.fn().mockResolvedValue({ content: [] }), read: vi.fn().mockResolvedValue({ contents: [] }), openLink: vi.fn(), modelContext: vi.fn(), message: vi.fn(), size: vi.fn(), ready: vi.fn() };
  return { bridge: new McpAppBridge(options), ...options };
}
async function initialize(f: ReturnType<typeof fixture>) {
  await f.bridge.receive({ jsonrpc: "2.0", id: "init", method: "ui/initialize", params: { protocolVersion: "2026-01-26", appInfo: { name: "fixture", version: "1" }, appCapabilities: {} } });
  expect(f.send).toHaveBeenCalledOnce();
  await f.bridge.receive({ jsonrpc: "2.0", method: "ui/notifications/initialized" });
}
it("does not execute or send initial tool data before the declared Apps handshake is complete", async () => {
  const f = fixture();
  await f.bridge.receive({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "show" } });
  expect(f.call).not.toHaveBeenCalled(); expect(f.send.mock.calls[0][0].error.code).toBe(-32600);
  f.send.mockClear(); await initialize(f);
  expect(f.send.mock.calls.map(([value]) => value.method).filter(Boolean)).toEqual(["ui/notifications/tool-input", "ui/notifications/tool-result"]);
  expect(f.ready).toHaveBeenCalledOnce();
});
it("dispatches only catalog-bound tool/resource actions and never reissues duplicate request IDs", async () => {
  const f = fixture(); await initialize(f);
  const request = { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "show", arguments: { n: 1 } } };
  await f.bridge.receive(request); await f.bridge.receive(request);
  expect(f.call).toHaveBeenCalledOnce(); expect(f.call).toHaveBeenCalledWith("show", { n: 1 });
  await f.bridge.receive({ jsonrpc: "2.0", id: 3, method: "resources/read", params: { uri: "ui://app" } });
  expect(f.read).toHaveBeenCalledWith("ui://app");
  for (const params of [{ name: "show", _meta: { bypass: true } }, { name: "show", method: "turn/start" }])
    await f.bridge.receive({ jsonrpc: "2.0", id: JSON.stringify(params), method: "tools/call", params });
  expect(f.call).toHaveBeenCalledOnce();
  await f.bridge.receive({ jsonrpc: "2.0", id: 4, method: "turn/start", params: {} });
  expect(f.send.mock.calls.at(-1)?.[0].error.code).toBe(-32601);
});
it("bounds resize and URLs and releases late action responses when the widget closes", async () => {
  const f = fixture(); await initialize(f);
  await f.bridge.receive({ jsonrpc: "2.0", method: "ui/notifications/size-changed", params: { height: 99_999 } });
  expect(f.size).toHaveBeenCalledWith(720);
  for (const url of ["javascript:alert(1)", "https://user:secret@example.invalid/", "file:///etc/passwd"])
    await f.bridge.receive({ jsonrpc: "2.0", id: url, method: "ui/open-link", params: { url } });
  expect(f.openLink).not.toHaveBeenCalled();
  let finish!: (value: unknown) => void;
  f.call.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const pending = f.bridge.receive({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "show" } });
  f.bridge.close(); f.send.mockClear(); finish({ content: [] }); await pending;
  expect(f.send).not.toHaveBeenCalled();
});
it("requests graceful teardown before closing the view and never accepts more tool writes",async()=>{const f=fixture();await f.bridge.receive({jsonrpc:"2.0",id:1,method:"ui/initialize",params:{protocolVersion:"2026-01-26",appInfo:{name:"test"}}});await f.bridge.receive({jsonrpc:"2.0",method:"ui/notifications/initialized"});const closing=f.bridge.teardown();const request=f.send.mock.calls.at(-1)![0];expect(request.method).toBe("ui/resource-teardown");await f.bridge.receive({jsonrpc:"2.0",id:request.id,result:{}});await closing;await f.bridge.receive({jsonrpc:"2.0",id:30,method:"tools/call",params:{name:"show",arguments:{}}});expect(f.call).not.toHaveBeenCalled();});
