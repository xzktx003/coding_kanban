import { beforeEach, expect, it, vi } from "vitest";
import { resumeInterruptedTurn } from "./resumeInterruptedTurn";
const api = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  current: vi.fn(() => true),
  scope: "domain-a",
}));
vi.mock("./apiAdapt/shared", () => ({
  getJsonWithOptions: api.get,
  postJsonWithOptions: api.post,
  isExplicitRequestRejection: (error: unknown) =>
    error instanceof Error && error.message === "rejected",
}));
vi.mock("./codexOperationScope", () => ({
  captureCodexOperationScope: () => ({}),
  isCodexOperationScopeCurrent: api.current,
}));
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  api.current.mockReturnValue(true);
  api.get.mockImplementation(async (path: string) =>
    path.endsWith("/context")
      ? { namespace: api.scope, scopeToken: "current-token" }
      : {
          operationId: JSON.parse(
            localStorage.getItem("session-resume-receipts-v1")!,
          )[0].operationId,
          threadId: "thread",
          status: "unknown",
        },
  );
});
it("persists an identity before POST, and reconciles an unknown receipt without sending twice", async () => {
  api.post.mockImplementation(async (_path, body) => {
    expect(
      JSON.parse(localStorage.getItem("session-resume-receipts-v1")!)[0]
        .operationId,
    ).toBe(body.operationId);
    throw new Error("lost response");
  });
  const first = await resumeInterruptedTurn("thread", "interrupted-turn", {
    model: "captured",
  });
  expect(first.status).toBe("unknown");
  const second = await resumeInterruptedTurn("thread", "interrupted-turn", {
    model: "later",
  });
  expect(second.operationId).toBe(first.operationId);
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(
    api.get.mock.calls.some(([path]) => path.includes("operationId=")),
  ).toBe(true);
  const saved = localStorage.getItem("session-resume-receipts-v1")!;
  expect(saved).not.toContain("captured");
  expect(saved).not.toContain("later");
});
it("does not send when receipt persistence fails", async () => {
  const broken = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(() => {
      throw new Error("disk full");
    });
  try {
    await expect(resumeInterruptedTurn("thread", "turn", {})).rejects.toThrow(
      "disk full",
    );
  } finally {
    broken.mockRestore();
  }
  expect(api.post).not.toHaveBeenCalled();
});
it("accepted receipt blocks another empty turn while the UI awaits native events", async () => {
  api.post.mockImplementation(async (_path, body) => ({
    operationId: body.operationId,
    threadId: "thread",
    status: "accepted",
    turnId: "new-turn",
  }));
  const result = await resumeInterruptedTurn("thread", "interrupted-turn", {});
  expect(result.status).toBe("accepted");
  await resumeInterruptedTurn("thread", "interrupted-turn", {});
  expect(api.post).toHaveBeenCalledTimes(1);
});
