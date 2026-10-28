import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { CodexConnectionState } from "./CodexConnectionState";

it("offers CA certificate download and trust steps when certificate is blocked", () => {
  render(
    <CodexConnectionState
      available={false}
      instanceReady={false}
      error="浏览器尚未信任 HTTPS 证书"
      detail="An SSL certificate error occurred when fetching the script."
      certificate
      active
      onRetry={vi.fn()}
    />,
  );
  expect(
    screen.getByRole("heading", { name: "浏览器尚未信任 HTTPS 证书" }),
  ).toBeTruthy();
  const download = screen.getByRole("link", { name: "下载 CA 证书" });
  expect(download.getAttribute("href")).toBe("/__coding-kanban/https-ca.crt");
  expect(download.getAttribute("download")).toBe("coding-kanban-dev-ca.crt");
  expect(screen.getByText(/下载 Coding Kanban 开发 CA 证书/)).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "重新检查连接" }),
  ).toBeTruthy();
});

it("keeps only retry when the failure is not certificate related", () => {
  render(
    <CodexConnectionState
      available={false}
      instanceReady={false}
      error="原生聊天无法启动"
      detail="Service Workers are unavailable."
      active
      onRetry={vi.fn()}
    />,
  );
  expect(screen.queryByRole("link", { name: "下载 CA 证书" })).toBeNull();
  expect(screen.getByRole("button", { name: "重新检查连接" })).toBeTruthy();
});

it("triggers retry from the certificate card", () => {
  const onRetry = vi.fn();
  render(
    <CodexConnectionState
      available={false}
      instanceReady={false}
      error="浏览器尚未信任 HTTPS 证书"
      certificate
      active
      onRetry={onRetry}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "重新检查连接" }));
  expect(onRetry).toHaveBeenCalledOnce();
});
