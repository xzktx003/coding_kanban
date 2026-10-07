import { renderHook, act } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import type { ServerNotification } from "@session/bindings/ServerNotification";
import { useSessionNameStore } from "@session/stores/useSessionNameStore";
import { useServerNotificationHandler } from "./useServerNotificationHandler";

const mock = vi.hoisted(() => ({
  state: { threads: [{ id: "thread", name: "old" as string | null }] },
  addEvent: vi.fn(),
}));
vi.mock("@session/components/codex/stores", () => ({
  useCodexStore: {
    setState: (
      update: (state: typeof mock.state) => Partial<typeof mock.state>,
    ) => {
      mock.state = { ...mock.state, ...update(mock.state) };
    },
    getState: () => ({ ...mock.state, addEvent: mock.addEvent }),
  },
}));
vi.mock("@session/services/apiAdapt", () => ({
  allowSleep: vi.fn(),
  preventSleep: vi.fn(),
}));

beforeEach(() => {
  mock.state = { threads: [{ id: "thread", name: "old" }] };
  useSessionNameStore.setState({ names: { "codex:thread": "old" } });
});

for (const threadName of [undefined, null, "new name"]) {
  test(`name notification handles ${String(threadName)} with the nullable thread contract`, () => {
    const { result } = renderHook(() =>
      useServerNotificationHandler(
        {
          isCodexThreadActiveRef: { current: true },
          taskCompleteBeepModeRef: { current: "never" },
          preventSleepDuringTasksRef: { current: false },
        },
        async () => {},
      ),
    );
    act(() =>
      result.current({
        method: "thread/name/updated",
        params: { threadId: "thread", threadName },
      } as ServerNotification),
    );
    expect(mock.state.threads[0].name).toBe(threadName ?? null);
    expect(useSessionNameStore.getState().names["codex:thread"]).toBe("old");
  });
}
