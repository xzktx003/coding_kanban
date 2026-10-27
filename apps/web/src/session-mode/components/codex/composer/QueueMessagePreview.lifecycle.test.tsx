import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ComposerRail, ComposerRailItem } from "./ComposerRail";
import { QueueMessagePreview } from "./QueueMessagePreview";
const state = vi.hoisted(() => ({
  stop: vi.fn(),
  start: vi.fn(),
  resolve: null as
    | null
    | ((value: { x: number; y: number; placement: string }) => void),
}));
vi.mock("@floating-ui/dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@floating-ui/dom")>();
  return {
    ...actual,
    autoUpdate: (...args: unknown[]) => {
      state.start();
      (args[2] as () => void)();
      return state.stop;
    },
    computePosition: () =>
      new Promise((resolve) => {
        state.resolve = resolve;
      }),
  };
});
it("starts position observers only while open and ignores a late result after rail removal", async () => {
  const fixture = (visible: boolean) => (
    <ComposerRail>
      <ComposerRailItem visible={visible}>
        <QueueMessagePreview
          text="original"
          summary="summary"
          threadId="owner"
          position={1}
        />
      </ComposerRailItem>
    </ComposerRail>
  );
  const view = render(fixture(true));
  expect(state.start).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("group", { name: "预览排队消息 1：summary" }),
  );
  expect(state.start).toHaveBeenCalledTimes(1);
  const popup = document.querySelector<HTMLElement>("[role=dialog]")!;
  expect(popup.style.visibility).toBe("hidden");
  view.rerender(fixture(false));
  expect(state.stop).toHaveBeenCalledTimes(1);
  expect(popup.isConnected).toBe(false);
  await act(async () => state.resolve?.({ x: 10, y: 20, placement: "top" }));
  expect(popup.style.visibility).toBe("hidden");
  await waitFor(() =>
    expect(document.querySelector("[role=dialog]")).toBeNull(),
  );
});
