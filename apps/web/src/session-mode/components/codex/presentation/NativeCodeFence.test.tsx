import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NativeCodeFence } from "./NativeCodeFence";

const callbacks = vi.hoisted(() => [] as Array<(html: string) => void>);
vi.mock("./nativeFenceHighlight", () => ({
  nativeFenceHighlight: {
    highlight: (_: unknown, callback: (html: string) => void) => {
      callbacks.push(callback);
      return null;
    },
  },
}));
afterEach(() => {
  callbacks.splice(0);
  vi.restoreAllMocks();
});

it("shows source immediately and toggles native wrapping without adding line numbers", () => {
  render(<NativeCodeFence code="const example = 42;" language="typescript" />);
  expect(screen.getByText("const example = 42;")).toBeTruthy();
  const wrap = screen.getByRole("button", { name: "启用自动换行" });
  expect(wrap.getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(wrap);
  expect(
    screen
      .getByRole("button", { name: "禁用自动换行" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  expect(
    screen
      .getByText("const example = 42;")
      .closest("pre")
      ?.getAttribute("data-wrap"),
  ).toBe("true");
  expect(document.querySelector("[data-line-number]")).toBeNull();
});

it("does not let a stale highlighter return replace the current code", async () => {
  const view = render(<NativeCodeFence code="first" language="typescript" />);
  view.rerender(<NativeCodeFence code="second" language="typescript" />);
  act(() => callbacks[0]('<span style="color:red">first</span>'));
  expect(screen.getByText("second")).toBeTruthy();
  expect(screen.queryByText("first")).toBeNull();
  act(() => callbacks[1]('<span style="color:blue">second</span>'));
  await waitFor(() =>
    expect(screen.getByText("second").style.color).toBe("blue"),
  );
});

it("copies the captured code and reports a rejected clipboard operation truthfully", async () => {
  const writeText = vi.fn().mockRejectedValue(new Error("Clipboard denied"));
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  render(<NativeCodeFence code={"exact source\n"} language="text" />);
  fireEvent.click(screen.getByRole("button", { name: "复制" }));
  await screen.findByRole("alert");
  expect(writeText).toHaveBeenCalledWith("exact source\n");
  expect(screen.queryByRole("button", { name: "已复制" })).toBeNull();
});

it("keeps source download reachable from the compact native menu", async () => {
  const createObjectURL = vi.fn(() => "blob:fixture"),
    revokeObjectURL = vi.fn();
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: createObjectURL,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: revokeObjectURL,
  });
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => {});
  render(<NativeCodeFence code="source" language="typescript" />);
  fireEvent.keyDown(screen.getByRole("button", { name: "代码块更多操作" }), {
    key: "ArrowDown",
  });
  fireEvent.click(await screen.findByRole("menuitem", { name: "下载代码" }));
  expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
  expect(click).toHaveBeenCalledOnce();
});
