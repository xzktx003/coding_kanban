import { afterEach, beforeEach, expect, test, vi } from "vitest";
const api = vi.hoisted(() => ({
  verify: vi.fn(),
  endpoint: "https://fixture.invalid/api/session/health",
}));
vi.mock("./sessionWindowVerification", () => ({
  verifySessionWindowTarget: api.verify,
  sessionWindowEndpoint: () => api.endpoint,
}));
import { restoreSessionWindow } from "./restoreSessionWindow";
import {
  SESSION_WINDOW_ACCEPTED,
  SESSION_WINDOW_INTENTS,
  type SessionWindowRecord,
} from "./sessionWindowRecords";
import { useAgentCenterStore } from "@session/stores/useAgentCenterStore";
import {
  splitGroups,
  useSessionSplitStore,
} from "@session/stores/useSessionSplitStore";
import { useCodexStore } from "@session/components/codex/stores/useCodexStore";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
const id = "40bd1159-560e-4977-b808-b32aaf93265c";
const cards = ["A", "B", "C"].map((id) => ({
  kind: "codex" as const,
  id,
  cwd: "/private/project",
}));
const authority = {
  runtimeInstance: "same-runtime",
  codexNamespace: "same-account",
  daemonIdentity: "c".repeat(64),
};
const record = (): SessionWindowRecord => ({
  version: 1,
  id,
  createdAt: Date.now(),
  endpoint: api.endpoint,
  target: cards[1],
  status: "ready",
  authority,
});
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, "", `/?mode=session&sessionWindow=${id}`);
  api.endpoint = "https://fixture.invalid/api/session/health";
  api.verify.mockReset().mockResolvedValue(authority);
  useAgentCenterStore.setState({
    cards,
    currentAgentCardId: null,
    currentAgentCardKind: null,
    detachedCard: null,
    pendingTabOperations: [],
  });
  useCodexStore.setState({ currentThreadId: null });
  useWorkspaceStore.setState({ cwd: null });
  useSessionSplitStore.getState().reset();
});
afterEach(() => window.history.replaceState(null, "", "/"));
test("a tampered or unknown launch nonce never falls back to the original page's input", async () => {
  await expect(
    restoreSessionWindow(new AbortController().signal),
  ).rejects.toThrow(/缺失/);
  expect(api.verify).not.toHaveBeenCalled();
  expect(useCodexStore.getState().currentThreadId).toBeNull();
});
test.each(["endpoint", "account", "runtime"])(
  "a changed %s rejects restoration before any input target is selected",
  async (change) => {
    const value = record();
    if (change === "endpoint")
      value.endpoint = "https://different.invalid/health";
    else
      api.verify.mockResolvedValue({
        ...authority,
        ...(change === "account"
          ? { codexNamespace: "other-account" }
          : { runtimeInstance: "other-runtime" }),
      });
    localStorage.setItem(SESSION_WINDOW_INTENTS + id, JSON.stringify(value));
    await expect(
      restoreSessionWindow(new AbortController().signal),
    ).rejects.toThrow(/改变/);
    expect(useCodexStore.getState().currentThreadId).toBeNull();
    expect(useWorkspaceStore.getState().cwd).toBeNull();
    expect(sessionStorage.getItem(SESSION_WINDOW_ACCEPTED + id)).toBeNull();
  },
);
test("first entry selects the exact verified target in one pane without changing shared membership", async () => {
  localStorage.setItem(SESSION_WINDOW_INTENTS + id, JSON.stringify(record()));
  await expect(
    restoreSessionWindow(new AbortController().signal),
  ).resolves.toEqual(cards[1]);
  expect(api.verify).toHaveBeenCalledWith(cards[1], expect.any(AbortSignal));
  expect(useCodexStore.getState().currentThreadId).toBe("B");
  expect(useAgentCenterStore.getState().cards).toEqual(cards);
  expect(useAgentCenterStore.getState().pendingTabOperations).toEqual([]);
  expect(splitGroups(useSessionSplitStore.getState().tree)).toHaveLength(1);
  expect(splitGroups(useSessionSplitStore.getState().tree)[0].selected).toBe(
    "codex:B",
  );
  expect(localStorage.getItem(SESSION_WINDOW_INTENTS + id)).toBeNull();
  expect(sessionStorage.getItem(SESSION_WINDOW_ACCEPTED + id)).not.toBeNull();
});
test("a refresh verifies and retains this window's later target and split layout", async () => {
  localStorage.setItem(SESSION_WINDOW_INTENTS + id, JSON.stringify(record()));
  await restoreSessionWindow(new AbortController().signal);
  useAgentCenterStore.getState().setCurrentAgentCardId("C", "codex");
  const initial = splitGroups(useSessionSplitStore.getState().tree)[0];
  useSessionSplitStore.getState().place("codex:C", initial.id, "right");
  const tree = JSON.stringify(useSessionSplitStore.getState().tree);
  await expect(
    restoreSessionWindow(new AbortController().signal),
  ).resolves.toEqual(cards[2]);
  expect(useCodexStore.getState().currentThreadId).toBe("C");
  expect(JSON.stringify(useSessionSplitStore.getState().tree)).toBe(tree);
});
test("cancelling a pending source wait releases its listener without native reads", async () => {
  localStorage.setItem(
    SESSION_WINDOW_INTENTS + id,
    JSON.stringify({ ...record(), status: "verifying", authority: undefined }),
  );
  const controller = new AbortController(),
    removed = vi.spyOn(window, "removeEventListener");
  const pending = restoreSessionWindow(controller.signal);
  controller.abort();
  await expect(pending).rejects.toThrow(/取消/);
  expect(removed.mock.calls.some(([type]) => type === "storage")).toBe(true);
  expect(api.verify).not.toHaveBeenCalled();
  removed.mockRestore();
});

test("a changed URL nonce while native proof is held cannot revive the old window target", async () => {
  localStorage.setItem(SESSION_WINDOW_INTENTS + id, JSON.stringify(record()));
  let finish!: (value: unknown) => void;
  api.verify.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const pending = restoreSessionWindow(new AbortController().signal);
  await vi.waitFor(() => expect(api.verify).toHaveBeenCalled());
  window.history.replaceState(
    null,
    "",
    "/?mode=session&sessionWindow=5bdb8079-3f4d-4dd0-9406-07e92d241054",
  );
  finish(authority);
  await expect(pending).rejects.toThrow(/改变/);
  expect(useCodexStore.getState().currentThreadId).toBeNull();
});

test("an existing Codex window can recover a new owned runtime only after a second strict proof of the same native daemon account and target", async () => {
  sessionStorage.setItem(
    SESSION_WINDOW_ACCEPTED + id,
    JSON.stringify(record()),
  );
  useAgentCenterStore.getState().setCurrentAgentCardId("C", "codex");
  api.verify.mockResolvedValue({
    ...authority,
    runtimeInstance: "new-owned-runtime",
  });
  await expect(
    restoreSessionWindow(new AbortController().signal),
  ).resolves.toEqual(cards[2]);
  expect(api.verify).toHaveBeenCalledTimes(2);
  expect(api.verify).toHaveBeenLastCalledWith(
    cards[2],
    expect.any(AbortSignal),
    { recheckContext: true },
  );
  expect(useCodexStore.getState().currentThreadId).toBe("C");
  expect(
    JSON.parse(sessionStorage.getItem(SESSION_WINDOW_ACCEPTED + id)!).authority
      .runtimeInstance,
  ).toBe("new-owned-runtime");
  expect(window.location.search).toContain(id);
});

test("a runtime rebind cannot proceed when its strict native proof changes account or generation again", async () => {
  sessionStorage.setItem(
    SESSION_WINDOW_ACCEPTED + id,
    JSON.stringify(record()),
  );
  api.verify
    .mockResolvedValueOnce({
      ...authority,
      runtimeInstance: "new-owned-runtime",
    })
    .mockResolvedValueOnce({
      ...authority,
      runtimeInstance: "another-new-runtime",
    });
  await expect(
    restoreSessionWindow(new AbortController().signal),
  ).rejects.toThrow(/改变/);
  expect(useCodexStore.getState().currentThreadId).toBeNull();
  expect(
    JSON.parse(sessionStorage.getItem(SESSION_WINDOW_ACCEPTED + id)!).authority
      .runtimeInstance,
  ).toBe(authority.runtimeInstance);
});

test("the same history/account namespace alone cannot authorize rebinding a different official daemon", async () => {
  sessionStorage.setItem(
    SESSION_WINDOW_ACCEPTED + id,
    JSON.stringify(record()),
  );
  api.verify.mockResolvedValue({
    ...authority,
    runtimeInstance: "new-owned-runtime",
    daemonIdentity: "d".repeat(64),
  });
  await expect(
    restoreSessionWindow(new AbortController().signal),
  ).rejects.toThrow(/改变/);
  expect(api.verify).toHaveBeenCalledTimes(1);
  expect(useCodexStore.getState().currentThreadId).toBeNull();
  expect(
    JSON.parse(sessionStorage.getItem(SESSION_WINDOW_ACCEPTED + id)!).authority
      .daemonIdentity,
  ).toBe(authority.daemonIdentity);
});

test("a replaced official daemon is rejected even when the board runtime has not changed", async () => {
  sessionStorage.setItem(
    SESSION_WINDOW_ACCEPTED + id,
    JSON.stringify(record()),
  );
  api.verify.mockResolvedValue({
    ...authority,
    daemonIdentity: "d".repeat(64),
  });
  await expect(
    restoreSessionWindow(new AbortController().signal),
  ).rejects.toThrow(/改变/);
  expect(useCodexStore.getState().currentThreadId).toBeNull();
});
