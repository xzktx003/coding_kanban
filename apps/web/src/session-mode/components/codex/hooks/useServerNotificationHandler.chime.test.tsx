import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import type { ServerNotification } from "@session/bindings/ServerNotification";
import { useCodexStore } from "@session/components/codex/stores";
import { useSubagentStore } from "@session/features/subagents/store";
import { notifyDesktop } from "@session/lib/notify";
import { playBeep } from "@session/utils/beep";
import {
  resetCompletionChimeClaims,
  useServerNotificationHandler,
} from "./useServerNotificationHandler";

vi.mock("@session/utils/beep", () => ({ playBeep: vi.fn() }));
vi.mock("@session/lib/notify", () => ({ notifyDesktop: vi.fn() }));
vi.mock("@session/services/apiAdapt/codex", () => ({
  allowSleep: vi.fn(async () => {}),
  preventSleep: vi.fn(async () => {}),
}));

function completion(threadId: string, turnId: string): ServerNotification {
  return {
    method: "turn/completed",
    params: {
      threadId,
      turn: { id: turnId, status: "completed" },
    },
  } as ServerNotification;
}

function mount(mode: "never" | "unfocused" | "always" = "always") {
  return renderHook(() =>
    useServerNotificationHandler(
      {
        isCodexThreadActiveRef: { current: true },
        taskCompleteBeepModeRef: { current: mode },
        preventSleepDuringTasksRef: { current: false },
      },
      async () => {},
    ),
  );
}

beforeEach(() => {
  resetCompletionChimeClaims();
  vi.mocked(playBeep).mockClear();
  vi.mocked(notifyDesktop).mockClear();
  useSubagentStore.setState({ nodes: {}, revision: 0 });
  useCodexStore.setState({
    threads: [{ id: "thread-a", name: "A" }],
    currentThreadId: null,
  });
  document.body.innerHTML = "";
  vi.spyOn(document, "hasFocus").mockReturnValue(false);
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => false,
  });
});

test("one completed turn plays a single beep and keeps the system notice silent", () => {
  const { result } = mount();
  act(() => {
    result.current(completion("thread-a", "turn-1"));
    result.current(completion("thread-a", "turn-1"));
  });
  expect(playBeep).toHaveBeenCalledTimes(1);
  expect(notifyDesktop).toHaveBeenCalledTimes(1);
  expect(notifyDesktop).toHaveBeenCalledWith(
    "Codex 任务已完成",
    undefined,
    expect.any(Function),
    { silent: true },
  );
});

test("separate turns still each play once", () => {
  const { result } = mount();
  act(() => {
    result.current(completion("thread-a", "turn-1"));
    result.current(completion("thread-a", "turn-2"));
  });
  expect(playBeep).toHaveBeenCalledTimes(2);
});

test("disabling the beep keeps the system notice silent", () => {
  const { result } = mount("never");
  act(() => result.current(completion("thread-a", "turn-silent")));
  expect(playBeep).not.toHaveBeenCalled();
  expect(notifyDesktop).toHaveBeenCalledTimes(1);
  expect(notifyDesktop).toHaveBeenCalledWith(
    "Codex 任务已完成",
    undefined,
    expect.any(Function),
    { silent: true },
  );
});

test("a focused session does not add a desktop notice beside the beep", () => {
  document.body.innerHTML = '<div class="session-mode"></div>';
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  const { result } = mount();
  act(() => result.current(completion("thread-a", "turn-focus")));
  expect(playBeep).toHaveBeenCalledTimes(1);
  expect(notifyDesktop).not.toHaveBeenCalled();
});
