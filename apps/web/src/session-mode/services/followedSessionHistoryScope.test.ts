import { afterEach, beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ threadRead: vi.fn(), threadGoalGet: vi.fn() }));
vi.mock("./apiAdapt", () => api);
vi.mock("../lib/eventStream", () => ({ openEventStream: () => () => {} }));
import { useCodexStore } from "../components/codex/stores";
import { useAgentCenterStore } from "../stores/useAgentCenterStore";
import { useSessionSyncStore } from "../stores/useSessionSyncStore";
import { startFollowedSessionHistorySync } from "./followedSessionHistorySync";
import { resetCodexRuntimeState } from "./codexService";
import { resetGoalCompletionScope } from "./goalCompletionAutoClear";
const thread = (text: string) => ({
  id: "scope-initial",
  cwd: "/fixture",
  preview: text,
  status: { type: "idle" },
  turns: [
    {
      id: "t",
      status: "completed",
      items: [{ id: "m", type: "agentMessage", text, phase: null }],
    },
  ],
});
let stop: (() => void) | undefined;
beforeEach(() => {
  vi.clearAllMocks();
  resetCodexRuntimeState();
  useCodexStore.setState({
    currentThreadId: "scope-initial",
    threads: [],
    events: {},
    historyLoadedMap: {},
    historyLoadingMap: {},
    historyErrorMap: {},
    turnTimingMap: {},
    threadStatusMap: {},
    accountNamespace: "scope-initial",
    hasAccount: null,
  });
  useAgentCenterStore.setState({
    cards: [{ kind: "codex", id: "scope-initial" }],
    detachedCard: null,
    currentAgentCardId: "scope-initial",
    currentAgentCardKind: "codex",
  });
  api.threadGoalGet.mockResolvedValue({ goal: null });
});
afterEach(() => {
  stop?.();
  stop = undefined;
});
for (const transition of [
  "initial-account",
  "same-valued-notification",
] as const)
  it(`requeues an invalidated initial read exactly once after ${transition} without accepting stale history`, async () => {
    let release!: (value: any) => void;
    api.threadRead
      .mockReturnValueOnce(
        new Promise((resolve) => {
          release = resolve;
        }),
      )
      .mockResolvedValue({ thread: thread("current-scope-body") });
    stop = startFollowedSessionHistorySync();
    await vi.waitFor(() => expect(api.threadRead).toHaveBeenCalledOnce());
    if (transition === "initial-account")
      useCodexStore.setState({ hasAccount: true });
    else resetGoalCompletionScope();
    release({ thread: thread("STALE-SCOPE-MUST-NOT-APPEAR") });
    await vi.waitFor(() =>
      expect(useCodexStore.getState().historyLoadedMap["scope-initial"]).toBe(
        true,
      ),
    );
    expect(api.threadRead).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(useCodexStore.getState().events)).not.toContain(
      "STALE-SCOPE-MUST-NOT-APPEAR",
    );
    expect(JSON.stringify(useCodexStore.getState().events)).toContain(
      "current-scope-body",
    );
    expect(
      useSessionSyncStore.getState().recovering["scope-initial"],
    ).toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(api.threadRead).toHaveBeenCalledTimes(2);
  });
