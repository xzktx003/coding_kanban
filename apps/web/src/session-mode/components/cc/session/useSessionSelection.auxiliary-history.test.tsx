import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  recent: vi.fn(),
  raw: vi.fn(),
  convertRaw: vi.fn(),
  setCwd: vi.fn(),
  setSelectedAgent: vi.fn(),
  setView: vi.fn(),
  addAgentCard: vi.fn(),
  setCurrentAgentCardId: vi.fn(),
  addMessageToSession: vi.fn(),
  setSessionLoading: vi.fn(),
  selected: "initial",
  cc: {
    activeSessionIds: ["background-running"],
    activeSessionId: "initial",
    isLoading: true,
    sessionMessagesMap: {} as Record<string, unknown[]>,
  },
}));

vi.mock("@session/services/followedSessionAuxSync", () => ({
  refreshClaudeHistory: fixture.recent,
}));
vi.mock("@session/services/apiAdapt/cc", () => ({
  ccGetSessionMessages: fixture.raw,
}));
vi.mock("@session/components/cc/utils/fromSdkMessages", () => ({
  fromSdkMessages: fixture.convertRaw,
}));
vi.mock("@session/stores", () => ({
  useAgentCenterStore: () => ({
    addAgentCard: fixture.addAgentCard,
    setCurrentAgentCardId: fixture.setCurrentAgentCardId,
  }),
  useLayoutStore: () => ({ setView: fixture.setView }),
}));
vi.mock("@session/stores/cc", () => ({
  useCCStore: () => ({
    ...fixture.cc,
    addMessageToSession: fixture.addMessageToSession,
    setSessionLoading: fixture.setSessionLoading,
  }),
}));
vi.mock("@session/stores/useAgentSettingsStore", () => ({
  useAgentSettingsStore: () => ({ setSelectedAgent: fixture.setSelectedAgent }),
}));
vi.mock("@session/stores/useWorkspaceStore", () => ({
  useWorkspaceStore: () => ({ setCwd: fixture.setCwd }),
}));

import { useSessionSelection } from "./useSessionSelection";
import { ProviderTranscriptControls } from "../../agent/ProviderTranscriptControls";
import {
  trackProviderTranscript,
  updateProviderTranscript,
  useProviderTranscriptStore,
} from "@session/services/sessionProviderTranscriptState";

const record = (id: string) => ({
  session_id: id,
  summary: `Private source ${id}`,
  cwd: `/private/${id}`,
  last_modified: 1,
});

beforeEach(() => {
  vi.clearAllMocks();
  fixture.recent.mockReset().mockResolvedValue(undefined);
  fixture.raw.mockReset().mockResolvedValue([]);
  fixture.convertRaw.mockReset().mockReturnValue([]);
  fixture.selected = "initial";
  fixture.cc.activeSessionId = "initial";
  fixture.cc.activeSessionIds = ["background-running"];
  fixture.cc.isLoading = true;
  fixture.cc.sessionMessagesMap = {};
  fixture.setCurrentAgentCardId.mockImplementation((id: string) => {
    fixture.selected = id;
  });
  useProviderTranscriptStore.setState({ entries: {}, revision: 0 });
});

test("opening an uncached public Claude row reads the exact recent source without raw history or task-state writes", async () => {
  const onSelectSession = vi.fn();
  const { result } = renderHook(() =>
    useSessionSelection({ directory: "/private/original", onSelectSession }),
  );

  await act(async () =>
    result.current.handleSessionClick(record("alias-source")),
  );

  expect(fixture.raw).not.toHaveBeenCalled();
  expect(fixture.recent).toHaveBeenCalledExactlyOnceWith("alias-source");
  expect(onSelectSession).toHaveBeenCalledExactlyOnceWith(
    "alias-source",
    "/private/alias-source",
  );
  expect(fixture.addAgentCard).toHaveBeenCalledWith({
    kind: "cc",
    id: "alias-source",
    preview: "Private source alias-source",
    cwd: "/private/alias-source",
  });
  expect(fixture.selected).toBe("alias-source");
  expect(fixture.setCwd).toHaveBeenCalledWith("/private/alias-source");
  expect(fixture.setSelectedAgent).toHaveBeenCalledWith("cc");
  expect(fixture.setView).toHaveBeenCalledWith("agent");
  expect(fixture.convertRaw).not.toHaveBeenCalled();
  expect(fixture.addMessageToSession).not.toHaveBeenCalled();
  expect(fixture.setSessionLoading).not.toHaveBeenCalled();
  expect(fixture.cc.isLoading).toBe(true);
  expect(fixture.cc.activeSessionIds).toEqual(["background-running"]);
});

test("opening an already cached Claude row preserves the bounded cached body without an automatic history read", async () => {
  fixture.cc.sessionMessagesMap["cached-source"] = [
    { uuid: "bounded-preview" },
  ];
  const { result } = renderHook(() =>
    useSessionSelection({ directory: "/private" }),
  );

  await act(async () =>
    result.current.handleSessionClick(record("cached-source")),
  );

  expect(fixture.selected).toBe("cached-source");
  expect(fixture.recent).not.toHaveBeenCalled();
  expect(fixture.raw).not.toHaveBeenCalled();
  expect(fixture.addMessageToSession).not.toHaveBeenCalled();
  expect(fixture.setSessionLoading).not.toHaveBeenCalled();
});

test("a rejected recent read retains its existing retry presentation and never clears background task loading", async () => {
  fixture.recent.mockImplementation(async (id: string) => {
    const owner = `cc:${id}`;
    trackProviderTranscript(owner, "cc", id);
    updateProviderTranscript(owner, {
      loading: false,
      error: "Private source is unavailable",
    });
    throw new Error("Private source is unavailable");
  });
  const { result } = renderHook(() =>
    useSessionSelection({ directory: "/private" }),
  );
  render(
    <ProviderTranscriptControls
      owner="cc:rejected-source"
      onEarlier={async () => {}}
      onRetry={() => fixture.recent("rejected-source")}
    />,
  );

  await act(async () =>
    result.current.handleSessionClick(record("rejected-source")),
  );

  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain(
      "Private source is unavailable",
    ),
  );
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "重试读取" })),
  );
  await waitFor(() => expect(fixture.recent).toHaveBeenCalledTimes(2));
  expect(
    fixture.recent.mock.calls.every(([id]) => id === "rejected-source"),
  ).toBe(true);
  expect(fixture.selected).toBe("rejected-source");
  expect(fixture.raw).not.toHaveBeenCalled();
  expect(fixture.addMessageToSession).not.toHaveBeenCalled();
  expect(fixture.setSessionLoading).not.toHaveBeenCalled();
  expect(fixture.cc.isLoading).toBe(true);
  expect(fixture.cc.activeSessionIds).toEqual(["background-running"]);
});

test("a late source read cannot select the prior row, append raw rows, or clear the newly selected task state", async () => {
  let finishFirst!: () => void;
  fixture.recent.mockImplementation((id: string) =>
    id === "first-source"
      ? new Promise<void>((resolve) => {
          finishFirst = resolve;
        })
      : Promise.resolve(),
  );
  const { result } = renderHook(() =>
    useSessionSelection({ directory: "/private" }),
  );

  act(() => result.current.handleSessionClick(record("first-source")));
  await act(async () =>
    result.current.handleSessionClick(record("second-source")),
  );
  expect(fixture.recent.mock.calls.map(([id]) => id)).toEqual([
    "first-source",
    "second-source",
  ]);
  await act(async () => finishFirst());

  expect(fixture.selected).toBe("second-source");
  expect(fixture.setCurrentAgentCardId.mock.calls.map(([id]) => id)).toEqual([
    "first-source",
    "second-source",
  ]);
  expect(fixture.raw).not.toHaveBeenCalled();
  expect(fixture.convertRaw).not.toHaveBeenCalled();
  expect(fixture.addMessageToSession).not.toHaveBeenCalled();
  expect(fixture.setSessionLoading).not.toHaveBeenCalled();
  expect(fixture.cc.isLoading).toBe(true);
});

test("a late rejection after another row was selected stays handled without changing the new target", async () => {
  let rejectFirst!: (reason: Error) => void;
  fixture.recent.mockImplementation((id: string) =>
    id === "first-source"
      ? new Promise<void>((_resolve, reject) => {
          rejectFirst = reject;
        })
      : Promise.resolve(),
  );
  const { result } = renderHook(() =>
    useSessionSelection({ directory: "/private" }),
  );

  act(() => result.current.handleSessionClick(record("first-source")));
  await act(async () =>
    result.current.handleSessionClick(record("second-source")),
  );
  expect(fixture.recent.mock.calls.map(([id]) => id)).toEqual([
    "first-source",
    "second-source",
  ]);
  await act(async () => {
    rejectFirst(new Error("The first source was revoked"));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });

  expect(fixture.selected).toBe("second-source");
  expect(fixture.raw).not.toHaveBeenCalled();
  expect(fixture.addMessageToSession).not.toHaveBeenCalled();
  expect(fixture.setSessionLoading).not.toHaveBeenCalled();
  expect(fixture.cc.isLoading).toBe(true);
});

test("the async public selection callback can reject its recent read without an unhandled rejection or task-state cleanup", async () => {
  fixture.recent.mockRejectedValue(
    new Error("Public selection source is unavailable"),
  );
  // SideBarClaudeTab passes an async handleSessionSelect that awaits the same
  // recent reader. Consuming the hook's own read does not consume this distinct
  // callback Promise, even when the underlying read is shared.
  const callbackCalls: Array<[string, string | undefined]> = [];
  const onSelectSession = async (id: string, project?: string) => {
    callbackCalls.push([id, project]);
    await fixture.recent(id);
  };
  const { result } = renderHook(() =>
    useSessionSelection({ directory: "/private", onSelectSession }),
  );

  await act(async () => {
    result.current.handleSessionClick(record("callback-source"));
    // Leave the event loop once so Vitest observes any unhandled rejection.
    // The test intentionally installs no rejection listener or suppression.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });

  expect(callbackCalls).toEqual([
    ["callback-source", "/private/callback-source"],
  ]);
  expect(fixture.recent.mock.calls.map(([id]) => id)).toEqual([
    "callback-source",
    "callback-source",
  ]);
  expect(fixture.selected).toBe("callback-source");
  expect(fixture.raw).not.toHaveBeenCalled();
  expect(fixture.addMessageToSession).not.toHaveBeenCalled();
  expect(fixture.setSessionLoading).not.toHaveBeenCalled();
  expect(fixture.cc.isLoading).toBe(true);
  expect(fixture.cc.activeSessionIds).toEqual(["background-running"]);
});
