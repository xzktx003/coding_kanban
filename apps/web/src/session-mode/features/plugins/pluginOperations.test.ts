import { beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({
  post: vi.fn(),
  context: vi.fn(),
  current: true,
}));
vi.mock("@session/services/nativeOperationContext", () => ({
  readNativeOperationContext: api.context,
}));
vi.mock("@session/services/apiAdapt/shared", () => ({
  postJsonWithOptions: api.post,
  isExplicitRequestRejection: () => false,
}));
vi.mock("./pluginScope", () => ({
  capturePluginScope: () => ({}),
  isPluginScopeCurrent: () => api.current,
}));
import { performPluginOperation } from "./pluginOperations";
const target = {
  marketplacePath: "/private/market",
  remoteMarketplaceName: null,
  pluginName: "fixture",
};
beforeEach(() => {
  localStorage.clear();
  api.post.mockReset();
  api.context
    .mockReset()
    .mockResolvedValue({
      namespace: "native-account",
      scopeToken: "a".repeat(64),
    });
  api.current = true;
});
it("a lost response is durable and the next explicit action only inspects its original intent", async () => {
  api.post.mockRejectedValueOnce(new Error("network lost after write"));
  await expect(performPluginOperation(target, "install")).rejects.toThrow(
    "network lost",
  );
  const first = api.post.mock.calls[0][1];
  expect(first.inspectOnly).toBeUndefined();
  api.post.mockImplementation(async (_path, body) => ({
    operationId: body.operationId,
    status: "state-confirmed",
    appsNeedingAuth: [],
    plugin: { summary: { installed: false } },
  }));
  await performPluginOperation(target, "install");
  expect(api.post.mock.calls[1][1]).toMatchObject({
    operationId: first.operationId,
    operation: "install",
    inspectOnly: true,
  });
  const records = Object.keys(localStorage).filter((key) =>
    key.startsWith("kanban.session.plugin-mutations.v1:"),
  );
  expect(records).toHaveLength(1);
  expect(JSON.parse(localStorage.getItem(records[0])!).status).toBe(
    "state-confirmed",
  );
});
it("a revoked scope after context verification never posts a plugin mutation", async () => {
  api.context.mockImplementation(async () => {
    api.current = false;
    return { namespace: "native-account", scopeToken: "a".repeat(64) };
  });
  await expect(performPluginOperation(target, "install")).rejects.toThrow(
    "变化",
  );
  expect(api.post).not.toHaveBeenCalled();
});
it("another account namespace cannot consume the first account's unknown intent", async () => {
  api.post.mockRejectedValueOnce(new Error("unknown"));
  await expect(performPluginOperation(target, "install")).rejects.toThrow();
  const first = api.post.mock.calls[0][1];
  api.context.mockResolvedValue({
    namespace: "other-native-account",
    scopeToken: "b".repeat(64),
  });
  api.post.mockImplementation(async (_path, body) => ({
    operationId: body.operationId,
    status: "accepted",
    appsNeedingAuth: [],
  }));
  await performPluginOperation(target, "install");
  const second = api.post.mock.calls[1][1];
  expect(second.operationId).not.toBe(first.operationId);
  expect(second.inspectOnly).toBeUndefined();
  expect(second.expectedScope).toBe("b".repeat(64));
});
