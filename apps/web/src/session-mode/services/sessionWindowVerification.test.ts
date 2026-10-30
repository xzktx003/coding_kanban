import { beforeEach, expect, test, vi } from "vitest";
const api = vi.hoisted(() => ({
  get: vi.fn(),
  metadata: vi.fn(),
  snapshot: vi.fn(),
  endpoint: "https://fixture.invalid",
  auth: "private-test-auth",
}));
vi.mock("@session/hooks/runtime", () => ({
  buildUrl: (path: string) => api.endpoint + "/api/session" + path,
  authHeaders: () => ({ Authorization: api.auth }),
}));
vi.mock("./apiAdapt/shared", () => ({
  getJsonWithOptions: api.get,
  SessionApiError: class extends Error {
    constructor(
      message: string,
      public status: number,
    ) {
      super(message);
    }
  },
}));
vi.mock("./apiAdapt/codex", () => ({ threadMetadata: api.metadata }));
vi.mock("./apiAdapt/cc", () => ({ ccReadSessionSnapshot: api.snapshot }));
import { SessionApiError } from "./apiAdapt/shared";
import { verifySessionWindowTarget } from "./sessionWindowVerification";
const target = {
  kind: "codex" as const,
  id: "exact-thread",
  cwd: "/private/project",
};
beforeEach(() => {
  api.endpoint = "https://fixture.invalid";
  api.auth = "private-test-auth";
  api.get
    .mockReset()
    .mockImplementation(async (path) =>
      path === "/health"
        ? { status: "ok", instance: "owned-runtime" }
        : { namespace: "exact-native-account" },
    );
  api.metadata
    .mockReset()
    .mockResolvedValue({ thread: { id: target.id, cwd: target.cwd } });
  api.snapshot.mockReset().mockResolvedValue({
    sessionId: target.id,
    cwd: target.cwd,
    runtimeInstance: "owned-runtime",
  });
});
test("new-window proof reads metadata and captures the actual service/native namespace without execution", async () => {
  await expect(verifySessionWindowTarget(target)).resolves.toEqual({
    runtimeInstance: "owned-runtime",
    codexNamespace: "exact-native-account",
  });
  expect(api.metadata).toHaveBeenCalledWith(
    target.id,
    expect.objectContaining({
      signal: expect.any(AbortSignal),
      suppressToast: true,
    }),
  );
  expect(api.get.mock.calls.map(([path]) => path)).toEqual([
    "/health",
    "/lifecycle/context",
  ]);
  expect(api.snapshot).not.toHaveBeenCalled();
});
test.each([
  { id: "wrong-thread", cwd: target.cwd },
  { id: target.id, cwd: "/other/project" },
])(
  "new-window proof rejects a mismatched thread/project: %j",
  async (thread) => {
    api.metadata.mockResolvedValue({ thread });
    await expect(verifySessionWindowTarget(target)).rejects.toThrow(/不一致/);
  },
);
test.each(["endpoint", "auth"])(
  "connection changes while metadata is delayed revoke the %s result",
  async (field) => {
    let finish!: (value: unknown) => void;
    api.metadata.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const pending = verifySessionWindowTarget(target);
    await vi.waitFor(() => expect(api.metadata).toHaveBeenCalled());
    api[field as "endpoint" | "auth"] = "changed";
    finish({ thread: { id: target.id, cwd: target.cwd } });
    await expect(pending).rejects.toThrow(/配对/);
  },
);
test("Claude live-owner verification uses the exact SDK snapshot and same runtime", async () => {
  await expect(
    verifySessionWindowTarget({ ...target, kind: "cc" }),
  ).resolves.toEqual({ runtimeInstance: "owned-runtime" });
  expect(api.snapshot).toHaveBeenCalledWith(
    target.id,
    target.cwd,
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  expect(api.metadata).not.toHaveBeenCalled();
});
test("only a missing Claude owner can fall back to exact read-only historical metadata", async () => {
  api.snapshot.mockRejectedValue(new SessionApiError("Missing owner", 404));
  api.get.mockImplementation(async (path) =>
    path === "/health"
      ? { status: "ok", instance: "owned-runtime" }
      : { sessions: [{ session_id: target.id, cwd: target.cwd }], total: 1 },
  );
  await expect(
    verifySessionWindowTarget({ ...target, kind: "cc" }),
  ).resolves.toEqual({ runtimeInstance: "owned-runtime" });
  expect(api.get.mock.calls[1][0]).toContain("/api/cc/sessions?");
  api.snapshot.mockRejectedValue(new SessionApiError("Scope conflict", 409));
  const previous = api.get.mock.calls.length;
  await expect(
    verifySessionWindowTarget({ ...target, kind: "cc" }),
  ).rejects.toThrow(/Scope conflict/);
  expect(api.get.mock.calls.length).toBe(previous + 1);
});

test.each(["same scope", "same-value revocation", "runtime changes again"])(
  "strict Codex rebind observes context before and after exact metadata: %s",
  async (change) => {
    const calls: string[] = [];
    let contexts = 0,
      healths = 0;
    api.get.mockImplementation(async (path) => {
      calls.push(path);
      if (path === "/health")
        return {
          status: "ok",
          instance:
            change === "runtime changes again" && healths++
              ? "other-runtime"
              : "new-owned-runtime",
        };
      contexts++;
      return {
        namespace: "same-account",
        daemonIdentity: "c".repeat(64),
        scopeToken:
          change === "same-value revocation" && contexts > 1
            ? "revoked-scope"
            : "same-scope",
      };
    });
    api.metadata.mockImplementation(async () => {
      calls.push("exact-metadata");
      expect(contexts).toBe(1);
      return { thread: { id: target.id, cwd: target.cwd } };
    });
    const result = verifySessionWindowTarget(target, undefined, {
      recheckContext: true,
    });
    if (change === "same scope")
      await expect(result).resolves.toEqual({
        runtimeInstance: "new-owned-runtime",
        codexNamespace: "same-account",
        daemonIdentity: "c".repeat(64),
      });
    else await expect(result).rejects.toThrow(/改变/);
    expect(calls).toEqual([
      "/health",
      "/lifecycle/context",
      "exact-metadata",
      "/lifecycle/context",
      "/health",
    ]);
  },
);
