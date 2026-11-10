import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

vi.mock("../lib/vscode-service-worker", () => ({
  probeVsCodeWebServiceWorker: vi.fn(async () => ({
    state: "blocked",
    reason: "certificate",
    detail: "An SSL certificate error occurred when fetching the script.",
  })),
}));

import CodexWorkbench from "./CodexWorkbench";

it("does not replace the native chat with a certificate gate when the probe fails", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      if (input === "/api/session/projects")
        return { ok: true, json: async () => ({ projects: [] }) } as Response;
      if (input === "/api/native-codex/status")
        return {
          ok: true,
          json: async () => ({
            available: true,
            iframeUrl: "/native-codex/",
            newChatWindowIds: ["019aabcd-5678-7890-abcd-0123456789ab"],
          }),
        } as Response;
      throw new Error(`unexpected request ${String(input)}`);
    }),
  );

  render(<CodexWorkbench active onModeChange={vi.fn()} />);

  expect(
    await screen.findByTitle("原生 Codex 会话窗口"),
  ).toBeTruthy();
  expect(
    screen.queryByRole("heading", { name: "浏览器尚未信任 HTTPS 证书" }),
  ).toBeNull();
});
