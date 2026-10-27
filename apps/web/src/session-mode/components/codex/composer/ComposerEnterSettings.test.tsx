import { render, screen, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ComposerEnterSettings } from "./ComposerEnterSettings";
import { useFollowupSettingsStore } from "@session/stores/useFollowupSettingsStore";
beforeEach(() =>
  useFollowupSettingsStore.setState({
    enterBehavior: "enter",
    persistenceError: null,
  }),
);
afterEach(() => vi.restoreAllMocks());
it("exposes all three native Enter variants and persists the exact selected value", () => {
  render(<ComposerEnterSettings />);
  expect(screen.getAllByRole("radio")).toHaveLength(3);
  fireEvent.click(screen.getByLabelText("多行时使用 Ctrl/⌘ Enter 发送"));
  expect(useFollowupSettingsStore.getState().enterBehavior).toBe(
    "cmdIfMultiline",
  );
  fireEvent.click(screen.getByLabelText("始终使用 Ctrl/⌘ Enter 发送"));
  expect(useFollowupSettingsStore.getState().enterBehavior).toBe("cmdAlways");
  expect(
    JSON.parse(
      localStorage.getItem(
        "kanban.session.followup-settings.v1.enterBehavior",
      )!,
    ),
  ).toBe("cmdAlways");
});

it("shows persistence failure and retries the actual selected preference", () => {
  render(<ComposerEnterSettings />);
  const write = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(() => {
      throw new DOMException("fixture quota", "QuotaExceededError");
    });
  fireEvent.click(screen.getByLabelText("始终使用 Ctrl/⌘ Enter 发送"));
  expect(useFollowupSettingsStore.getState().enterBehavior).toBe("cmdAlways");
  expect(screen.getByRole("alert").textContent).toContain("fixture quota");
  expect(screen.getByRole("alert").textContent).toContain(
    "当前页面继续使用所选偏好",
  );
  write.mockRestore();
  fireEvent.click(screen.getByRole("button", { name: "重试保存偏好" }));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(
    JSON.parse(
      localStorage.getItem(
        "kanban.session.followup-settings.v1.enterBehavior",
      )!,
    ),
  ).toBe("cmdAlways");
});
