import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { resolveWorkbenchMode } from "../../lib/workbench-mode";

const { navigate, addProject, selectTab } = vi.hoisted(() => ({
  navigate: vi.fn(),
  addProject: vi.fn(),
  selectTab: vi.fn(),
}));
vi.mock("@session/lib/agentNav", () => ({ navigateToAgentSession: navigate }));
vi.mock("@session/stores/useWorkspaceStore", () => ({
  useWorkspaceStore: { getState: () => ({ addProject }) },
}));
vi.mock("./useSessionTabs", () => ({
  useSessionTabActions: () => ({ selectTab }),
}));
vi.mock("@session/features/thread-workflows/threadLinkService", () => ({
  openThreadLink: vi.fn(),
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});
afterEach(() => {
  history.replaceState(null, "", "/");
});

it.each([
  {
    agent: "codex",
    target: "thread=target-thread",
    threadId: "target-thread",
    sessionId: null,
  },
  {
    agent: "cc",
    target: "session=target-session",
    threadId: null,
    sessionId: "target-session",
  },
])(
  "preserves Session mode on refresh after consuming a $agent launcher link",
  async ({ agent, target, threadId, sessionId }) => {
    history.replaceState(
      { keep: "state" },
      "",
      `/mobile?mode=session&agent=${agent}&cwd=%2Fproject&${target}&addProject=%2Fextra&keep=one&keep=two#anchor`,
    );
    const { useUrlParamThread } = await import("./useUrlParamThread");
    const { rerender } = renderHook(
      ({ enabled }) => useUrlParamThread(enabled),
      { initialProps: { enabled: false } },
    );
    expect(navigate).not.toHaveBeenCalled();
    rerender({ enabled: true });
    expect(navigate).toHaveBeenCalledExactlyOnceWith({
      agent,
      cwd: "/project",
      threadId,
      sessionId,
    });
    expect(addProject).toHaveBeenCalledExactlyOnceWith("/extra");
    expect(location.pathname).toBe("/mobile");
    expect(resolveWorkbenchMode(location.search, "terminal")).toBe("session");
    expect(new URLSearchParams(location.search).getAll("keep")).toEqual([
      "one",
      "two",
    ]);
    expect(location.hash).toBe("#anchor");
    expect(history.state).toEqual({ keep: "state" });
    for (const key of ["agent", "cwd", "thread", "session", "addProject"]) {
      expect(new URLSearchParams(location.search).has(key)).toBe(false);
    }
    rerender({ enabled: false });
    rerender({ enabled: true });
    expect(navigate).toHaveBeenCalledTimes(1);
  },
);

it("consumes project additions without removing unrelated navigation parameters", async () => {
  history.replaceState(
    null,
    "",
    "/?mode=session&agent=other&cwd=%2Fkeep&addProject=%2Fa&addProject=%2Fb&view=settings",
  );
  const { useUrlParamThread } = await import("./useUrlParamThread");
  renderHook(() => useUrlParamThread(true));
  expect(addProject.mock.calls).toEqual([["/a"], ["/b"]]);
  expect(navigate).not.toHaveBeenCalled();
  const params = new URLSearchParams(location.search);
  expect(params.get("mode")).toBe("session");
  expect(params.get("agent")).toBe("other");
  expect(params.get("cwd")).toBe("/keep");
  expect(params.get("view")).toBe("settings");
  expect(params.has("addProject")).toBe(false);
});
