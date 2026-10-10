import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useLayoutStore } from "@session/stores";
import { useBotUiStore } from "@session/stores/useBotUiStore";

const stream = vi.hoisted(() => ({
  open: vi.fn(),
  close: vi.fn(),
  subscriber: undefined as
    | {
        agents?: string[];
        onEvent: (event: { event: string; payload: unknown }) => void;
      }
    | undefined,
}));
const api = vi.hoisted(() => ({
  listBots: vi.fn(),
}));

vi.mock("@session/hooks/runtime", () => ({
  isDesktopTauri: () => false,
  buildEventUrl: (path: string) => path,
}));
vi.mock("@session/lib/eventStream", () => ({
  openEventStream: vi.fn((subscriber) => {
    stream.subscriber = subscriber;
    stream.open(subscriber);
    return stream.close;
  }),
}));
vi.mock("@session/services/apiAdapt/bots", () => ({
  listBots: (...args: unknown[]) => api.listBots(...args),
}));
vi.mock("@session/lib/notify", () => ({
  notifyDesktop: vi.fn(),
}));

import { useBotActivity } from "./useBotActivity";

const bot = {
  id: "bot",
  name: "Build Bot",
  unreadCount: 0,
  notificationsEnabled: true,
  mcpServers: "[]",
};

beforeEach(() => {
  vi.clearAllMocks();
  stream.subscriber = undefined;
  api.listBots.mockResolvedValue([{ ...bot, unreadCount: 1 }]);
  useLayoutStore.setState({ view: "agent" });
  useBotUiStore.setState({
    bots: [bot as any],
    selectedBotId: null,
    runningByBot: {},
    statusByBot: {},
  });
  vi.stubGlobal(
    "EventSource",
    vi.fn(
      class {
        close() {}
      },
    ),
  );
});

it("uses the shared session event stream for browser bot activity", async () => {
  const { unmount } = renderHook(() => useBotActivity());

  expect(EventSource).not.toHaveBeenCalled();
  expect(stream.open).toHaveBeenCalledTimes(1);
  expect(stream.subscriber?.agents).toEqual(["bot"]);

  act(() =>
    stream.subscriber?.onEvent({
      event: "bot:activity",
      payload: { botId: "bot", status: "working" },
    }),
  );
  expect(useBotUiStore.getState().runningByBot.bot).toBe(true);
  expect(useBotUiStore.getState().statusByBot.bot).toBe("working");

  act(() =>
    stream.subscriber?.onEvent({
      event: "bot:activity",
      payload: { botId: "bot", status: "done" },
    }),
  );
  await waitFor(() => expect(api.listBots).toHaveBeenCalledTimes(1));
  expect(useBotUiStore.getState().runningByBot.bot).toBe(false);
  expect(useBotUiStore.getState().statusByBot.bot).toBe("done");
  expect(useBotUiStore.getState().bots[0]?.unreadCount).toBe(1);

  unmount();
  expect(stream.close).toHaveBeenCalledTimes(1);
});
