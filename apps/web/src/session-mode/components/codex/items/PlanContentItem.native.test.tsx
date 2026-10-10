import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { PlanContentItem } from "./PlanContentItem";
vi.mock("@session/contexts/ThemeContext", () => ({
  useThemeContext: () => ({ resolvedTheme: "dark" }),
  CapturedThemeProvider: ({ children }: { children: any }) => children,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("../presentation/CodexMarkdown", () => ({
  CodexMarkdown: ({
    value,
    threadId,
  }: {
    value: string;
    threadId?: string;
  }) => <span data-owner={threadId}>{value}</span>,
}));
it("uses native 320px plan preview and expands the full plan without an arbitrary clipping cap", () => {
  const { container } = render(
    <PlanContentItem
      text={"# Plan\n\n" + "Full plan\n".repeat(300)}
      threadId="owner"
      turnId="turn"
    />,
  );
  const body = container.querySelector(".codex-plan-content")!;
  expect(body.getAttribute("data-collapsed")).toBe("true");
  expect(body.querySelector('[data-owner="owner"]')).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "plan.expandContent" }));
  expect(body.getAttribute("data-collapsed")).toBe("false");
  expect(body.className).not.toContain("1200");
});
it("streaming plan remains copy/download disabled and keeps writing presentation", () => {
  const { container } = render(
    <PlanContentItem text="Incomplete plan" running />,
  );
  expect(
    screen.getByRole("button", { name: "plan.copy" }).hasAttribute("disabled"),
  ).toBe(true);
  expect(
    screen
      .getByRole("button", { name: "plan.download" })
      .hasAttribute("disabled"),
  ).toBe(true);
  expect(container.querySelector('[data-streaming="true"]')).not.toBeNull();
});
