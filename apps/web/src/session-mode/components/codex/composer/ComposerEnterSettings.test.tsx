import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import { ComposerEnterSettings } from "./ComposerEnterSettings";
import { useFollowupSettingsStore } from "@session/stores/useFollowupSettingsStore";
beforeEach(() => useFollowupSettingsStore.setState({ enterBehavior: "enter" }));
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
    JSON.parse(localStorage.getItem("kanban.session.followup-settings")!).state
      .enterBehavior,
  ).toBe("cmdAlways");
});
