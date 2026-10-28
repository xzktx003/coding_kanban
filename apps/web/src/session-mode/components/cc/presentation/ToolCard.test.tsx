import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import {
  FileLink,
  SecondaryLine,
  ToolBody,
  ToolHeader,
  ToolInputRow,
  ToolOutputRow,
} from "./ToolCard";
import { OPEN_IN_EDITOR_HINT } from "./primitives";

// Ground truth: docs/designs/claude-render-alignment/tool-card-contract-20261027.md §1

test("the IN row is omitted for empty input", () => {
  // Official: `if (J && Object.keys(J).length > 0)`
  const { container: empty } = render(
    <ToolInputRow input={{}} toolName="Bash" />,
  );
  expect(empty.querySelector(".claude-tool-body-row")).toBeNull();

  const { container: missing } = render(
    <ToolInputRow input={undefined} toolName="Bash" />,
  );
  expect(missing.querySelector(".claude-tool-body-row")).toBeNull();
});

test("the IN row dumps pretty-printed JSON under an IN label", () => {
  const { container } = render(
    <ToolInputRow input={{ a: 1 }} toolName="Bash" />,
  );
  expect(
    container.querySelector(".claude-tool-body-row-label")?.textContent,
  ).toBe("IN");
  expect(container.querySelector("pre")?.textContent).toBe('{\n  "a": 1\n}');
});

test("small content is not clickable, big content opens in an editor tab", () => {
  const openContent = vi.fn();

  // Small input: inert, no hint, no tabindex.
  const { container: small } = render(
    <ToolInputRow input={{ a: 1 }} toolName="Bash" context={{ openContent }} />,
  );
  const smallRegion = small.querySelector(".claude-tool-body-row-content")!;
  expect(smallRegion.getAttribute("tabindex")).toBeNull();
  fireEvent.click(smallRegion);
  expect(openContent).not.toHaveBeenCalled();

  // Big input (>250 chars): activatable, carries the official hint.
  const { container: big } = render(
    <ToolInputRow
      input={{ a: "x".repeat(300) }}
      toolName="Bash"
      context={{ openContent }}
    />,
  );
  const bigRegion = big.querySelector(".claude-tool-body-row-content")!;
  expect(bigRegion.getAttribute("aria-description")).toBe(OPEN_IN_EDITOR_HINT);
  fireEvent.click(bigRegion);
  expect(openContent).toHaveBeenCalledTimes(1);
  expect(openContent.mock.calls[0][1]).toBe("Bash tool input");
});

test("the OUT row titles the editor tab with the tool name", () => {
  const openContent = vi.fn();
  const { container } = render(
    <ToolOutputRow
      text={"line\n".repeat(10)}
      toolName="Grep"
      context={{ openContent }}
    />,
  );
  expect(
    container.querySelector(".claude-tool-body-row-label")?.textContent,
  ).toBe("OUT");
  fireEvent.click(container.querySelector(".claude-tool-body-row-content")!);
  expect(openContent.mock.calls[0][1]).toBe("Grep tool output");
});

test("an empty OUT row renders nothing", () => {
  const { container } = render(<ToolOutputRow text="" toolName="Grep" />);
  expect(container.querySelector(".claude-tool-body-row")).toBeNull();
});

test("the body wrapper is omitted when there are no rows", () => {
  // Official: `(Q || z) && <div class={toolBody}>…`. Header-only cards must
  // not render empty body chrome.
  const { container } = render(<ToolBody>{[null, null]}</ToolBody>);
  expect(container.querySelector(".claude-tool-body")).toBeNull();
  expect(container.querySelector(".claude-tool-body-grid")).toBeNull();
});

test("the body wrapper appears once a row is present", () => {
  const { container } = render(
    <ToolBody>
      <ToolInputRow input={{ a: 1 }} toolName="Bash" />
    </ToolBody>,
  );
  expect(container.querySelector(".claude-tool-body-grid")).not.toBeNull();
});

test("a description renders as a secondary line above the grid", () => {
  const { container } = render(
    <ToolBody description="Allowed: example.com">{null}</ToolBody>,
  );
  expect(container.querySelector(".claude-secondary-line")?.textContent).toBe(
    "Allowed: example.com",
  );
});

test("the header separates primary and secondary styling", () => {
  const { container } = render(
    <ToolHeader name="Grep" secondary={'"pattern"'} />,
  );
  expect(container.querySelector(".claude-tool-name-text")?.textContent).toBe(
    "Grep",
  );
  expect(
    container.querySelector(".claude-tool-name-text-secondary")?.textContent,
  ).toBe('"pattern"');
});

test("the header can opt into the plaintext secondary style", () => {
  // Bash uses `toolNameTextSecondaryPlaintext` for its description.
  const { container } = render(
    <ToolHeader name="Bash " secondary="list files" secondaryPlaintext />,
  );
  expect(
    container.querySelector(".claude-tool-name-text-secondary-plaintext")
      ?.textContent,
  ).toBe("list files");
  expect(
    container.querySelector(".claude-tool-name-text-secondary"),
  ).toBeNull();
});

test("a file link shows the basename and opens the file", () => {
  const onOpen = vi.fn();
  render(<FileLink path="/project/src/deep/file.ts" onOpen={onOpen} />);
  const link = screen.getByRole("link", { name: "file.ts" });
  fireEvent.click(link);
  expect(onOpen).toHaveBeenCalledTimes(1);
});

test("a file link without a handler is plain text, not an anchor", () => {
  render(<FileLink path="/project/file.ts" />);
  expect(screen.queryByRole("link")).toBeNull();
  expect(screen.getByText("file.ts")).toBeTruthy();
});

test("clicking a file link inside an activatable row does not also open the row", () => {
  // This is the nested-interactive guard in `GW` applied to a real card:
  // the file link must win over the row's open-in-editor affordance.
  const openContent = vi.fn();
  const onOpen = vi.fn();
  const { container } = render(
    <ToolOutputRow
      text={"x".repeat(300)}
      toolName="Read"
      context={{ openContent }}
    >
      <FileLink path="/project/file.ts" onOpen={onOpen} />
    </ToolOutputRow>,
  );
  fireEvent.click(screen.getByRole("link", { name: "file.ts" }));
  expect(onOpen).toHaveBeenCalledTimes(1);
  expect(openContent).not.toHaveBeenCalled();

  // The row itself still opens when clicked directly.
  fireEvent.click(container.querySelector(".claude-tool-body-row-content")!);
  expect(openContent).toHaveBeenCalledTimes(1);
});

test("a row can disable clipping, as NotebookEdit does", () => {
  const { container } = render(
    <ToolOutputRow text="src" toolName="NotebookEdit" />,
  );
  expect(
    container
      .querySelector(".claude-tool-body-row-content")
      ?.className.includes("unclipped"),
  ).toBe(false);
});

test("the secondary line exposes an expanded state when interactive", () => {
  const onClick = vi.fn();
  const { container } = render(
    <SecondaryLine onClick={onClick} expanded>
      Explored 3
    </SecondaryLine>,
  );
  const line = container.querySelector(".claude-secondary-line")!;
  expect(line.getAttribute("aria-expanded")).toBe("true");
  fireEvent.keyDown(line, { key: "Enter" });
  expect(onClick).toHaveBeenCalledTimes(1);
});
