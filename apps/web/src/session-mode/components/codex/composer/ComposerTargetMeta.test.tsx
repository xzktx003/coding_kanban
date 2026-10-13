import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { ComposerTargetMeta } from "./ComposerTargetMeta";

it("renders the shared Session composer target in the Codex composer metadata row", () => {
  render(
    <ComposerTargetMeta
      targetLabel={
        <div className="session-input-target">
          <strong>Selected Codex conversation</strong>
        </div>
      }
    />,
  );

  expect(screen.getByText("Selected Codex conversation")).toBeTruthy();
  expect(
    screen
      .getByText("Selected Codex conversation")
      .closest(".session-compact-meta"),
  ).toBeTruthy();
});

it("does not reserve composer space without a shared target", () => {
  const { container } = render(<ComposerTargetMeta targetLabel={null} />);
  expect(container.querySelector(".session-compact-meta")).toBeNull();
});
