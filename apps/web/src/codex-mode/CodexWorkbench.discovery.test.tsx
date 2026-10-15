import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import * as nativeSurface from "./native-surface";
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

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it.each(["startup", "dynamic"] as const)(
  "follows the first native send in a %s window once, even if window observation arrives first",
  async (kind) => {
    const startup = "019aabcd-5678-7890-abcd-0123456789ab";
    const windowId =
      kind === "startup" ? startup : "019aabcd-5678-7890-abcd-0123456789ac";
    const threadId = "019aabcd-1234-7890-abcd-0123456789ab";
    const id = `new:${windowId}`;
    localStorage.setItem(
      CODEX_MULTIWINDOW_KEY,
      JSON.stringify({
        version: 2,
        hostKey: startup,
        activeId: id,
        activeGroupId: "saved",
        tree: { type: "group", id: "saved", keys: [id], selected: id },
        windows: [
          {
            id,
            kind: "new",
            newChatWindowId: windowId,
            title: "Native test",
            cwd: "/tmp/native-discovery",
          },
        ],
      }),
    );
    const actions: Array<{
      type: string;
      thread?: { id: string; cwd: string };
    }> = [];
    let threads: unknown[] = [];
    let revision = 1;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        let body: unknown;
        if (input === "/api/session/projects") body = { projects: [] };
        else if (input === "/api/native-codex/status")
          body = {
            available: true,
            resumeAvailable: true,
            iframeUrl: "/native-codex/",
            newChatWindowIds: [startup],
          };
        else if (input === "/api/native-codex/tabs") {
          const operation =
            init?.body && JSON.parse(String(init.body)).operations?.[0];
          if (operation) {
            actions.push(operation.action);
            threads = [operation.action.thread];
            revision++;
          }
          body = {
            initialized: true,
            revision,
            threads,
            sequence: operation ? 1 : 0,
          };
        } else if (input === "/api/native-codex/new-beside")
          body = { opened: true, column: 2 };
        else if (input === "/api/native-codex/focus") body = { focused: true };
        else if (input === "/api/native-codex/theme") body = { applied: true };
        else throw new Error(`Unexpected request ${input}`);
        return { ok: true, status: 202, json: async () => body } as Response;
      }),
    );
    let observer: nativeSurface.NativeSurfaceOptions | undefined;
    vi.spyOn(nativeSurface, "mountNativeSurface").mockImplementation(
      (_doc, count, ready, options) => {
        observer = options;
        count(1);
        ready?.(1);
        options?.onHostInstance?.("019aabcd-1234-7890-abcd-0123456789ae");
        return {
          start: vi.fn(),
          pause: vi.fn(),
          dispose: vi.fn(),
          setLayout: vi.fn(),
          bindWindowAtColumn: vi.fn(),
        };
      },
    );
    render(<CodexWorkbench active onModeChange={vi.fn()} />);
    fireEvent.load(await screen.findByTitle("原生 Codex 会话窗口"));
    await waitFor(() => expect(observer).toBeTruthy());
    const state = {
      ready: true,
      conversationId: threadId,
      hasComposer: true,
      composerEmpty: true,
      userInteracted: true,
    };
    act(() => observer?.onWindowState?.(id, state));
    // A separate observer delivery can follow a React render. Dynamic windows
    // have no startup panel index and therefore never emit onThreadState.
    if (kind === "startup") act(() => observer?.onThreadState?.(0, state));
    await waitFor(() =>
      expect(actions).toEqual([
        {
          type: "add",
          thread: {
            id: threadId,
            cwd: "/tmp/native-discovery",
            title: "Native test",
          },
        },
      ]),
    );
    act(() => {
      observer?.onWindowState?.(id, state);
      if (kind === "startup") observer?.onThreadState?.(0, state);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(actions).toHaveLength(1);
  },
);
