import { StrictMode } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { UserMessageItem } from "./UserMessageItem";
import { useLayoutStore } from "@session/stores/useLayoutStore";
import { findTranscriptMatchRange } from "../thread/threadSearchHighlight";
import { NativeUserMessageContent } from "./NativeUserMessageContent";

const clipboard = vi.hoisted(() => ({
  write: vi.fn(async (_text: string, _html?: string) => {}),
}));
vi.mock("../presentation/nativeMarkdownClipboard", () => ({
  writeNativeMarkdownClipboard: clipboard.write,
}));
vi.mock("../presentation/nativeFenceHighlight", () => ({
  nativeFenceHighlight: { highlight: () => null },
}));
let width = 400,
  height = 600,
  codeBottom = 0;
const resize: Array<{ callback: ResizeObserverCallback; live: boolean }> = [];
const intersections: Array<{
  callback: IntersectionObserverCallback;
  elements: Set<Element>;
  live: boolean;
}> = [];
const message =
  Array.from({ length: 30 }, (_, i) => `Paragraph ${i + 1}`).join("\n\n") +
  "\n\n[Needle-tail](https://example.test/tail)";
const content = (text = message) => [
  { type: "text" as const, text, text_elements: [] },
];
function show(text = message, owner = "owner") {
  return (
    <div className="session-mode">
      <UserMessageItem
        content={content(text)}
        threadId={owner}
        turnId="turn"
        itemId="item"
      />
    </div>
  );
}
function resized() {
  act(() => {
    for (const observer of resize)
      if (observer.live) observer.callback([], {} as ResizeObserver);
  });
}
function intersect(target: Element, ratio: number) {
  act(() => {
    for (const observer of intersections)
      if (observer.live && observer.elements.has(target))
        observer.callback(
          [
            {
              target,
              isIntersecting: ratio > 0,
              intersectionRatio: ratio,
            } as IntersectionObserverEntry,
          ],
          {} as IntersectionObserver,
        );
  });
}
beforeEach(() => {
  width = 400;
  height = 600;
  codeBottom = 0;
  resize.length = 0;
  intersections.length = 0;
  useLayoutStore.setState({ view: "agent" });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      record: (typeof resize)[number];
      constructor(callback: ResizeObserverCallback) {
        this.record = { callback, live: true };
        resize.push(this.record);
      }
      observe() {}
      unobserve() {}
      disconnect() {
        this.record.live = false;
      }
    },
  );
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      record: (typeof intersections)[number];
      constructor(callback: IntersectionObserverCallback) {
        this.record = { callback, elements: new Set(), live: true };
        intersections.push(this.record);
      }
      observe(element: Element) {
        this.record.elements.add(element);
      }
      unobserve(element: Element) {
        this.record.elements.delete(element);
      }
      disconnect() {
        this.record.live = false;
      }
    },
  );
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(
    () => width,
  );
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(
    () => height,
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const top =
        this.matches('[data-markdown-copy="code-block"]') && codeBottom
          ? 350
          : 0;
      const bottom = top ? codeBottom : 380;
      return {
        top,
        bottom,
        left: 0,
        right: width,
        width,
        height: bottom - top,
        x: 0,
        y: top,
        toJSON() {},
      };
    },
  );
  const getStyle = window.getComputedStyle;
  vi.spyOn(window, "getComputedStyle").mockImplementation(
    (element, ...args) =>
      new Proxy(getStyle.call(window, element, ...args), {
        get(style, key) {
          return key === "fontSize"
            ? "13px"
            : key === "lineHeight"
              ? "20px"
              : Reflect.get(style, key);
        },
      }),
  );
});
afterEach(() => {
  clipboard.write.mockClear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("uses the native 20-line plus one-pixel threshold and a 19-line ellipsis disclosure", () => {
  height = 401;
  const view = render(show());
  expect(screen.queryByRole("button", { name: "显示更多" })).toBeNull();
  height = 402;
  resized();
  const more = screen.getByRole("button", { name: "显示更多" });
  expect(more.getAttribute("aria-expanded")).toBe("false");
  expect(
    view.container.querySelector<HTMLElement>(
      '[data-native-user-message-collapsed="true"]',
    )?.style.maxHeight,
  ).toBe("380px");
  expect(
    view.container.querySelector("[data-native-user-message-ellipsis]")
      ?.textContent,
  ).toBe("…");
  fireEvent.click(more);
  expect(
    screen.getByRole("button", { name: "收起" }).getAttribute("aria-expanded"),
  ).toBe("true");
  expect(
    view.container.querySelector("[data-native-user-message-ellipsis]"),
  ).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "收起" }));
  expect(screen.getByRole("button", { name: "显示更多" })).toBeTruthy();
});

it("waits for measurable width and resets expansion for changed content or owner", () => {
  width = 0;
  const view = render(show());
  expect(screen.queryByRole("button", { name: "显示更多" })).toBeNull();
  width = 130;
  resized();
  fireEvent.click(screen.getByRole("button", { name: "显示更多" }));
  view.rerender(show(message + "\n\nNew content"));
  expect(screen.getByRole("button", { name: "显示更多" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "显示更多" }));
  view.rerender(show(message + "\n\nNew content", "another-owner"));
  expect(screen.getByRole("button", { name: "显示更多" })).toBeTruthy();
});

it("keeps a code block crossing the truncation boundary fully visible", () => {
  codeBottom = 460;
  const view = render(show(message + "\n\n```text\ncode source\n```"));
  expect(
    view.container.querySelector<HTMLElement>(
      '[data-native-user-message-collapsed="true"]',
    )?.style.maxHeight,
  ).toBe("460px");
});

it("copies clipped link text and original code while keeping attachments outside the clipped region", async () => {
  const text = message + "\n\n```text\nexact code\n```";
  const view = render(
    <UserMessageItem
      content={[
        ...content(text),
        { type: "image", url: "data:image/png;base64,AA==" },
      ]}
      threadId="owner"
      turnId="turn"
      itemId="item"
    />,
  );
  const clipped = view.container.querySelector(
    '[data-native-user-message-collapsed="true"]',
  )!;
  const link = view.container.querySelector<HTMLAnchorElement>(
    'a[href="https://example.test/tail"]',
  )!;
  intersect(link, 0);
  expect(link.hasAttribute("inert")).toBe(true);
  expect(
    clipped.contains(screen.getByRole("img", { name: "Uploaded 1" })),
  ).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "复制消息" }));
  await waitFor(() => expect(clipboard.write).toHaveBeenCalledTimes(1));
  const [plain, html] = clipboard.write.mock.calls[0];
  expect(plain).toContain("Needle-tail");
  expect(plain).toContain("exact code");
  expect(html).toContain('href="https://example.test/tail"');
  expect(html).not.toContain("显示更多");
});

it("uses partial intersection for links and full intersection for other controls, restoring original state on hide", async () => {
  height = 100;
  const view = render(show(message + "\n\n```text\ncode\n```"));
  const link = screen.getByRole("link", { name: "Needle-tail" });
  link.setAttribute("aria-hidden", "false");
  height = 600;
  resized();
  intersect(link, 0.1);
  expect(link.hasAttribute("inert")).toBe(false);
  expect(link.getAttribute("aria-hidden")).toBe("false");
  const copy = view.container.querySelector<HTMLButtonElement>(
    'button[aria-label="复制代码"]',
  )!;
  intersect(copy, 0.5);
  expect(copy.hasAttribute("inert")).toBe(true);
  intersect(copy, 1);
  expect(copy.hasAttribute("inert")).toBe(false);
  intersect(link, 0);
  expect(link.getAttribute("aria-hidden")).toBe("true");
  act(() => useLayoutStore.setState({ view: "settings" }));
  await waitFor(() =>
    expect(resize.every((observer) => !observer.live)).toBe(true),
  );
  expect(intersections.every((observer) => !observer.live)).toBe(true);
  expect(link.hasAttribute("inert")).toBe(false);
  expect(link.getAttribute("aria-hidden")).toBe("false");
  act(() => useLayoutStore.setState({ view: "agent" }));
  expect(screen.getByRole("button", { name: "显示更多" })).toBeTruthy();
  view.unmount();
  expect(resize.every((observer) => !observer.live)).toBe(true);
  expect(intersections.every((observer) => !observer.live)).toBe(true);
});

it("releases observers and restores clipped descendants through StrictMode cleanup and unmount", () => {
  const view = render(<StrictMode>{show()}</StrictMode>);
  const link = view.container.querySelector<HTMLAnchorElement>(
    'a[href="https://example.test/tail"]',
  )!;
  intersect(link, 0);
  expect(link.hasAttribute("inert")).toBe(true);
  expect(screen.getByRole("button", { name: "显示更多" })).toBeTruthy();
  view.unmount();
  expect(link.hasAttribute("inert")).toBe(false);
  expect(link.hasAttribute("aria-hidden")).toBe(false);
  expect(resize.every((observer) => !observer.live)).toBe(true);
  expect(intersections.every((observer) => !observer.live)).toBe(true);
  for (const observer of resize) observer.callback([], {} as ResizeObserver);
});

it("reveals a clipped user message before finding a link occurrence", () => {
  const view = render(show());
  const link = view.container.querySelector<HTMLAnchorElement>(
    'a[href="https://example.test/tail"]',
  )!;
  intersect(link, 0);
  let range: Range | null = null;
  act(() => {
    range = findTranscriptMatchRange(view.container, "Needle-tail");
  });
  expect(range!.toString()).toBe("Needle-tail");
  expect(screen.getByRole("button", { name: "收起" })).toBeTruthy();
});

it("preserves descendants that were already inert and stops observing a hidden workbench mode", async () => {
  const view = render(
    <div className="session-mode">
      <NativeUserMessageContent text="content" identity="owner">
        <a href="#existing" inert aria-hidden="false">
          Existing inert
        </a>
        <a href="#managed">Managed link</a>
      </NativeUserMessageContent>
    </div>,
  );
  const existing = view.container.querySelector('a[href="#existing"]')!;
  const managed = view.container.querySelector('a[href="#managed"]')!;
  expect(existing.hasAttribute("inert")).toBe(true);
  expect(existing.getAttribute("aria-hidden")).toBe("false");
  intersect(managed, 0);
  const root = view.container.querySelector<HTMLElement>(".session-mode")!;
  await act(async () => {
    root.hidden = true;
  });
  await waitFor(() =>
    expect(resize.every((observer) => !observer.live)).toBe(true),
  );
  expect(intersections.every((observer) => !observer.live)).toBe(true);
  expect(managed.hasAttribute("inert")).toBe(false);
  expect(managed.hasAttribute("aria-hidden")).toBe(false);
  expect(existing.hasAttribute("inert")).toBe(true);
  expect(existing.getAttribute("aria-hidden")).toBe("false");
  view.unmount();
  expect(existing.hasAttribute("inert")).toBe(true);
});

it("uses native geometry rules when IntersectionObserver is unavailable", () => {
  vi.stubGlobal("IntersectionObserver", undefined);
  height = 100;
  const view = render(
    <div className="session-mode">
      <NativeUserMessageContent text="content" identity="owner">
        <a href="#partial">Partially visible link</a>
        <button>Partially visible control</button>
      </NativeUserMessageContent>
    </div>,
  );
  const link = view.container.querySelector("a")!;
  const button = screen.getByRole("button", {
    name: "Partially visible control",
  });
  const bounds = {
    top: 370,
    bottom: 390,
    left: 0,
    right: width,
    width,
    height: 20,
    x: 0,
    y: 370,
    toJSON() {},
  };
  Object.defineProperty(link, "getBoundingClientRect", {
    configurable: true,
    value: () => bounds,
  });
  Object.defineProperty(button, "getBoundingClientRect", {
    configurable: true,
    value: () => bounds,
  });
  height = 600;
  resized();
  expect(link.hasAttribute("inert")).toBe(false);
  expect(button.hasAttribute("inert")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "显示更多" }));
  expect(button.hasAttribute("inert")).toBe(false);
});
