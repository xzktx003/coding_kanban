import { expect, it } from "vitest";
import { formatNativeToolMessage } from "./nativeToolMessage";
it("formats native nested selector and plural templates without interpreting public parameter text as a template", () => {
  expect(
    formatNativeToolMessage(
      "{state, select, active{Creating {count, plural, =0 {no pages} one {a page} other {{count, number} pages}}} other {Done}}",
      { state: "active", count: 1001 },
      "en",
    ),
  ).toBe("Creating 1,001 pages");
  expect(
    formatNativeToolMessage(
      'Searching "{query}"',
      { query: "literal {owner}" },
      "en",
    ),
  ).toBe('Searching "literal {owner}"');
  expect(
    formatNativeToolMessage(
      "{count, plural, one {# item} other {# items}}",
      { count: 1 },
      "en",
    ),
  ).toBe("1 item");
  expect(
    formatNativeToolMessage("'{literal}' {name}", { name: "Visible" }, "en"),
  ).toBe("{literal} Visible");
});
