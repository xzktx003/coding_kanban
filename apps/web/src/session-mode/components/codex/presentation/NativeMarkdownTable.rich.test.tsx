import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  NativeMarkdownSource,
  NativeMarkdownTable,
} from "./NativeMarkdownTable";
afterEach(() => vi.unstubAllGlobals());

it("copies the original Markdown plus native clean rich HTML without UI classes or private attributes", async () => {
  class Item {
    constructor(public data: Record<string, Blob>) {}
  }
  vi.stubGlobal("ClipboardItem", Item);
  const write = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { write },
  });
  const source = "| Name | Value |\n|---|---|\n| **one** | `code` |";
  render(
    <NativeMarkdownSource.Provider value={source}>
      <NativeMarkdownTable
        sourceStart={0}
        sourceEnd={source.length}
        data-ui-token="private"
      >
        <thead>
          <tr>
            <th className="fixture">Name</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <strong data-private-id="secret">one</strong>
            </td>
            <td>
              <code dir="ltr" data-streamdown="inline-code">
                code
              </code>
              <span aria-hidden="true">hidden action</span>
            </td>
          </tr>
        </tbody>
      </NativeMarkdownTable>
    </NativeMarkdownSource.Provider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "复制表格" }));
  await waitFor(() => expect(write).toHaveBeenCalledOnce());
  const data = (write.mock.calls[0][0][0] as Item).data;
  const read = (blob: Blob) =>
    new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(blob);
    });
  expect(await read(data["text/plain"])).toBe(source);
  expect(await read(data["text/html"])).toBe(
    '<table><thead><tr><th>Name</th><th>Value</th></tr></thead><tbody><tr><td><strong>one</strong></td><td><code dir="ltr">code</code></td></tr></tbody></table>',
  );
});
