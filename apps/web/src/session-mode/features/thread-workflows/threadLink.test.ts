import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { openThreadLink } from "./threadLinkService";
import { useThreadLinkStore } from "./threadLinkStore";
import { useCodexStore } from "@session/components/codex/stores";
import { useAgentCenterStore } from "@session/stores/useAgentCenterStore";
import { useAgentSettingsStore } from "@session/stores/useAgentSettingsStore";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import { useLayoutStore } from "@session/stores/useLayoutStore";
import {
  changeThreadModel,
  getThreadModelSettings,
  useThreadModelStore,
} from "@session/stores/useThreadModelStore";
import {
  registerSessionLeaveGuard,
  cancelSessionNavigation,
  confirmSessionNavigation,
  useSessionNavigationGuard,
} from "@session/services/sessionNavigationGuard";
let unregister: (() => void) | undefined;
afterEach(() => {
  unregister?.();
  unregister = undefined;
  useSessionNavigationGuard.setState({ pending: null });
});
import {
  readDraft,
  sessionDraftKey,
  useSessionDraftStore,
} from "@session/stores/useSessionDraftStore";
const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@session/services/apiAdapt/codex", () => ({ threadRead: mocks.read }));
const thread = {
  id: "target",
  cwd: "/native/target",
  preview: "Native target",
  name: "Target",
  status: { type: "idle" },
  turns: [
    {
      id: "chosen",
      status: "completed",
      items: [
        {
          type: "userMessage",
          id: "user",
          content: [
            { type: "text", text: "Captured link message", text_elements: [] },
          ],
        },
      ],
      startedAt: 1,
      durationMs: 100,
      error: null,
    },
  ],
};
beforeEach(() => {
  mocks.read.mockReset().mockResolvedValue({ thread });
  useThreadLinkStore.setState({
    requestId: 0,
    target: null,
    loading: false,
    error: null,
  });
  useCodexStore.setState({
    currentThreadId: "original",
    threads: [],
    events: {},
    historyLoadedMap: {},
    threadStatusMap: {},
    turnTimingMap: {},
  });
  useAgentCenterStore.setState({
    cards: [],
    currentAgentCardId: null,
    currentAgentCardKind: null,
  });
  useAgentSettingsStore.setState({ selectedAgent: "codex" });
  useWorkspaceStore.setState({ cwd: "/original" });
  useLayoutStore.setState({ view: "agent" });
  useSessionDraftStore.setState({ drafts: {} });
  useThreadModelStore.setState({ threads: {} });
  useSessionDraftStore
    .getState()
    .setText(sessionDraftKey("codex", "original"), "Original unsent draft");
});
it("hydrates only the verified native owner's settings and preserves newer owner revisions through a delayed read", async () => {
  const native = {
    thread,
    model: "native-model",
    reasoningEffort: "high",
    serviceTier: "fast",
    approvalsReviewer: "user",
    approvalPolicy: "on-request",
    sandboxPolicy: { type: "readOnly", networkAccess: true },
  };
  mocks.read.mockResolvedValueOnce(native);
  await openThreadLink({ threadId: "target" }, vi.fn());
  expect(getThreadModelSettings("target")).toMatchObject({
    model: "native-model",
    reasoningEffort: "high",
    serviceTier: "fast",
    approvalsReviewer: "user",
    approvalPolicy: "on-request",
    sandboxPolicy: { type: "readOnly", networkAccess: true },
  });
  let finishRead!: (value: unknown) => void;
  mocks.read.mockImplementationOnce(
    () => new Promise((resolve) => (finishRead = resolve)),
  );
  const opening = openThreadLink({ threadId: "target" }, vi.fn());
  changeThreadModel("target", {
    model: "newer-owner-model",
    serviceTier: "flex",
    sandbox: "danger-full-access",
    approvalPolicy: "never",
  });
  changeThreadModel("other", { model: "other-model", serviceTier: null });
  useCodexStore.setState({ currentThreadId: "other" });
  finishRead(native);
  expect(await opening).toBe(false);
  expect(getThreadModelSettings("target")).toMatchObject({
    model: "newer-owner-model",
    serviceTier: "flex",
    approvalPolicy: "never",
  });
  expect(getThreadModelSettings("other")).toMatchObject({
    model: "other-model",
    serviceTier: null,
  });
});
it("a dirty form cancel never adds a followed tab or changes input", async () => {
  useLayoutStore.setState({ view: "settings" });
  unregister = registerSessionLeaveGuard(() => ({
    dirty: true,
    saving: false,
  }));
  const activate = vi.fn();
  const pending = openThreadLink(
    { threadId: "target", turnId: "chosen" },
    activate,
  );
  await vi.waitFor(() =>
    expect(useSessionNavigationGuard.getState().pending).toBeTruthy(),
  );
  expect(useAgentCenterStore.getState().cards).toHaveLength(0);
  cancelSessionNavigation();
  expect(await pending).toBe(false);
  expect(activate).not.toHaveBeenCalled();
  expect(useCodexStore.getState().currentThreadId).toBe("original");
  expect(useLayoutStore.getState().view).toBe("settings");
});
it("confirmed page departure rechecks owner intent and commits once", async () => {
  useLayoutStore.setState({ view: "settings" });
  unregister = registerSessionLeaveGuard(() => ({
    dirty: true,
    saving: false,
  }));
  const activate = vi.fn();
  const stale = openThreadLink(
    { threadId: "target", turnId: "chosen" },
    activate,
  );
  await vi.waitFor(() =>
    expect(useSessionNavigationGuard.getState().pending).toBeTruthy(),
  );
  useCodexStore.setState({ currentThreadId: "newer" });
  confirmSessionNavigation();
  expect(await stale).toBe(false);
  expect(activate).not.toHaveBeenCalled();
  expect(useAgentCenterStore.getState().cards).toHaveLength(0);
  useLayoutStore.setState({ view: "settings" });
  const accepted = openThreadLink(
    { threadId: "target", turnId: "chosen" },
    activate,
  );
  await vi.waitFor(() =>
    expect(useSessionNavigationGuard.getState().pending).toBeTruthy(),
  );
  confirmSessionNavigation();
  expect(await accepted).toBe(true);
  confirmSessionNavigation();
  expect(activate).toHaveBeenCalledTimes(1);
});
it("verifies only native history identity and cwd before adding the normal tab and captured target turn", async () => {
  const activate = vi.fn().mockResolvedValue(undefined);
  expect(
    await openThreadLink({ threadId: "target", turnId: "chosen" }, activate),
  ).toBe(true);
  expect(mocks.read).toHaveBeenCalledWith(
    { threadId: "target" },
    expect.objectContaining({ suppressToast: true }),
  );
  expect(activate).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: "codex",
      id: "target",
      cwd: "/native/target",
    }),
  );
  expect(useAgentCenterStore.getState().cards).toMatchObject([
    { id: "target", cwd: "/native/target" },
  ]);
  expect(useThreadLinkStore.getState().target).toEqual({
    threadId: "target",
    turnId: "chosen",
  });
  expect(readDraft(sessionDraftKey("codex", "original")).text).toBe(
    "Original unsent draft",
  );
});
it("a delayed read cannot follow or activate a thread after the user's input target changed", async () => {
  let resolve!: (value: unknown) => void;
  mocks.read.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const activate = vi.fn();
  const pending = openThreadLink(
    { threadId: "target", turnId: "chosen" },
    activate,
  );
  useCodexStore.setState({ currentThreadId: "newer" });
  useWorkspaceStore.setState({ cwd: "/newer" });
  resolve({ thread });
  expect(await pending).toBe(false);
  expect(activate).not.toHaveBeenCalled();
  expect(useAgentCenterStore.getState().cards).toHaveLength(0);
  expect(useCodexStore.getState().currentThreadId).toBe("newer");
  expect(useThreadLinkStore.getState().target).toBeNull();
});
it("wrong native identity, missing cwd or unavailable turn/history fail explicitly without following", async () => {
  const activate = vi.fn();
  for (const invalid of [
    { ...thread, id: "foreign" },
    { ...thread, cwd: "" },
    { ...thread, turns: [] },
  ]) {
    mocks.read.mockResolvedValueOnce({ thread: invalid });
    await expect(
      openThreadLink({ threadId: "target", turnId: "chosen" }, activate),
    ).rejects.toThrow();
  }
  await expect(
    openThreadLink({ threadId: "target", turnId: "missing" }, activate),
  ).rejects.toThrow(/轮次/);
  expect(activate).not.toHaveBeenCalled();
  expect(useAgentCenterStore.getState().cards).toHaveLength(0);
  expect(useThreadLinkStore.getState().error).toBeTruthy();
});
