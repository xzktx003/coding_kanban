import { afterEach, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
vi.mock("./App", () => ({
  default: () => <textarea aria-label="会话草稿" defaultValue="keep draft" />,
}));
vi.mock("./DataImportDialog", () => ({ DataImportDialog: () => null }));
import SessionWorkbench from "./SessionWorkbench";
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("checks connection continuously and retains the mounted draft during an outage", async () => {
  vi.useFakeTimers();
  const fetch = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({ status: "ok" }) });
  vi.stubGlobal("fetch", fetch);
  render(<SessionWorkbench />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10);
  });
  const draft = screen.getByLabelText("会话草稿");
  fetch.mockRejectedValue(new Error("offline"));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(31_000);
  });
  expect(screen.getByRole("alert").textContent).toContain("连接中断");
  expect(screen.getByLabelText("会话草稿")).toBe(draft);
  fetch.mockResolvedValue({ ok: true, json: async () => ({ status: "ok" }) });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(11_000);
  });
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByLabelText("会话草稿")).toBe(draft);
});
