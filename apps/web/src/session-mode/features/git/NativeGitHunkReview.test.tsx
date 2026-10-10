import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { NativeGitHunkReview } from "./NativeGitHunkReview";
const api = vi.hoisted(() => ({ read: vi.fn(), action: vi.fn() }));
vi.mock("./gitHunkService", () => ({ gitHunkRead: api.read, gitHunkAction: api.action }));
const snapshot = { digest: "a".repeat(64), binary: false, unifiedDiff: "@@ -80 +90 @@\n-before\n+after\n", hunks: [{ index: 0, oldStart: 80, oldCount: 1, newStart: 90, newCount: 1 }] };
it("sends the captured authoritative hunk and confirms exact revert scope", async () => {
  api.read.mockResolvedValue(snapshot); api.action.mockResolvedValue({ status: "success" });
  api.action.mockClear();
  render(<NativeGitHunkReview cwd="/owner" filePath="a.ts" staged={false} onRefresh={() => {}} />);
  fireEvent.click(await screen.findByRole("button", { name: "还原变更块 1" }));
  expect(api.action).not.toHaveBeenCalled();
  expect(screen.getByRole("alertdialog").textContent).toContain("/owner/a.ts");
  expect(screen.getByRole("alertdialog").textContent).toContain("90–90");
  fireEvent.click(screen.getByRole("button", { name: "确认丢弃此块" }));
  await waitFor(() => expect(api.action).toHaveBeenCalledWith({ cwd: "/owner", filePath: "a.ts", staged: false, hunkIndex: 0, expectedDigest: snapshot.digest, action: "revert", confirmRevert: true }));
});
it("never retries an uncertain mutation and requires read-only reconciliation", async () => {
  api.read.mockResolvedValue(snapshot); api.action.mockRejectedValue(new Error("transport unavailable")); api.action.mockClear();
  render(<NativeGitHunkReview cwd="/owner" filePath="a.ts" staged={false} onRefresh={() => {}} />);
  fireEvent.click(await screen.findByRole("button", { name: "暂存变更块 1" }));
  await screen.findByText(/回执不明/);
  expect((screen.getByRole("button", { name: "暂存变更块 1" }) as HTMLButtonElement).disabled).toBe(true);
  expect(api.action).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "只读刷新并核对" }));
  await waitFor(() => expect((screen.getByRole("button", { name: "暂存变更块 1" }) as HTMLButtonElement).disabled).toBe(false));
  expect(api.action).toHaveBeenCalledTimes(1);
});
