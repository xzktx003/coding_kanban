import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { DiffViewer } from "./DiffViewer";
const patch =
  "--- a/code.py\n+++ b/code.py\n@@ -115,3 +115,4 @@\n context\n-old = 1\n+new = 2\n+extra = 3\n tail\n@@ -307,1 +308,1 @@\n-old = 4\n+new = 5\n";
const writeText = vi.fn().mockResolvedValue(undefined);
beforeEach(() => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  writeText.mockClear();
});
it("keeps original line positions across separate hunks", () => {
  render(<DiffViewer unifiedDiff={patch} isCollapsed={false} />);
  expect(screen.getByText("115")).toBeTruthy();
  expect(screen.getByText("307")).toBeTruthy();
  expect(screen.getByText("308")).toBeTruthy();
});
it("copies the saved unified patch including hunk coordinates", () => {
  render(<DiffViewer unifiedDiff={patch} isCollapsed={false} />);
  fireEvent.click(screen.getByRole("button", { name: "Copy" }));
  expect(writeText).toHaveBeenCalledWith(patch);
});
it("keeps a final unterminated added line", () => {
  render(<DiffViewer original="old" current="new" isCollapsed={false} />);
  expect(screen.getByText("old")).toBeTruthy();
  expect(screen.getByText("new")).toBeTruthy();
});

it("native inline diffs omit extra filename/toolbars and raw hunk headers", () => {
  render(
    <DiffViewer
      native
      presentation="inline"
      displayPath="/project/code.py"
      unifiedDiff={patch}
      isCollapsed={false}
    />,
  );
  expect(screen.queryByText("code.py")).toBeNull();
  expect(screen.queryByText("@@ -115,3 +115,4 @@")).toBeNull();
  expect(screen.getByText("115")).toBeTruthy();
  expect(screen.getByText("307")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Copy" }));
  expect(writeText).toHaveBeenCalledWith(patch);
});

it("copies old/new hunk fragments without context prefixes or no-newline markers", () => {
  const value =
    "--- a/code.py\n+++ b/code.py\n@@ -15,2 +15,2 @@\n  indented context\n-old\n\\ No newline at end of file\n+new\n\\ No newline at end of file\n";
  render(<DiffViewer unifiedDiff={value} isCollapsed={false} />);
  fireEvent.click(screen.getByRole("button", { name: "Old" }));
  fireEvent.click(screen.getByRole("button", { name: "Copy" }));
  expect(writeText).toHaveBeenCalledWith(" indented context\nold");
});
it("full native review uses file actions and omitted-context separators, rather than fragment toggles", () => {
  render(<DiffViewer native presentation="review" displayPath="code.py" unifiedDiff={patch} isCollapsed={false} />);
  expect(screen.queryByText("@@ -115,3 +115,4 @@")).toBeNull();
  expect(screen.queryByRole("button", { name: /^Old$/ })).toBeNull();
  expect(screen.getByRole("button", { name: "文件操作" })).toBeTruthy();
  expect(screen.getByText("114 行未展开的上下文")).toBeTruthy();
});
it("native hover previews use the original compact filename/count/copy header", () => {
  render(<DiffViewer native displayPath="code.py" unifiedDiff={patch} isCollapsed={false}/>);
  expect(screen.queryByRole("button", { name: /^Old$/ })).toBeNull();
  expect(screen.queryByText("@@ -115,3 +115,4 @@")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Copy" }));
  expect(writeText).toHaveBeenCalledWith(patch);
});
it("reports clipboard rejection without claiming copy success", async () => {
  writeText.mockRejectedValueOnce(new Error("clipboard denied"));
  render(<DiffViewer native unifiedDiff={patch} displayPath="code.py" isCollapsed={false}/>);
  fireEvent.click(screen.getByRole("button", { name: "Copy" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("复制失败"));
  expect((screen.getByRole("button", { name: "Copy" }) as HTMLButtonElement).disabled).toBe(false);
});
it("labels binary and metadata-only native patches instead of an empty Diff", () => {
  const view = render(<DiffViewer native presentation="review" displayPath="image.bin" unifiedDiff={"diff --git a/image.bin b/image.bin\nBinary files a/image.bin and b/image.bin differ\n"} isCollapsed={false}/>);
  expect(screen.getByText("二进制文件不显示文本变更块")).toBeTruthy();
  view.rerender(<DiffViewer native presentation="review" displayPath="run.sh" unifiedDiff={"diff --git a/run.sh b/run.sh\nold mode 100644\nnew mode 100755\n"} isCollapsed={false}/>);
  expect(screen.getByText("文件模式：100644 → 100755")).toBeTruthy();
});
