import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ComposerSheet } from "./ComposerSheet";

it("gives the full sketch close button its hover title", () => {
  render(<ComposerSheet full title="草图编辑器" onClose={vi.fn()}><p>画布</p></ComposerSheet>);
  const button = screen.getByRole("button", { name: "关闭草图编辑器" });
  expect(button.textContent).toBe("");
  expect(button.getAttribute("title")).toBe("关闭草图编辑器");
});

it("lets a full composer explain that the draft is preserved on return", () => {
  render(<ComposerSheet full title="展开编辑" closeLabel="返回并保留草稿" onClose={vi.fn()}><p>草稿</p></ComposerSheet>);
  const button = screen.getByRole("button", { name: "返回并保留草稿" });
  expect(button.getAttribute("title")).toBe("返回并保留草稿");
});
