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
  mounts: { terminal: 0, session: 0, codex: 0, chatgpt: 0 },
  failChatgpt: false,
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
vi.mock("../chatgpt-mode/ChatgptModeApp", async () => {
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
        lifecycle.mounts.chatgpt += 1;
      }, []);
      if (lifecycle.failChatgpt) throw new Error("ChatGPT fixture failed");
      return (
        <div data-testid="chatgpt-app" data-active={String(active)}>
          <WorkbenchModeSwitch mode="chatgpt" onChange={onModeChange} />
          <input aria-label="ChatGPT 草稿" />
        </div>
      );
    },
  };
});

beforeEach(() => {
  lifecycle.mounts = { terminal: 0, session: 0, codex: 0, chatgpt: 0 };
  lifecycle.failChatgpt = false;
  localStorage.clear();
  history.replaceState(null, "", "/?mode=codex");
});

it("opens Codex directly without starting either unvisited workbench", async () => {
  render(<WorkbenchShell />);
  const codex = await screen.findByTestId("codex-app");
  expect(codex.getAttribute("data-active")).toBe("true");
  expect(codex.closest(".codex-mode")?.hasAttribute("inert")).toBe(false);
  expect(lifecycle.mounts).toEqual({
    terminal: 0,
    session: 0,
    codex: 1,
    chatgpt: 0,
  });
});

it("opens ChatGPT directly without mounting other workbenches", async () => {
  history.replaceState(null, "", "/?mode=chatgpt");
  render(<WorkbenchShell />);
  const chatgpt = await screen.findByTestId("chatgpt-app");
  expect(chatgpt.getAttribute("data-active")).toBe("true");
  expect(chatgpt.closest(".chatgpt-mode")?.hasAttribute("inert")).toBe(false);
  expect(
    within(chatgpt).queryByRole("button", { name: "ChatGPT" }),
  ).toBeNull();
  expect(lifecycle.mounts).toEqual({
    terminal: 0,
    session: 0,
    codex: 0,
    chatgpt: 1,
  });
});

it("keeps three visible workbenches and hides the paused ChatGPT entry", async () => {
  render(<WorkbenchShell />);
  const codex = await screen.findByTestId("codex-app");
  expect(within(codex).queryByRole("button", { name: "ChatGPT" })).toBeNull();
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
  for (const inactive of [session, terminal]) {
    expect(inactive.getAttribute("data-active")).toBe("false");
    expect(inactive.closest("[hidden][inert]")).not.toBeNull();
  }
  expect(screen.getByTestId("codex-app")).toBe(codex);
  expect(
    (within(codex).getByRole("textbox", { hidden: true }) as HTMLInputElement)
      .value,
  ).toBe("保留原生输入");
  expect(
    (within(session).getByRole("textbox", { hidden: true }) as HTMLInputElement)
      .value,
  ).toBe("保留会话输入");
  expect(lifecycle.mounts).toEqual({
    terminal: 1,
    session: 1,
    codex: 1,
    chatgpt: 0,
  });
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
    expect(lifecycle.mounts).toEqual({
      terminal: 1,
      session: 0,
      codex: 1,
      chatgpt: 0,
    });
    expect(location.hash).toBe("#details");
  } finally {
    window.removeEventListener("workbench-mode-changed", changed);
  }
});

it("restores the saved fourth mode on unknown history entries without remounting", async () => {
  localStorage.setItem(WORKBENCH_MODE_KEY, "chatgpt");
  history.replaceState(null, "", "/mobile?session=abc#details");
  render(<WorkbenchShell />);
  const chatgpt = await screen.findByTestId("chatgpt-app");
  const changed = vi.fn();
  window.addEventListener("workbench-mode-changed", changed);
  try {
    history.replaceState(null, "", "/mobile?session=abc&mode=terminal#details");
    fireEvent.popState(window);
    const terminal = await screen.findByTestId("terminal-app");
    expect(chatgpt.closest("[hidden][inert]")).not.toBeNull();
    history.replaceState(null, "", "/mobile?session=abc&mode=unknown#details");
    fireEvent.popState(window);
    await waitFor(() =>
      expect(chatgpt.getAttribute("data-active")).toBe("true"),
    );
    expect(terminal.getAttribute("data-active")).toBe("false");
    expect(changed.mock.calls.map(([event]) => event.detail)).toEqual([
      "terminal",
      "chatgpt",
    ]);
    expect(lifecycle.mounts).toEqual({
      terminal: 1,
      session: 0,
      codex: 0,
      chatgpt: 1,
    });
    expect(location.hash).toBe("#details");
  } finally {
    window.removeEventListener("workbench-mode-changed", changed);
  }
});

it("isolates a fourth-mode render failure and offers an explicit terminal fallback", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  lifecycle.failChatgpt = true;
  try {
    history.replaceState(null, "", "/?mode=chatgpt");
    render(<WorkbenchShell />);
    const heading = await screen.findByRole("heading", {
      name: "ChatGPT界面加载失败",
    });
    fireEvent.click(
      within(heading.parentElement!).getByRole("button", {
        name: "切换到终端模式",
      }),
    );
    const terminal = await screen.findByTestId("terminal-app");
    expect(terminal.getAttribute("data-active")).toBe("true");
    expect(screen.getByTestId("codex-app")).toBe(codex);
    expect(lifecycle.mounts.codex).toBe(1);
  } finally {
    log.mockRestore();
  }
});
