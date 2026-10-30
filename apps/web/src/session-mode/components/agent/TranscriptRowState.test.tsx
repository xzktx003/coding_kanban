import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import {
  TranscriptRowState,
  useTranscriptRowBoolean,
} from "./TranscriptRowState";
afterEach(cleanup);
function Toggle() {
  const [open, change] = useTranscriptRowBoolean("tool:exact-id");
  return (
    <button aria-expanded={open} onClick={() => change((value) => !value)}>
      Tool
    </button>
  );
}
it("retains only expansion booleans across viewport unmounts and isolates another row", () => {
  const values = new Map<string, boolean>();
  const first = render(
    <TranscriptRowState row="first" values={values}>
      <Toggle />
    </TranscriptRowState>,
  );
  fireEvent.click(screen.getByRole("button"));
  expect(screen.getByRole("button").getAttribute("aria-expanded")).toBe("true");
  first.unmount();
  const restored = render(
    <TranscriptRowState row="first" values={values}>
      <Toggle />
    </TranscriptRowState>,
  );
  expect(screen.getByRole("button").getAttribute("aria-expanded")).toBe("true");
  restored.unmount();
  render(
    <TranscriptRowState row="second" values={values}>
      <Toggle />
    </TranscriptRowState>,
  );
  expect(screen.getByRole("button").getAttribute("aria-expanded")).toBe(
    "false",
  );
  expect([...values.values()]).toEqual([true]);
});
