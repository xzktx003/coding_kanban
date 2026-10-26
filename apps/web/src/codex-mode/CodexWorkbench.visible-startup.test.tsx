import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { it, expect, vi, afterEach } from "vitest";
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
const startup = "019aabcd-1234-7890-abcd-000000000001";
const instanceId = "019aabcd-1234-7890-abcd-000000000002";
const threadId = "019aabcd-1234-7890-abcd-000000000003";
const hiddenThreadId = "019aabcd-1234-7890-abcd-000000000004";
afterEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function mount(
  restoreVisibleWindows: boolean,
  history = false,
  followed = true,
  delayedHost = false,
) {
  if (history) {
    localStorage.setItem(
      CODEX_MULTIWINDOW_KEY,
      JSON.stringify({
        version: 2,
        hostKey: startup,
        activeId: threadId,
        activeGroupId: "g",
        tree: {
          type: "group",
          id: "g",
          keys: [threadId, hiddenThreadId],
          selected: threadId,
        },
        windows: [
          {
            id: threadId,
            kind: "thread",
            threadId,
            cwd: "/tmp/visible-startup",
            title: "Saved visible history",
          },
          {
            id: hiddenThreadId,
            kind: "thread",
            threadId: hiddenThreadId,
            cwd: "/tmp/visible-startup",
            title: "Hidden unfollowed history",
          },
        ],
      }),
    );
  }
  const operations: Array<{ path: string; body: unknown }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: RequestInfo | URL, init?: RequestInit) => {
      const target = String(path);
      if (target === "/api/native-codex/status")
        return {
          ok: true,
          json: async () => ({
            available: true,
            resumeAvailable: true,
            iframeUrl: "/native-codex/",
            newChatWindowIds: [startup],
            restoreVisibleWindows,
          }),
        } as Response;
      if (target === "/api/session/projects")
        return { ok: true, json: async () => ({ projects: [] }) } as Response;
      if (target === "/api/native-codex/tabs")
        return {
          ok: true,
          json: async () => ({
            initialized: true,
            revision: 1,
            sequence: 0,
            threads:
              history && followed
                ? [
                    {
                      id: threadId,
                      cwd: "/tmp/visible-startup",
                      title: "Saved visible history",
                    },
                  ]
                : [],
          }),
        } as Response;
      if (
        [
          "/api/native-codex/new-beside",
          "/api/native-codex/resume-beside",
        ].includes(target)
      )
        operations.push({ path: target, body: JSON.parse(String(init?.body)) });
      return {
        ok: true,
        status: 202,
        json: async () => ({
          opened: true,
          column: 1,
          focused: true,
          applied: true,
        }),
      } as Response;
    }),
  );
  let publishHost: (() => void) | undefined;
  vi.spyOn(surface, "mountNativeSurface").mockImplementation(
    (_doc, count, ready, options) => {
      count(1);
      ready?.(1);
      publishHost = () => options?.onHostInstance?.(instanceId);
      if (!delayedHost) publishHost();
      return {
        start: vi.fn(),
        pause: vi.fn(),
        dispose: vi.fn(),
        setLayout: vi.fn(),
        bindWindowAtColumn: vi.fn(),
      };
    },
  );
  const view = render(<CodexWorkbench active onModeChange={vi.fn()} />);
  const frame = await screen.findByTitle("原生 Codex 会话窗口");
  expect(operations).toEqual([]);
  fireEvent.load(frame);
  return { view, operations, publishHost: () => publishHost?.() };
}
it("opens the first displayed new chat once after the native instance becomes ready in visible-window mode", async () => {
  const { view, operations } = await mount(true);
  await waitFor(() =>
    expect(operations).toEqual([
      {
        path: "/api/native-codex/new-beside",
        body: { instanceId, windowId: startup },
      },
    ]),
  );
  view.rerender(<CodexWorkbench active={false} onModeChange={vi.fn()} />);
  view.rerender(<CodexWorkbench active onModeChange={vi.fn()} />);
  expect(operations).toHaveLength(1);
});
it("preserves automatic first-new-chat opening for ordinary hosts", async () => {
  const { operations } = await mount(false);
  expect(screen.getByTitle("原生 Codex 会话窗口")).toBeTruthy();
  expect(operations).toEqual([]);
});
it("restores the displayed history without requesting a hidden startup new chat", async () => {
  const { operations } = await mount(true, true);
  await waitFor(() =>
    expect(operations).toEqual([
      {
        path: "/api/native-codex/resume-beside",
        body: { instanceId, threadId },
      },
    ]),
  );
});
it("retains the locally displayed history when the shared followed collection is already initialized and empty", async () => {
  const { operations, publishHost } = await mount(true, true, false, true);
  await waitFor(() =>
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(([url]) => url === "/api/native-codex/tabs"),
    ).toBe(true),
  );
  await act(async () => {});
  expect(screen.getByText("Saved visible history")).toBeTruthy();
  act(() => publishHost());
  await waitFor(() =>
    expect(operations).toEqual([
      {
        path: "/api/native-codex/resume-beside",
        body: { instanceId, threadId },
      },
    ]),
  );
  expect(screen.getByText("当前会话未关注")).toBeTruthy();
  expect(screen.queryByText("Hidden unfollowed history")).toBeNull();
});
