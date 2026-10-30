import { beforeEach, expect, it, vi } from "vitest";
import { prepareRestoredInputTarget } from "./restoredInputTarget";
import { useAgentCenterStore } from "@session/stores/useAgentCenterStore";
import { useCodexStore } from "@session/components/codex/stores/useCodexStore";
import { useCCStore } from "@session/stores/cc/ccStore";
import { useAcpStore } from "@session/stores/useAcpStore";
import { useAgentSettingsStore } from "@session/stores/useAgentSettingsStore";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import { invalidateCodexOperationScope } from "./codexOperationScope";
const card = { kind: "codex" as const, id: "saved", cwd: "/saved" };
beforeEach(() => {
  useAgentCenterStore.setState({
    cards: [card],
    currentAgentCardId: card.id,
    currentAgentCardKind: card.kind,
    detachedCard: null,
  });
  useCodexStore.setState({
    currentThreadId: null,
    currentTurnId: null,
    historyLoadedMap: {},
    events: {},
    turnTimingMap: {},
    threadStatusMap: {},
    activeThreadIds: [],
  });
  useCCStore.setState({ activeSessionId: null });
  useAcpStore.setState({ active: false });
  useWorkspaceStore.setState({ cwd: "/saved" });
  useAgentSettingsStore.setState({ selectedAgent: "codex" });
});
it("prepares the exact saved target without waiting for the application body", async () => {
  const synchronizeBuiltinInputTarget = vi.fn();
  prepareRestoredInputTarget(async () => ({ synchronizeBuiltinInputTarget }));
  await Promise.resolve();
  expect(synchronizeBuiltinInputTarget).toHaveBeenCalledExactlyOnceWith(card);
});
for (const change of [
  "selection",
  "sender",
  "cwd",
  "account",
  "acp",
  "cancel",
] as const)
  it(`does not apply a late saved target after ${change} changes`, async () => {
    let resolve!: (
      module: Pick<
        typeof import("./builtinInputNavigation"),
        "synchronizeBuiltinInputTarget"
      >,
    ) => void;
    const synchronizeBuiltinInputTarget = vi.fn();
    const stop = prepareRestoredInputTarget(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    if (change === "selection")
      useAgentCenterStore.setState({ currentAgentCardId: "other" });
    if (change === "sender")
      useCodexStore.setState({ currentThreadId: "other" });
    if (change === "cwd") useWorkspaceStore.setState({ cwd: "/other" });
    if (change === "account") invalidateCodexOperationScope();
    if (change === "acp") useAcpStore.setState({ active: true });
    if (change === "cancel") stop();
    resolve({ synchronizeBuiltinInputTarget });
    await Promise.resolve();
    expect(synchronizeBuiltinInputTarget).not.toHaveBeenCalled();
  });

it("prepares the sender synchronously while read-only navigation modules are stalled, clearing the previous turn", () => {
  useCodexStore.setState({
    currentThreadId: "old",
    currentTurnId: "old-running-turn",
  });
  const stop = prepareRestoredInputTarget(() => new Promise(() => {}));
  expect(useCodexStore.getState()).toMatchObject({
    currentThreadId: "saved",
    currentTurnId: null,
  });
  stop();
});
it("synchronous preparation retains only the exact active cached turn", () => {
  useCodexStore.setState({
    historyLoadedMap: { saved: true },
    threadStatusMap: { saved: { type: "active", activeFlags: [] } },
    turnTimingMap: {
      saved: { turnId: "exact-live", status: "inProgress" },
    } as any,
  });
  const stop = prepareRestoredInputTarget(() => new Promise(() => {}));
  expect(useCodexStore.getState()).toMatchObject({
    currentThreadId: "saved",
    currentTurnId: "exact-live",
  });
  stop();
});
it("does not revive a cached old started event after the native thread is idle", () => {
  useCodexStore.setState({
    historyLoadedMap: { saved: true },
    threadStatusMap: { saved: { type: "idle" } },
    events: {
      saved: [
        {
          method: "turn/started",
          params: { threadId: "saved", turn: { id: "stale-turn" } },
        },
      ],
    } as any,
  });
  const stop = prepareRestoredInputTarget(() => new Promise(() => {}));
  expect(useCodexStore.getState()).toMatchObject({
    currentThreadId: "saved",
    currentTurnId: null,
  });
  stop();
});

for (const field of ["selection", "sender", "cwd", "provider"] as const)
  it(`does not reauthorize a late preparation after ${field} leaves and returns`, async () => {
    let resolve!: (
      module: Pick<
        typeof import("./builtinInputNavigation"),
        "synchronizeBuiltinInputTarget"
      >,
    ) => void;
    const synchronizeBuiltinInputTarget = vi.fn();
    prepareRestoredInputTarget(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    if (field === "selection") {
      useAgentCenterStore.setState({ currentAgentCardId: "other" });
      useAgentCenterStore.setState({ currentAgentCardId: card.id });
    } else if (field === "sender") {
      useCodexStore.setState({ currentThreadId: "other" });
      useCodexStore.setState({ currentThreadId: card.id });
    } else if (field === "cwd") {
      useWorkspaceStore.setState({ cwd: "/other" });
      useWorkspaceStore.setState({ cwd: card.cwd });
    } else {
      useAcpStore.setState({ active: true });
      useAcpStore.setState({ active: false });
    }
    resolve({ synchronizeBuiltinInputTarget });
    await Promise.resolve();
    expect(synchronizeBuiltinInputTarget).not.toHaveBeenCalled();
  });
