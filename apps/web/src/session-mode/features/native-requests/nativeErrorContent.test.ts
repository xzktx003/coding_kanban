import { expect, it } from "vitest";
import {
  nativeErrorMessage,
  nativeErrorParts,
  nativeRetryIsOverloaded,
} from "./nativeErrorContent";

it("matches the native 429/overload classification without treating unknown failures as capacity errors", () => {
  expect(nativeRetryIsOverloaded("serverOverloaded")).toBe(true);
  expect(
    nativeRetryIsOverloaded({
      responseStreamDisconnected: { httpStatusCode: 429 },
    }),
  ).toBe(true);
  expect(
    nativeRetryIsOverloaded({
      responseStreamDisconnected: { httpStatusCode: null },
    }),
  ).toBe(false);
  expect(
    nativeRetryIsOverloaded({ responseStreamDisconnected: null } as any),
  ).toBe(false);
});

it.each([
  "**https://example.invalid/strong**",
  "_https://example.invalid/em_",
  "~~https://example.invalid/del~~",
])("keeps native top-level formatting token literal: %s", (message) => {
  const parts = nativeErrorParts(message);
  expect(parts.map((part) => part.text).join("")).toBe(message);
  expect(parts.some((part) => part.href)).toBe(false);
});

it("keeps legitimate bare URLs with underscores and unpaired markers clickable", () => {
  const message =
    "**unclosed https://example.invalid/a_b_c ~~unclosed https://example.invalid/two";
  expect(
    nativeErrorParts(message)
      .filter((part) => part.href)
      .map((part) => part.text),
  ).toEqual(["https://example.invalid/a_b_c", "https://example.invalid/two"]);
});

it("unwraps only the real native error.message envelope and preserves other payloads", () => {
  expect(
    nativeErrorMessage('{"error":{"message":"exact native message"}}'),
  ).toBe("exact native message");
  expect(nativeErrorMessage('{"message":"other payload"}')).toBe(
    '{"message":"other payload"}',
  );
  expect(nativeErrorMessage('{"error":{"message":false}}')).toBe(
    '{"error":{"message":false}}',
  );
});
