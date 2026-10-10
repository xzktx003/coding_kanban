import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { NativeDiffContent } from "./NativeDiffContent";
import { nativeDiffLines } from "./nativeDiffLines";

it("selects native side coordinates using gutter and shift range and opens the exact line", () => {
  const select = vi.fn(), open = vi.fn();
  render(<NativeDiffContent lines={nativeDiffLines("", "", "@@ -80 +90,2 @@\n-old\n+new\n+extra\n")} path="a.ts" split onSelectLines={select} onOpenLine={open} />);
  fireEvent.click(screen.getByRole("button", { name: "选择新文件第 90 行" }));
  fireEvent.click(screen.getByRole("button", { name: "选择新文件第 91 行" }), { shiftKey: true });
  expect(select).toHaveBeenLastCalledWith({ side: "new", start: 90, end: 91, content: "new\nextra" });
  fireEvent.doubleClick(screen.getByText("extra"));
  expect(open).toHaveBeenCalledWith({ side: "new", line: 91 });
});
it("does not calculate unbounded word diffs for long unbroken generated lines", () => {
  const start = performance.now();
  render(<NativeDiffContent lines={nativeDiffLines("", "", `@@ -1 +1 @@\n-${"a".repeat(150000)}\n+${"b".repeat(150000)}\n`)} />);
  expect(document.querySelectorAll(".codex-diff-word").length).toBe(0);
  expect(performance.now() - start).toBeLessThan(2000);
});
it("supports mouse gutter drag and keyboard ranges using native side coordinates", () => {
  vi.stubGlobal("PointerEvent", MouseEvent);
  try {
    const select = vi.fn();
    render(<NativeDiffContent lines={nativeDiffLines("", "", "@@ -0,0 +90,3 @@\n+first\n+second\n+third\n")} onSelectLines={select} />);
    const first = screen.getByRole("button", { name: "选择新文件第 90 行" }), second = screen.getByRole("button", { name: "选择新文件第 91 行" });
    fireEvent.pointerDown(first, { button: 0, buttons: 1, pointerType: "mouse" }); fireEvent.pointerEnter(second, { buttons: 1, pointerType: "mouse" }); fireEvent.pointerUp(second); fireEvent.click(second);
    expect(select).toHaveBeenLastCalledWith({ side: "new", start: 90, end: 91, content: "first\nsecond" });
    fireEvent.keyDown(second, { key: "ArrowDown", shiftKey: true });
    expect(select).toHaveBeenLastCalledWith({ side: "new", start: 90, end: 92, content: "first\nsecond\nthird" });
  } finally { vi.unstubAllGlobals(); }
});
it("places each hunk's actions after its final changed native row", () => {
  const view = render(<NativeDiffContent lines={nativeDiffLines("", "", "@@ -80,3 +80,3 @@\n context\n-old\n+new\n tail\n")} renderHunkActions={index => <button>hunk {index}</button>} />);
  expect(view.container.querySelector(".codex-diff-hunk button")).toBeNull();
  expect(view.container.querySelector('[data-new-line="81"]')?.parentElement?.querySelector("[data-hunk-actions] button")?.textContent).toBe("hunk 0");
});
