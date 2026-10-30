import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("./LanguageSelector", () => ({ LanguageSelector: () => null }));
vi.mock("./FeishuNotificationSettings", () => ({
  FeishuNotificationSettings: () => null,
}));
vi.mock("@session/lib/telemetry", () => ({
  getTelemetryStatus: vi.fn(async () => ({ available: false })),
  setTelemetryConsent: vi.fn(),
}));
import { GeneralSettings } from "./GeneralSettings";
import { useSettingsStore } from "../../stores/settings/useSettingsStore";

beforeEach(() => {
  localStorage.clear();
  useSettingsStore.setState({ warmFollowedSessions: true });
});
afterEach(cleanup);

it("offers a device-local warm retention switch and persists its explicit choice", () => {
  render(<GeneralSettings />);
  const toggle = screen.getByRole("switch", { name: "预热关注会话" });
  expect(toggle.getAttribute("aria-checked")).toBe("true");
  fireEvent.click(toggle);
  expect(toggle.getAttribute("aria-checked")).toBe("false");
  expect(
    JSON.parse(localStorage.getItem("kanban.session.settings-storage")!).state
      .warmFollowedSessions,
  ).toBe(false);
  fireEvent.click(toggle);
  expect(toggle.getAttribute("aria-checked")).toBe("true");
});
