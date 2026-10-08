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
