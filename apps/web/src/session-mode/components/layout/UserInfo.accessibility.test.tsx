import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { UserInfo } from "./UserInfo";
import { useCodexStore } from "@session/components/codex/stores";
vi.mock("@session/services", () => ({
  listAccountSnapshots: async () => [],
  switchAccountSnapshot: vi.fn(),
}));
vi.mock("@session/components/codex/CodexAuthDialog", () => ({
  CodexAuthDialog: () => null,
}));
test("account entry is named and returns focus after Escape", async () => {
  useCodexStore.setState({ hasAccount: true, account: null });
  render(<UserInfo />);
  const trigger = screen.getByRole("button", { name: "账户与登录" });
  fireEvent.click(trigger);
  const dialog = await screen.findByRole("dialog");
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(trigger.getAttribute("title")).toBe("账户与登录");
  await waitFor(() => expect(document.activeElement).toBe(trigger));
});
