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
import { CODEX_MULTIWINDOW_KEY } from "./codex-multiwindow-state";
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
const visibleInstanceId = "019aabcd-1234-7890-abcd-0123456789ae";
async function markVisibleHostReady() {
  const frame = await screen.findByTitle("原生 Codex 会话窗口") as HTMLIFrameElement;
  if (!frame.contentDocument!.body) {
    frame.contentDocument!.open();
    frame.contentDocument!.write("<!doctype html><html><body></body></html>");
    frame.contentDocument!.close();
  }
  const marker = frame.contentDocument!.createElement("div");
  marker.className = "statusbar-item";
  marker.textContent = `Kanban host ${visibleInstanceId}`;
  frame.contentDocument!.body.append(marker);
  fireEvent.load(frame);
  return frame;
}

function dragCodexTabToPaneEdge(windowId: string, edge: "left" | "right" | "top" | "bottom") {
  HTMLElement.prototype.setPointerCapture = () => {};
  const tab = document.querySelector<HTMLElement>(`[data-codex-window="${windowId}"]`);
  const body = document.querySelector<HTMLElement>("[data-codex-group-body]");
  if (!tab || !body) throw new Error("missing Codex split drag target");
  vi.spyOn(body, "getBoundingClientRect").mockReturnValue({
    x: 0, y: 40, left: 0, top: 40, right: 800, bottom: 640, width: 800, height: 600, toJSON: () => ({}),
  } as DOMRect);
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => body });
  const point = edge === "left" ? [10, 300] : edge === "right" ? [790, 300] : edge === "top" ? [400, 50] : [400, 620];
  fireEvent.pointerDown(tab, { pointerId: 1, clientX: 100, clientY: 10, button: 0 });
  fireEvent.pointerMove(tab, { pointerId: 1, clientX: point[0], clientY: point[1] });
  fireEvent.pointerUp(tab, { pointerId: 1, clientX: point[0], clientY: point[1] });
}

function withSessionListEndpoints(fetcher: unknown): typeof fetch {
  return async (input, init) => {
    if (input === "/api/session/projects")
      return {
        ok: true,
        json: async () => ({ projects: [] }),
      } as Response;
    if (input === "/api/native-codex/tabs")
      return {
        ok: true,
        json: async () => ({ initialized: true, revision: 1, threads: [], sequence: 0 }),
      } as Response;
    if (input === "/api/codex/thread/list")
      return {
        ok: true,
        json: async () => ({ data: [], nextCursor: null }),
      } as Response;
    if (input === "/api/native-codex/focus")
      return { ok: true, status: 202, json: async () => ({ focused: true, column: 1 }) } as Response;
    return (
      fetcher as unknown as (
        input: RequestInfo | URL,
        init?: RequestInit,
      ) => Promise<Response>
    )(input, init);
  };
}

afterEach(() => {
  sessionStorage.clear();
  localStorage.removeItem(CODEX_WINDOW_THREADS_KEY);
  localStorage.removeItem(CODEX_MULTIWINDOW_KEY);
  localStorage.removeItem("kanban.codex.multiwindow.v1");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  sessionBridge.navigateToAgentSession.mockReset();
  sessionBridge.setCwd.mockReset();
  sessionBridge.listThreads.mockReset();
});
it("offers handoff only after native writer conflict and live previous host are confirmed", async () => {
  const firstWindowId = "019aabcd-5678-7890-abcd-0123456789ab";
  const oldInstanceId = "019aabcd-1234-7890-abcd-0123456789ad";
  const threadId = "019aabcd-1234-7890-abcd-0123456789ab";
  localStorage.setItem(CODEX_MULTIWINDOW_KEY, JSON.stringify({ version: 2, hostKey: firstWindowId, activeId: threadId,
    activeGroupId: "saved", tree: { type: "group", id: "saved", keys: [threadId], selected: threadId },
    windows: [{ id: threadId, kind: "thread", threadId, title: "Saved chat", cwd: "/tmp/project" }] }));
  sessionStorage.setItem("kanban.codex.native-host.v1", JSON.stringify({ hostKey: firstWindowId, instanceId: oldInstanceId }));
  const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  vi.stubGlobal("fetch", withSessionListEndpoints(vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ input, init });
    if (input === "/api/native-codex/status") return { ok: true, json: async () => ({ available: true, resumeAvailable: true,
      iframeUrl: "/native-codex/?folder=%2Ftmp%2Fproject", newChatWindowIds: [firstWindowId, "019aabcd-5678-7890-abcd-0123456789ac"] }) } as Response;
    if (input === "/api/native-codex/release-instance") return { ok: true, status: 202, json: async () => ({ released: true }) } as Response;
    if (input === "/api/native-codex/instance-status") return { ok: true, json: async () => ({ active: true }) } as Response;
    if (input === "/api/native-codex/resume-beside") return { ok: true, status: 202, json: async () => ({ opened: true, column: 2 }) } as Response;
    throw new Error(`unexpected request ${String(input)}`);
  })));
  let report: nativeSurface.NativeSurfaceOptions["onWindowState"];
  vi.spyOn(nativeSurface, "mountNativeSurface").mockImplementation((_document, onCount, onReady, options) => {
    onCount(2); onReady?.(2); options?.onHostInstance?.(visibleInstanceId);
    report = options?.onWindowState;
    return { start: vi.fn(), pause: vi.fn(), dispose: vi.fn(), setLayout: vi.fn() };
  });
  render(<CodexWorkbench active onModeChange={vi.fn()} />);
  fireEvent.load(await screen.findByTitle("原生 Codex 会话窗口"));
  await waitFor(() => expect(requests.some(({ input }) => input === "/api/native-codex/resume-beside")).toBe(true));
  expect(screen.queryByRole("button", { name: "释放旧实例并恢复" })).toBeNull();
  act(() => report?.(threadId, { ready: true, conversationId: threadId, hasComposer: false, composerEmpty: false, userInteracted: false, blockedByOtherApp: true }));
  const release = await screen.findByRole("button", { name: "释放旧实例并恢复" });
  expect(requests.some(({ input }) => input === "/api/native-codex/release-instance")).toBe(false);
  fireEvent.click(release);
  await waitFor(() => expect(requests.some(({ input }) => input === "/api/native-codex/resume-beside")).toBe(true));
  expect(JSON.parse(String(requests.find(({ input }) => input === "/api/native-codex/release-instance")?.init?.body))).toEqual({ oldInstanceId, currentInstanceId: visibleInstanceId });
  expect(JSON.parse(sessionStorage.getItem("kanban.codex.native-host.v1")!)).toMatchObject({ hostKey: firstWindowId, instanceId: visibleInstanceId });
});

it("does not block an empty chat or offer release for a dead previous instance", async () => {
  const firstWindowId = "019aabcd-5678-7890-abcd-0123456789ab";
  sessionStorage.setItem("kanban.codex.native-host.v1", JSON.stringify({ hostKey: firstWindowId, instanceId: "019aabcd-1234-7890-abcd-0123456789ad" }));
  const requests: string[] = [];
  vi.stubGlobal("fetch", withSessionListEndpoints(vi.fn(async (input: string) => {
    requests.push(input);
    if (input === "/api/native-codex/status") return { ok: true, json: async () => ({ available: true, resumeAvailable: true, iframeUrl: "/native-codex/", newChatWindowIds: [firstWindowId, "019aabcd-5678-7890-abcd-0123456789ac"] }) } as Response;
    if (input === "/api/native-codex/instance-status") return { ok: true, json: async () => ({ active: false }) } as Response;
    throw new Error(input);
  })));
  let report: nativeSurface.NativeSurfaceOptions["onWindowState"];
  vi.spyOn(nativeSurface, "mountNativeSurface").mockImplementation((_document, onCount, onReady, options) => {
    onCount(2); onReady?.(2); options?.onHostInstance?.(visibleInstanceId); report = options?.onWindowState;
    return { start: vi.fn(), pause: vi.fn(), dispose: vi.fn(), setLayout: vi.fn() };
  });
  render(<CodexWorkbench active onModeChange={vi.fn()} />);
  fireEvent.load(await screen.findByTitle("原生 Codex 会话窗口"));
  expect(screen.queryByText("刷新后检测到旧 Codex 实例")).toBeNull();
  expect(screen.getByRole("button", { name: "+ 新聊天" }).hasAttribute("disabled")).toBe(false);
  act(() => report?.(`new:${firstWindowId}`, { ready: true, conversationId: null, hasComposer: false, composerEmpty: false, userInteracted: false, blockedByOtherApp: true }));
  await waitFor(() => expect(requests).toContain("/api/native-codex/instance-status"));
  expect(screen.queryByRole("button", { name: "释放旧实例并恢复" })).toBeNull();
  expect(requests).not.toContain("/api/native-codex/release-instance");
});
it("waits for the selected native editor group before enabling its input", async () => {
  const firstWindowId = "019aabcd-5678-7890-abcd-0123456789ab";
  let resolveFocus: ((value: Response) => void) | undefined;
  const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ input, init });
    if (input === "/api/native-codex/status") return { ok: true, json: async () => ({
      available: true, resumeAvailable: true, iframeUrl: "/native-codex/", newChatWindowIds: [firstWindowId, "019aabcd-5678-7890-abcd-0123456789ac"],
    }) } as Response;
    if (input === "/api/session/projects") return { ok: true, json: async () => ({ projects: [] }) } as Response;
    if (input === "/api/native-codex/tabs") return { ok: true, json: async () => ({ initialized: true, revision: 1, threads: [], sequence: 0 }) } as Response;
    if (input === "/api/native-codex/focus") return new Promise<Response>((resolve) => { resolveFocus = resolve; });
    throw new Error("unexpected request " + String(input));
  }));
  const setLayout = vi.fn();
  let report: ((windowId: string, state: { ready: boolean; conversationId: string | null; hasComposer: boolean; composerEmpty: boolean; userInteracted: boolean; blockedByOtherApp?: boolean }) => void) | undefined;
  vi.spyOn(nativeSurface, "mountNativeSurface").mockImplementation((_document, onCount, onReady, options) => {
    onCount(2); onReady?.(2); options?.onHostInstance?.(visibleInstanceId); report = options?.onWindowState;
    return { start: vi.fn(), pause: vi.fn(), dispose: vi.fn(), setLayout };
  });
  render(<CodexWorkbench active onModeChange={vi.fn()} />);
  fireEvent.load(await screen.findByTitle("原生 Codex 会话窗口"));
  await waitFor(() => expect(screen.getByRole("button", { name: "+ 新聊天" }).hasAttribute("disabled")).toBe(false));
  expect(requests.some(request => request.input === "/api/native-codex/focus")).toBe(false);
  act(() => report?.(`new:${firstWindowId}`, { ready: true, conversationId: null, hasComposer: false, composerEmpty: false, userInteracted: false, blockedByOtherApp: false }));
  await waitFor(() => expect(requests.some(request => request.input === "/api/native-codex/focus")).toBe(true));
  expect(JSON.parse(String(requests.find(request => request.input === "/api/native-codex/focus")?.init?.body))).toEqual({
    instanceId: visibleInstanceId, kind: "new", targetId: firstWindowId,
  });
  expect(screen.getByText("请在原生界面中完成官方引导")).toBeTruthy();
  expect(screen.queryByText("正在切换原生输入窗口…")).toBeNull();
  expect(setLayout.mock.lastCall?.[0].interactiveId).toBe(`new:${firstWindowId}`);
  act(() => resolveFocus?.({ ok: false, status: 503, json: async () => ({}) } as Response));
  await waitFor(() => expect(screen.getByText("原生窗口切换失败（HTTP 503）")).toBeTruthy());
  expect(screen.queryByText("请在原生界面中完成官方引导")).toBeNull();
  expect(setLayout.mock.lastCall?.[0].interactiveId).toBe(`new:${firstWindowId}`);
  act(() => report?.(`new:${firstWindowId}`, { ready: true, conversationId: null, hasComposer: false, composerEmpty: false, userInteracted: false, blockedByOtherApp: true }));
  expect(screen.getByText("另一实例占用 · 请点原生 Retry")).toBeTruthy();
  act(() => report?.(`new:${firstWindowId}`, { ready: true, conversationId: null, hasComposer: true, composerEmpty: true, userInteracted: false, blockedByOtherApp: false }));
  expect(screen.queryByText("已就绪")).toBeNull();
  expect(document.querySelector(".codex-window-status")).toBeNull();
  expect(screen.queryByRole("button", { name: "关闭 新聊天 窗口" })).toBeNull();
  expect(screen.getByRole("button", { name: "关闭 新聊天 标签" })).toBeTruthy();
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

it("times out unrendered native content even when outer panels exist and clears the error on late readiness", async () => {
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
  expect(screen.getByRole("alert").textContent).toContain("原生 Codex 界面未能加载");
  act(() => ready(2));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByText("1 个窗口")).toBeTruthy();
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
  await screen.findByText("1 个窗口");
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

it("restores a saved local thread only into its visible blank new-chat window", async () => {
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
      options?.onHostInstance?.(visibleInstanceId);
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
  await waitFor(() => expect(calls.some((call) => call.input === "/api/native-codex/restore")).toBe(true), { timeout: 3000 });
  expect(calls.filter((call) => call.input === "/api/native-codex/restore")).toHaveLength(1);
  expect(
    calls.filter((call) => call.input === "/api/native-codex/restore").map((call) => JSON.parse(String(call.init?.body))),
  ).toEqual([{ windowId: windowIds[0], threadId, column: 1, instanceId: visibleInstanceId }]);
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

it("returns a native card to loading when its webview loses rendered content", async () => {
  const firstWindowId = "019aabcd-5678-7890-abcd-0123456789ab";
  vi.stubGlobal("fetch", withSessionListEndpoints(vi.fn(async () => ({ ok: true, json: async () => ({
    available: true, resumeAvailable: true, iframeUrl: "/native-codex/",
    newChatWindowIds: [firstWindowId, "019aabcd-5678-7890-abcd-0123456789ac"],
  }) }))));
  let report: ((windowId: string, state: { ready: boolean; conversationId: string | null; hasComposer: boolean; composerEmpty: boolean; userInteracted: boolean }) => void) | undefined;
  vi.spyOn(nativeSurface, "mountNativeSurface").mockImplementation((_document, onCount, onReady, options) => {
    onCount(2);
    onReady?.(1);
    options?.onHostInstance?.(visibleInstanceId);
    report = options?.onWindowState;
    return { start: vi.fn(), pause: vi.fn(), dispose: vi.fn() };
  });
  render(<CodexWorkbench active onModeChange={vi.fn()} />);
  fireEvent.load(await screen.findByTitle("原生 Codex 会话窗口"));
  expect(report).toBeTypeOf("function");
  act(() => report?.(`new:${firstWindowId}`, { ready: true, conversationId: null, hasComposer: true, composerEmpty: true, userInteracted: false }));
  expect(screen.queryByText("已就绪")).toBeNull();
  expect(document.querySelector(".codex-window-status")).toBeNull();
  act(() => report?.(`new:${firstWindowId}`, { ready: true, conversationId: null, hasComposer: false, composerEmpty: false, userInteracted: false }));
  expect(screen.getByText("请在原生界面中完成官方引导")).toBeTruthy();
  expect(screen.queryByText("正在加载原生 Codex…")).toBeNull();
  act(() => report?.(`new:${firstWindowId}`, { ready: false, conversationId: null, hasComposer: false, composerEmpty: false, userInteracted: false }));
  expect(screen.getByText("正在加载原生 Codex…")).toBeTruthy();
});

it("keeps an unsent native new-chat draft out of newly opened windows", async () => {
  const firstWindowId = "019aabcd-5678-7890-abcd-0123456789ab";
  const requests: string[] = [];
  vi.stubGlobal("fetch", withSessionListEndpoints(vi.fn(async (input: RequestInfo | URL) => {
    requests.push(String(input));
    if (input === "/api/native-codex/status") return { ok: true, json: async () => ({
      available: true, resumeAvailable: true, iframeUrl: "/native-codex/", newChatWindowIds: [firstWindowId, "019aabcd-5678-7890-abcd-0123456789ac"],
    }) } as Response;
    if (input === "/api/native-codex/new-beside") return { ok: true, status: 202, json: async () => ({ opened: true, column: 2 }) } as Response;
    throw new Error(`unexpected request ${String(input)}`);
  })));
  let report: ((windowId: string, state: { ready: boolean; conversationId: string | null; hasComposer: boolean; composerEmpty: boolean; userInteracted: boolean }) => void) | undefined;
  vi.spyOn(nativeSurface, "mountNativeSurface").mockImplementation((_document, onCount, onReady, options) => {
    onCount(2); onReady?.(2); options?.onHostInstance?.(visibleInstanceId); report = options?.onWindowState;
    return { start: vi.fn(), pause: vi.fn(), dispose: vi.fn(), setLayout: vi.fn() };
  });
  render(<CodexWorkbench active onModeChange={vi.fn()} />);
  fireEvent.load(await screen.findByTitle("原生 Codex 会话窗口"));
  await waitFor(() => expect(screen.getByRole("button", { name: "+ 新聊天" }).hasAttribute("disabled")).toBe(false));
  act(() => report?.(`new:${firstWindowId}`, { ready: true, conversationId: null, hasComposer: true, composerEmpty: false, userInteracted: true }));
  fireEvent.click(screen.getByRole("button", { name: "+ 新聊天" }));
  expect(requests).not.toContain("/api/native-codex/new-beside");
  expect(screen.getByText(/先发送当前新聊天草稿/)).toBeTruthy();
  act(() => report?.(`new:${firstWindowId}`, { ready: true, conversationId: null, hasComposer: true, composerEmpty: true, userInteracted: true }));
  fireEvent.click(screen.getByRole("button", { name: "+ 新聊天" }));
  await waitFor(() => expect(requests).toContain("/api/native-codex/new-beside"));
});

it("keeps a matching loaded native thread usable if a duplicate open request conflicts", async () => {
  const firstWindowId = "019aabcd-5678-7890-abcd-0123456789ab";
  const threadId = "019aabcd-1234-7890-abcd-0123456789ab";
  localStorage.setItem(CODEX_MULTIWINDOW_KEY, JSON.stringify({ version: 2, hostKey: firstWindowId, activeId: threadId,
    activeGroupId: "saved", tree: { type: "group", id: "saved", keys: [threadId], selected: threadId },
    windows: [{ id: threadId, kind: "thread", threadId, title: "Saved chat", cwd: "/tmp/project" }] }));
  let resolveResume: ((value: Response) => void) | undefined;
  vi.stubGlobal("fetch", withSessionListEndpoints(vi.fn(async (input: RequestInfo | URL) => {
    if (input === "/api/native-codex/status") return { ok: true, json: async () => ({ available: true, resumeAvailable: true,
      iframeUrl: "/native-codex/?folder=%2Ftmp%2Fproject", newChatWindowIds: [firstWindowId, "019aabcd-5678-7890-abcd-0123456789ac"] }) } as Response;
    if (input === "/api/native-codex/resume-beside") return new Promise<Response>((resolve) => { resolveResume = resolve; });
    throw new Error(`unexpected request ${String(input)}`);
  })));
  let report: ((windowId: string, state: { ready: boolean; conversationId: string | null; hasComposer: boolean; composerEmpty: boolean; userInteracted: boolean }) => void) | undefined;
  vi.spyOn(nativeSurface, "mountNativeSurface").mockImplementation((_document, onCount, onReady, options) => {
    onCount(2); onReady?.(2); options?.onHostInstance?.(visibleInstanceId); report = options?.onWindowState;
    return { start: vi.fn(), pause: vi.fn(), dispose: vi.fn(), setLayout: vi.fn() };
  });
  render(<CodexWorkbench active onModeChange={vi.fn()} />);
  fireEvent.load(await screen.findByTitle("原生 Codex 会话窗口"));
  await waitFor(() => expect(resolveResume).toBeTypeOf("function"));
  act(() => report?.(threadId, { ready: true, conversationId: threadId, hasComposer: true, composerEmpty: true, userInteracted: false }));
  act(() => resolveResume?.({ ok: false, status: 409 } as Response));
  await waitFor(() => expect(screen.getByRole("tab", { name: /Saved chat/ })).toBeTruthy());
  expect(screen.queryByText("已就绪")).toBeNull();
  expect(screen.queryByText("打开失败")).toBeNull();
  expect(document.querySelector(".codex-window-status")).toBeNull();
});

it("opens a project conversation as a second independent window and never reroutes Session input", async () => {
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
      if (input === "/api/native-codex/tabs")
        return { ok: true, json: async () => ({ initialized: true, revision: 1, threads: [], sequence: 0 }) } as Response;
      if (input === "/api/native-codex/resume-beside")
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
  expect(screen.getByText("1 个")).toBeTruthy();
  await markVisibleHostReady();
  await waitFor(
    () => expect((conversation as HTMLButtonElement).disabled).toBe(false),
    { timeout: 3000 },
  );
  fireEvent.click(conversation);

  await waitFor(() =>
    expect(
      requests.find((request) => request.input === "/api/native-codex/resume-beside"),
    ).toBeTruthy(),
  );
  const resumeRequest = requests.find(
    (request) => request.input === "/api/native-codex/resume-beside",
  );
  expect(JSON.parse(String(resumeRequest?.init?.body))).toEqual({
    threadId,
    instanceId: visibleInstanceId,
  });
  expect(screen.getByText("2 个窗口")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "分屏" })).toBeNull();
  expect(screen.queryByRole("button", { name: "专注" })).toBeNull();
  dragCodexTabToPaneEdge(threadId, "right");
  expect(document.querySelectorAll(".codex-window-card")).toHaveLength(2);
  fireEvent.click(conversation);
  expect(requests.filter((request) => request.input === "/api/native-codex/resume-beside")).toHaveLength(1);
  expect(sessionBridge.listThreads).toHaveBeenCalledExactlyOnceWith({
    cwd,
    limit: 100,
    sortKey: "updated_at",
    sortDirection: "desc",
    modelProviders: [],
    archived: false,
    useStateDbOnly: true,
  });
  expect(sessionBridge.navigateToAgentSession).not.toHaveBeenCalled();
  expect(sessionBridge.setCwd).not.toHaveBeenCalled();
});

it("isolates a failed history open while other project conversations keep opening in split view", async () => {
  const cwd = "/tmp/project-a";
  const conversations = Array.from({ length: 4 }, (_, index) => ({
    id: `019aabcd-1234-7890-abcd-${String(index + 1).padStart(12, "0")}`,
    cwd,
    name: `Conversation ${index + 1}`,
    preview: `Message ${index + 1}`,
    updatedAt: index,
    parentThreadId: null,
    ephemeral: false,
  }));
  sessionBridge.listThreads.mockResolvedValue({ data: conversations, nextCursor: null });
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (input === "/api/native-codex/status") return { ok: true, json: async () => ({
      available: true, resumeAvailable: true, iframeUrl: "/native-codex/?folder=%2Ftmp%2Fproject-a",
    }) } as Response;
    if (input === "/api/session/projects") return { ok: true, json: async () => ({ projects: [cwd] }) } as Response;
    if (input === "/api/native-codex/tabs") return { ok: true, json: async () => ({ initialized: true, revision: 1, threads: [], sequence: init?.method === "POST" ? 1 : 0 }) } as Response;
    if (input === "/api/native-codex/resume-beside") {
      calls.push(String(input));
      return calls.length === 1 ? { ok: false, status: 503 } as Response
        : { ok: true, status: 202, json: async () => ({ opened: true }) } as Response;
    }
    throw new Error(`unexpected request ${String(input)}`);
  }));
  render(<CodexWorkbench active onModeChange={vi.fn()} />);
  const original = await markVisibleHostReady();
  for (let index = 1; index <= 4; index++) {
    const button = await screen.findByRole("button", { name: `Resume Conversation ${index}` });
    fireEvent.click(button);
  }
  await waitFor(() => expect(calls).toHaveLength(4));
  expect(screen.getByText("5 个窗口")).toBeTruthy();
  expect(document.querySelectorAll(".codex-window-card")).toHaveLength(1);
  dragCodexTabToPaneEdge(conversations[0]!.id, "right");
  expect(document.querySelectorAll(".codex-window-card")).toHaveLength(2);
  expect(await screen.findByText("Codex 窗口打开失败（HTTP 503）")).toBeTruthy();
  expect(calls).toHaveLength(4);
  fireEvent.click(screen.getByRole("button", { name: "Resume Conversation 3" }));
  expect(calls).toHaveLength(4);
  throw new Error(Array.from(document.querySelectorAll("[data-codex-window]")).map((item) => item.textContent).join(" || "));
  expect(screen.getByText("4 个窗口")).toBeTruthy();
  expect(screen.getByTitle("原生 Codex 会话窗口")).toBe(original);
});

it("opens a thread added in another browser and keeps the current thread after that browser closes it", async () => {
  const cwd = "/tmp/project-a";
  const first = "019aabcd-1234-7890-abcd-000000000001";
  const second = "019aabcd-1234-7890-abcd-000000000002";
  const thread = (id: string, title: string) => ({ id, cwd, title });
  const shared = { initialized: true, revision: 1, threads: [thread(first, "First")] };
  const requests: Array<{ input: RequestInfo | URL; body?: string }> = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ input, body: typeof init?.body === "string" ? init.body : undefined });
    if (input === "/api/native-codex/status") return { ok: true, json: async () => ({
      available: true, resumeAvailable: true, iframeUrl: `/native-codex/?folder=${encodeURIComponent(cwd)}`,
      newChatWindowIds: ["019aabcd-5678-7890-abcd-0123456789ab"],
    }) } as Response;
    if (input === "/api/session/projects") return { ok: true, json: async () => ({ initialized: true, revision: 3, projects: [cwd, "/tmp/project-b"] }) } as Response;
    if (input === "/api/native-codex/tabs") {
      if (init?.method === "POST") {
        const action = JSON.parse(init.body as string).operations[0]?.action;
        if (action?.type === "add") Object.assign(shared, { revision: shared.revision + 1, threads: [...shared.threads, action.thread] });
        if (action?.type === "remove") Object.assign(shared, { revision: shared.revision + 1, threads: shared.threads.filter((item) => item.id !== action.id) });
        return { ok: true, json: async () => ({ ...shared, sequence: 1 }) } as Response;
      }
      return { ok: true, json: async () => shared } as Response;
    }
    if (input === "/api/native-codex/resume-beside") return { ok: true, status: 202, json: async () => ({ opened: true, column: 1 }) } as Response;
    if (input === "/api/native-codex/focus") return { ok: true, json: async () => ({ focused: true }) } as Response;
    throw new Error(`unexpected request ${String(input)}`);
  }));
  vi.spyOn(nativeSurface, "mountNativeSurface").mockImplementation((_document, onCount, onReady, options) => {
    onCount(1); onReady?.(1); options?.onHostInstance?.(visibleInstanceId);
    return { start: vi.fn(), pause: vi.fn(), dispose: vi.fn(), setLayout: vi.fn() };
  });
  render(<CodexWorkbench active onModeChange={vi.fn()} />);
  await markVisibleHostReady();
  expect(await screen.findByRole("tab", { name: /First/ })).toBeTruthy();
  expect(screen.getByRole("button", { name: /project-b/ })).toBeTruthy();
  Object.assign(shared, { revision: 2, threads: [thread(first, "First"), thread(second, "Second")] });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 2100)); });
  expect(await screen.findByRole("tab", { name: /Second/ })).toBeTruthy();
  await waitFor(() => expect(requests.filter((request) => request.input === "/api/native-codex/resume-beside")).toHaveLength(2));
  HTMLElement.prototype.setPointerCapture = () => {};
  dragCodexTabToPaneEdge(second, "right");
  expect(document.querySelectorAll("[data-codex-group]").length).toBeGreaterThan(1);
  fireEvent.click(screen.getByRole("tab", { name: /First/ }));
  Object.assign(shared, { revision: 3, threads: [thread(second, "Second")] });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 2100)); });
  expect(screen.getByText("当前会话未关注")).toBeTruthy();
  expect(screen.getByRole("tab", { name: /First/ })).toBeTruthy();
  expect(document.querySelectorAll("[data-codex-group]").length).toBeGreaterThan(1);
});
