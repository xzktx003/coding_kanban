import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { FeishuNotificationSettingsResponse } from "@agent-orchestrator/shared";
import { beforeEach, expect, it, vi } from "vitest";
import { FeishuNotificationSettings } from "./FeishuNotificationSettings";
import {
  getFeishuNotificationSettings,
  updateFeishuNotificationSettings,
} from "../../../lib/api";

vi.mock("../../../lib/api", () => ({
  getFeishuNotificationSettings: vi.fn(),
  updateFeishuNotificationSettings: vi.fn(),
}));

const getSettings = vi.mocked(getFeishuNotificationSettings);
const updateSettings = vi.mocked(updateFeishuNotificationSettings);

function settings(
  overrides: Partial<FeishuNotificationSettingsResponse> = {},
): FeishuNotificationSettingsResponse {
  return {
    enabled: true,
    configured: true,
    destinationType: "user",
    replyEnabled: true,
    replyConfigured: true,
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  getSettings.mockResolvedValue(settings());
});

it("loads the shared Feishu completion switch without exposing recipient ids", async () => {
  render(<FeishuNotificationSettings />);

  expect(await screen.findByText("已开启")).toBeTruthy();
  expect(screen.getByText("目标：个人")).toBeTruthy();
  expect(
    screen.getByText(
      "与终端共用开关；Codex 每轮成功完成后发送，关闭页面也可通知。",
    ),
  ).toBeTruthy();
  expect(screen.queryByText(/open_id|union_id|chat_id|ou_/i)).toBeNull();
});

it("toggles only the enabled flag through the shared endpoint", async () => {
  updateSettings.mockResolvedValue(settings({ enabled: false }));
  render(<FeishuNotificationSettings />);

  const toggle = await screen.findByRole("switch", { name: "飞书完成通知" });
  fireEvent.click(toggle);

  await waitFor(() =>
    expect(updateSettings).toHaveBeenCalledWith({ enabled: false }),
  );
  expect(updateSettings).not.toHaveBeenCalledWith(
    expect.objectContaining({ replyEnabled: expect.any(Boolean) }),
  );
  expect(await screen.findByText("已关闭")).toBeTruthy();
});

it("toggles only the reply flag through the shared endpoint", async () => {
  updateSettings.mockResolvedValue(settings({ replyEnabled: false }));
  render(<FeishuNotificationSettings />);

  const toggle = await screen.findByRole("switch", {
    name: "飞书回复继续任务",
  });
  fireEvent.click(toggle);

  await waitFor(() =>
    expect(updateSettings).toHaveBeenCalledWith({ replyEnabled: false }),
  );
  expect(updateSettings).not.toHaveBeenCalledWith(
    expect.objectContaining({ enabled: expect.any(Boolean) }),
  );
  expect(
    screen.getByText(
      "仅个人接收目标可用；回复会话模式的完成卡片可继续原 Codex 会话，忙碌时会排队。",
    ),
  ).toBeTruthy();
});

it("disables the switch when Feishu delivery is not configured", async () => {
  getSettings.mockResolvedValue(
    settings({ enabled: false, configured: false, destinationType: null }),
  );

  render(<FeishuNotificationSettings />);

  const toggle = await screen.findByRole("switch", { name: "飞书完成通知" });
  expect((toggle as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText("未配置接收目标")).toBeTruthy();
});

it("disables the reply switch when private replies are not configured", async () => {
  getSettings.mockResolvedValue(
    settings({
      destinationType: "chat",
      replyConfigured: false,
      replyEnabled: false,
    }),
  );

  render(<FeishuNotificationSettings />);

  const toggle = await screen.findByRole("switch", {
    name: "飞书回复继续任务",
  });
  expect((toggle as HTMLButtonElement).disabled).toBe(true);
});

it("shows load and update failures with retry actions", async () => {
  getSettings.mockRejectedValueOnce(new Error("network"));
  render(<FeishuNotificationSettings />);

  expect(await screen.findByText("无法读取飞书完成通知设置")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "重试读取飞书通知设置" }));
  expect(await screen.findByText("已开启")).toBeTruthy();

  updateSettings.mockRejectedValueOnce(new Error("save failed"));
  fireEvent.click(screen.getByRole("switch", { name: "飞书完成通知" }));

  expect(await screen.findByText("无法更新飞书完成通知设置")).toBeTruthy();
  updateSettings.mockResolvedValueOnce(settings({ enabled: false }));
  fireEvent.click(screen.getByRole("button", { name: "重试更新飞书通知设置" }));

  expect(await screen.findByText("已关闭")).toBeTruthy();
});
