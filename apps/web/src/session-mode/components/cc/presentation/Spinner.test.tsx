import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { DateDivider, MessageTimestamp, Spinner } from "./Spinner";
import { SPINNER_FRAMES, SPINNER_FRAME_MS } from "./stream";

// Ground truth: docs/designs/claude-render-alignment/message-stream-contract-20261027.md §4, §6

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

test("the spinner advances one glyph per official frame interval", () => {
  const { container } = render(<Spinner verb="Working" />);
  const glyph = () =>
    container.querySelector(".claude-spinner-glyph")!.textContent;

  expect(glyph()).toBe(SPINNER_FRAMES[0]);
  act(() => void vi.advanceTimersByTime(SPINNER_FRAME_MS));
  expect(glyph()).toBe(SPINNER_FRAMES[1]);
  act(() => void vi.advanceTimersByTime(SPINNER_FRAME_MS));
  expect(glyph()).toBe(SPINNER_FRAMES[2]);
});

test("the glyph cycle wraps after twelve frames", () => {
  const { container } = render(<Spinner verb="Working" />);
  act(() => void vi.advanceTimersByTime(SPINNER_FRAME_MS * 12));
  expect(container.querySelector(".claude-spinner-glyph")!.textContent).toBe(
    SPINNER_FRAMES[0],
  );
});

test("the verb is rendered with the official trailing ellipsis", () => {
  render(<Spinner verb="Pondering" />);
  expect(screen.getByText("Pondering...")).toBeTruthy();
});

test("a status verb overrides the random one", () => {
  // Compacting must not be hidden behind a whimsical verb.
  render(<Spinner status="compacting" verb="Pondering" />);
  expect(screen.getByText("Compacting...")).toBeTruthy();
  expect(screen.queryByText("Pondering...")).toBeNull();
});

test("hook verbs override too", () => {
  render(<Spinner status="startup_hooks" verb="Pondering" />);
  expect(screen.getByText("Running start-up hooks...")).toBeTruthy();
});

test("the glyph color follows the permission mode", () => {
  const { container: plan } = render(
    <Spinner verb="W" permissionMode="plan" />,
  );
  expect(
    plan.querySelector(".claude-spinner-glyph")!.className,
  ).toContain("claude-spinner-plan");

  const { container: danger } = render(
    <Spinner verb="W" permissionMode="bypassPermissions" />,
  );
  expect(
    danger.querySelector(".claude-spinner-glyph")!.className,
  ).toContain("claude-spinner-danger");
});

test("the spinner is announced as a status region", () => {
  const { container } = render(<Spinner verb="W" />);
  expect(container.querySelector('[role="status"]')).not.toBeNull();
  // The glyph itself is decorative; the verb carries the meaning.
  expect(
    container.querySelector(".claude-spinner-glyph")!.getAttribute("aria-hidden"),
  ).toBe("true");
});

test("reduced motion pins the glyph instead of animating", () => {
  const original = window.matchMedia;
  window.matchMedia = ((query: string) =>
    ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
  try {
    const { container } = render(<Spinner verb="W" />);
    const glyph = () =>
      container.querySelector(".claude-spinner-glyph")!.textContent;
    // The official reduced-motion glyph, not simply frame 0.
    expect(glyph()).toBe("✻");
    act(() => void vi.advanceTimersByTime(SPINNER_FRAME_MS * 5));
    expect(glyph()).toBe("✻");
  } finally {
    window.matchMedia = original;
  }
});

test("a custom verb list replaces the defaults", () => {
  render(
    <Spinner verbSetting={{ mode: "replace", verbs: ["Yakking"] }} />,
  );
  expect(screen.getByText("Yakking...")).toBeTruthy();
});

test("the timestamp shows the short form and carries the full one", () => {
  const date = new Date("2026-01-05T15:45:30Z");
  const { container } = render(
    <MessageTimestamp date={date} timeZone="UTC" />,
  );
  const time = container.querySelector("time")!;
  expect(time.textContent).toBe("3:45 PM");
  expect(time.getAttribute("title")).toBe("2026-01-05 15:45:30");
  expect(time.getAttribute("datetime")).toBe(date.toISOString());
  expect(container.querySelector("[data-message-stamp]")).not.toBeNull();
});

test("the timestamp placement distinguishes prompt from response", () => {
  const date = new Date("2026-01-05T15:45:30Z");
  const { container: response } = render(
    <MessageTimestamp date={date} timeZone="UTC" />,
  );
  expect(
    response.querySelector(".claude-message-stamp-response"),
  ).not.toBeNull();

  const { container: prompt } = render(
    <MessageTimestamp date={date} placement="prompt" timeZone="UTC" />,
  );
  expect(prompt.querySelector(".claude-message-stamp-prompt")).not.toBeNull();
});

test("the date divider labels the day and omits the current year", () => {
  const { container } = render(
    <DateDivider
      date={new Date("2026-01-05T12:00:00Z")}
      now={new Date("2026-06-01T12:00:00Z")}
      timeZone="UTC"
    />,
  );
  expect(
    container.querySelector(".claude-date-divider-label")!.textContent,
  ).toBe("Mon, Jan 5");
  expect(container.querySelector('[role="separator"]')).not.toBeNull();
  // Decorative waves flank the label.
  expect(container.querySelectorAll(".claude-date-divider-wave")).toHaveLength(
    2,
  );
});

test("the date divider shows a year outside the current one", () => {
  const { container } = render(
    <DateDivider
      date={new Date("2026-01-05T12:00:00Z")}
      now={new Date("2027-06-01T12:00:00Z")}
      timeZone="UTC"
    />,
  );
  expect(
    container.querySelector(".claude-date-divider-label")!.textContent,
  ).toContain("2026");
});
