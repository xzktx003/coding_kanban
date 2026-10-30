import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { DeferredCodexMarkdown } from "./DeferredCodexMarkdown";

vi.mock("./CodexMarkdown", () => new Promise(() => {}));

it("retains queue text and the composer while the optional Markdown module is pending", () => {
  render(
    <>
      <DeferredCodexMarkdown
        value="Exact queued **text**"
        threadId="owner"
        headingAsText
      />
      <textarea aria-label="composer" />
    </>,
  );
  expect(screen.getByText("Exact queued **text**")).toBeTruthy();
  expect(screen.getByRole("textbox", { name: "composer" })).toBeTruthy();
});
