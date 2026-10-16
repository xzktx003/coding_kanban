import { it, expect, vi, afterEach } from "vitest";
import { startNativeVisibilityClient } from "./native-visibility";
const profileId = "019aabcd-1234-7890-abcd-000000000001",
  instanceId = "019aabcd-1234-7890-abcd-000000000002",
  id = "019aabcd-1234-7890-abcd-000000000003";
const lease = {
  leaseId: "019aabcd-1234-7890-abcd-000000000004",
  token: "a".repeat(64),
};
class Socket extends EventTarget {
  static instances: Socket[] = [];
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  constructor(public url: string) {
    super();
    Socket.instances.push(this);
  }
  open() {
    this.readyState = 1;
    this.dispatchEvent(new Event("open"));
  }
  receive(value: unknown) {
    this.dispatchEvent(
      new MessageEvent("message", { data: JSON.stringify(value) }),
    );
  }
  send(body: string) {
    this.sent.push(JSON.parse(body));
  }
  close() {
    this.readyState = 3;
    this.dispatchEvent(new CloseEvent("close", { code: 1000 }));
  }
}
let client: ReturnType<typeof startNativeVisibilityClient> | undefined;
const key = `kanban.codex.visibility-lease.v1:${profileId}`;
function setup(type = "navigate") {
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", Socket);
  vi.stubGlobal("performance", { getEntriesByType: () => [{ type }] });
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  const states: string[] = [];
  client = startNativeVisibilityClient({
    profileId,
    instanceId,
    onState: (value) => states.push(value),
  });
  return { client, socket: Socket.instances.at(-1)!, states };
}
afterEach(() => {
  client?.stop();
  client = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  Socket.instances = [];
});
it("sends only bounded visible UUID metadata, coalesces until acknowledgement and keeps the native path untouched", () => {
  const { client, socket, states } = setup();
  client.setVisible([id], true);
  socket.open();
  expect(socket.url).toContain(
    `/native-codex/clients/${profileId}/kanban-visibility`,
  );
  expect(socket.sent).toEqual([{ type: "hello", instanceId }]);
  socket.receive({ type: "hello", ...lease });
  expect(socket.sent.at(-1)).toEqual({
    type: "visible",
    sequence: 1,
    threadIds: [id],
  });
  client.setVisible([], false);
  client.setVisible([id], true);
  expect(socket.sent).toHaveLength(2);
  socket.receive({ type: "ack", sequence: 1 });
  expect(socket.sent).toHaveLength(2);
  expect(states.at(-1)).toBe("protected");
  expect(Object.keys(JSON.parse(sessionStorage.getItem(key)!)).sort()).toEqual([
    "instanceId",
    "leaseId",
    "token",
  ]);
});
it("resumes saved protection only for a real reload, so a cloned new-tab sessionStorage cannot evict its opener", () => {
  sessionStorage.setItem(key, JSON.stringify({ instanceId, ...lease }));
  const first = setup();
  first.socket.open();
  expect(first.socket.sent[0]).toEqual({ type: "hello", instanceId });
  first.client.stop();
  sessionStorage.setItem(key, JSON.stringify({ instanceId, ...lease }));
  const second = setup("reload");
  second.socket.open();
  expect(second.socket.sent[0]).toEqual({
    type: "hello",
    instanceId,
    ...lease,
  });
});
it("pagehide cancels deferred hidden publication and holds the last visible set during reload", () => {
  const { client, socket } = setup();
  client.setVisible([id], true);
  socket.open();
  socket.receive({ type: "hello", ...lease });
  socket.receive({ type: "ack", sequence: 1 });
  vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  document.dispatchEvent(new Event("visibilitychange"));
  window.dispatchEvent(new PageTransitionEvent("pagehide"));
  vi.advanceTimersByTime(1000);
  expect(socket.sent).toHaveLength(2);
  expect(socket.readyState).toBe(3);
});
it("hidden mode publishes an empty set and old document callbacks cannot save another lease", () => {
  const { client, socket } = setup();
  client.setVisible([id], true);
  socket.open();
  socket.receive({ type: "hello", ...lease });
  socket.receive({ type: "ack", sequence: 1 });
  client.setVisible([id], false);
  expect(socket.sent.at(-1)).toEqual({
    type: "visible",
    sequence: 2,
    threadIds: [],
  });
  client.stop();
  socket.receive({ type: "hello", leaseId: id, token: "b".repeat(64) });
  expect(JSON.parse(sessionStorage.getItem(key)!).token).toBe(lease.token);
});

it("a missing visibility acknowledgement times out and connection attempts remain bounded", () => {
  const { client, socket, states } = setup();
  client.setVisible([id], true);
  socket.open();
  socket.receive({ type: "hello", ...lease });
  vi.advanceTimersByTime(5000);
  expect(socket.readyState).toBe(3);
  expect(states.at(-1)).toBe("unavailable");
  vi.advanceTimersByTime(1000);
  Socket.instances.at(-1)!.open();
  vi.advanceTimersByTime(5000);
  vi.advanceTimersByTime(2000);
  Socket.instances.at(-1)!.open();
  vi.advanceTimersByTime(30000);
  expect(Socket.instances).toHaveLength(3);
});
