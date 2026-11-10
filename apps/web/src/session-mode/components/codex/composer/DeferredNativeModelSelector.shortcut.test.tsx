import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { DeferredNativeModelSelector } from "./DeferredNativeModelSelector";

vi.mock("@session/stores/useInputStore", () => ({ activeDraftOwner: () => "owner" }));
vi.mock("@session/session-dom", () => ({
  isSessionInteractionVisible: () => true,
  useAgentInteractionVisible: () => true,
}));
vi.mock("./NativeModelSelector", () => ({
  NativeModelSelector: () => <div role="menu">模型菜单</div>,
}));

it("opens the model menu from the actual model selector", async () => {
  render(<div className="session-mode"><DeferredNativeModelSelector threadId={null} draftOwner="owner" /></div>);
  fireEvent.click(screen.getByRole("button", { name: /模型：|跟随配置/ }));
  expect((await screen.findByRole("menu")).textContent).toBe("模型菜单");
});

it("does not expose an IDE context action without a host implementation", () => {
  render(<div className="session-mode"><DeferredNativeModelSelector threadId={null} draftOwner="owner" /></div>);
  expect(screen.queryByRole("button", { name: /IDE 上下文/ })).toBeNull();
});
