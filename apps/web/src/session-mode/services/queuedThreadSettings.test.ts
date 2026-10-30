import { beforeEach, expect, it, vi } from "vitest";
import { applyQueuedThreadSettings } from "./queuedThreadSettings";
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("./resumeInterruptedTurn", () => ({
  lifecycleContext: async () => ({
    namespace: "history-domain",
    scopeToken: "current-scope",
  }),
}));
vi.mock("./apiAdapt/shared", () => ({
  getJsonWithOptions: api.get,
  postJsonWithOptions: api.post,
  isExplicitRequestRejection: () => false,
}));
vi.mock("./codexOperationScope", () => ({
  captureCodexOperationScope: () => ({}),
  isCodexOperationScopeCurrent: () => true,
}));
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});
it("does not reapply unknown settings and persists no model or permission payload", async () => {
  api.post.mockRejectedValue(new Error("lost acknowledgement"));
  api.get.mockImplementation(async () => ({
    ...JSON.parse(
      localStorage.getItem("session-queued-settings-receipts-v1")!,
    )[0],
    status: "unknown",
  }));
  const first = await applyQueuedThreadSettings("thread", {
    model: "captured-model",
    permissions: "team-profile",
  });
  const second = await applyQueuedThreadSettings("thread", {
    model: "later-choice",
  });
  expect(first.status).toBe("unknown");
  expect(second.operationId).toBe(first.operationId);
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(api.get).toHaveBeenCalledTimes(1);
  expect(api.post.mock.calls[0][1].expectedScope).toBe("current-scope");
  expect(
    localStorage.getItem("session-queued-settings-receipts-v1"),
  ).not.toContain("model");
  expect(
    localStorage.getItem("session-queued-settings-receipts-v1"),
  ).not.toContain("team-profile");
});
it("fails closed on an invalid receipt cache before another native settings write", async () => {
  localStorage.setItem(
    "session-queued-settings-receipts-v1",
    JSON.stringify([{ status: "unknown" }]),
  );
  await expect(applyQueuedThreadSettings("thread", {})).rejects.toThrow(
    "回执损坏",
  );
  expect(api.post).not.toHaveBeenCalled();
});
