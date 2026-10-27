import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  endpoint: "https://fixture.invalid",
  token: "A",
  fetch: vi.fn(),
  subscriber: null as any,
  prompts: [] as any[],
  stop: vi.fn(),
  danger: vi.fn(),
}));
vi.mock("@session/hooks/runtime", () => ({
  buildUrl: (path: string) => mocks.endpoint + path,
  authHeaders: () => ({ Authorization: mocks.token }),
}));
vi.mock("@session/lib/eventStream", () => ({
  openEventStream: (subscriber: any) => {
    mocks.subscriber = subscriber;
    return mocks.stop;
  },
}));
vi.mock("./prompt", () => ({
  showMcpPrompt: (name: string, reconnect: any, dismiss: any, remove: any) => {
    const prompt = { name, reconnect, dismiss, close: vi.fn(() => remove()) };
    mocks.prompts.push(prompt);
    return prompt;
  },
}));
vi.mock("../native-notifications/service", () => ({
  nativeNotifications: { danger: mocks.danger },
}));
import { useCodexStore } from "@session/components/codex/stores";
import { usePairingStore } from "@session/stores/usePairingStore";
import { startMcpAuthentication } from "./service";
let stop: (() => void) | undefined;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.endpoint = "https://fixture.invalid";
  mocks.token = "A";
  mocks.prompts = [];
  useCodexStore.setState({
    account: null,
    accountNamespace: null,
    currentThreadId: "A",
  });
  vi.stubGlobal("fetch", mocks.fetch);
  vi.spyOn(window, "open").mockReturnValue(null);
  mocks.fetch.mockImplementation(async (url: string) => ({
    ok: true,
    json: async () =>
      url.endsWith("/health")
        ? {
            capabilities: {
              codexMcpAuthV1: true,
              codexMcpOAuthThreadId: false,
            },
          }
        : url.endsWith("/config/read")
          ? { config: { desktop: { mcp_startup_authentication: false } } }
          : url.endsWith("/mcp/status/list")
            ? { data: [], nextCursor: null }
            : { authorizationUrl: "https://example.invalid/auth" },
  }));
});
afterEach(() => {
  stop?.();
  stop = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const emit = (method: string, params: any) =>
  mocks.subscriber.onEvent({
    event: "codex:notification",
    payload: { method, params },
  });
it("uses the runtime's fixed empty-body public config endpoint", async () => {
  stop = startMcpAuthentication();
  await vi.waitFor(() =>
    expect(
      mocks.fetch.mock.calls.some(([url]: any[]) =>
        url.endsWith("/config/read"),
      ),
    ).toBe(true),
  );
  const [, options] = mocks.fetch.mock.calls.find(([url]: any[]) =>
    url.endsWith("/config/read"),
  )!;
  expect(JSON.parse(options.body)).toEqual({});
});
it("reconciles a missed authentication inventory after stream resync without reading transcript bodies", async () => {
  let needsLogin = false;
  mocks.fetch.mockImplementation(async (url: string) => ({
    ok: true,
    json: async () =>
      url.endsWith("/health")
        ? {}
        : url.endsWith("/config/read")
          ? { config: { desktop: { mcp_startup_authentication: true } } }
          : {
              data: needsLogin
                ? [{ name: "inventory-fixture", authStatus: "notLoggedIn" }]
                : [],
              nextCursor: null,
            },
  }));
  stop = startMcpAuthentication();
  await vi.waitFor(() =>
    expect(
      mocks.fetch.mock.calls.some(([url]: any) =>
        url.endsWith("/mcp/status/list"),
      ),
    ).toBe(true),
  );
  expect(mocks.prompts).toHaveLength(0);
  needsLogin = true;
  expect(typeof mocks.subscriber.onResync).toBe("function");
  mocks.subscriber.onResync();
  await vi.waitFor(() => expect(mocks.prompts).toHaveLength(1));
  expect(mocks.prompts[0].name).toBe("inventory-fixture");
  expect(
    mocks.fetch.mock.calls.every(([url]: any) =>
      /\/(health|config\/read|mcp\/status\/list)$/.test(url),
    ),
  ).toBe(true);
});
it("disposes an issued OAuth request across same-email workspace changes", async () => {
  useCodexStore.setState({
    account: {
      type: "chatgpt",
      email: "fixture@example.invalid",
      planType: "plus",
    },
    accountNamespace: "workspace-A",
  } as any);
  stop = startMcpAuthentication();
  await vi.waitFor(() =>
    expect(mocks.fetch.mock.calls.length).toBeGreaterThanOrEqual(2),
  );
  let finish!: (v: any) => void;
  mocks.fetch.mockImplementationOnce(() => new Promise((r) => (finish = r)));
  emit("item/completed", {
    threadId: "A",
    item: {
      type: "mcpToolCall",
      server: "workspace-fixture",
      nativeMcpAuthChallenge: { scopes: [] },
    },
  });
  const pending = mocks.prompts[0].reconnect();
  useCodexStore.setState({ accountNamespace: "workspace-B" } as any);
  finish({
    ok: true,
    json: async () => ({
      authorizationUrl: "https://example.invalid/old-workspace",
    }),
  });
  await pending;
  expect(window.open).not.toHaveBeenCalled();
  expect(mocks.prompts[0].close).toHaveBeenCalledTimes(1);
  expect(mocks.danger).not.toHaveBeenCalled();
});
it("keeps an issued OAuth request when only the same account plan changes", async () => {
  useCodexStore.setState({
    account: {
      type: "chatgpt",
      email: "fixture@example.invalid",
      planType: "free",
    },
  });
  stop = startMcpAuthentication();
  await vi.waitFor(() =>
    expect(mocks.fetch.mock.calls.length).toBeGreaterThanOrEqual(2),
  );
  let finish!: (v: any) => void;
  mocks.fetch.mockImplementationOnce(() => new Promise((r) => (finish = r)));
  emit("item/completed", {
    threadId: "A",
    item: {
      type: "mcpToolCall",
      server: "plan-fixture",
      nativeMcpAuthChallenge: { scopes: [] },
    },
  });
  const pending = mocks.prompts[0].reconnect();
  useCodexStore.setState({
    account: {
      type: "chatgpt",
      email: "fixture@example.invalid",
      planType: "pro",
    },
  });
  finish({
    ok: true,
    json: async () => ({
      authorizationUrl: "https://example.invalid/account-plan",
    }),
  });
  await pending;
  expect(window.open).toHaveBeenCalledWith(
    "https://example.invalid/account-plan",
    "_blank",
    "noopener,noreferrer",
  );
  expect(mocks.prompts[0].close).not.toHaveBeenCalled();
});
it("uses one chat event subscriber and preserves the original runtime scopes and version gate", async () => {
  stop = startMcpAuthentication();
  await vi.waitFor(() =>
    expect(mocks.fetch.mock.calls.length).toBeGreaterThanOrEqual(2),
  );
  expect(mocks.subscriber).toMatchObject({
    agents: ["codex"],
    label: "mcp-authentication",
  });
  mocks.subscriber.onEvent({
    event: "codex:initialized",
    payload: { userAgent: "codex_cli_rs/0.143.0-alpha.26" },
  });
  emit("item/completed", {
    threadId: "A",
    item: {
      type: "mcpToolCall",
      server: "mcp",
      nativeMcpAuthChallenge: { scopes: ["read"] },
    },
  });
  await mocks.prompts[0].reconnect();
  const call = mocks.fetch.mock.calls.find(([url]: any) =>
    url.endsWith("/oauth/login"),
  )!;
  expect(JSON.parse(call[1].body)).toEqual({
    name: "mcp",
    threadId: "A",
    scopes: ["read"],
  });
  expect(call[1].headers.Authorization).toBe("A");
  expect(window.open).toHaveBeenCalledWith(
    "https://example.invalid/auth",
    "_blank",
    "noopener,noreferrer",
  );
});
it("disposes old identity before late OAuth returns and does not open its URL or show an error", async () => {
  stop = startMcpAuthentication();
  await vi.waitFor(() =>
    expect(mocks.fetch.mock.calls.length).toBeGreaterThanOrEqual(2),
  );
  let finish!: (v: any) => void;
  mocks.fetch.mockImplementationOnce(() => new Promise((r) => (finish = r)));
  emit("item/completed", {
    threadId: "A",
    item: {
      type: "mcpToolCall",
      server: "mcp",
      nativeMcpAuthChallenge: { scopes: [] },
    },
  });
  const pending = mocks.prompts[0].reconnect();
  mocks.endpoint = "https://other.invalid";
  mocks.token = "B";
  usePairingStore.setState({ selectedHost: null });
  finish({
    ok: true,
    json: async () => ({ authorizationUrl: "https://example.invalid/late" }),
  });
  await pending;
  expect(window.open).not.toHaveBeenCalled();
  expect(mocks.prompts[0].close).toHaveBeenCalledTimes(1);
  expect(mocks.danger).not.toHaveBeenCalled();
});
it("protocol completion triggers only the fixed refresh route after health advertises it", async () => {
  stop = startMcpAuthentication();
  await vi.waitFor(() =>
    expect(mocks.fetch.mock.calls.length).toBeGreaterThanOrEqual(2),
  );
  await Promise.resolve();
  emit("item/completed", {
    threadId: "A",
    item: {
      type: "mcpToolCall",
      server: "mcp",
      nativeMcpAuthChallenge: { scopes: [] },
    },
  });
  await mocks.prompts[0].reconnect();
  emit("mcpServer/oauthLogin/completed", { name: "mcp", success: true });
  await vi.waitFor(() =>
    expect(
      mocks.fetch.mock.calls.some(([url]: any) => url.endsWith("/mcp/reload")),
    ).toBe(true),
  );
});
