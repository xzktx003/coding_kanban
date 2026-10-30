import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ apply: vi.fn() }));
vi.mock("@session/stores/useThreadModelStore", () => ({ captureThreadModelSelection: () => ({ settings: {} }), flushThreadModelSettings: async () => {} }));
vi.mock("@session/services/followupService", () => ({ followupParameters: () => ({}) }));
vi.mock("@session/services/queuedThreadSettings", () => ({ applyQueuedThreadSettings: api.apply }));
vi.mock("@session/services/codexOperationScope", () => ({ captureCodexOperationScope: () => ({}), isCodexOperationScopeCurrent: () => true }));
import { NativeQueueSettingsNotice } from "./NativeQueueSettingsNotice";
it("does not show the previous target's late settings receipt on a newly selected thread", async () => {
  let finish!: (value: unknown) => void;
  api.apply.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const view = render(<NativeQueueSettingsNotice threadId="original" />);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "应用到待发队列" })));
  view.rerender(<NativeQueueSettingsNotice threadId="other" />);
  await act(async () => finish({ status: "accepted" }));
  expect(screen.queryByRole("status")).toBeNull();
  expect((screen.getByRole("button", { name: "应用到待发队列" }) as HTMLButtonElement).disabled).toBe(false);
});
