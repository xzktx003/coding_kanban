import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventEnvelope } from "@session/lib/eventStream";
import { McpServerCard } from "./McpServerCard";
import { useMcpAuthStatus } from "./useMcpAuthStatus";

const mock = vi.hoisted(() => ({
  subscribers: new Set<{
    onEvent: (event: EventEnvelope) => void;
    onResync?: () => void;
  }>(),
  list: vi.fn(),
  login: vi.fn(),
  open: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  changed: vi.fn(),
  info: vi.fn(),
  dismiss: vi.fn(),
  mobile: false,
}));
vi.mock("@session/hooks/use-mobile", () => ({
  useIsMobile: () => mock.mobile,
}));
vi.mock("@session/hooks/runtime", () => ({ isTauri: () => false }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@session/lib/eventStream", () => ({
  openEventStream: (subscriber: {
    onEvent: (event: EventEnvelope) => void;
  }) => {
    mock.subscribers.add(subscriber);
    return () => mock.subscribers.delete(subscriber);
  },
}));
vi.mock("@session/services", () => ({
  listMcpServerStatus: mock.list,
  mcpServerOauthLogin: mock.login,
  unifiedDisableMcpServer: vi.fn(),
  unifiedEnableMcpServer: vi.fn(),
  unifiedRemoveMcpServer: vi.fn(),
}));
vi.mock("@session/features/plugins/hooks/useExternalUrl", () => ({
  useExternalUrl: () => ({ openExternalUrl: mock.open }),
}));
vi.mock("sonner", () => ({
  toast: {
    success: mock.success,
    error: mock.error,
    info: mock.info,
    dismiss: mock.dismiss,
  },
}));
const status = (authStatus: string) => ({
  data: [{ name: "fixture-mcp", authStatus }],
  nextCursor: null,
});
const emit = (method: string, params: unknown) =>
  act(() => {
    for (const subscriber of mock.subscribers)
      subscriber.onEvent({
        seq: 42,
        event: "codex:notification",
        payload: { method, params },
      });
  });
const card = (
  name = "fixture-mcp",
  authStatus: "notLoggedIn" | "oAuth" = "notLoggedIn",
) => (
  <McpServerCard
    name={name}
    config={{ type: "http", url: "https://fixture.invalid/mcp" }}
    authStatus={authStatus}
    loadServers={async () => {}}
    setServers={vi.fn()}
    onEdit={vi.fn()}
    onAuthChanged={mock.changed}
  />
);

beforeEach(() => {
  vi.clearAllMocks();
  mock.mobile = false;
  mock.info.mockReturnValue("oauth-toast");
  mock.success.mockReturnValue("oauth-toast");
  mock.subscribers.clear();
  mock.list.mockResolvedValue(status("notLoggedIn"));
  mock.login.mockResolvedValue({
    authorizationUrl: "https://fixture.invalid/authorize",
  });
  mock.open.mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());

describe("MCP browser notification transport", () => {
  it("mobile authorization notifications stay below navigation, update the same notice and leave with the card", async () => {
    mock.mobile = true;
    const { unmount } = render(card());
    fireEvent.click(screen.getByRole("button", { name: "Authorize" }));
    await waitFor(() => expect(mock.info).toHaveBeenCalled());
    expect(mock.info.mock.calls[0][1]).toMatchObject({
      position: "bottom-center",
    });
    emit("mcpServer/oauthLogin/completed", {
      name: "fixture-mcp",
      threadId: null,
      success: true,
      error: null,
    });
    expect(mock.success.mock.calls[0][1]).toMatchObject({
      id: "oauth-toast",
      position: "bottom-center",
    });
    unmount();
    expect(mock.dismiss).toHaveBeenCalledWith("oauth-toast");
  });
  it("refreshes real auth badges on Web OAuth completion and startup events", async () => {
    const { result, unmount } = renderHook(() => useMcpAuthStatus());
    await waitFor(() =>
      expect(result.current.authStatuses["fixture-mcp"]).toBe("notLoggedIn"),
    );
    mock.list.mockResolvedValue(status("oAuth"));
    emit("mcpServer/oauthLogin/completed", {
      name: "fixture-mcp",
      success: true,
      error: null,
    });
    await waitFor(() =>
      expect(result.current.authStatuses["fixture-mcp"]).toBe("oAuth"),
    );
    mock.list.mockResolvedValue(status("notLoggedIn"));
    emit("mcpServer/startupStatus/updated", { name: "fixture-mcp" });
    await waitFor(() =>
      expect(result.current.authStatuses["fixture-mcp"]).toBe("notLoggedIn"),
    );
    unmount();
    expect(mock.subscribers.size).toBe(0);
  });

  it("a matching Web completion frees the authorize button; another server cannot finish it", async () => {
    const { unmount } = render(card());
    fireEvent.click(screen.getByRole("button", { name: "Authorize" }));
    await waitFor(() => expect(mock.open).toHaveBeenCalledTimes(1));
    emit("mcpServer/oauthLogin/completed", {
      name: "other-mcp",
      success: true,
      error: null,
    });
    expect(
      (
        screen.getByRole("button", {
          name: "Authorize",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    emit("mcpServer/oauthLogin/completed", {
      name: "fixture-mcp",
      success: true,
      error: null,
    });
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "Authorize",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
    expect(mock.changed).toHaveBeenCalledTimes(1);
    expect(mock.success).toHaveBeenCalledTimes(1);
    unmount();
    expect(mock.subscribers.size).toBe(0);
  });

  it("a late start result cannot open the authorization URL for a replaced server card", async () => {
    let resolve!: (response: { authorizationUrl: string }) => void;
    mock.login.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const view = render(card());
    fireEvent.click(screen.getByRole("button", { name: "Authorize" }));
    expect(mock.login).toHaveBeenCalledTimes(1);
    view.rerender(card("replacement-mcp"));
    await act(async () =>
      resolve({ authorizationUrl: "https://fixture.invalid/old-authorize" }),
    );
    expect(mock.open).not.toHaveBeenCalled();
    expect(
      (
        screen.getByRole("button", {
          name: "Authorize",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it("late status reads cannot replace a newer OAuth status", async () => {
    let old!: (value: ReturnType<typeof status>) => void;
    mock.list.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          old = resolve;
        }),
    );
    const { result } = renderHook(() => useMcpAuthStatus());
    mock.list.mockResolvedValue(status("oAuth"));
    await act(async () => {
      await result.current.refreshAuthStatuses();
    });
    expect(result.current.authStatuses["fixture-mcp"]).toBe("oAuth");
    await act(async () => old(status("notLoggedIn")));
    expect(result.current.authStatuses["fixture-mcp"]).toBe("oAuth");
  });

  it("thread-specific or inactive completions do not finish a global authorization", async () => {
    render(card());
    emit("mcpServer/oauthLogin/completed", {
      name: "fixture-mcp",
      success: true,
      threadId: null,
    });
    expect(mock.success).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Authorize" }));
    await waitFor(() => expect(mock.open).toHaveBeenCalledTimes(1));
    emit("mcpServer/oauthLogin/completed", {
      name: "fixture-mcp",
      success: true,
      threadId: "other-thread",
    });
    expect(mock.success).not.toHaveBeenCalled();
    emit("mcpServer/oauthLogin/completed", {
      name: "fixture-mcp",
      success: false,
      threadId: null,
      error: "fixture denial",
    });
    expect(mock.error).toHaveBeenCalledWith(
      "Authorization failed: fixture denial",
      {
        id: "oauth-toast",
        position: "top-right",
        className: "session-mcp-notice",
      },
    );
    expect(
      (
        screen.getByRole("button", {
          name: "Authorize",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it("unmount ignores late authorization starts, and duplicate activation starts once", async () => {
    let complete!: (value: { authorizationUrl: string }) => void;
    mock.login.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const view = render(card());
    const button = screen.getByRole("button", {
      name: "Authorize",
    });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(mock.login).toHaveBeenCalledTimes(1);
    view.unmount();
    await act(async () =>
      complete({ authorizationUrl: "https://fixture.invalid/late" }),
    );
    expect(mock.open).not.toHaveBeenCalled();
    expect(mock.subscribers.size).toBe(0);
  });

  it("unknown timeout frees the UI and only reads status instead of retrying OAuth", async () => {
    vi.useFakeTimers();
    const view = render(card());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Authorize" }));
    });
    expect(mock.login).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTime(120_000));
    expect(
      (
        screen.getByRole("button", {
          name: "Authorize",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    expect(mock.error).toHaveBeenCalledWith(
      expect.stringContaining("still unknown"),
      {
        id: "oauth-toast",
        position: "top-right",
        className: "session-mcp-notice",
      },
    );
    expect(mock.changed).toHaveBeenCalled();
    expect(mock.login).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a confirmed status hides the finished authorization and returning to notLoggedIn enables a retry", async () => {
    const view = render(card());
    fireEvent.click(screen.getByRole("button", { name: "Authorize" }));
    await waitFor(() => expect(mock.open).toHaveBeenCalledTimes(1));
    view.rerender(card("fixture-mcp", "oAuth"));
    expect(screen.queryByRole("button", { name: "Authorize" })).toBeNull();
    view.rerender(card());
    expect(
      (
        screen.getByRole("button", {
          name: "Authorize",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });
});
