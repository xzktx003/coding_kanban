import { expect, test } from "vitest";
import { createAcpStore } from "./useAcpStore";

test("pending approval stays bound to its original session through history navigation", () => {
  const store = createAcpStore();
  store.setState({ connectionId: "connection", sessionId: "original" });
  store
    .getState()
    .setPermission({ requestId: "request", title: "原会话请求", options: [] });
  store.getState().setSessionId("other");
  expect(store.getState().permission).toBeNull();
  store.getState().applySession({ sessionId: "original" });
  expect(store.getState().permission).toMatchObject({
    requestId: "request",
    connectionId: "connection",
    sessionId: "original",
  });
});

test("a permission arriving for a background session is saved without replacing foreground approval", () => {
  const store = createAcpStore();
  store.setState({ connectionId: "connection", sessionId: "foreground" });
  store
    .getState()
    .setPermission({ requestId: "current", title: "当前请求", options: [] });
  store.getState().setPermission({
    requestId: "background",
    title: "后台请求",
    options: [],
    connectionId: "connection",
    sessionId: "background-session",
  });
  expect(store.getState().permission?.requestId).toBe("current");
  store.getState().setSessionId("background-session");
  expect(store.getState().permission?.requestId).toBe("background");
});

test("parallel permission requests are handled in order without overwriting unresolved requests", () => {
  const store = createAcpStore();
  store.setState({ connectionId: "connection", sessionId: "session" });
  store
    .getState()
    .setPermission({ requestId: "first", title: "第一项请求", options: [] });
  store
    .getState()
    .setPermission({ requestId: "second", title: "第二项请求", options: [] });
  expect(store.getState().permission?.requestId).toBe("first");
  store.getState().dismissPermission("connection", "session", "first");
  expect(store.getState().permission?.requestId).toBe("second");
  store.getState().dismissPermission("connection", "session", "first");
  expect(store.getState().permission?.requestId).toBe("second");
  store.getState().dismissPermission("connection", "session", "second");
  expect(store.getState().permission).toBeNull();
});
