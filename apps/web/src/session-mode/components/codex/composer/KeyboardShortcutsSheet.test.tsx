import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { KeyboardShortcutsSheet } from "./KeyboardShortcutsSheet";

vi.mock("sonner", () => ({ toast: { message: vi.fn() } }));

describe("KeyboardShortcutsSheet", () => {
  it("records real shortcuts, persists them, rejects browser keys, and resets", () => {
    render(<KeyboardShortcutsSheet onClose={() => undefined} />);
    expect(
      screen.getByRole("dialog", { name: "键盘快捷方式" }).textContent,
    ).toContain("自定义键盘快捷键");
    fireEvent.change(screen.getByRole("textbox", { name: "搜索键盘快捷键" }), {
      target: { value: "zzz" },
    });
    expect(screen.getByRole("status").textContent).toContain(
      "没有匹配的快捷键",
    );
    fireEvent.change(screen.getByRole("textbox", { name: "搜索键盘快捷键" }), {
      target: { value: "个性" },
    });
    fireEvent.click(screen.getByRole("button", { name: "为 个性 录入快捷键" }));
    expect(
      screen.getByRole("button", { name: "为 个性 录入快捷键" }).textContent,
    ).toContain("按下新的组合键");
    fireEvent.keyDown(
      screen.getByRole("button", { name: "为 个性 录入快捷键" }),
      { key: "p", code: "KeyP", ctrlKey: true, altKey: true },
    );
    expect(
      screen.getByRole("button", { name: "为 个性 录入快捷键" }).textContent,
    ).toContain("Alt");
    expect(localStorage.getItem("session-keyboard-shortcuts-v1")).toContain(
      "personality",
    );
    fireEvent.click(screen.getByRole("button", { name: "为 个性 录入快捷键" }));
    fireEvent.keyDown(
      screen.getByRole("button", { name: "为 个性 录入快捷键" }),
      { key: "l", code: "KeyL", ctrlKey: true },
    );
    expect(screen.getByRole("alert").textContent).toContain("浏览器");
    fireEvent.click(screen.getByRole("button", { name: "全部重置为默认值" }));
    expect(screen.getByRole("status").textContent).toContain(
      "已恢复默认快捷键",
    );
  });
});
