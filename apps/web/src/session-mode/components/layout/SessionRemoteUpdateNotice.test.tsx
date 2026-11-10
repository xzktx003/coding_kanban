import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { SessionRemoteUpdateNotice } from "./SessionRemoteUpdateNotice";

const getAppVersion = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/api", () => ({ getAppVersion }));

afterEach(() => {
  getAppVersion.mockReset();
});

test("session mode shows a remote update without loading terminal mode", async () => {
  getAppVersion.mockResolvedValue({
    autoUpdate: {
      enabled: true,
      phase: "available",
      branch: "v1.3.0",
      remoteHead: "abcdef123456",
    },
  });
  const onOpenUpdate = vi.fn();
  render(<SessionRemoteUpdateNotice active onOpenUpdate={onOpenUpdate} />);

  const button = await screen.findByRole("button", {
    name: /远程有新版本/,
  });
  expect(button.getAttribute("title")).toContain("v1.3.0");
  expect(button.getAttribute("title")).toContain("abcdef12");
  expect(onOpenUpdate).not.toHaveBeenCalled();
  fireEvent.click(button);
  expect(onOpenUpdate).toHaveBeenCalledOnce();
});

test("hidden session mode waits until it becomes active before polling", async () => {
  getAppVersion.mockResolvedValue({
    autoUpdate: {
      enabled: true,
      phase: "available",
      branch: "v1.3.0",
      remoteHead: "abcdef123456",
    },
  });
  const { rerender } = render(
    <SessionRemoteUpdateNotice active={false} onOpenUpdate={vi.fn()} />,
  );
  expect(getAppVersion).not.toHaveBeenCalled();
  rerender(<SessionRemoteUpdateNotice active onOpenUpdate={vi.fn()} />);
  await screen.findByRole("button", { name: /远程有新版本/ });
  expect(getAppVersion).toHaveBeenCalledOnce();
});

test("session mode explains why a remote update is blocked", async () => {
  getAppVersion.mockResolvedValue({
    autoUpdate: {
      enabled: true,
      intervalMinutes: 10,
      phase: "conflict",
      branch: "main",
      remoteHead: "abcdef123456",
      lastCheckedAt: null,
      lastUpdatedAt: null,
      conflictReason: "diverged",
      message: "本地与远程分支已经分叉，需要手动处理后再更新。",
    },
  });
  render(<SessionRemoteUpdateNotice active onOpenUpdate={vi.fn()} />);

  const button = await screen.findByRole("button", {
    name: /远程更新存在冲突/,
  });
  expect(button.textContent).toContain("本地与远程已分叉");
  expect(button.getAttribute("title")).toContain(
    "本地与远程分支已经分叉，需要手动处理后再更新。",
  );
  expect(button.getAttribute("aria-label")).toContain(
    "本地与远程分支已经分叉，需要手动处理后再更新。",
  );
});
