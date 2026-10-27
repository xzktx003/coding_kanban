import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PointerSensor } from "@dnd-kit/core";
import {
  QueueDragHandle,
  QueueReorderList,
  QueueSortableItem,
} from "./QueueReorder";
import { useLayoutStore } from "@session/stores/useLayoutStore";

const originalPointer = window.PointerEvent;
const hidden = Object.getOwnPropertyDescriptor(document, "hidden");
class TestPointerEvent extends MouseEvent {
  readonly isPrimary: boolean;
  readonly pointerId: number;
  readonly pointerType: string;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.isPrimary = init.isPrimary ?? true;
    this.pointerId = init.pointerId ?? 1;
    this.pointerType = init.pointerType ?? "mouse";
  }
}
beforeEach(() => {
  window.PointerEvent = TestPointerEvent as unknown as typeof PointerEvent;
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: false,
  });
  useLayoutStore.setState({ view: "agent" });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const item = this.closest<HTMLElement>("[data-followup-id]");
      const index = item
        ? ["a", "b", "c"].indexOf(item.dataset.followupId!)
        : 0;
      const top = Math.max(0, index) * 100;
      const height = this.tagName === "OL" ? 300 : 40;
      return {
        x: 0,
        y: top,
        left: 0,
        right: 300,
        top,
        bottom: top + height,
        width: 300,
        height,
        toJSON: () => ({}),
      } as DOMRect;
    },
  );
});
afterEach(async () => {
  // Real sensors must be dismissed even when a regression assertion fails.
  fireEvent.pointerCancel(document, { pointerId: 1 });
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 60));
  vi.restoreAllMocks();
  window.PointerEvent = originalPointer;
  if (hidden) Object.defineProperty(document, "hidden", hidden);
  else delete (document as any).hidden;
});
function Fixture({
  identity = "thread-a:1",
  ids = ["a", "b", "c"],
  enabled = true,
  change = vi.fn(),
  click = vi.fn(),
}: {
  identity?: string;
  ids?: string[];
  enabled?: boolean;
  change?: (ids: string[]) => void;
  click?: () => void;
}) {
  return (
    <div className="session-mode">
      <QueueReorderList
        identity={identity}
        ids={ids}
        enabled={enabled}
        onReorder={change}
      >
        {ids.map((id, index) => (
          <QueueSortableItem key={id} id={id} status="queued">
            <QueueDragHandle position={index + 1}>
              <span>{id}</span>
            </QueueDragHandle>
            <input aria-label={`edit-${id}`} defaultValue={`draft-${id}`} />
          </QueueSortableItem>
        ))}
      </QueueReorderList>
      <button type="button" onClick={click}>
        Ordinary action
      </button>
    </div>
  );
}
function down() {
  fireEvent.pointerDown(
    screen.getByRole("button", { name: "拖动排序排队消息 1" }),
    { isPrimary: true, button: 0, pointerId: 1, clientX: 20, clientY: 20 },
  );
}
async function activate() {
  down();
  fireEvent.pointerMove(document, { pointerId: 1, clientX: 20, clientY: 28 });
  await waitFor(() =>
    expect(
      document.querySelector('[data-queue-dragging="true"]'),
    ).not.toBeNull(),
  );
}
async function dropAtSecond() {
  fireEvent.pointerMove(document, { pointerId: 1, clientX: 20, clientY: 130 });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  fireEvent.pointerUp(document, { pointerId: 1, clientX: 20, clientY: 130 });
}

it("uses the real pointer sensor and only reorders after its activation distance", async () => {
  const change = vi.fn();
  render(<Fixture change={change} />);
  down();
  fireEvent.pointerMove(document, { pointerId: 1, clientX: 20, clientY: 25 });
  expect(document.querySelector('[data-queue-dragging="true"]')).toBeNull();
  fireEvent.pointerUp(document, { pointerId: 1, clientX: 20, clientY: 25 });
  await act(async () => {
    await Promise.resolve();
  });
  expect(change).not.toHaveBeenCalled();
  await activate();
  await dropAtSecond();
  expect(change).toHaveBeenCalledExactlyOnceWith(["b", "a", "c"]);
});

it.each(["thread", "revision", "ids", "disabled"] as const)(
  "does not commit an active drag after %s changes",
  async (reason) => {
    const change = vi.fn();
    const view = render(<Fixture change={change} />);
    await activate();
    view.rerender(
      <Fixture
        change={change}
        identity={
          reason === "thread"
            ? "thread-b:1"
            : reason === "revision"
              ? "thread-a:2"
              : "thread-a:1"
        }
        ids={reason === "ids" ? ["a", "c"] : ["a", "b", "c"]}
        enabled={reason !== "disabled"}
      />,
    );
    await dropAtSecond();
    expect(change).not.toHaveBeenCalled();
  },
);

it("keeps an idle editor node, focus and selection across revision updates", () => {
  const view = render(<Fixture />);
  const input = screen.getByRole("textbox", {
    name: "edit-a",
  }) as HTMLInputElement;
  input.focus();
  fireEvent.change(input, { target: { value: "draft changed" } });
  input.setSelectionRange(1, 4);
  view.rerender(<Fixture identity="thread-a:2" />);
  expect(screen.getByRole("textbox", { name: "edit-a" })).toBe(input);
  expect(document.activeElement).toBe(input);
  expect(input.value).toBe("draft changed");
  expect(input.selectionStart).toBe(1);
  expect(input.selectionEnd).toBe(4);
});

it("cancels active blur without leaving the native sensor's document click blocker", async () => {
  const click = vi.fn(),
    change = vi.fn();
  render(<Fixture click={click} change={change} />);
  await activate();
  fireEvent(window, new Event("blur"));
  await new Promise((resolve) => setTimeout(resolve, 70));
  fireEvent.click(screen.getByRole("button", { name: "Ordinary action" }));
  expect(click).toHaveBeenCalledOnce();
  expect(change).not.toHaveBeenCalled();
});

it("unmounting an active list releases its document click blocker without waiting for pointerup", async () => {
  const view = render(<Fixture />);
  await activate();
  view.unmount();
  const button = document.createElement("button"),
    click = vi.fn();
  button.addEventListener("click", click);
  document.body.append(button);
  try {
    await new Promise((resolve) => setTimeout(resolve, 70));
    fireEvent.click(button);
    expect(click).toHaveBeenCalledOnce();
  } finally {
    button.remove();
  }
});

it.each([
  "hidden",
  "inert",
  "secondary",
  "document-hidden",
  "pointercancel",
] as const)("prevents a drop after %s", async (reason) => {
  const change = vi.fn();
  render(<Fixture change={change} />);
  await activate();
  await act(async () => {
    const root = document.querySelector<HTMLElement>(".session-mode")!;
    if (reason === "hidden") root.hidden = true;
    if (reason === "inert") root.setAttribute("inert", "");
    if (reason === "secondary") useLayoutStore.setState({ view: "settings" });
    if (reason === "document-hidden") {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    }
    if (reason === "pointercancel")
      fireEvent.pointerCancel(document, { pointerId: 1 });
    await Promise.resolve();
  });
  await dropAtSecond();
  expect(change).not.toHaveBeenCalled();
});

it("invalidates a pending sub-threshold pointer when the owner changes", async () => {
  const change = vi.fn();
  const view = render(<Fixture change={change} />);
  down();
  fireEvent.pointerMove(document, { pointerId: 1, clientX: 20, clientY: 25 });
  view.rerender(<Fixture change={change} identity="thread-b:1" />);
  await dropAtSecond();
  expect(change).not.toHaveBeenCalled();
});

// Observe the pinned library lifecycle without replacing sensor behavior.
const pointerLifecycle = Object.getPrototypeOf(PointerSensor.prototype) as {
  handleCancel: () => void;
};
it.each(["end", "cancel"] as const)(
  "releases the owned cancel registration after normal %s",
  async (finish) => {
    const cancel = vi.spyOn(pointerLifecycle, "handleCancel");
    const view = render(<Fixture />);
    await activate();
    if (finish === "end") await dropAtSecond();
    else fireEvent.pointerCancel(document, { pointerId: 1 });
    const calls = cancel.mock.calls.length;
    expect(calls).toBe(finish === "end" ? 0 : 1);
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent(window, new Event("blur"));
    view.rerender(<Fixture identity="thread-b:1" />);
    view.unmount();
    expect(cancel).toHaveBeenCalledTimes(calls);
  },
);

it("unmounting a pending sub-threshold gesture detaches its real document listeners", () => {
  const cancel = vi.spyOn(pointerLifecycle, "handleCancel");
  const add = vi.spyOn(document, "addEventListener"),
    remove = vi.spyOn(document, "removeEventListener");
  const view = render(<Fixture />);
  down();
  fireEvent.pointerMove(document, { pointerId: 1, clientX: 20, clientY: 25 });
  const pointerMoves = add.mock.calls.filter(
    (call) => call[0] === "pointermove",
  );
  expect(pointerMoves).toHaveLength(1);
  view.unmount();
  expect(cancel).toHaveBeenCalledOnce();
  expect(
    remove.mock.calls.some(
      (call) => call[0] === "pointermove" && call[1] === pointerMoves[0][1],
    ),
  ).toBe(true);
});

it("cancels only its owned sensor when another same-id queue has a live gesture", async () => {
  const first = vi.fn(),
    second = vi.fn();
  const pair = (identity: string) => (
    <>
      <section data-testid="first">
        <Fixture identity={identity} change={first} />
      </section>
      <section data-testid="second">
        <Fixture identity="other-thread:1" change={second} />
      </section>
    </>
  );
  const view = render(pair("thread-a:1"));
  for (const name of ["first", "second"]) {
    fireEvent.pointerDown(
      within(screen.getByTestId(name)).getByRole("button", {
        name: "拖动排序排队消息 1",
      }),
      { isPrimary: true, button: 0, pointerId: 1, clientX: 20, clientY: 20 },
    );
  }
  fireEvent.pointerMove(document, { pointerId: 1, clientX: 20, clientY: 28 });
  await waitFor(() =>
    expect(
      document.querySelectorAll('[data-queue-dragging="true"]'),
    ).toHaveLength(2),
  );
  view.rerender(pair("thread-new:1"));
  expect(
    within(screen.getByTestId("first")).getByRole("textbox", {
      name: "edit-a",
    }),
  ).toBeTruthy();
  expect(
    screen.getByTestId("first").querySelector('[data-queue-dragging="true"]'),
  ).toBeNull();
  expect(
    screen.getByTestId("second").querySelector('[data-queue-dragging="true"]'),
  ).not.toBeNull();
  await dropAtSecond();
  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledExactlyOnceWith(["b", "a", "c"]);
});

it("preserves the editor after a pending abort and accepts the next drag", async () => {
  const cancel = vi.spyOn(pointerLifecycle, "handleCancel");
  const change = vi.fn();
  const view = render(<Fixture change={change} />);
  down();
  fireEvent.pointerMove(document, { pointerId: 1, clientX: 20, clientY: 25 });
  fireEvent.pointerUp(document, { pointerId: 1, clientX: 20, clientY: 25 });
  expect(change).not.toHaveBeenCalled();
  const input = screen.getByRole("textbox", {
    name: "edit-a",
  }) as HTMLInputElement;
  input.focus();
  fireEvent.change(input, { target: { value: "draft after aborted gesture" } });
  input.setSelectionRange(2, 7);
  // No microtask flush: abort cleanup is owned by the sensor callback itself.
  view.rerender(<Fixture change={change} identity="thread-a:2" />);
  expect(screen.getByRole("textbox", { name: "edit-a" })).toBe(input);
  expect(document.activeElement).toBe(input);
  expect(input.value).toBe("draft after aborted gesture");
  expect([input.selectionStart, input.selectionEnd]).toEqual([2, 7]);
  fireEvent(window, new Event("blur"));
  expect(cancel).not.toHaveBeenCalled();
  await activate();
  await dropAtSecond();
  expect(change).toHaveBeenCalledExactlyOnceWith(["b", "a", "c"]);
  view.unmount();
  expect(cancel).not.toHaveBeenCalled();
});
