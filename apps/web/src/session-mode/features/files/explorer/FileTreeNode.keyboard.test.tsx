import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { FileTreeNode } from "./FileTreeNode";
const input = vi.hoisted(() => ({ append: vi.fn() }));
beforeEach(() => input.append.mockClear());
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
  useInputStore: () => ({ appendInputValue: input.append }),
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

test("directory disclosure expands once without inserting a path", () => {
  const toggle = vi.fn();
  const load = vi.fn();
  const props = {
    node: { name: "src", path: "/fixture/src", kind: "dir" as const },
    depth: 0,
    rootPath: "/fixture",
    activeExpanded: new Set<string>(),
    loadingNodes: new Set<string>(),
    onToggle: toggle,
    onLoadChildren: load,
  };
  const view = render(<FileTreeNode {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "展开文件夹 src" }));
  expect(toggle).toHaveBeenCalledExactlyOnceWith("/fixture/src");
  expect(load).toHaveBeenCalledExactlyOnceWith(props.node);
  view.rerender(
    <FileTreeNode
      {...props}
      node={{ ...props.node, children: [] }}
      activeExpanded={new Set(["/fixture/src"])}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "收起文件夹 src" }));
  expect(toggle).toHaveBeenCalledTimes(2);
  expect(load).toHaveBeenCalledTimes(1);
  expect(input.append).not.toHaveBeenCalled();
});

test("inserting a directory path leaves its expansion unchanged", () => {
  const toggle = vi.fn();
  const load = vi.fn();
  render(
    <FileTreeNode
      node={{ name: "src", path: "/fixture/src", kind: "dir" }}
      depth={0}
      rootPath="/fixture"
      activeExpanded={new Set()}
      loadingNodes={new Set()}
      onToggle={toggle}
      onLoadChildren={load}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "插入路径 src" }));
  expect(toggle).not.toHaveBeenCalled();
  expect(load).not.toHaveBeenCalled();
  expect(input.append).toHaveBeenCalledExactlyOnceWith("`src`");
});
