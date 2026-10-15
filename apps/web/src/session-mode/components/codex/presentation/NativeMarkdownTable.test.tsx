import { nativeNotifications } from "@session/features/native-notifications/service";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  NativeMarkdownTable,
  serializeNativeTable,
} from "./NativeMarkdownTable";

afterEach(() => vi.restoreAllMocks());
const rows = (
  <>
    <thead>
      <tr>
        <th>Name</th>
        <th>Value</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>one, two</td>
        <td>"quoted"</td>
      </tr>
      <tr>
        <td>last</td>
        <td>value</td>
      </tr>
    </tbody>
  </>
);

it("copies the actual table contents and keeps exports reachable without an extra toolbar row", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  render(<NativeMarkdownTable>{rows}</NativeMarkdownTable>);
  fireEvent.click(screen.getByRole("button", { name: "复制表格" }));
  await screen.findByRole("button", { name: "已复制代码" });
  expect(writeText).toHaveBeenCalledWith(
    '| Name | Value |\n| --- | --- |\n| one, two | "quoted" |\n| last | value |',
  );
  fireEvent.keyDown(screen.getByRole("button", { name: "表格更多操作" }), {
    key: "ArrowDown",
  });
  fireEvent.click(await screen.findByRole("menuitem", { name: "复制 · CSV" }));
  expect(writeText).toHaveBeenLastCalledWith(
    'Name,Value\n"one, two","""quoted"""\nlast,value',
  );
  expect(
    document
      .querySelector(".codex-native-table-actions")
      ?.getAttribute("data-markdown-copy"),
  ).toBe("exclude");
});

it("does not report a failed table clipboard write as copied", async () => {
  const danger = vi.spyOn(nativeNotifications, "danger");
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
  });
  render(<NativeMarkdownTable>{rows}</NativeMarkdownTable>);
  fireEvent.click(screen.getByRole("button", { name: "复制表格" }));
  await waitFor(() =>
    expect(danger).toHaveBeenCalledWith("无法复制到剪贴板", {
      id: "copy-to-clipboard-error",
      description: "内容未复制。请在 ChatGPT 处于焦点时重试",
    }),
  );
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByRole("button", { name: "已复制代码" })).toBeNull();
});

it("serializes CSV quotes and Markdown pipes from cells rather than rendered controls", () => {
  const { container } = render(
    <table>
      <tbody>
        <tr>
          <td>a|b</td>
          <td>first{"\n"}second</td>
        </tr>
      </tbody>
    </table>,
  );
  const table = container.querySelector("table")!;
  expect(serializeNativeTable(table, "markdown")).toBe(
    "| a\\|b | first<br>second |\n| --- | --- |",
  );
  expect(serializeNativeTable(table, "tsv")).toBe('a|b\t"first\nsecond"');
});

it("scrolls an overflowing table when the native copy control has keyboard focus", () => {
  const { container } = render(
    <NativeMarkdownTable>{rows}</NativeMarkdownTable>,
  );
  const scroller = container.querySelector(".codex-native-table-scroller")!;
  Object.defineProperties(scroller, {
    scrollWidth: { value: 1200 },
    clientWidth: { value: 300 },
  });
  const scrollBy = vi.fn();
  Object.defineProperty(scroller, "scrollBy", { value: scrollBy });
  fireEvent.keyDown(screen.getByRole("button", { name: "复制表格" }), {
    key: "ArrowRight",
  });
  expect(scrollBy).toHaveBeenCalledWith({ left: 40 });
  scrollBy.mockClear();
  vi.spyOn(navigator, "platform", "get").mockReturnValue("Linux x86_64");
  fireEvent.keyDown(screen.getByRole("button", { name: "复制表格" }), {
    key: "ArrowRight",
    altKey: true,
  });
  expect(scrollBy).not.toHaveBeenCalled();
  vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  fireEvent.keyDown(screen.getByRole("button", { name: "复制表格" }), {
    key: "ArrowRight",
    altKey: true,
  });
  expect(scrollBy).toHaveBeenCalledWith({ left: 300 });
});

it("locks repeated default copy requests while permission is pending and shows native busy attributes", async () => {
  let finish!: () => void;
  const writeText = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  render(<NativeMarkdownTable>{rows}</NativeMarkdownTable>);
  const button = screen.getByRole("button", { name: "复制表格" });
  fireEvent.click(button);
  expect(button.getAttribute("aria-busy")).toBe("true");
  fireEvent.click(button);
  expect(writeText).toHaveBeenCalledTimes(1);
  await act(async () => finish());
  fireEvent.click(screen.getByRole("button", { name: "已复制代码" }));
  expect(writeText).toHaveBeenCalledTimes(1);
});

it("sizes each column using its longest rendered header or cell, including native size boundaries", () => {
  const values = [40, 41, 100, 101, 160, 161];
  const view = render(
    <NativeMarkdownTable>
      <thead>
        <tr>
          {values.map((n) => (
            <th key={n}>Name</th>
          ))}
        </tr>
      </thead>
      <tbody>
        <tr>
          {values.map((n) => (
            <td key={n}>{"x".repeat(n)}</td>
          ))}
        </tr>
      </tbody>
    </NativeMarkdownTable>,
  );
  expect(
    [...view.container.querySelectorAll("td")].map((cell) =>
      cell.getAttribute("data-col-size"),
    ),
  ).toEqual(["sm", "md", "md", "lg", "lg", "xl"]);
  expect(
    [...view.container.querySelectorAll("th")].map((cell) =>
      cell.getAttribute("data-col-size"),
    ),
  ).toEqual(["sm", "md", "md", "lg", "lg", "xl"]);
});

it("isolates table direction and marks only digits as native unwrapped numeric cells", () => {
  const values = ["0", "123456", "-1", "1.5", "1 2"];
  const view = render(
    <NativeMarkdownTable>
      <tbody>
        <tr>
          {values.map((value) => (
            <td key={value}>{value}</td>
          ))}
        </tr>
      </tbody>
    </NativeMarkdownTable>,
  );
  expect(
    [...view.container.querySelectorAll("td")].map((cell) =>
      cell.hasAttribute("data-numeric-cell"),
    ),
  ).toEqual([true, true, false, false, false]);
  expect(view.container.querySelector("table")?.getAttribute("dir")).toBe(
    "auto",
  );
  expect(
    [...view.container.querySelectorAll("td")].every(
      (cell) => cell.getAttribute("dir") === "auto",
    ),
  ).toBe(true);
});

it("does not bubble a default copy request into its containing message", async () => {
  const parent = vi.fn();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
  render(
    <div onClick={parent}>
      <NativeMarkdownTable>{rows}</NativeMarkdownTable>
    </div>,
  );
  fireEvent.click(screen.getByRole("button", { name: "复制表格" }));
  await screen.findByRole("button", { name: "已复制代码" });
  expect(parent).not.toHaveBeenCalled();
});

it("leaves keys on the scrolling region to the browser like the native Eui region", () => {
  const { container } = render(
    <NativeMarkdownTable>{rows}</NativeMarkdownTable>,
  );
  const scroller = container.querySelector(".codex-native-table-scroller")!;
  Object.defineProperties(scroller, {
    scrollWidth: { value: 1200 },
    clientWidth: { value: 300 },
  });
  const scrollBy = vi.fn();
  Object.defineProperty(scroller, "scrollBy", { value: scrollBy });
  const event = new KeyboardEvent("keydown", {
    key: "ArrowRight",
    bubbles: true,
    cancelable: true,
  });
  fireEvent(scroller, event);
  expect(event.defaultPrevented).toBe(false);
  expect(scrollBy).not.toHaveBeenCalled();
});

it("counts React child text like native HU without reading an opaque widget's generated label", () => {
  function Label({ value }: { value: string }) {
    return <span>{value}</span>;
  }
  const view = render(
    <NativeMarkdownTable>
      <thead>
        <tr>
          <th>Name</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <Label value={"x".repeat(161)} />
          </td>
        </tr>
      </tbody>
    </NativeMarkdownTable>,
  );
  expect(
    view.container.querySelector("td")?.getAttribute("data-col-size"),
  ).toBe("sm");
});

it("keeps copy success when only hint or favicon UI attributes change while permission is pending", async () => {
  let finish!: () => void;
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    },
  });
  const view = render(<NativeMarkdownTable>{rows}</NativeMarkdownTable>);
  fireEvent.click(screen.getByRole("button", { name: "复制表格" }));
  view.container.querySelector("td")!.setAttribute("data-state", "open");
  await act(async () => finish());
  expect(screen.queryByRole("button", { name: "已复制代码" })).not.toBeNull();
});

it("does not mark replacement rows copied after an older permission request completes", async () => {
  let finish!: () => void;
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    },
  });
  const view = render(<NativeMarkdownTable>{rows}</NativeMarkdownTable>);
  fireEvent.click(screen.getByRole("button", { name: "复制表格" }));
  view.rerender(
    <NativeMarkdownTable>
      <tbody>
        <tr>
          <td>New contents</td>
        </tr>
      </tbody>
    </NativeMarkdownTable>,
  );
  await act(async () => finish());
  expect(screen.queryByRole("button", { name: "已复制代码" })).toBeNull();
});
