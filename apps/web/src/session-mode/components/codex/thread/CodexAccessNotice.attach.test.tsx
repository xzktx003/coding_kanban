import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CodexAccessNotice } from "./CodexAccessNotice";
import {
  resetCodexAccessCache,
  useCodexAccessStore,
} from "@session/stores/useCodexAccessStore";
import { useSessionSyncStore } from "@session/stores/useSessionSyncStore";
import { threadAccess } from "@session/services/apiAdapt/codex";
vi.mock("@session/services/apiAdapt/codex", () => ({ threadAccess: vi.fn() }));
vi.mock("@session/lib/eventStream", () => ({ retryEventStream: vi.fn() }));
vi.mock("@session/session-dom", () => ({
  useAgentInteractionVisible: () => true,
}));
const active = {
  state: "readonly",
  reason: "",
  generation: 3,
  sharedDaemon: true,
  loaded: true,
  attached: false,
  activeTurnId: "active-turn",
};
afterEach(() => {
  cleanup();
  resetCodexAccessCache();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
function setup() {
  useSessionSyncStore.setState({
    connection: "connected",
    connectionError: null,
    recovering: {},
  });
  vi.mocked(threadAccess).mockResolvedValue(active as never);
}
it("does not attach during reads and captures the exact active target only on explicit interaction", async () => {
  setup();
  const fetcher = vi.fn(
    async (_url: RequestInfo | URL, options?: RequestInit) => {
      if (!options?.method)
        return new Response(
          JSON.stringify({ scopeToken: "scope-1", namespace: "account-1" }),
        );
      vi.mocked(threadAccess).mockResolvedValue({
        ...active,
        state: "owned",
        attached: true,
      } as never);
      return new Response("{}");
    },
  );
  vi.stubGlobal("fetch", fetcher);
  render(<CodexAccessNotice threadId="external-thread" />);
  const button = await screen.findByRole("button", { name: "连接实时交互" });
  expect(fetcher).not.toHaveBeenCalled();
  fireEvent.click(button);
  fireEvent.click(button);
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  expect(JSON.parse(String(fetcher.mock.calls[1]![1]!.body))).toEqual({
    expectedScope: "scope-1",
    threadId: "external-thread",
    expectedTurnId: "active-turn",
  });
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "连接实时交互" })).toBeNull(),
  );
});
it.each([
  { attached: true },
  { loaded: false },
  { activeTurnId: null },
  { sharedDaemon: false },
])(
  "does not offer attachment for an ineligible shared task: %j",
  async (change) => {
    setup();
    vi.mocked(threadAccess).mockResolvedValue({
      ...active,
      ...change,
    } as never);
    render(<CodexAccessNotice threadId="attached-thread" />);
    await waitFor(() =>
      expect(
        useCodexAccessStore.getState().entries["attached-thread"]?.access,
      ).toBeTruthy(),
    );
    expect(screen.queryByRole("button", { name: "连接实时交互" })).toBeNull();
  },
);
it("blocks an old target when the access generation changes before the write", async () => {
  setup();
  let resolve!: (response: Response) => void;
  const fetcher = vi.fn(
    (_url: RequestInfo | URL, _options?: RequestInit) =>
      new Promise<Response>((done) => {
        resolve = done;
      }),
  );
  vi.stubGlobal("fetch", fetcher);
  render(<CodexAccessNotice threadId="original" />);
  fireEvent.click(await screen.findByRole("button", { name: "连接实时交互" }));
  act(() =>
    useCodexAccessStore.setState({
      entries: { original: { access: { ...active, generation: 4 } as never } },
    }),
  );
  await act(async () =>
    resolve(
      new Response(
        JSON.stringify({ scopeToken: "scope-1", namespace: "account-1" }),
      ),
    ),
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(screen.getByText(/会话或连接已变化/)).toBeTruthy();
});
it("keeps a lost write receipt unknown and never retries attachment automatically", async () => {
  setup();
  const fetcher = vi.fn(
    async (_url: RequestInfo | URL, options?: RequestInit) => {
      if (!options?.method)
        return new Response(
          JSON.stringify({ scopeToken: "scope-1", namespace: "account-1" }),
        );
      throw new Error("connection lost");
    },
  );
  vi.stubGlobal("fetch", fetcher);
  const view = render(<CodexAccessNotice threadId="unknown" />);
  fireEvent.click(await screen.findByRole("button", { name: "连接实时交互" }));
  await screen.findByText(/连接结果尚未确认/);
  view.rerender(<CodexAccessNotice threadId="unknown" />);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(
    screen
      .getByRole("button", { name: "连接状态待核对" })
      .hasAttribute("disabled"),
  ).toBe(true);
});
it("never dispatches a late context result after the inspected owner has changed", async () => {
  setup();
  let resolve!: (response: Response) => void;
  const fetcher = vi.fn(
    (_url: RequestInfo | URL, _options?: RequestInit) =>
      new Promise<Response>((done) => {
        resolve = done;
      }),
  );
  vi.stubGlobal("fetch", fetcher);
  const view = render(<CodexAccessNotice threadId="original" />);
  fireEvent.click(await screen.findByRole("button", { name: "连接实时交互" }));
  view.rerender(<CodexAccessNotice threadId="another" />);
  await act(async () =>
    resolve(
      new Response(
        JSON.stringify({ scopeToken: "scope-1", namespace: "account-1" }),
      ),
    ),
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(/连接结果尚未确认/)).toBeNull();
});
