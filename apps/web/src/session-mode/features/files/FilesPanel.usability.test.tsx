import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import FilesPanel from "./FilesPanel";
import { useEditorStore } from "@session/stores/useEditorStore";
vi.mock("./explorer", () => ({
  FileTree: () => <div>文件树</div>,
  FileViewer: () => <div>文件内容</div>,
}));
vi.mock("@session/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@session/stores", async () => ({
  useEditorStore: (await import("@session/stores/useEditorStore"))
    .useEditorStore,
  useWorkspaceStore: () => ({ cwd: "/fixture" }),
}));
beforeEach(() => {
  localStorage.removeItem("kanban.session.files-tree-size");
  useEditorStore.getState().resetFiles();
});
test("file selection and close are separate native keyboard buttons", () => {
  useEditorStore.getState().openFile("/fixture/中文文件.ts");
  render(<FilesPanel />);
  const close = screen.getByRole("button", { name: "关闭文件 中文文件.ts" });
  expect(close.tagName).toBe("BUTTON");
  expect(close.parentElement?.closest("button")).toBeNull();
  expect(
    screen
      .getByRole("button", { name: "查看文件 中文文件.ts" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  fireEvent.click(close);
  expect(useEditorStore.getState().openFiles).toEqual([]);
  expect(screen.getByText("选择文件以查看内容")).toBeTruthy();
});
test("file tree toggle reports expanded state and localized accessible name", () => {
  render(<FilesPanel />);
  const toggle = screen.getByRole("button", { name: "隐藏文件树" });
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  fireEvent.click(toggle);
  expect(
    screen
      .getByRole("button", { name: "显示文件树" })
      .getAttribute("aria-expanded"),
  ).toBe("false");
});

test("closing the last focused file returns focus to the file tree control", async () => {
  useEditorStore.getState().openFile("/fixture/唯一文件.ts");
  render(<FilesPanel />);
  const close = screen.getByRole("button", { name: "关闭文件 唯一文件.ts" });
  close.focus();
  fireEvent.click(close);
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "隐藏文件树" }),
    ),
  );
});

test("desktop file tree has a keyboard reachable divider and toggling preserves the viewer", () => {
  useEditorStore.getState().openFile("/fixture/preview.ts");
  render(<FilesPanel />);
  const viewer = screen.getByText("文件内容");
  const divider = screen.getByRole("separator", {
    name: "调整文件树与预览宽度",
  });
  expect(divider.getAttribute("tabindex")).toBe("0");
  fireEvent.click(screen.getByRole("button", { name: "隐藏文件树" }));
  expect(
    screen.queryByRole("separator", { name: "调整文件树与预览宽度" }),
  ).toBeNull();
  expect(screen.getByText("文件内容")).toBe(viewer);
  fireEvent.click(screen.getByRole("button", { name: "显示文件树" }));
  expect(
    screen.getByRole("separator", { name: "调整文件树与预览宽度" }),
  ).toBeTruthy();
  expect(screen.getByText("文件内容")).toBe(viewer);
});

for (const [stored, expected] of [
  ["60", "40"],
  ["broken", "65"],
  ["1000", "65"],
]) {
  test(`restores only a valid file tree width (${stored})`, () => {
    localStorage.setItem("kanban.session.files-tree-size", stored);
    const { container } = render(<FilesPanel />);
    const preview = container.querySelector<HTMLElement>(
      '[data-panel-id="file-preview"]',
    );
    expect(Number(preview?.style.flexGrow)).toBe(Number(expected));
  });
}
