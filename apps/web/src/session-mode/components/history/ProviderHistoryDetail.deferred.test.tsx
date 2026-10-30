import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
vi.mock("./ProviderHistoryDetailReader", () => ({
  default: () => {
    throw new Error("optional detail module failed");
  },
}));
vi.mock("@session/session-dom", () => ({
  useAgentInteractionVisible: () => true,
}));
import { ProviderHistoryDetail } from "./ProviderHistoryDetail";
it("a failed optional detail module stays local and preserves the conversation draft", async () => {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    render(
      <>
        <input aria-label="draft" defaultValue="preserved local draft" />
        <ProviderHistoryDetail
          provider="cc"
          sessionId="original"
          itemId="source"
        />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "查看完整内容" }));
    await screen.findByRole("alert");
    expect(
      (screen.getByRole("textbox", { name: "draft" }) as HTMLInputElement)
        .value,
    ).toBe("preserved local draft");
    fireEvent.click(screen.getByRole("button", { name: "关闭此面板" }));
    expect(screen.queryByRole("alert")).toBeNull();
  } finally {
    consoleError.mockRestore();
  }
});
