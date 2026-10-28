import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import {
  isBigContent,
  OPEN_IN_EDITOR_HINT,
  activatable,
  toOutputText,
} from "./primitives";

// Ground truth: docs/designs/claude-render-alignment/tool-card-contract-20261027.md §2

test("big-content threshold matches the official rule", () => {
  // entry.js:3315 — `$.length > 250 || $.split("\n").length > 3`
  expect(isBigContent("a".repeat(250))).toBe(false);
  expect(isBigContent("a".repeat(251))).toBe(true);
  expect(isBigContent("1\n2\n3")).toBe(false);
  expect(isBigContent("1\n2\n3\n4")).toBe(true);
  expect(isBigContent("")).toBe(false);
});

test("the open-in-editor hint is the official sentence", () => {
  // entry.js:3314
  expect(OPEN_IN_EDITOR_HINT).toBe(
    "Press Enter to open the full text in an editor tab",
  );
});

test("activatable returns no props when there is no handler", () => {
  // `GW` returns {} for an undefined handler, so the region stays inert.
  expect(activatable(undefined)).toEqual({});
});

test("activating a region fires the handler and exposes the hint", () => {
  const onActivate = vi.fn();
  render(
    <div data-testid="region" {...activatable(onActivate)}>
      content
    </div>,
  );
  const region = screen.getByTestId("region");
  expect(region.getAttribute("tabindex")).toBe("0");
  expect(region.getAttribute("aria-description")).toBe(OPEN_IN_EDITOR_HINT);

  fireEvent.click(region);
  expect(onActivate).toHaveBeenCalledTimes(1);
});

test("clicking a nested button does not activate the outer region", () => {
  // The official handler bails when the click lands on a nested
  // button/[role=button]/a[href] that is not the region itself.
  const onActivate = vi.fn();
  render(
    <div data-testid="region" {...activatable(onActivate)}>
      <button type="button">inner</button>
      <a href="https://example.test">link</a>
    </div>,
  );

  fireEvent.click(screen.getByRole("button", { name: "inner" }));
  expect(onActivate).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("link", { name: "link" }));
  expect(onActivate).not.toHaveBeenCalled();

  fireEvent.click(screen.getByTestId("region"));
  expect(onActivate).toHaveBeenCalledTimes(1);
});

test("Enter and Space activate, and a held key does not repeat", () => {
  const onActivate = vi.fn();
  render(
    <div data-testid="region" {...activatable(onActivate)}>
      content
    </div>,
  );
  const region = screen.getByTestId("region");

  fireEvent.keyDown(region, { key: "Enter" });
  fireEvent.keyDown(region, { key: " " });
  expect(onActivate).toHaveBeenCalledTimes(2);

  // `if (!J.repeat)` — holding the key must not fire repeatedly.
  fireEvent.keyDown(region, { key: "Enter", repeat: true });
  expect(onActivate).toHaveBeenCalledTimes(2);

  // Other keys are ignored.
  fireEvent.keyDown(region, { key: "a" });
  expect(onActivate).toHaveBeenCalledTimes(2);
});

test("key events originating inside a child do not activate the region", () => {
  // `if (J.target !== J.currentTarget) return`
  const onActivate = vi.fn();
  render(
    <div data-testid="region" {...activatable(onActivate)}>
      <input data-testid="inner" />
    </div>,
  );
  fireEvent.keyDown(screen.getByTestId("inner"), { key: "Enter" });
  expect(onActivate).not.toHaveBeenCalled();
});

test("output text extraction mirrors toOutputContent", () => {
  // text and tool_result carry text; every other block type yields "".
  expect(toOutputText({ type: "text", text: "hello" })).toBe("hello");
  expect(
    toOutputText({ type: "tool_result", tool_use_id: "t", content: "out" }),
  ).toBe("out");
  expect(
    toOutputText({
      type: "tool_result",
      tool_use_id: "t",
      content: [
        { type: "text", text: "a" },
        { type: "text", text: "b" },
      ],
    }),
  ).toBe("a\nb");
  expect(
    toOutputText({
      type: "image",
      source: { type: "url", url: "https://example.test/x.png" },
    }),
  ).toBe("");
  // Nested non-text blocks are dropped, not stringified.
  expect(
    toOutputText({
      type: "tool_result",
      tool_use_id: "t",
      content: [
        { type: "text", text: "kept" },
        { type: "image", source: { type: "url", url: "u" } },
      ],
    }),
  ).toBe("kept");
});
