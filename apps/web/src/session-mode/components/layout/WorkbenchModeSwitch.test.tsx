import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { WorkbenchModeSwitch } from "../../../components/WorkbenchModeSwitch";

it("exposes both modes and switches with one click", () => {
  const change = vi.fn();
  const view = render(<WorkbenchModeSwitch mode="session" onChange={change} />);
  const rail = screen.getByRole("switch", { name: "工作模式" });
  expect(rail.getAttribute("aria-checked")).toBe("false");
  fireEvent.click(rail);
  expect(change).toHaveBeenLastCalledWith("terminal");
  view.rerender(<WorkbenchModeSwitch mode="terminal" onChange={change} />);
  expect(rail.getAttribute("aria-checked")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "会话" }));
  expect(change).toHaveBeenLastCalledWith("session");
});
it("exposes Codex as a separate selection while retaining the binary rail", () => {
  const change = vi.fn();
  const view = render(
    <WorkbenchModeSwitch mode="terminal" onChange={change} />,
  );
  const codex = screen.getByRole("button", { name: "Codex" });
  expect(codex.getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(codex);
  expect(change).toHaveBeenLastCalledWith("codex");
  view.rerender(<WorkbenchModeSwitch mode="codex" onChange={change} />);
  expect(codex.getAttribute("aria-pressed")).toBe("true");
  expect(
    screen.getByRole("button", { name: "会话" }).getAttribute("aria-pressed"),
  ).toBe("false");
  expect(
    screen.getByRole("button", { name: "终端" }).getAttribute("aria-pressed"),
  ).toBe("false");
  fireEvent.click(screen.getByRole("switch", { name: "工作模式" }));
  expect(change).toHaveBeenLastCalledWith("session");
});
it("reaches all three labeled choices by keyboard and prevents disabled navigation", () => {
  const change = vi.fn();
  const view = render(
    <WorkbenchModeSwitch mode="terminal" onChange={change} />,
  );
  fireEvent.keyDown(screen.getByRole("button", { name: "终端" }), {
    key: "ArrowRight",
  });
  expect(change).toHaveBeenLastCalledWith("codex");
  view.rerender(<WorkbenchModeSwitch mode="codex" onChange={change} />);
  const codex = screen.getByRole("button", { name: "Codex" });
  fireEvent.keyDown(codex, { key: "ArrowLeft" });
  expect(change).toHaveBeenLastCalledWith("terminal");
  fireEvent.keyDown(codex, { key: "Home" });
  expect(change).toHaveBeenLastCalledWith("session");
  fireEvent.keyDown(screen.getByRole("button", { name: "会话" }), {
    key: "End",
  });
  expect(change).toHaveBeenLastCalledWith("codex");
  view.rerender(
    <WorkbenchModeSwitch mode="session" onChange={change} disabled />,
  );
  change.mockClear();
  expect(
    screen.getByRole("button", { name: "Codex" }).hasAttribute("disabled"),
  ).toBe(true);
  fireEvent.keyDown(screen.getByRole("button", { name: "会话" }), {
    key: "End",
  });
  expect(change).not.toHaveBeenCalled();
});
it("supports keyboard direction and disabled targets", () => {
  const change = vi.fn();
  const view = render(<WorkbenchModeSwitch mode="session" onChange={change} />);
  const rail = screen.getByRole("switch", { name: "工作模式" });
  fireEvent.keyDown(rail, { key: "ArrowRight" });
  expect(change).toHaveBeenLastCalledWith("terminal");
  fireEvent.keyDown(rail, { key: "ArrowLeft" });
  expect(change).toHaveBeenLastCalledWith("session");
  change.mockClear();
  view.rerender(
    <WorkbenchModeSwitch mode="session" onChange={change} disabled />,
  );
  fireEvent.click(rail);
  expect(change).not.toHaveBeenCalled();
});
it("commits a drag on release, ignores its following click and cancels cleanly", () => {
  const change = vi.fn();
  render(<WorkbenchModeSwitch mode="session" onChange={change} />);
  const rail = screen.getByRole("switch", { name: "工作模式" });
  vi.spyOn(rail, "getBoundingClientRect").mockReturnValue({
    left: 0,
    width: 44,
    right: 44,
  } as DOMRect);
  const pointer = (name: string, x: number) => {
    const event = new Event(name, { bubbles: true });
    Object.assign(event, {
      pointerId: 1,
      clientX: x,
      button: 0,
      isPrimary: true,
    });
    fireEvent(rail, event);
  };
  pointer("pointerdown", 10);
  pointer("pointermove", 40);
  expect(change).not.toHaveBeenCalled();
  pointer("pointerup", 40);
  expect(change).toHaveBeenCalledOnce();
  expect(change).toHaveBeenCalledWith("terminal");
  fireEvent.click(rail);
  expect(change).toHaveBeenCalledOnce();
  pointer("pointerdown", 10);
  pointer("pointermove", 40);
  pointer("pointercancel", 40);
  expect(change).toHaveBeenCalledOnce();
});
