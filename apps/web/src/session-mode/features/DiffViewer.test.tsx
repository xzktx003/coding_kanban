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
it("replaces an oversized native diff with the editor prompt", () => {
  const open = vi.fn();
  const huge = `--- a/generated.ts\n+++ b/generated.ts\n@@ -1 +1 @@\n-${"a".repeat(100_001)}\n+${"b".repeat(10)}\n`;
  render(
    <DiffViewer
      native
      presentation="review"
      displayPath="generated.ts"
      unifiedDiff={huge}
      isCollapsed={false}
      onOpenFile={open}
    />,
  );
  expect(screen.getByRole("status").textContent).toContain("此文件过大，无法在此显示。");
  expect(screen.queryByText("a".repeat(20))).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "在编辑器中打开" }));
  expect(open).toHaveBeenCalledOnce();
});
it("labels a content-free rename with the plugin sentence", () => {
  render(
    <DiffViewer
      native
      presentation="review"
      displayPath="next.ts"
      unifiedDiff={"diff --git a/old.ts b/next.ts\nsimilarity index 100%\nrename from old.ts\nrename to next.ts\n"}
      isCollapsed={false}
    />,
  );
  expect(screen.getByText("文件已重命名，内容未变更")).toBeTruthy();
  expect(screen.queryByText("重命名：old.ts → next.ts")).toBeNull();
});
it("labels binary and metadata-only native patches instead of an empty Diff", () => {
  const view = render(<DiffViewer native presentation="review" displayPath="image.bin" unifiedDiff={"diff --git a/image.bin b/image.bin\nBinary files a/image.bin and b/image.bin differ\n"} isCollapsed={false}/>);
  expect(screen.getByText("二进制文件不显示文本变更块")).toBeTruthy();
  view.rerender(<DiffViewer native presentation="review" displayPath="run.sh" unifiedDiff={"diff --git a/run.sh b/run.sh\nold mode 100644\nnew mode 100755\n"} isCollapsed={false}/>);
  expect(screen.getByText("文件模式：100644 → 100755")).toBeTruthy();
});
