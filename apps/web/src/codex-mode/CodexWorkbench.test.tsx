import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import * as nativeSurface from "./native-surface";
import { CODEX_WINDOW_THREADS_KEY } from "./codex-window-restore";
const sessionBridge = vi.hoisted(() => ({
  navigateToAgentSession: vi.fn(),
  setCwd: vi.fn(),
  listThreads: vi.fn(),
}));
vi.mock("@session/lib/agentNav", () => ({
  navigateToAgentSession: sessionBridge.navigateToAgentSession,
}));
vi.mock("@session/stores/useWorkspaceStore", () => ({
  useWorkspaceStore: {
    getState: () => ({ cwd: null, setCwd: sessionBridge.setCwd }),
  },
}));
vi.mock("@session/services/apiAdapt/shared", () => ({
  postJsonWithOptions: (path: string, body: unknown) => {
    if (path !== "/api/codex/thread/list")
      throw new Error("unexpected Session API route " + path);
    return sessionBridge.listThreads(body);
  },
}));
import CodexWorkbench from "./CodexWorkbench";

function withSessionListEndpoints(fetcher: unknown): typeof fetch {
  return async (input, init) => {
    if (input === "/api/session/projects")
      return {
        ok: true,
        json: async () => ({ projects: [] }),
      } as Response;
    if (input === "/api/codex/thread/list")
      return {
        ok: true,
        json: async () => ({ data: [], nextCursor: null }),
      } as Response;
    return (
      fetcher as unknown as (
        input: RequestInfo | URL,
        init?: RequestInit,
      ) => Promise<Response>
    )(input, init);
  };
}

afterEach(() => {
  localStorage.removeItem(CODEX_WINDOW_THREADS_KEY);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  sessionBridge.navigateToAgentSession.mockReset();
  sessionBridge.setCwd.mockReset();
  sessionBridge.listThreads.mockReset();
});
it("shows unavailable native host honestly and navigation still works", async () => {
  vi.stubGlobal(
    "fetch",
    withSessionListEndpoints(
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ available: false, reason: "独立宿主未配置" }),
      })),
    ),
  );
  const change = vi.fn();
  render(<CodexWorkbench active onModeChange={change} />);
  await screen.findByText("独立宿主未配置");
  expect(document.querySelector("iframe")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /^会话$/ }));
  expect(change).toHaveBeenCalledWith("session");
});
it("retains the original host frame and does not poll or navigate while another mode is active", async () => {
  const fetcher = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      available: true,
      resumeAvailable: true,
      iframeUrl: "/native-codex/?folder=%2Ftmp%2Fowned",
      fixtures: [
        { id: "019aabcd-1234-7890-abcd-0123456789ab", label: "原生会话 1" },
      ],
    }),
  }));
  vi.stubGlobal("fetch", withSessionListEndpoints(fetcher));
  const change = vi.fn();
  const view = render(<CodexWorkbench active onModeChange={change} />);
  await waitFor(() => expect(document.querySelector("iframe")).not.toBeNull());
  const frame = document.querySelector("iframe");
  view.rerender(<CodexWorkbench active={false} onModeChange={change} />);
  view.rerender(<CodexWorkbench active onModeChange={change} />);
  expect(document.querySelector("iframe")).toBe(frame);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("does not mount a frame for a foreign URL even when metadata claims available", async () => {
  vi.stubGlobal(
    "fetch",
    withSessionListEndpoints(
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          available: true,
          resumeAvailable: true,
          iframeUrl: "https://evil.test/native-codex/",
        }),
      })),
    ),
  );
  render(<CodexWorkbench active onModeChange={vi.fn()} />);
  await screen.findByRole("alert");
  expect(document.querySelector("iframe")).toBeNull();
});

it("clears a load timeout when native windows become ready later", async () => {
  let ready: (count: number) => void = () => {};
  vi.spyOn(nativeSurface, "mountNativeSurface").mockImplementation(
    (_document, onCount, onReady) => {
      ready = (count) => {
        onCount(count);
        onReady?.(count);
      };
      return { start: () => onCount(2), pause: vi.fn(), dispose: vi.fn() };
    },
  );
  vi.stubGlobal(
    "fetch",
    withSessionListEndpoints(
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          available: true,
          resumeAvailable: true,
          iframeUrl: "/native-codex/",
        }),
      })),
    ),
  );
  render(<CodexWorkbench active onModeChange={vi.fn()} />);
  const frame = await screen.findByTitle("原生 Codex 会话窗口");
  fireEvent.load(frame);
  vi.useFakeTimers(); // Re-arm timeout using current fake clock.
  fireEvent.click(screen.getByRole("button", { name: "重试连接" }));
  await act(async () => {
    await Promise.resolve();
  });
  fireEvent.load(screen.getByTitle("原生 Codex 会话窗口"));
  act(() => vi.advanceTimersByTime(60_000));
  expect(screen.getByRole("alert")).toBeTruthy();
  act(() => ready(2));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByText("2 个窗口")).toBeTruthy();
});
it("pauses its loading timeout while the Codex mode is hidden", async () => {
  vi.stubGlobal(
    "fetch",
    withSessionListEndpoints(
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          available: true,
          resumeAvailable: true,
          iframeUrl: "/native-codex/",
        }),
      })),
    ),
  );
  const view = render(<CodexWorkbench active onModeChange={vi.fn()} />);
  await screen.findByTitle("原生 Codex 会话窗口");
  vi.useFakeTimers();
  fireEvent.click(screen.getByRole("button", { name: "重试连接" }));
  await act(async () => {
    await Promise.resolve();
  });
  view.rerender(<CodexWorkbench active={false} onModeChange={vi.fn()} />);
  act(() => vi.advanceTimersByTime(120_000));
  expect(screen.queryByRole("alert")).toBeNull();
});

it("rechecks the connection without replacing an open native iframe or its unsent input", async () => {
  const fetcher = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      available: true,
      resumeAvailable: true,
      iframeUrl: "/native-codex/?folder=%2Ftmp%2Fowned",
    }),
  }));
  vi.stubGlobal("fetch", withSessionListEndpoints(fetcher));
  const dispose = vi.fn();
  vi.spyOn(nativeSurface, "mountNativeSurface").mockImplementation(
    (_document, onCount) => ({
      start: () => onCount(2),
      pause: vi.fn(),
      dispose,
    }),
  );
  render(<CodexWorkbench active onModeChange={vi.fn()} />);
  const original = (await screen.findByTitle(
    "原生 Codex 会话窗口",
  )) as HTMLIFrameElement;
  original.contentDocument!.open();
  original.contentDocument!.write("<!doctype html><html><body></body></html>");
  original.contentDocument!.close();
  const input = original.contentDocument!.createElement("textarea");
  input.value = "keep my unsent draft";
  original.contentDocument!.body.append(input);
  fireEvent.load(original);
  await screen.findByText("2 个窗口");
  fireEvent.click(screen.getByRole("button", { name: "重试连接" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  expect(screen.getByTitle("原生 Codex 会话窗口")).toBe(original);
  expect(original.isConnected).toBe(true);
  expect(original.contentDocument!.querySelector("textarea")?.value).toBe(
    "keep my unsent draft",
  );
  expect(dispose).not.toHaveBeenCalled();
});

it("retains an already open native document when a connection recheck fails", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        available: true,
        resumeAvailable: true,
        iframeUrl: "/native-codex/",
      }),
    })
    .mockResolvedValueOnce({ ok: false });
  vi.stubGlobal("fetch", withSessionListEndpoints(fetcher));
  render(<CodexWorkbench active onModeChange={vi.fn()} />);
  const original = await screen.findByTitle("原生 Codex 会话窗口");
  fireEvent.click(screen.getByRole("button", { name: "重试连接" }));
  await screen.findByRole("alert");
  expect(screen.getByTitle("原生 Codex 会话窗口")).toBe(original);
});

it("restores a saved local thread only into its blank captured new-chat window", async () => {
  const windowIds = [
    "019aabcd-5678-7890-abcd-0123456789ab",
    "019aabcd-5678-7890-abcd-0123456789ac",
  ];
  const threadId = "019aabcd-1234-7890-abcd-0123456789ab";
  const secondThreadId = "019aabcd-1234-7890-abcd-0123456789ac";
  localStorage.setItem(
    CODEX_WINDOW_THREADS_KEY,
    JSON.stringify({
      version: 1,
      windows: { [windowIds[0]!]: threadId, [windowIds[1]!]: secondThreadId },
    }),
  );
  const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  vi.stubGlobal(
    "fetch",
    withSessionListEndpoints(
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ input, init });
        return init?.method === "POST"
          ? ({ ok: true, status: 202 } as Response)
          : ({
              ok: true,
              json: async () => ({
                available: true,
                resumeAvailable: true,
                iframeUrl: "/native-codex/",
                newChatWindowIds: windowIds,
              }),
            } as Response);
      }),
    ),
  );
  vi.spyOn(nativeSurface, "mountNativeSurface").mockImplementation(
    (_document, onCount, onReady, options) => {
      onCount(2);
      onReady?.(2);
      options?.onThreadState?.(0, {
        ready: true,
        conversationId: null,
        hasComposer: true,
        composerEmpty: true,
        userInteracted: false,
      });
      options?.onThreadState?.(1, {
        ready: true,
        conversationId: null,
        hasComposer: true,
        composerEmpty: true,
        userInteracted: false,
      });
      return { start: vi.fn(), pause: vi.fn(), dispose: vi.fn() };
    },
  );
  render(<CodexWorkbench active onModeChange={vi.fn()} />);
  fireEvent.load(await screen.findByTitle("原生 Codex 会话窗口"));
  await waitFor(() => expect(calls).toHaveLength(3), { timeout: 3000 });
  expect(calls[1]?.input).toBe("/api/native-codex/restore");
  expect(
    calls.slice(1).map((call) => JSON.parse(String(call.init?.body))),
  ).toEqual([
    { windowId: windowIds[0], threadId, column: 1 },
    { windowId: windowIds[1], threadId: secondThreadId, column: 2 },
  ]);
  const frame = screen.getByTitle("原生 Codex 会话窗口") as HTMLIFrameElement;
  expect(frame.style.pointerEvents).toBe("");
  expect(frame.tabIndex).toBe(0);
  expect(localStorage.getItem(CODEX_WINDOW_THREADS_KEY)).toContain(threadId);
});

it("cancels delayed restoration when the user interacts with the original composer", async () => {
  const windowIds = [
    "019aabcd-5678-7890-abcd-0123456789ab",
    "019aabcd-5678-7890-abcd-0123456789ac",
  ];
  const threadId = "019aabcd-1234-7890-abcd-0123456789ab";
  localStorage.setItem(
    CODEX_WINDOW_THREADS_KEY,
    JSON.stringify({ version: 1, windows: { [windowIds[0]!]: threadId } }),
  );
  const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  vi.stubGlobal(
    "fetch",
    withSessionListEndpoints(
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ input, init });
        return {
          ok: true,
          json: async () => ({
            available: true,
            resumeAvailable: true,
            iframeUrl: "/native-codex/",
            newChatWindowIds: windowIds,
          }),
        } as Response;
      }),
    ),
  );
  vi.spyOn(nativeSurface, "mountNativeSurface").mockImplementation(
    (_document, onCount, onReady, options) => {
      onCount(2);
      onReady?.(2);
      options?.onThreadState?.(0, {
        ready: true,
        conversationId: null,
        hasComposer: true,
        composerEmpty: true,
        userInteracted: false,
      });
      window.setTimeout(
        () =>
          options?.onThreadState?.(0, {
            ready: true,
            conversationId: null,
            hasComposer: true,
            composerEmpty: true,
            userInteracted: true,
          }),
        100,
      );
      return { start: vi.fn(), pause: vi.fn(), dispose: vi.fn() };
    },
  );
  render(<CodexWorkbench active onModeChange={vi.fn()} />);
  fireEvent.load(await screen.findByTitle("原生 Codex 会话窗口"));
  await new Promise((resolve) => window.setTimeout(resolve, 1000));
  expect(calls).toHaveLength(1);
  expect(calls[0]?.input).toBe("/api/native-codex/status");
});

it("lists the selected project's sessions and resumes the exact thread into the chosen native window", async () => {
  const threadId = "019aabcd-1234-7890-abcd-0123456789ab";
  const cwd = "/tmp/project-a";
  sessionBridge.listThreads.mockResolvedValue({
    data: [
      {
        id: threadId,
        cwd,
        name: "Existing conversation",
        preview: "Open the existing thread",
        updatedAt: 10,
        parentThreadId: null,
        ephemeral: false,
      },
    ],
    nextCursor: null,
  });
  const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  let statusRequests = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ input, init });
      if (input === "/api/native-codex/status")
        return {
          ok: true,
          json: async () => ({
            available: true,
            resumeAvailable: ++statusRequests > 1,
            iframeUrl: "/native-codex/",
          }),
        } as Response;
      if (input === "/api/session/projects")
        return {
          ok: true,
          json: async () => ({ projects: [cwd] }),
        } as Response;
      if (input === "/api/native-codex/resume")
        return {
          ok: true,
          status: 202,
          json: async () => ({ opened: true }),
        } as Response;
      throw new Error("unexpected request " + String(input));
    }),
  );

  render(<CodexWorkbench active onModeChange={vi.fn()} />);
  const conversation = await screen.findByRole("button", {
    name: "Resume Existing conversation",
  });
  expect(screen.getByText("1 个会话")).toBeTruthy();
  expect((conversation as HTMLButtonElement).disabled).toBe(true);
  await waitFor(
    () => expect((conversation as HTMLButtonElement).disabled).toBe(false),
    { timeout: 3000 },
  );
  fireEvent.click(screen.getByRole("button", { name: "Codex 窗口 2" }));
  fireEvent.click(conversation);

  await waitFor(() =>
    expect(
      requests.find((request) => request.input === "/api/native-codex/resume"),
    ).toBeTruthy(),
  );
  const resumeRequest = requests.find(
    (request) => request.input === "/api/native-codex/resume",
  );
  expect(JSON.parse(String(resumeRequest?.init?.body))).toEqual({
    threadId,
    column: 2,
  });
  expect(sessionBridge.listThreads).toHaveBeenCalledExactlyOnceWith({
    cwd,
    limit: 100,
    sortKey: "updated_at",
    sortDirection: "desc",
    modelProviders: [],
    archived: false,
    useStateDbOnly: true,
  });
  expect(sessionBridge.navigateToAgentSession).toHaveBeenCalledExactlyOnceWith({
    agent: "codex",
    cwd,
    threadId,
  });
});
