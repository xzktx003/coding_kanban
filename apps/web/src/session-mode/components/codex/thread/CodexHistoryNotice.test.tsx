import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { CodexHistoryNotice } from "./CodexHistoryNotice";

it("keeps failed updating history visible alongside previously confirmed rows", () => {
  const retry = vi.fn();
  const { rerender } = render(
    <CodexHistoryNotice loaded error="read timed out" onRetry={retry} />,
  );
  expect(screen.getByRole("alert").textContent).toContain("无法加载消息");
  expect(screen.getByRole("alert").title).toBe("read timed out");
  fireEvent.click(screen.getByRole("button"));
  expect(retry).toHaveBeenCalledOnce();
  rerender(<CodexHistoryNotice loaded onRetry={retry} />);
  expect(screen.queryByRole("alert")).toBeNull();
});
it("shows initial hydration regardless of partial live rows and clears stale errors while retrying", () => {
  render(<CodexHistoryNotice loading error="old failure" onRetry={() => {}} />);
  expect(screen.getByRole("status")).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
});
