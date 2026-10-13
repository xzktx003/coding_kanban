import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, expect, it, vi } from "vitest";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import { zh } from "@session/locales/zh";
import { PlanContentItem } from "./PlanContentItem";
import { useSessionDraftStore } from "@session/stores/useSessionDraftStore";

vi.mock("@session/contexts/ThemeContext", () => ({
  useThemeContext: () => ({ resolvedTheme: "dark" }),
  CapturedThemeProvider: ({ children }: { children: unknown }) => children,
}));
vi.mock("../presentation/CodexMarkdown", () => ({
  CodexMarkdown: ({ value }: { value: string }) => <span>{value}</span>,
}));

beforeAll(async () => {
  await i18next
    .use(initReactI18next)
    .init({ lng: "zh", resources: { zh: { thread: zh.thread } } });
});

it("copies only the open plan and leaves another session draft unchanged", async () => {
  const writeText = vi.fn(async () => undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  const plan = ["# 计划", "", "先看范围，再改代码。"].join("\n");
  useSessionDraftStore.setState({
    drafts: { "other-session": { text: "不要改这条草稿", revision: 3 } },
  });
  render(<PlanContentItem text={plan} threadId="owner" />);
  fireEvent.click(screen.getByRole("button", { name: "复制计划" }));
  await waitFor(() => {
    expect(screen.getByRole("button", { name: "已复制" })).toBeTruthy();
  });
  expect(writeText).toHaveBeenCalledWith(plan);
  expect(useSessionDraftStore.getState().drafts["other-session"]).toEqual({
    text: "不要改这条草稿",
    revision: 3,
  });
});
