import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, test } from "vitest";
import { SessionSyncIndicator } from "./SessionSyncIndicator";
import { useSessionManagementSyncStatus } from "../../services/sessionManagementClient";

beforeEach(() => useSessionManagementSyncStatus.setState({ pending: 0, blocked: 0, error: undefined }));
test("an unknown management receipt is visible without promising an automatic retry", async () => {
  useSessionManagementSyncStatus.setState({ pending: 1, blocked: 1, error: "操作结果待核对，未自动重复执行" });
  render(<SessionSyncIndicator />);
  fireEvent.click(screen.getByRole("button", { name: /同步/ }));
  expect(await screen.findByText("操作结果待核对，未自动重复执行")).toBeTruthy();
  expect(screen.getByRole("button", { name: "核对共享状态" })).toBeTruthy();
  expect(screen.queryByText("修改已保存在本机，连接恢复后自动同步。")).toBeNull();
});
