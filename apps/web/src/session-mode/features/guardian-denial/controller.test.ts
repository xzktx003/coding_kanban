import { describe, expect, it, vi } from "vitest";
import { GuardianDenialController } from "./controller";
const identity = {
  threadId: "thread-a",
  turnId: "turn-a",
  reviewId: "review-a",
  targetItemId: "item-a",
  startedAtMs: 10,
  completedAtMs: 20,
};
const review = {
  ...identity,
  decisionSource: "agent" as const,
  review: {
    status: "denied" as const,
    riskLevel: "high" as const,
    userAuthorization: "low" as const,
    rationale: "Needs consent",
  },
  action: {
    type: "command" as const,
    source: "shell" as const,
    command: "echo fixture",
    cwd: "/fixture",
  },
};
const snapshot = {
  identity,
  runtimeInstance: "runtime-a",
  approvalToken: "a".repeat(64),
  canApprove: true,
  canAcceptDirectInput: true,
  state: "available" as const,
  review,
};
describe("guardian denial explicit approval", () => {
  it("does not send on loading, and unavailable/unknown/direct-input-false or changed public review cannot authorize", async () => {
    for (const altered of [
      { ...snapshot, canApprove: false },
      { ...snapshot, canAcceptDirectInput: null },
      { ...snapshot, canAcceptDirectInput: false },
      { ...snapshot, approvalToken: null },
      {
        ...snapshot,
        review: { ...review, action: { ...review.action, command: "changed" } },
      },
      { ...snapshot, identity: { ...identity, turnId: "turn-b" } },
    ]) {
      const approve = vi.fn();
      const controller = new GuardianDenialController(review, {
        snapshot: async () => altered,
        approve,
      });
      await controller.load();
      await controller.approve();
      expect(approve).not.toHaveBeenCalled();
      expect(controller.getState().canApprove).toBe(false);
    }
  });
  it("rechecks exact runtime/token/public review and submits only captured identity once", async () => {
    const read = vi.fn().mockResolvedValue(snapshot);
    const approve = vi.fn().mockImplementation(async (request) => ({
      identity,
      runtimeInstance: "runtime-a",
      clientRequestId: request.clientRequestId,
      state: "recorded",
    }));
    const controller = new GuardianDenialController(review, {
      snapshot: read,
      approve,
    });
    await controller.load();
    expect(approve).not.toHaveBeenCalled();
    expect(controller.getState().canApprove).toBe(true);
    await Promise.all([controller.approve(), controller.approve()]);
    expect(read).toHaveBeenCalledTimes(2);
    expect(approve).toHaveBeenCalledTimes(1);
    expect(approve.mock.calls[0][0]).toEqual({
      identity,
      runtimeInstance: "runtime-a",
      approvalToken: "a".repeat(64),
      clientRequestId: expect.any(String),
    });
    expect(controller.getState().state).toBe("recorded");
  });
  it("changed runtime or token between load and click aborts rather than approving replacement review", async () => {
    for (const patch of [
      { runtimeInstance: "runtime-b" },
      { approvalToken: "b".repeat(64) },
      { state: "unavailable", canApprove: false },
    ]) {
      const read = vi
        .fn()
        .mockResolvedValueOnce(snapshot)
        .mockResolvedValueOnce({ ...snapshot, ...patch });
      const approve = vi.fn();
      const controller = new GuardianDenialController(review, {
        snapshot: read,
        approve,
      });
      await controller.load();
      await controller.approve();
      expect(approve).not.toHaveBeenCalled();
      expect(controller.getState().canApprove).toBe(false);
    }
  });
  it("unknown delivery and mismatched receipt remain locked; recheck only settles a recorded exact instance", async () => {
    const read = vi.fn().mockResolvedValue(snapshot);
    const approve = vi.fn().mockRejectedValue(new Error("response lost"));
    const controller = new GuardianDenialController(review, {
      snapshot: read,
      approve,
    });
    await controller.load();
    await controller.approve();
    expect(controller.getState().state).toBe("uncertain");
    await controller.approve();
    expect(approve).toHaveBeenCalledTimes(1);
    await controller.load();
    expect(controller.getState().state).toBe("uncertain");
    read.mockResolvedValue({
      ...snapshot,
      state: "recorded",
      canApprove: false,
      approvalToken: null,
      runtimeInstance: "runtime-b",
    });
    await controller.load();
    expect(controller.getState().state).toBe("uncertain");
    read.mockResolvedValue({
      ...snapshot,
      state: "recorded",
      canApprove: false,
      approvalToken: null,
    });
    await controller.load();
    expect(controller.getState().state).toBe("recorded");
    expect(approve).toHaveBeenCalledTimes(1);
  });
  it("a late result belonging to another thread or client receipt never clears original uncertain state", async () => {
    const approve = vi.fn().mockResolvedValue({
      identity: { ...identity, threadId: "thread-b" },
      runtimeInstance: "runtime-a",
      clientRequestId: "other-client",
      state: "recorded",
    });
    const controller = new GuardianDenialController(review, {
      snapshot: async () => snapshot,
      approve,
    });
    await controller.load();
    await controller.approve();
    expect(controller.getState().state).toBe("uncertain");
  });
  it("uncertain receipt survives unmount/reload without persisting a token, raw event or command", async () => {
    const storage = new Map<string, string>();
    const browserStorage: Storage = {
      get length() {
        return storage.size;
      },
      clear: () => storage.clear(),
      key: (index: number) => [...storage.keys()][index] ?? null,
      removeItem: (key: string) => {
        storage.delete(key);
      },
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    };
    const approve = vi.fn().mockRejectedValue(new Error("lost"));
    const first = new GuardianDenialController(
      review,
      { snapshot: async () => snapshot, approve },
      browserStorage,
    );
    await first.load();
    await first.approve();
    const serialized = [...storage.values()].join("");
    expect(serialized).not.toContain(snapshot.approvalToken);
    expect(serialized).not.toContain("echo fixture");
    expect(serialized).not.toContain("rationale");
    const second = new GuardianDenialController(
      review,
      { snapshot: async () => snapshot, approve },
      browserStorage,
    );
    expect(second.getState().state).toBe("uncertain");
    await second.load();
    await second.approve();
    expect(approve).toHaveBeenCalledTimes(1);
  });
});
