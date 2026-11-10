import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ComposerHeaderMenu } from "./ComposerHeaderMenu";

it("uses the existing keyboard shortcut event", () => {
  const opened = vi.fn();
  window.addEventListener("codex-open-keyboard-shortcuts", opened);
  render(<ComposerHeaderMenu onSettings={vi.fn()} onShortcuts={() => window.dispatchEvent(new Event("codex-open-keyboard-shortcuts"))} />);
  fireEvent.click(screen.getByRole("button", { name: "Codex 菜单" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "键盘快捷键" }));
  expect(opened).toHaveBeenCalledOnce();
  window.removeEventListener("codex-open-keyboard-shortcuts", opened);
});

it("labels the header trigger as settings before opening its menu", () => {
  render(<ComposerHeaderMenu onSettings={vi.fn()} onShortcuts={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Codex 菜单" }).getAttribute("title")).toBe("设置");
});

it("opens settings and shortcuts without changing the composer", () => {
  const settings = vi.fn();
  const shortcuts = vi.fn();
  render(<ComposerHeaderMenu onSettings={settings} onShortcuts={shortcuts} />);
  fireEvent.click(screen.getByRole("button", { name: "Codex 菜单" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "键盘快捷键" }));
  expect(shortcuts).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Codex 菜单" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Codex 设置" }));
  expect(settings).toHaveBeenCalledOnce();
});

it("closes on outside pointer input", () => {
  render(<ComposerHeaderMenu onSettings={vi.fn()} onShortcuts={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Codex 菜单" }));
  expect(screen.getByRole("menu", { name: "Codex 菜单" })).toBeTruthy();
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole("menu", { name: "Codex 菜单" })).toBeNull();
});

it("closes on Escape and restores focus to its trigger", () => {
  render(<ComposerHeaderMenu onSettings={vi.fn()} onShortcuts={vi.fn()} />);
  const trigger = screen.getByRole("button", { name: "Codex 菜单" });
  fireEvent.click(trigger);
  screen.getByRole("menuitem", { name: "Codex 设置" }).focus();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("menu", { name: "Codex 菜单" })).toBeNull();
  expect(document.activeElement).toBe(trigger);
});
