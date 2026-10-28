import { render } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { CCMessageBlock } from "../session/messages/CCMessageBlock";
import type { ToolResultBlock, ToolUseBlock } from "../types/messages";

// The presentation layer must actually drive the transcript, not sit beside
// it. These assertions fail if CCMessageBlock still renders the legacy
// per-tool components for aligned tools.
//
// Ground truth: docs/designs/claude-render-alignment/tool-card-contract-20261027.md

vi.mock("@session/stores/settings", () => ({
  useCCSettingsStore: () => ({ enabledThinking: true }),
}));

const use = (
  name: string,
  input: Record<string, unknown> = {},
): ToolUseBlock => ({ type: "tool_use", id: "tu-1", name, input });

const ok = (content: string): ToolResultBlock => ({
  type: "tool_result",
  tool_use_id: "tu-1",
  content,
});

test("a Bash tool call renders through the aligned card", () => {
  const { container } = render(
    <CCMessageBlock
      block={use("Bash", { command: "ls -la", description: "List files" })}
      index={0}
    />,
  );
  // The aligned shell, not the legacy Badge-based markup.
  expect(container.querySelector(".claude-tool-card")).not.toBeNull();
  expect(container.querySelector(".claude-tool-name-text")?.textContent).toBe(
    "Bash ",
  );
  expect(
    container.querySelector(".claude-tool-name-text-secondary-plaintext")
      ?.textContent,
  ).toBe("List files");
});

test("a Read tool call renders header-only inside the transcript", () => {
  const { container } = render(
    <CCMessageBlock
      block={use("Read", { file_path: "/project/src/app.ts" })}
      index={0}
    />,
  );
  expect(container.querySelector(".claude-tool-card")).not.toBeNull();
  expect(container.textContent).toContain("app.ts");
  expect(container.querySelector(".claude-tool-body")).toBeNull();
});

test("ToolSearch stays hidden when rendered through the transcript", () => {
  const { container } = render(
    <CCMessageBlock block={use("ToolSearch", { query: "x" })} index={0} />,
  );
  // hidden = true must survive the integration, not just the unit.
  expect(container.querySelector(".claude-tool-card")).toBeNull();
  expect(container.textContent).toBe("");
});

test("an unknown tool keeps its raw name in the transcript", () => {
  const { container } = render(
    <CCMessageBlock block={use("BrandNewTool", { a: 1 })} index={0} />,
  );
  expect(container.querySelector(".claude-tool-name-text")?.textContent).toBe(
    "BrandNewTool",
  );
});

test("an MCP tool renders the humanized server name", () => {
  const { container } = render(
    <CCMessageBlock
      block={use("mcp__github__search_issues", { query: "is:open" })}
      index={0}
    />,
  );
  expect(container.querySelector(".claude-tool-name-text")?.textContent).toBe(
    "GitHub [search_issues]",
  );
});

test("a tool result is passed into the card so summaries can use it", () => {
  const { container } = render(
    <CCMessageBlock
      block={use("Grep", { pattern: "TODO" })}
      index={0}
      result={ok("a.ts:1\nb.ts:4")}
    />,
  );
  expect(container.querySelector(".claude-secondary-line")?.textContent).toBe(
    "2 lines of output",
  );
});

test("redacted thinking is rendered, not reported as unsupported", () => {
  // Deliberate, documented divergence: the official webview has no branch for
  // this block type and falls through to "Unsupported content type".
  const { container } = render(
    <CCMessageBlock
      block={{ type: "redacted_thinking" } as never}
      index={0}
    />,
  );
  expect(container.textContent).not.toContain("Unsupported content type");
  expect(container.textContent).toContain("Thinking");
});
