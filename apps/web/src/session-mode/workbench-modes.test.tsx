import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { WorkbenchMode } from "../lib/workbench-mode";
import { WORKBENCH_MODE_KEY } from "../lib/workbench-mode";
import { WorkbenchShell } from "../components/WorkbenchShell";

const lifecycle = vi.hoisted(() => ({
  mounts: { terminal: 0, session: 0, codex: 0 },
}));
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
        lifecycle.mounts.terminal += 1;
      }, []);
      return (
        <div data-testid="terminal-app" data-active={String(active)}>
          {navigation}
          <input aria-label="终端草稿" />
        </div>
      );
    },
  };
});
vi.mock("./SessionWorkbench", async () => {
  const { useEffect } = await import("react");
  const { WorkbenchModeSwitch } =
    await import("../components/WorkbenchModeSwitch");
  return {
    default: ({
      active,
      onModeChange,
    }: {
      active: boolean;
      onModeChange: (mode: WorkbenchMode) => void;
    }) => {
      useEffect(() => {
        lifecycle.mounts.session += 1;
      }, []);
      return (
        <div data-testid="session-app" data-active={String(active)}>
          <WorkbenchModeSwitch mode="session" onChange={onModeChange} />
          <input aria-label="会话草稿" />
        </div>
      );
    },
  };
});
vi.mock("../codex-mode/CodexWorkbench", async () => {
  const { useEffect } = await import("react");
  const { WorkbenchModeSwitch } =
    await import("../components/WorkbenchModeSwitch");
  return {
    default: ({
      active,
      onModeChange,
    }: {
      active: boolean;
      onModeChange: (mode: WorkbenchMode) => void;
    }) => {
      useEffect(() => {
        lifecycle.mounts.codex += 1;
      }, []);
      return (
        <div data-testid="codex-app" data-active={String(active)}>
          <WorkbenchModeSwitch mode="codex" onChange={onModeChange} />
          <input aria-label="Codex 草稿" />
        </div>
      );
    },
  };
});

beforeEach(() => {
  lifecycle.mounts = { terminal: 0, session: 0, codex: 0 };
  localStorage.clear();
  history.replaceState(null, "", "/?mode=codex");
});

it("opens Codex directly without starting either unvisited workbench", async () => {
  render(<WorkbenchShell />);
  const codex = await screen.findByTestId("codex-app");
  expect(codex.getAttribute("data-active")).toBe("true");
  expect(codex.closest(".codex-mode")?.hasAttribute("inert")).toBe(false);
  expect(lifecycle.mounts).toEqual({ terminal: 0, session: 0, codex: 1 });
});

it("retains all three visited workbenches, isolates hidden surfaces and restores mode focus", async () => {
  render(<WorkbenchShell />);
  const codex = await screen.findByTestId("codex-app");
  fireEvent.change(within(codex).getByRole("textbox"), {
    target: { value: "保留原生输入" },
  });
  const toSession = within(codex).getByRole("button", { name: "会话" });
  toSession.focus();
  fireEvent.click(toSession);
  const session = await screen.findByTestId("session-app");
  await waitFor(() =>
    expect(document.activeElement).toBe(
      within(session).getByRole("button", { name: "会话" }),
    ),
  );
  fireEvent.change(within(session).getByRole("textbox"), {
    target: { value: "保留会话输入" },
  });
  fireEvent.click(within(session).getByRole("button", { name: "终端" }));
  const terminal = await screen.findByTestId("terminal-app");
  const toCodex = within(terminal).getByRole("button", { name: "Codex" });
  toCodex.focus();
  fireEvent.click(toCodex);
  await waitFor(() =>
    expect(document.activeElement).toBe(
      within(codex).getByRole("button", { name: "Codex" }),
    ),
  );
  for (const inactive of [terminal, session]) {
    expect(inactive.getAttribute("data-active")).toBe("false");
    expect(inactive.closest("[hidden][inert]")).not.toBeNull();
  }
  expect(codex.getAttribute("data-active")).toBe("true");
  expect(screen.getByTestId("codex-app")).toBe(codex);
  expect((within(codex).getByRole("textbox") as HTMLInputElement).value).toBe(
    "保留原生输入",
  );
  expect(
    (within(session).getByRole("textbox", { hidden: true }) as HTMLInputElement)
      .value,
  ).toBe("保留会话输入");
  expect(lifecycle.mounts).toEqual({ terminal: 1, session: 1, codex: 1 });
  expect(localStorage.getItem(WORKBENCH_MODE_KEY)).toBe("codex");
  expect(location.search).toBe("?mode=codex");
});

it("synchronizes history navigation and saved Codex preference without duplicate mounts", async () => {
  localStorage.setItem(WORKBENCH_MODE_KEY, "codex");
  history.replaceState(null, "", "/mobile?session=abc#details");
  render(<WorkbenchShell />);
  const codex = await screen.findByTestId("codex-app");
  const changed = vi.fn();
  window.addEventListener("workbench-mode-changed", changed);
  try {
    history.replaceState(null, "", "/mobile?session=abc&mode=terminal#details");
    fireEvent.popState(window);
    const terminal = await screen.findByTestId("terminal-app");
    expect(codex.closest("[hidden][inert]")).not.toBeNull();
    history.replaceState(null, "", "/mobile?session=abc&mode=codex#details");
    fireEvent.popState(window);
    await waitFor(() => expect(codex.getAttribute("data-active")).toBe("true"));
    expect(terminal.getAttribute("data-active")).toBe("false");
    expect(changed.mock.calls.map(([event]) => event.detail)).toEqual([
      "terminal",
      "codex",
    ]);
    expect(lifecycle.mounts).toEqual({ terminal: 1, session: 0, codex: 1 });
    expect(location.hash).toBe("#details");
  } finally {
    window.removeEventListener("workbench-mode-changed", changed);
  }
});
