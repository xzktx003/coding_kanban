import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { WorkbenchModeSwitch } from "../../../components/WorkbenchModeSwitch";
import type { WorkbenchMode } from "../../../lib/workbench-mode";

it("offers exactly three peer buttons without a binary switch", () => {
  const change = vi.fn();
  const view = render(<WorkbenchModeSwitch mode="session" onChange={change} />);
  const group = screen.getByRole("group", { name: "工作模式" });
  const buttons = within(group).getAllByRole("button");
  expect(buttons.map((button) => button.textContent)).toEqual([
    "会话",
    "终端",
    "Codex",
  ]);
  expect(within(group).queryByRole("switch")).toBeNull();

  for (const [index, mode] of (
    ["session", "terminal", "codex"] as WorkbenchMode[]
  ).entries()) {
    view.rerender(<WorkbenchModeSwitch mode={mode} onChange={change} />);
    expect(
      buttons.map((button) => button.getAttribute("aria-pressed")),
    ).toEqual(buttons.map((_, candidate) => String(candidate === index)));
    fireEvent.click(buttons[index]);
    expect(change).toHaveBeenLastCalledWith(mode);
  }
});

it("selects peer buttons with arrows, Home and End", () => {
  const change = vi.fn();
  render(<WorkbenchModeSwitch mode="terminal" onChange={change} />);
  fireEvent.keyDown(screen.getByRole("button", { name: "终端" }), {
    key: "ArrowRight",
  });
  expect(change).toHaveBeenLastCalledWith("codex");
  fireEvent.keyDown(screen.getByRole("button", { name: "Codex" }), {
    key: "ArrowLeft",
  });
  expect(change).toHaveBeenLastCalledWith("terminal");
  fireEvent.keyDown(screen.getByRole("button", { name: "Codex" }), {
    key: "Home",
  });
  expect(change).toHaveBeenLastCalledWith("session");
  fireEvent.keyDown(screen.getByRole("button", { name: "会话" }), {
    key: "End",
  });
  expect(change).toHaveBeenLastCalledWith("codex");
});

it("blocks disabled mode changes for clicks and keys", () => {
  const change = vi.fn();
  render(<WorkbenchModeSwitch mode="session" onChange={change} disabled />);
  for (const button of screen.getAllByRole("button")) {
    fireEvent.click(button);
    fireEvent.keyDown(button, { key: "End" });
  }
  expect(change).not.toHaveBeenCalled();
  expect(
    screen.getByRole("button", { name: "Codex" }).hasAttribute("disabled"),
  ).toBe(true);
});
