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
  dynamic = "019aabcd-5678-7890-abcd-0123456789ac";
const first = "019aabcd-1234-7890-abcd-0123456789ae",
  second = "019aabcd-1234-7890-abcd-0123456789af";
afterEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function mount() {
  const id = "new:" + dynamic;
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
          newChatWindowId: dynamic,
          title: "Saved native new chat",
          cwd: "/tmp/open-fence",
        },
      ],
    }),
  );
  const requests: Array<{ body: unknown; resolve: (value: Response) => void }> =
    [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: RequestInfo | URL, init?: RequestInit) => {
      if (path === "/api/native-codex/new-beside")
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
              : { applied: true };
      return { ok: true, status: 200, json: async () => body } as Response;
    }),
  );
  let observer: surface.NativeSurfaceOptions | undefined;
  const bindings = vi.fn();
  vi.spyOn(surface, "mountNativeSurface").mockImplementation(
    (_doc, count, ready, options) => {
      observer = options;
      count(1);
      ready?.(1);
      options?.onHostInstance?.(first);
      return {
        start: vi.fn(),
        pause: vi.fn(),
        dispose: vi.fn(),
        setLayout: vi.fn(),
        bindWindowAtColumn: bindings,
      };
    },
  );
  render(<CodexWorkbench active onModeChange={vi.fn()} />);
  fireEvent.load(await screen.findByTitle("原生 Codex 会话窗口"));
  await waitFor(() => expect(requests).toHaveLength(1));
  return {
    id,
    requests,
    bindings,
    reload: () => fireEvent.load(screen.getByTitle("原生 Codex 会话窗口")),
    reportHost: () => act(() => observer?.onHostInstance?.(second)),
    resolve: async (index: number) =>
      act(async () => {
        requests[index]!.resolve({
          ok: true,
          status: 200,
          json: async () => ({ opened: true, column: 7 }),
        } as Response);
      }),
  };
}
it("restores the selected new chat again when native host identity changes inside the preserved iframe", async () => {
  const f = await mount();
  f.reportHost();
  await waitFor(() => expect(f.requests).toHaveLength(2));
  expect(f.requests[1]!.body).toEqual({
    windowId: dynamic,
    instanceId: second,
  });
  await f.resolve(0);
  await f.resolve(1);
});
it("a late open receipt from the previous native host cannot bind its column into the current surface", async () => {
  const f = await mount();
  f.reportHost();
  await f.resolve(0);
  expect(f.bindings).not.toHaveBeenCalledWith(f.id, 7);
});
it("a late receipt cannot bind a replacement surface even if the native host UUID is unchanged", async () => {
  const f = await mount();
  f.reload();
  await waitFor(() => expect(f.requests).toHaveLength(2));
  await f.resolve(0);
  expect(f.bindings).not.toHaveBeenCalledWith(f.id, 7);
  await f.resolve(1);
  expect(f.bindings).toHaveBeenCalledWith(f.id, 7);
});
