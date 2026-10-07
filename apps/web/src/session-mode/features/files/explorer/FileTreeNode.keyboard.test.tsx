import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { FileTreeNode } from "./FileTreeNode";
vi.mock("@session/hooks/runtime", () => ({ isTauri: () => false }));
vi.mock("@session/stores", () => ({
  useEditorStore: () => ({
    selectedFilePath: null,
    setSelectedFilePath: vi.fn(),
  }),
  useWorkspaceStore: () => ({ addProject: vi.fn() }),
  useLayoutStore: () => ({
    setRightPanelOpen: vi.fn(),
    setActiveRightPanelTab: vi.fn(),
  }),
  useInputStore: () => ({ appendInputValue: vi.fn() }),
}));
test("file row supports Space and ignores Enter from nested actions", () => {
  const toggle = vi.fn();
  render(
    <FileTreeNode
      node={{ name: "中文目录", path: "/fixture/中文目录", kind: "dir" }}
      depth={0}
      rootPath="/fixture"
      activeExpanded={new Set()}
      loadingNodes={new Set()}
      onToggle={toggle}
      onLoadChildren={() => {}}
    />,
  );
  const row = screen.getByText("中文目录").closest("[role=button]")!;
  fireEvent.keyDown(row, { key: " " });
  expect(toggle).toHaveBeenCalledTimes(1);
  const nested = row.querySelector("button")!;
  fireEvent.keyDown(nested, { key: "Enter" });
  expect(toggle).toHaveBeenCalledTimes(1);
});
