import { act, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { GeneralSettings } from "./GeneralSettings";
import AboutView from "@session/views/AboutView";
import TodoView from "@session/features/todos/TodoView";

vi.mock("@session/lib/telemetry", () => ({
  getTelemetryStatus: async () => ({ available: false }),
  setTelemetryConsent: vi.fn(),
}));

const repository = "https://github.com/BrotherHappy/coding-kanban";

it("settings expose only this project's GitHub link", async () => {
  await act(async () => {
    render(<GeneralSettings />);
  });
  const links = screen.getAllByRole("link");
  expect(links.map((link) => link.getAttribute("href"))).toEqual([repository]);
  expect(
    screen.getByRole("link", { name: "GitHub 项目" }).getAttribute("rel"),
  ).toContain("noopener");
  expect(screen.queryByText(/上游|lisp_mi/)).toBeNull();
});

it("about identifies Coding Kanban and links directly to its repository", () => {
  const { container } = render(<AboutView />);
  expect(
    screen.getByRole("heading", { name: "Coding Kanban · 会话模式" }),
  ).toBeTruthy();
  expect(
    screen
      .getByRole("link", { name: "BrotherHappy/coding-kanban" })
      .getAttribute("href"),
  ).toBe(repository);
  expect(screen.getByRole("img").getAttribute("alt")).toBe("Coding Kanban");
  expect(container.textContent).not.toMatch(
    /Milisp|Codexia|All rights reserved/i,
  );
});

it("todos retain their controls without third-party upsell links", () => {
  const { container } = render(<TodoView />);
  expect(screen.getByRole("button", { name: "Hide done" })).toBeTruthy();
  expect(container.textContent).not.toMatch(/plux|Capture from any app/i);
});
