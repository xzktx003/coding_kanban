import { act, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const load = vi.hoisted(() => vi.fn());
vi.mock("./SideChatPanel", () => {
  load();
  return { SideChatPanel: () => <div>Opened side contents</div> };
});
import { DeferredSideChatPanel } from "./DeferredSideChatPanel";
import { useSideChatStore } from "@session/stores/useSideChatStore";
import { planSidePanel } from "@session/features/thread-workflows/planSidePanel";
beforeEach(() => {
  useSideChatStore.getState().close();
  planSidePanel.close();
});
it("waits for an explicit chat intent and closes without importing initial content", async () => {
  render(<DeferredSideChatPanel />);
  expect(load).not.toHaveBeenCalled();
  expect(screen.queryByText("Opened side contents")).toBeNull();
  act(() =>
    useSideChatStore
      .getState()
      .open({ id: "side", parentId: "parent", title: "Side", images: [] }),
  );
  await screen.findByText("Opened side contents");
  act(() => useSideChatStore.getState().close());
  expect(screen.queryByText("Opened side contents")).toBeNull();
});
it("also responds to a plan opened independently of side chat", async () => {
  render(<DeferredSideChatPanel />);
  act(() => planSidePanel.open({ text: "Plan remains available" }));
  await screen.findByText("Opened side contents");
  act(() => planSidePanel.close());
  expect(screen.queryByText("Opened side contents")).toBeNull();
});
