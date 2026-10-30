import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { FollowupQueueContent } from "./FollowupQueue";
import { ComposerRail, ComposerRailItem } from "./ComposerRail";
import { followupService } from "@session/services/followupService";
vi.mock("@session/services/followupService", () => ({
  followupService: { change: vi.fn(), load: vi.fn() },
}));
const text =
  "# Check **bold** and `code`\n\nKeep all of this prompt for reading and copying.";
function Fixture({ visible = true, value = text }) {
  return (
    <ComposerRail>
      <ComposerRailItem visible={visible}>
        <FollowupQueueContent
          compactShelf
          threadId="owner"
          turnId="turn"
          snapshot={{
            error: undefined,
            state: {
              revision: 1,
              paused: null,
              items: [
                {
                  id: "q1",
                  threadId: "owner",
                  text: value,
                  images: [],
                  parameters: {},
                  status: "queued",
                  mode: "queue",
                  createdAt: 1,
                  fingerprint: "fixture",
                },
              ],
            },
          }}
        />
      </ComposerRailItem>
    </ComposerRail>
  );
}
function overflow(element: HTMLElement) {
  const clamp = element.querySelector("[data-queue-preview-clamp]")!;
  Object.defineProperty(clamp, "scrollHeight", {
    configurable: true,
    value: 40,
  });
  Object.defineProperty(clamp, "clientHeight", {
    configurable: true,
    value: 20,
  });
}
it("renders native one-line rich preview without a heading or a nested text button", async () => {
  const view = render(<Fixture />);
  const trigger = screen.getByRole("group", { name: /预览排队消息 1/ });
  await act(async () => {
    await vi.dynamicImportSettled();
  });
  await waitFor(() =>
    expect(trigger.querySelector("strong")?.textContent).toBe("bold"),
  );
  expect(trigger.querySelector("code")?.textContent).toBe("code");
  expect(trigger.querySelector("h1")).toBeNull();
  expect(view.container.querySelector("button button")).toBeNull();
});
it("opens an unmodified read-only prompt instead of changing or editing its queue entry", async () => {
  render(<Fixture />);
  const trigger = screen.getByRole("group", { name: /预览排队消息 1/ });
  overflow(trigger);
  fireEvent.click(trigger);
  const dialog = await screen.findByRole("dialog", { name: "排队消息预览" });
  expect(dialog.textContent).toBe(text);
  expect(dialog.getAttribute("aria-modal")).not.toBe("true");
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(followupService.change).not.toHaveBeenCalled();
  fireEvent.keyDown(dialog, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});
it("removes the preview portal immediately when its rail leaves", async () => {
  const view = render(<Fixture />);
  const trigger = screen.getByRole("group", { name: /预览排队消息 1/ });
  overflow(trigger);
  fireEvent.click(trigger);
  await screen.findByRole("dialog", { name: "排队消息预览" });
  view.rerender(<Fixture visible={false} />);
  expect(screen.queryByRole("dialog", { name: "排队消息预览" })).toBeNull();
});
it("does not open a popup for a short prompt that fits", () => {
  render(<Fixture value="short" />);
  const trigger = screen.getByRole("group", { name: "预览排队消息 1：short" });
  fireEvent.focus(trigger);
  fireEvent.click(trigger);
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("closes a visible preview when Session mode is hidden", async () => {
  const view = render(
    <main className="session-mode">
      <Fixture />
    </main>,
  );
  const trigger = screen.getByRole("group", { name: /预览排队消息 1/ });
  overflow(trigger);
  fireEvent.click(trigger);
  await screen.findByRole("dialog", { name: "排队消息预览" });
  view.container.querySelector<HTMLElement>(".session-mode")!.hidden = true;
  window.dispatchEvent(new Event("workbench-mode-changed"));
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "排队消息预览" })).toBeNull(),
  );
});
it("keeps reordering on its icon handle without making selectable text draggable", async () => {
  const first = {
    id: "first",
    threadId: "owner",
    text: "first",
    images: [],
    parameters: {},
    status: "queued" as const,
    mode: "queue" as const,
    createdAt: 1,
    fingerprint: "first",
  };
  const second = { ...first, id: "second", text: "second" };
  vi.mocked(followupService.change).mockResolvedValue({
    revision: 2,
    paused: null,
    items: [second, first],
  });
  const view = render(
    <FollowupQueueContent
      compactShelf
      threadId="owner"
      turnId="turn"
      snapshot={{
        error: undefined,
        state: { revision: 1, paused: null, items: [first, second] },
      }}
    />,
  );
  const rows = view.container.querySelectorAll("li");
  expect(rows[0].draggable).toBe(false);
  const handle = rows[0].querySelector<HTMLElement>(
    ".session-queue-drag-handle",
  )!;
  expect(handle.draggable).toBe(false);
  expect(handle.getAttribute("aria-roledescription")).toBe("sortable");
  const values = new Map<string, string>();
  const dataTransfer = {
    setData: (kind: string, value: string) => values.set(kind, value),
    getData: (kind: string) => values.get(kind) ?? "",
  };
  fireEvent.dragStart(handle, { dataTransfer });
  fireEvent.drop(rows[1], { dataTransfer });
  // Sorting now uses the real PointerSensor. Physical gestures and the same
  // exact owner/revision/id order are asserted in session-queue-sort.spec.ts.
  expect(followupService.change).not.toHaveBeenCalled();
});
