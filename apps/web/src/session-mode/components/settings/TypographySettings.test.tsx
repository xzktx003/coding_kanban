import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { TypographySettings } from "./TypographySettings";
it("exposes real device-local chat and code typography controls", () => {
  render(<TypographySettings />);
  fireEvent.change(screen.getByRole("combobox", { name: "聊天字体" }), {
    target: { value: "serif" },
  });
  fireEvent.change(screen.getByRole("combobox", { name: "正文字号" }), {
    target: { value: "18" },
  });
  expect(
    (screen.getByRole("combobox", { name: "聊天字体" }) as HTMLSelectElement)
      .value,
  ).toBe("serif");
  expect(
    (screen.getByRole("combobox", { name: "正文字号" }) as HTMLSelectElement)
      .value,
  ).toBe("18");
});

import { act } from "@testing-library/react";
import { beforeEach } from "vitest";
import { useTypographyStore } from "@session/stores/settings/useTypographyStore";
import { useSessionTypography } from "@session/hooks/useSessionTypography";
function Application() {
  useSessionTypography();
  return <TypographySettings />;
}
beforeEach(() => {
  localStorage.clear();
  useTypographyStore.getState().reset();
});
it("persists only chosen fields, applies them only to session roots, and accepts newer page values", () => {
  const root = document.createElement("div"),
    terminal = document.createElement("div");
  root.className = "session-mode";
  terminal.className = "terminal-mode";
  document.body.append(root, terminal);
  try {
    render(<Application />, { container: root });
    expect(root.style.getPropertyValue("--codex-chat-font-size")).toBe("");
    fireEvent.change(screen.getByRole("combobox", { name: "代码字号" }), {
      target: { value: "18" },
    });
    expect(root.style.getPropertyValue("--codex-chat-code-font-size")).toBe(
      "18px",
    );
    expect(terminal.style.cssText).toBe("");
    expect(
      document.documentElement.style.getPropertyValue(
        "--codex-chat-code-font-size",
      ),
    ).toBe("");
    const key = "kanban.session.typography.v1.codeSize";
    expect(localStorage.getItem(key)).toBe("18");
    localStorage.setItem(key, "20");
    fireEvent.change(screen.getByRole("combobox", { name: "聊天字体" }), {
      target: { value: "serif" },
    });
    expect(localStorage.getItem(key)).toBe("20");
    act(() =>
      window.dispatchEvent(
        new StorageEvent("storage", { key, newValue: "16" }),
      ),
    );
    expect(root.style.getPropertyValue("--codex-chat-code-font-size")).toBe(
      "20px",
    );
    expect(root.style.getPropertyValue("--vscode-font-family")).toContain(
      "serif",
    );
    fireEvent.click(screen.getByRole("button", { name: "恢复默认字体" }));
    expect(root.style.getPropertyValue("--codex-chat-code-font-size")).toBe("");
    expect(root.hasAttribute("data-session-code-size")).toBe(false);
  } finally {
    root.remove();
    terminal.remove();
  }
});
it("rejects invalid typography values without persisting unusable CSS", () => {
  act(() =>
    useTypographyStore
      .getState()
      .choose({
        textSize: Infinity,
        codeSize: 999,
        chatFont: "url(invalid)" as never,
      }),
  );
  expect(useTypographyStore.getState()).toMatchObject({
    textSize: null,
    codeSize: null,
    chatFont: "default",
  });
});
