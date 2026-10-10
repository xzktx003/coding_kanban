// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
const api = vi.hoisted(() => ({
  getJsonWithOptions: vi.fn(),
  postJsonWithOptions: vi.fn(),
}));
vi.mock("./apiAdapt/shared", () => api);
import {
  followupService,
  followupParameters,
  submissionId,
  useFollowupStore,
} from "./followupService";
import { useWorkspaceStore } from "../stores/useWorkspaceStore";
import { useConfigStore, useCodexStore } from "../components/codex/stores";
import {
  changeThreadModel,
  hydrateThreadModel,
  useThreadModelStore,
} from "../stores/useThreadModelStore";
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useThreadModelStore.setState({ threads: {} });
  useFollowupStore.setState({ threads: {}, errors: {} });
  useCodexStore.setState({
    turnTimingMap: {},
    threadStatusMap: {},
  });
  vi.stubGlobal("crypto", webcrypto);
});
it("reuses the same request identity after reload and separates new drafts, targets and attachments", async () => {
  const data = {
    threadId: "a",
    text: "hello",
    images: [],
    parameters: {},
    mode: "queue" as const,
  };
  const first = await submissionId("owner", 1, data);
  expect(await submissionId("owner", 1, data)).toBe(first);
  expect(await submissionId("owner", 2, data)).not.toBe(first);
  expect(await submissionId("owner", 1, { ...data, threadId: "b" })).not.toBe(
    first,
  );
  expect(
    await submissionId("owner", 1, { ...data, images: ["/image.png"] }),
  ).not.toBe(first);
});
it("captures the target directory, model, permissions and plan mode at enqueue time", () => {
  useCodexStore.setState({ threads: [{ id: "a", cwd: "/target" } as any] });
  useConfigStore.setState({
    model: "chosen",
    collaborationMode: "plan",
    sandbox: "read-only",
    approvalPolicy: "untrusted",
  });
  hydrateThreadModel("a", { model: "chosen", reasoningEffort: "medium" });
  const p = followupParameters("a");
  changeThreadModel("a", { model: "changed-for-a", reasoningEffort: "high" });
  useConfigStore.setState({ model: "changed", collaborationMode: "default" });
  expect(p).toMatchObject({
    cwd: "/target",
    model: "chosen",
    sandboxPolicy: { type: "readOnly" },
    approvalsReviewer: "user",
    collaborationMode: { mode: "plan" },
  });
  expect(followupParameters("a")).toMatchObject({
    model: "changed-for-a",
    effort: "high",
  });
});
it("captures explicit native auto review for workspace-write queued followups", () => {
  useCodexStore.setState({ threads: [{ id: "a", cwd: "/target" } as any] });
  changeThreadModel("a", {
    sandbox: "workspace-write",
    approvalPolicy: "on-request",
    approvalsReviewer: "auto_review",
  });
  expect(followupParameters("a")).toMatchObject({
    approvalPolicy: "on-request",
    approvalsReviewer: "auto_review",
    sandboxPolicy: { type: "workspaceWrite" },
  });
});
it("reconciles native review execution ids after completion or browser refresh without touching a newer turn", async () => {
  const { reconcileReview } = await import("./followupService");
  const data = {
    revision: 1,
    paused: null,
    items: [],
    review: {
      turnId: "review",
      executionTurnId: "execution",
      status: "completed" as const,
      durationMs: 12,
    },
  };
  useCodexStore.setState({
    turnTimingMap: {
      a: {
        turnId: "execution",
        status: "inProgress",
        startedAtMs: 1,
        durationMs: null,
      },
    },
  });
  reconcileReview("a", data);
  expect(useCodexStore.getState().turnTimingMap.a).toMatchObject({
    turnId: "review",
    status: "completed",
    durationMs: 12,
  });
  useCodexStore.setState({
    turnTimingMap: {
      a: {
        turnId: "newer",
        status: "inProgress",
        startedAtMs: 1,
        durationMs: null,
      },
    },
  });
  reconcileReview("a", data);
  expect(useCodexStore.getState().turnTimingMap.a.status).toBe("inProgress");
});

it("reconciles a completed review again when an unchanged queue snapshot reloads", async () => {
  const data = {
    revision: 1,
    paused: null,
    items: [],
    review: {
      turnId: "review",
      executionTurnId: "execution",
      status: "completed" as const,
      durationMs: 12,
    },
  };
  api.getJsonWithOptions.mockResolvedValueOnce(data);
  await followupService.load("a");

  useCodexStore.setState({
    turnTimingMap: {
      a: {
        turnId: "execution",
        status: "inProgress",
        startedAtMs: 1,
        durationMs: null,
      },
    },
    threadStatusMap: { a: { type: "active", activeFlags: [] } as any },
  });

  api.getJsonWithOptions.mockResolvedValueOnce(structuredClone(data));
  await followupService.load("a");

  expect(useCodexStore.getState().turnTimingMap.a).toMatchObject({
    turnId: "review",
    status: "completed",
    durationMs: 12,
  });
  expect(useCodexStore.getState().threadStatusMap.a).toEqual({
    type: "idle",
  });
});

it("does not send a blank restored thread directory or borrow another project's directory", () => {
  useWorkspaceStore.setState({ cwd: "/another-project" });
  for (const cwd of ["", "   ", undefined]) {
    useCodexStore.setState({ threads: [{ id: "restored", cwd } as any] });
    expect(followupParameters("restored").cwd).toBeNull();
  }
  useCodexStore.setState({
    threads: [{ id: "restored", cwd: "/project with spaces" } as any],
  });
  expect(followupParameters("restored").cwd).toBe("/project with spaces");
});

it("captures exact owner-scoped permissions and service tier before a queue, steer or edit operation can await", () => {
  hydrateThreadModel("a", { model: "chosen", reasoningEffort: "high" });
  hydrateThreadModel("b", { model: "other", reasoningEffort: "low" });
  changeThreadModel("a", {
    serviceTier: "fast",
    sandbox: "read-only",
    approvalPolicy: "untrusted",
    webSearchRequest: true,
    collaborationMode: "plan",
  });
  const captured = followupParameters("a");
  changeThreadModel("a", {
    serviceTier: null,
    sandbox: "workspace-write",
    approvalPolicy: "on-request",
    webSearchRequest: false,
    collaborationMode: "default",
  });
  changeThreadModel("b", {
    serviceTier: "another-tier",
    sandbox: "danger-full-access",
    approvalPolicy: "never",
  });
  useConfigStore.setState({
    sandbox: "danger-full-access",
    approvalPolicy: "never",
    collaborationMode: "default",
  });
  expect(captured).toMatchObject({
    model: "chosen",
    effort: "high",
    serviceTier: "fast",
    approvalPolicy: "untrusted",
    sandboxPolicy: { type: "readOnly", networkAccess: true },
    collaborationMode: { mode: "plan" },
  });
  expect(followupParameters("a")).toMatchObject({
    serviceTier: null,
    approvalPolicy: "on-request",
    sandboxPolicy: { type: "workspaceWrite", networkAccess: false },
  });
  expect(followupParameters("b")).toMatchObject({
    serviceTier: "another-tier",
    approvalPolicy: "never",
    sandboxPolicy: { type: "dangerFullAccess" },
  });
});

it.each(["queue", "steer"] as const)(
  "sends the exact captured owner config in the %s HTTP payload after selection changes",
  async (mode) => {
    useCodexStore.setState({ currentThreadId: "a" });
    hydrateThreadModel("a", { model: "owner-model", reasoningEffort: "high" });
    changeThreadModel("a", {
      serviceTier: "fast",
      sandbox: "read-only",
      sandboxPolicy: null,
      approvalPolicy: "untrusted",
      webSearchRequest: true,
      collaborationMode: "plan",
    });
    api.postJsonWithOptions.mockImplementation(async (_path, data) => ({
      revision: 1,
      paused: null,
      items: [{ ...data, status: "queued" }],
    }));
    const operation = followupService.submit(
      "codex:a",
      7,
      "a",
      "captured",
      [],
      mode,
      "owner-turn",
    );
    useCodexStore.setState({ currentThreadId: "b" });
    changeThreadModel("a", {
      serviceTier: null,
      sandbox: "danger-full-access",
      approvalPolicy: "never",
    });
    await operation;
    expect(api.postJsonWithOptions).toHaveBeenLastCalledWith(
      "/followups/submit",
      expect.objectContaining({
        threadId: "a",
        mode,
        expectedTurnId: "owner-turn",
        parameters: expect.objectContaining({
          model: "owner-model",
          effort: "high",
          serviceTier: "fast",
          approvalPolicy: "untrusted",
          sandboxPolicy: { type: "readOnly", networkAccess: true },
          collaborationMode: expect.objectContaining({ mode: "plan" }),
        }),
      }),
      { suppressToast: true },
    );
  },
);

it("keeps an unchanged same-revision queue snapshot stable while accepting real same-revision changes", async () => {
  const first = {
    revision: 2,
    paused: null,
    items: [
      {
        id: "message",
        threadId: "a",
        text: "hello",
        images: [],
        mode: "queue",
        parameters: {},
        status: "queued",
        createdAt: 1,
      },
    ],
  };
  api.getJsonWithOptions.mockResolvedValueOnce(first);
  await followupService.load("a");
  const firstState = useFollowupStore.getState();

  api.getJsonWithOptions.mockResolvedValueOnce(structuredClone(first));
  await followupService.load("a");
  expect(useFollowupStore.getState()).toBe(firstState);

  useFollowupStore.setState((s) => ({
    threads: s.threads,
    errors: { ...s.errors, a: "stale" },
  }));
  const changed = {
    ...first,
    items: [{ ...first.items[0], status: "sending" }],
  };
  api.getJsonWithOptions.mockResolvedValueOnce(changed);
  await followupService.load("a");
  expect(useFollowupStore.getState().threads.a).toBe(changed);
  expect(useFollowupStore.getState().errors.a).toBeUndefined();

  const accepted = useFollowupStore.getState();
  api.getJsonWithOptions.mockResolvedValueOnce({
    ...changed,
    revision: 1,
    items: [{ ...changed.items[0], status: "failed" }],
  });
  await followupService.load("a");
  expect(useFollowupStore.getState()).toBe(accepted);
});
