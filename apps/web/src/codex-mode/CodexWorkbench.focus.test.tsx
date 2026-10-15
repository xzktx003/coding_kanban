import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import * as surface from "./native-surface";
import { CODEX_MULTIWINDOW_KEY } from "./codex-multiwindow-state";
vi.mock("../lib/vscode-service-worker", () => ({
  probeVsCodeWebServiceWorker: vi.fn(async () => ({ state: "ready" })),
}));
vi.mock("@session/lib/agentNav", () => ({ navigateToAgentSession: vi.fn() }));
vi.mock("@session/stores/useWorkspaceStore", () => ({
  useWorkspaceStore: { getState: () => ({ cwd: null, setCwd: vi.fn() }) },
}));
vi.mock("@session/services/apiAdapt/shared", () => ({
  postJsonWithOptions: vi.fn(async () => ({ data: [], nextCursor: null })),
}));
import CodexWorkbench from "./CodexWorkbench";
const startup = "019aabcd-5678-7890-abcd-0123456789ab",
  second = "019aabcd-5678-7890-abcd-0123456789ac",
  instance = "019aabcd-1234-7890-abcd-0123456789ae";
afterEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function mount() {
  const ids = [`new:${startup}`, `new:${second}`];
  localStorage.setItem(
    CODEX_MULTIWINDOW_KEY,
    JSON.stringify({
      version: 2,
      hostKey: startup,
      activeId: ids[0],
      activeGroupId: "saved",
      tree: { type: "group", id: "saved", keys: ids, selected: ids[0] },
      windows: ids.map((id, index) => ({
        id,
        kind: "new",
        newChatWindowId: index ? second : startup,
        title: index ? "Second native chat" : "First native chat",
        cwd: "/tmp/focus-test",
      })),
    }),
  );
  const requests: Array<{ body: unknown; resolve: (value: Response) => void }> =
    [];
  const fetcher = vi.fn(async (path: RequestInfo | URL, init?: RequestInit) => {
    if (path === "/api/native-codex/focus")
      return new Promise<Response>((resolve) =>
        requests.push({ body: JSON.parse(String(init?.body)), resolve }),
      );
    const body =
      path === "/api/session/projects"
        ? { projects: [] }
        : path === "/api/native-codex/status"
          ? {
              available: true,
              resumeAvailable: true,
              iframeUrl: "/native-codex/",
              newChatWindowIds: [startup],
            }
          : path === "/api/native-codex/tabs"
            ? { initialized: true, revision: 1, sequence: 0, threads: [] }
            : path === "/api/native-codex/new-beside"
              ? { opened: true, column: 2 }
              : { applied: true };
    return { ok: true, status: 202, json: async () => body } as Response;
  });
  vi.stubGlobal("fetch", fetcher);
  let observer: surface.NativeSurfaceOptions | undefined;
  const layout = vi.fn();
  vi.spyOn(surface, "mountNativeSurface").mockImplementation(
    (_doc, count, ready, options) => {
      observer = options;
      count(1);
      ready?.(1);
      options?.onHostInstance?.(instance);
      return {
        start: vi.fn(),
        pause: vi.fn(),
        dispose: vi.fn(),
        setLayout: layout,
        bindWindowAtColumn: vi.fn(),
      };
    },
  );
  render(<CodexWorkbench active onModeChange={vi.fn()} />);
  fireEvent.load(await screen.findByTitle("原生 Codex 会话窗口"));
  await waitFor(() => expect(observer).toBeTruthy());
  const report = (id: string) =>
    act(() =>
      observer?.onWindowState?.(id, {
        ready: true,
        hasComposer: true,
        composerEmpty: true,
        userInteracted: false,
        conversationId: null,
      }),
    );
  const resolve = (index: number, focused = true) =>
    act(async () => {
      requests[index]!.resolve({
        ok: true,
        json: async () => ({ focused }),
      } as Response);
    });
  const reportHost = (id: string) => act(() => observer?.onHostInstance?.(id));
  report(ids[0]!);
  await waitFor(() => expect(requests.length).toBe(1));
  return { requests, layout, report, reportHost, resolve, ids };
}
it("keeps native pointer input closed until the exact host focus acknowledgement arrives", async () => {
  const f = await mount();
  expect(f.layout.mock.lastCall?.[0].interactiveId).toBeNull();
  await f.resolve(0);
  await waitFor(() =>
    expect(f.layout.mock.lastCall?.[0].interactiveId).toBe(f.ids[0]),
  );
});
it("does not refocus the active composer when a different native window becomes ready", async () => {
  const f = await mount();
  await f.resolve(0);
  await waitFor(() =>
    expect(f.layout.mock.lastCall?.[0].interactiveId).toBe(f.ids[0]),
  );
  f.report(f.ids[1]!);
  await act(async () => {
    await Promise.resolve();
  });
  expect(f.requests.length).toBe(1);
  expect(f.layout.mock.lastCall?.[0].interactiveId).toBe(f.ids[0]);
});
it("a late focus receipt for the previous tab cannot unlock the newly selected tab", async () => {
  const f = await mount();
  f.report(f.ids[1]!);
  fireEvent.click(screen.getByRole("tab", { name: "Second native chat" }));
  expect(f.layout.mock.lastCall?.[0].interactiveId).toBeNull();
  await f.resolve(0);
  await waitFor(() => expect(f.requests.length).toBe(2));
  expect(f.layout.mock.lastCall?.[0].interactiveId).toBeNull();
  await f.resolve(1);
  await waitFor(() =>
    expect(f.layout.mock.lastCall?.[0].interactiveId).toBe(f.ids[1]),
  );
});
it("a rejected focus receipt leaves native input closed", async () => {
  const f = await mount();
  await f.resolve(0, false);
  await screen.findByText("原生 Codex 没有确认输入窗口");
  expect(f.layout.mock.lastCall?.[0].interactiveId).toBeNull();
});
it("the previous native host receipt cannot unlock the same window in a new host instance", async () => {
  const f = await mount();
  await f.resolve(0);
  await waitFor(() =>
    expect(f.layout.mock.lastCall?.[0].interactiveId).toBe(f.ids[0]),
  );
  const nextInstance = "019aabcd-1234-7890-abcd-0123456789af";
  f.reportHost(nextInstance);
  expect(f.layout.mock.lastCall?.[0].interactiveId).toBeNull();
  await waitFor(() => expect(f.requests.length).toBe(2));
  expect(f.requests[1]?.body).toEqual({
    instanceId: nextInstance,
    kind: "new",
    targetId: startup,
  });
  await f.resolve(1);
  await waitFor(() =>
    expect(f.layout.mock.lastCall?.[0].interactiveId).toBe(f.ids[0]),
  );
});
