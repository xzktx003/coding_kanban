import { fireEvent, render, screen } from "@testing-library/react";
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
  await screen.findByRole("button", { name: "已复制" });
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
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
  });
  render(<NativeMarkdownTable>{rows}</NativeMarkdownTable>);
  fireEvent.click(screen.getByRole("button", { name: "复制表格" }));
  expect((await screen.findByRole("alert")).textContent).toContain("denied");
  expect(screen.queryByRole("button", { name: "已复制" })).toBeNull();
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
