// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { submissionId, followupParameters } from "./followupService";
import { useWorkspaceStore } from "../stores/useWorkspaceStore";
import { useConfigStore, useCodexStore } from "../components/codex/stores";
import { changeThreadModel, hydrateThreadModel, useThreadModelStore } from "../stores/useThreadModelStore";
beforeEach(() => {
  localStorage.clear();
  useThreadModelStore.setState({ threads: {} });
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
    collaborationMode: { mode: "plan" },
  });
  expect(followupParameters("a")).toMatchObject({ model: "changed-for-a", effort: "high" });
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

it("does not send a blank restored thread directory or borrow another project's directory", () => {
  useWorkspaceStore.setState({ cwd: "/another-project" });
  for (const cwd of ["", "   ", undefined]) {
    useCodexStore.setState({ threads: [{ id: "restored", cwd } as any] });
    expect(followupParameters("restored").cwd).toBeNull();
  }
  useCodexStore.setState({ threads: [{ id: "restored", cwd: "/project with spaces" } as any] });
  expect(followupParameters("restored").cwd).toBe("/project with spaces");
});
