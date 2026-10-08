import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";
import { WorkbenchShell } from "../components/WorkbenchShell";

const lifecycle = vi.hoisted(() => ({ terminalMounts: 0 }));

vi.mock("../App", async () => {
  const { useEffect } = await import("react");
  return {
    default: ({
      active,
      navigation,
    }: {
      active: boolean;
      navigation: ReactNode;
    }) => {
      useEffect(() => {
        lifecycle.terminalMounts += 1;
      }, []);
      return (
        <div data-testid="terminal-app" data-active={String(active)}>
          {navigation}
        </div>
      );
    },
  };
});
vi.mock("./SessionWorkbench", () => ({
  default: ({ onModeChange }: { onModeChange: (mode: "terminal") => void }) => (
    <button onClick={() => onModeChange("terminal")}>前往终端</button>
  ),
}));
vi.mock("../components/WorkbenchModeSwitch", () => ({
  WorkbenchModeSwitch: ({
    onChange,
  }: {
    onChange: (mode: "session") => void;
  }) => <button onClick={() => onChange("session")}>前往会话</button>,
}));

beforeEach(() => {
  lifecycle.terminalMounts = 0;
  localStorage.clear();
});

test("a session-first load does not initialize the terminal app", async () => {
  history.replaceState(null, "", "/?mode=session");
  render(<WorkbenchShell />);
  await screen.findByRole("button", { name: "前往终端" });
  expect(screen.queryByTestId("terminal-app")).toBeNull();
  expect(lifecycle.terminalMounts).toBe(0);
});

test("switching modes keeps terminal state mounted while suspending hidden work", async () => {
  history.replaceState(null, "", "/?mode=terminal");
  render(<WorkbenchShell />);
  const terminal = await screen.findByTestId("terminal-app");
  expect(terminal.getAttribute("data-active")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "前往会话" }));
  await waitFor(() =>
    expect(terminal.getAttribute("data-active")).toBe("false"),
  );
  fireEvent.click(await screen.findByRole("button", { name: "前往终端" }));
  await waitFor(() =>
    expect(terminal.getAttribute("data-active")).toBe("true"),
  );
  expect(screen.getByTestId("terminal-app")).toBe(terminal);
  expect(lifecycle.terminalMounts).toBe(1);
});
