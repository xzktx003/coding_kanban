import { act, fireEvent, render, screen } from "@testing-library/react";
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { beforeEach, expect, test, vi } from "vitest";
import { AppLayout } from "./AppLayout";
import { useLayoutStore } from "@session/stores/useLayoutStore";
const state = vi.hoisted(() => ({
  mobile: false,
  mounts: 0,
  unmounts: 0,
  agentMounts: 0,
  agentUnmounts: 0,
}));
vi.mock("@session/session-dom", () => ({
  listenInSessionMode: () => () => {},
}));
vi.mock("@session/hooks/use-mobile", () => ({
  useIsMobile: () => state.mobile,
}));
vi.mock("@session/hooks/useEdgeSwipe", () => ({ useEdgeSwipe: () => {} }));
vi.mock("@session/stores", async () => ({
  useLayoutStore: (await import("@session/stores/useLayoutStore"))
    .useLayoutStore,
}));
vi.mock("@session/components/ui/sidebar", () => ({
  SidebarProvider: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SidebarInset: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  useSidebar: () => ({ setOpenMobile: vi.fn() }),
}));
vi.mock("@session/components/ui/resizable", () => ({
  ResizablePanelGroup: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ResizableHandle: () => null,
  ResizablePanel: forwardRef(
    ({ children }: { children: React.ReactNode }, ref) => {
      useImperativeHandle(ref, () => ({
        collapse: () => {},
        expand: () => {},
        resize: () => {},
      }));
      return <div>{children}</div>;
    },
  ),
}));
vi.mock("@session/components/layout", () => ({
  AppSideBar: () => null,
  RightPanel: ({ visible }: { visible: boolean }) => {
    useEffect(() => {
      state.mounts++;
      return () => {
        state.unmounts++;
      };
    }, []);
    return <input aria-label="持久工具树" data-visible={String(visible)} />;
  },
}));
vi.mock("@session/components/agent/AgentView", () => ({
  default: () => {
    const [draft, setDraft] = useState("");
    useEffect(() => {
      state.agentMounts++;
      return () => {
        state.agentUnmounts++;
      };
    }, []);
    return (
      <input
        aria-label="局部Agent草稿"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
    );
  },
}));
vi.mock("@session/components/settings/SettingsView", () => ({
  default: () => <div>设置界面</div>,
}));
vi.mock("@session/features/plugins/components/PluginsView", () => ({
  default: () => null,
}));
vi.mock("@session/features/insight/InsightsView", () => ({
  default: () => null,
}));
beforeEach(() => {
  state.mobile = false;
  state.mounts = 0;
  state.agentMounts = 0;
  state.agentUnmounts = 0;
  state.unmounts = 0;
  useLayoutStore.setState({
    view: "agent",
    isSidebarOpen: false,
    isRightPanelOpen: true,
  });
});
test("tool tree persists across mobile breakpoint and overlay hide/open", () => {
  const view = render(<AppLayout />);
  const tree = screen.getByLabelText("持久工具树");
  state.mobile = true;
  view.rerender(<AppLayout />);
  act(() => useLayoutStore.setState({ isRightPanelOpen: true }));
  expect(screen.getByLabelText("持久工具树")).toBe(tree);
  act(() => useLayoutStore.setState({ isRightPanelOpen: false }));
  expect(tree.getAttribute("data-visible")).toBe("false");
  act(() => useLayoutStore.setState({ isRightPanelOpen: true }));
  expect(screen.getByLabelText("持久工具树")).toBe(tree);
  expect(state.mounts).toBe(1);
  expect(state.unmounts).toBe(0);
});
test("settings, plugins and insights hide tools without unmounting them", () => {
  render(<AppLayout />);
  const tree = screen.getByLabelText("持久工具树");
  for (const view of ["plugins", "insights", "settings", "agent"] as const) {
    act(() => useLayoutStore.getState().setView(view));
    expect(screen.getByLabelText("持久工具树")).toBe(tree);
    expect(tree.getAttribute("data-visible")).toBe(String(view === "agent"));
  }
  expect(state.mounts).toBe(1);
  expect(state.unmounts).toBe(0);
});

test("agent local drafts persist in the same hidden inert tree across secondary views", async () => {
  render(<AppLayout />);
  const input = await screen.findByRole("textbox", { name: "局部Agent草稿" });
  fireEvent.change(input, { target: { value: "ACP局部草稿" } });
  for (const view of ["plugins", "insights", "settings"] as const) {
    act(() => useLayoutStore.getState().setView(view));
    expect(screen.getByLabelText("局部Agent草稿")).toBe(input);
    expect(input.closest("[hidden][inert]")).toBeTruthy();
  }
  act(() => useLayoutStore.getState().setView("agent"));
  expect(
    (screen.getByLabelText("局部Agent草稿") as HTMLInputElement).value,
  ).toBe("ACP局部草稿");
  expect(state.agentUnmounts).toBe(0);
});
