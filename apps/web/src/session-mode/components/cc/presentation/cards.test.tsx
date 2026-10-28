import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { ToolCardView, cardFor } from "./cards";
import type { ToolResultBlock, ToolUseBlock } from "../types/messages";

// Ground truth: docs/designs/claude-render-alignment/tool-card-contract-20261027.md §4

const use = (name: string, input: Record<string, unknown> = {}): ToolUseBlock => ({
  type: "tool_use",
  id: "tu-1",
  name,
  input,
});

const ok = (content: unknown): ToolResultBlock => ({
  type: "tool_result",
  tool_use_id: "tu-1",
  content: content as ToolResultBlock["content"],
});

const err = (content: string): ToolResultBlock => ({
  type: "tool_result",
  tool_use_id: "tu-1",
  content,
  is_error: true,
});

function view(block: ToolUseBlock, result?: ToolResultBlock | null, context?: object) {
  return render(
    <ToolCardView block={block} result={result} context={context as never} />,
  );
}

// ------------------------------------------------- header-only cards

test("Read renders a header-only card with no body at all", () => {
  // Official zT1.body returns null — any body chrome here is wrong.
  const { container } = view(use("Read", { file_path: "/p/a/file.ts" }));
  expect(container.querySelector(".claude-tool-name-text")?.textContent).toBe(
    "Read ",
  );
  expect(screen.getByText("file.ts")).toBeTruthy();
  expect(container.querySelector(".claude-tool-body")).toBeNull();
  expect(container.querySelector(".claude-tool-body-grid")).toBeNull();
});

test("Read keeps a body-free card even when a result arrives", () => {
  const { container } = view(
    use("Read", { file_path: "/p/file.ts" }),
    ok("1\tconst a = 1;\n2\tconst b = 2;"),
  );
  expect(container.querySelector(".claude-tool-body")).toBeNull();
});

test("Read shows the line range and opens at the right line", () => {
  const openFile = vi.fn();
  const { container } = view(
    use("Read", { file_path: "/p/file.ts", offset: 9, limit: 20 }),
    null,
    { openFile },
  );
  expect(container.textContent).toContain("(lines 10-29)");
  fireEvent.click(screen.getByRole("link", { name: "file.ts" }));
  expect(openFile).toHaveBeenCalledWith("/p/file.ts", {
    startLine: 10,
    endLine: 29,
  });
});

test("Skill is header-only and strips the leading slash", () => {
  const { container } = view(use("Skill", { skill: "/code-review" }));
  expect(container.querySelector(".claude-tool-name-text")?.textContent).toBe(
    "code-review",
  );
  expect(
    container.querySelector(".claude-tool-name-text-secondary")?.textContent,
  ).toBe(" skill");
  expect(container.querySelector(".claude-tool-body")).toBeNull();
});

test("ReadCoalesced lists every file and renders no body", () => {
  const openFile = vi.fn();
  const { container } = view(
    use("ReadCoalesced", {
      fileReads: [
        { file_path: "/p/a.ts" },
        { file_path: "/p/b.ts", offset: 4 },
      ],
    }),
    null,
    { openFile },
  );
  expect(screen.getByRole("link", { name: "a.ts" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "b.ts" })).toBeTruthy();
  expect(container.textContent).toContain(", ");
  expect(container.textContent).toContain("(from line 5)");
  expect(container.querySelector(".claude-tool-body")).toBeNull();

  // Each entry opens its own file at its own offset.
  fireEvent.click(screen.getByRole("link", { name: "b.ts" }));
  expect(openFile).toHaveBeenCalledWith("/p/b.ts", {
    startLine: 5,
    endLine: undefined,
  });
});

test("AgentOutputTool renders no body", () => {
  const { container } = view(use("AgentOutputTool"), ok("anything"));
  expect(container.querySelector(".claude-tool-body")).toBeNull();
});

test("ToolSearch is hidden from the transcript entirely", () => {
  // Official NT1.hidden = true.
  const { container } = view(use("ToolSearch", { query: "notebook" }));
  expect(container.innerHTML).toBe("");
});

// ------------------------------------------------- Bash

test("Bash shows the command as its IN row and the description in the header", () => {
  const { container } = view(
    use("Bash", { command: "ls -la", description: "List files" }),
  );
  expect(container.querySelector(".claude-tool-name-text")?.textContent).toBe(
    "Bash ",
  );
  // The description uses the plaintext secondary style, not the regular one.
  expect(
    container.querySelector(".claude-tool-name-text-secondary-plaintext")
      ?.textContent,
  ).toBe("List files");
  expect(container.querySelector("pre")?.textContent).toContain("ls -la");
});

test("Bash suppresses output once the user denied the call", () => {
  // Official: a denial reason replaces the OUT row rather than sitting beside it.
  const prefix =
    "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.";
  const { container } = view(
    use("Bash", { command: "rm -rf /" }),
    err(`${prefix} Do not delete anything.`),
  );
  expect(container.textContent).toContain("Do not delete anything.");
  const labels = [...container.querySelectorAll(".claude-tool-body-row-label")]
    .map((n) => n.textContent);
  expect(labels).not.toContain("OUT");
});

test("Bash shows output when the call succeeded", () => {
  const { container } = view(use("Bash", { command: "echo hi" }), ok("hi"));
  const labels = [...container.querySelectorAll(".claude-tool-body-row-label")]
    .map((n) => n.textContent);
  expect(labels).toContain("OUT");
});

// ------------------------------------------------- Edit and Write

test("Edit summarizes the line delta and opens at the new text", () => {
  const openFile = vi.fn();
  const { container } = view(
    use("Edit", {
      file_path: "/p/file.ts",
      old_string: "a\nb",
      new_string: "x\ny\nz",
    }),
    ok("done"),
    { openFile },
  );
  expect(container.querySelector(".claude-secondary-line")?.textContent).toBe(
    "Added 3 lines, removed 2 lines",
  );
  fireEvent.click(screen.getByRole("link", { name: "file.ts" }));
  expect(openFile).toHaveBeenCalledWith("/p/file.ts", { searchText: "x\ny\nz" });
});

test("Edit reports failure instead of a line delta", () => {
  const { container } = view(
    use("Edit", { file_path: "/p/f.ts", old_string: "a", new_string: "b" }),
    err("<tool_use_error>String not found</tool_use_error>"),
  );
  expect(container.querySelector(".claude-secondary-line")?.textContent).toBe(
    "Edit failed",
  );
});

test("Write counts the content lines", () => {
  const { container } = view(
    use("Write", { file_path: "/p/new.ts", content: "one\ntwo\nthree" }),
    ok("written"),
  );
  expect(container.querySelector(".claude-secondary-line")?.textContent).toBe(
    "3 lines",
  );
});

// ------------------------------------------------- Glob and Grep

test("Glob shows its pattern and a count summary, with no IN dump", () => {
  const { container } = view(
    use("Glob", { pattern: "**/*.ts" }),
    ok("a.ts\nb.ts"),
  );
  expect(
    container.querySelector(".claude-tool-name-text-secondary")?.textContent,
  ).toBe('pattern: "**/*.ts"');
  expect(container.querySelector(".claude-secondary-line")?.textContent).toBe(
    "Found 2 files",
  );
  expect(container.querySelector(".claude-tool-body-grid")).toBeNull();
});

test("Glob renders nothing in the body before a result arrives", () => {
  const { container } = view(use("Glob", { pattern: "**/*.ts" }));
  expect(container.querySelector(".claude-secondary-line")).toBeNull();
});

test("Glob output opens in an editor tab regardless of size", () => {
  // Unlike the IN/OUT rows, this summary is not gated on the big-content rule.
  const openContent = vi.fn();
  const { container } = view(use("Glob", { pattern: "*" }), ok("a.ts"), {
    openContent,
  });
  fireEvent.click(container.querySelector(".claude-secondary-line")!);
  expect(openContent).toHaveBeenCalledWith("a.ts", "Glob output");
});

test("Grep renders its qualifiers in the header", () => {
  const { container } = view(
    use("Grep", { pattern: "TODO", path: "src", glob: "*.ts" }),
    ok("a\nb\nc"),
  );
  expect(
    container.querySelector(".claude-tool-name-text-secondary")?.textContent,
  ).toBe('"TODO" (in src, glob: *.ts)');
  expect(container.querySelector(".claude-secondary-line")?.textContent).toBe(
    "3 lines of output",
  );
});

// ------------------------------------------------- Web tools

test("WebFetch links only http(s) urls", () => {
  const { container: safe } = view(
    use("WebFetch", { url: "https://example.test/a" }),
  );
  expect(safe.querySelector("a")?.getAttribute("href")).toBe(
    "https://example.test/a",
  );

  // A javascript: url must render as text, never as a link.
  const { container: unsafe } = view(
    use("WebFetch", { url: "javascript:alert(1)" }),
  );
  expect(unsafe.querySelector("a")).toBeNull();
  expect(unsafe.textContent).toContain("javascript:alert(1)");
});

test("WebFetch reports the fetched url instead of dumping the page", () => {
  const result = {
    ...ok("<html>a very long page body</html>"),
    url: "https://example.test/a",
  } as ToolResultBlock & { url: string };
  const { container } = view(use("WebFetch", { url: "https://example.test/a" }), result);
  expect(container.querySelector(".claude-tool-body-plain-text")?.textContent).toBe(
    "Fetched from https://example.test/a",
  );
  expect(container.textContent).not.toContain("page body");
});

test("WebSearch shows the domain lists as its description", () => {
  const { container } = view(
    use("WebSearch", {
      query: "vitest",
      allowed_domains: ["a.com"],
      blocked_domains: ["b.com"],
    }),
    ok("results"),
  );
  expect(container.querySelector(".claude-secondary-line")?.textContent).toBe(
    "Allowed: a.com · Blocked: b.com",
  );
});

// ------------------------------------------------- Agent

test("Agent titles with the description and shows the prompt, not the output", () => {
  // Official PT1.renderOutput returns null: sub-agent output is not dumped here.
  const { container } = view(
    use("Task", { description: "Audit deps", prompt: "Check every dependency" }),
    ok("the sub-agent's full final report"),
  );
  expect(container.querySelector(".claude-tool-name-text")?.textContent).toBe(
    "Agent:",
  );
  expect(
    container.querySelector(".claude-tool-name-text-secondary")?.textContent,
  ).toBe("Audit deps");
  expect(container.textContent).toContain("Check every dependency");
  expect(container.textContent).not.toContain("full final report");
});

test("Agent with no prompt stays empty rather than falling back to output", () => {
  // Guards the `renderOutput -> null` rule at the point where it actually
  // bites: with no prompt to show, the card must still not surface the
  // sub-agent's result text.
  const { container } = view(
    use("Task", { description: "Audit deps" }),
    ok("the sub-agent's full final report"),
  );
  expect(container.querySelector(".claude-tool-name-text")?.textContent).toBe(
    "Agent:",
  );
  expect(container.textContent).not.toContain("full final report");
  expect(container.querySelector(".claude-tool-body")).toBeNull();
});

// ------------------------------------------------- TodoWrite

test("TodoWrite renders disabled checkboxes with an indeterminate in-progress state", () => {
  const { container } = view(
    use("TodoWrite", {
      todos: [
        { content: "done thing", status: "completed" },
        { content: "doing thing", status: "in_progress" },
        { content: "later thing", status: "pending" },
      ],
    }),
  );
  const boxes = [...container.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[];
  expect(boxes).toHaveLength(3);
  expect(boxes.every((b) => b.disabled)).toBe(true);
  expect(boxes[0].checked).toBe(true);
  expect(boxes[1].indeterminate).toBe(true);
  expect(boxes[1].checked).toBe(false);
  expect(boxes[2].checked).toBe(false);
  expect(boxes[2].indeterminate).toBe(false);
});

// ------------------------------------------------- Plan mode

test("plan mode uses the official curly apostrophe", () => {
  const { container } = view(use("ExitPlanMode", { plan: "do things" }));
  // U+2019, not an ASCII apostrophe.
  expect(container.querySelector(".claude-tool-name-text")?.textContent).toBe(
    "Claude’s Plan",
  );
  expect(container.textContent).not.toContain("Claude's Plan");
});

test("plan mode distinguishes approval from staying in plan mode", () => {
  const { container: approved } = view(
    use("ExitPlanMode", { plan: "p" }),
    ok("approved"),
  );
  expect(approved.querySelector(".claude-secondary-line")?.textContent).toBe(
    "User approved the plan",
  );

  const { container: kept } = view(
    use("ExitPlanMode", { plan: "p" }),
    err("rejected"),
  );
  expect(kept.querySelector(".claude-secondary-line")?.textContent).toBe(
    "Stayed in plan mode",
  );

  // Nothing is shown before a result arrives.
  const { container: pending } = view(use("ExitPlanMode", { plan: "p" }));
  expect(pending.querySelector(".claude-secondary-line")).toBeNull();
});

// ------------------------------------------------- NotebookEdit

test("NotebookEdit shows status and the new source unclipped", () => {
  const { container } = view(
    use("NotebookEdit", {
      notebook_path: "/p/nb.ipynb",
      cell_id: "c3",
      new_source: "print(1)",
    }),
    ok("ok"),
  );
  expect(container.querySelector(".claude-secondary-line")?.textContent).toBe(
    "Success",
  );
  expect(container.textContent).toContain("print(1)");
  expect(
    container.querySelector(".claude-tool-body-row-content-unclipped"),
  ).not.toBeNull();
});

test("NotebookEdit falls back to a placeholder with no source", () => {
  const { container } = view(
    use("NotebookEdit", { notebook_path: "/p/nb.ipynb" }),
  );
  expect(container.textContent).toContain("[No content]");
  expect(container.querySelector(".claude-secondary-line")?.textContent).toBe(
    "Pending",
  );
});

// ------------------------------------------------- MCP and fallback

test("generic MCP tools get a humanized server name and a derived subtitle", () => {
  const { container } = view(
    use("mcp__github__search_issues", { query: "is:open label:bug" }),
    ok("3 issues"),
  );
  expect(container.querySelector(".claude-tool-name-text")?.textContent).toBe(
    "GitHub [search_issues]",
  );
  expect(
    container.querySelector(".claude-tool-name-text-secondary")?.textContent,
  ).toBe("is:open label:bug");
});

test("MCP cards never dump their raw input", () => {
  // Official WT1.renderInput returns null.
  const { container } = view(
    use("mcp__srv__do", { secretish: "value", query: "q" }),
    ok("out"),
  );
  const labels = [...container.querySelectorAll(".claude-tool-body-row-label")]
    .map((n) => n.textContent);
  expect(labels).not.toContain("IN");
});

test("claude-in-chrome is matched ahead of the generic MCP renderer", () => {
  const { container } = view(
    use("mcp__claude-in-chrome__read_page", { tabId: 7 }),
    ok("page text"),
  );
  expect(container.querySelector(".claude-tool-name-text")?.textContent).toContain(
    "Claude in Chrome",
  );
  const tab = container.querySelector(".claude-tab-link");
  expect(tab?.getAttribute("href")).toBe("https://clau.de/chrome/tab/7");
});

test("an unknown tool keeps its raw name and dumps raw input", () => {
  // Official j71: no "unknown tool" label, no truncation, default IN/OUT.
  const { container } = view(
    use("SomeFutureTool", { alpha: 1 }),
    ok("result text"),
  );
  expect(container.querySelector(".claude-tool-name-text")?.textContent).toBe(
    "SomeFutureTool",
  );
  const labels = [...container.querySelectorAll(".claude-tool-body-row-label")]
    .map((n) => n.textContent);
  expect(labels).toContain("IN");
  expect(labels).toContain("OUT");
  expect(container.textContent).toContain('"alpha": 1');
});

test("every registered built-in resolves to a card", () => {
  for (const name of [
    "Bash",
    "Read",
    "Edit",
    "Write",
    "Glob",
    "Grep",
    "Search",
    "WebFetch",
    "WebSearch",
    "Agent",
    "Skill",
    "TaskOutput",
    "TodoWrite",
    "NotebookEdit",
    "ExitPlanMode",
    "AskUserQuestion",
    "ToolSearch",
    "SandboxNetworkAccess",
    "ReadCoalesced",
    "SendUserFile",
    "Artifact",
    "AgentOutputTool",
    "PowerShell",
  ])
    expect(cardFor(name), name).toBeDefined();
});

// ------------------------------------------------- Artifact and SendUserFile

test("Artifact renders a link with the right action word", () => {
  const { container } = view(
    use("Artifact", { file_path: "page.html" }),
    ok("Published at https://claude.ai/artifact/abc"),
  );
  expect(container.textContent).toContain("Published");
  expect(container.querySelector("a")?.getAttribute("href")).toBe(
    "https://claude.ai/artifact/abc",
  );
});

test("SendUserFile stays quiet on success and speaks up on failure", () => {
  const openFile = vi.fn();
  const { container: quiet } = view(
    use("SendUserFile", { files: ["/p/report.pdf"] }),
    ok("Sent."),
    { openFile },
  );
  const quietLabels = [...quiet.querySelectorAll(".claude-tool-body-row-label")]
    .map((n) => n.textContent);
  expect(quietLabels).not.toContain("OUT");
  expect(screen.getByRole("link", { name: "report.pdf" })).toBeTruthy();

  const { container: loud } = view(
    use("SendUserFile", { files: ["/p/report.pdf"] }),
    ok("The file was NOT delivered to the user"),
  );
  const loudLabels = [...loud.querySelectorAll(".claude-tool-body-row-label")]
    .map((n) => n.textContent);
  expect(loudLabels).toContain("OUT");
});
