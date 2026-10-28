import { expect, test } from "vitest";
import {
  isMcpToolName,
  isClaudeInChromeToolName,
  resolveToolRenderer,
  mcpServerName,
  mcpToolName,
  humanizeMcpServerName,
  CLAUDE_IN_CHROME_PREFIX,
} from "./registry";

// The official webview resolves a renderer per tool name in `Oz`
// (entry/chunk_a_0.js). Order matters: exact name, then the
// claude-in-chrome prefix, then the generic mcp prefix, then a fallback
// that keeps the raw name. See docs/designs/claude-render-alignment/
// tool-card-contract-20261027.md §3.

test("Task is rendered by the Agent renderer", () => {
  // `let X = $ === "Task" ? "Agent" : $` in the official registry.
  expect(resolveToolRenderer("Task").name).toBe("Agent");
  expect(resolveToolRenderer("Agent").name).toBe("Agent");
});

test("built-in tools resolve to their own renderer", () => {
  for (const name of [
    "Bash",
    "Read",
    "Edit",
    "Write",
    "Glob",
    "Grep",
    "TodoWrite",
    "WebFetch",
    "WebSearch",
    "Skill",
    "ExitPlanMode",
    "AskUserQuestion",
    "NotebookEdit",
    "ToolSearch",
    "TaskOutput",
    "Search",
    "SandboxNetworkAccess",
    "AgentOutputTool",
  ])
    expect(resolveToolRenderer(name).name, name).toBe(name);
});

test("ReadCoalesced keeps its own renderer rather than aliasing to Read", () => {
  // Official registers `new XT1(fileOpener)` with name `mW` = "ReadCoalesced";
  // it renders a comma-separated list of files and no body at all.
  expect(resolveToolRenderer("ReadCoalesced").name).toBe("ReadCoalesced");
});

test("claude-in-chrome tools are matched before the generic mcp prefix", () => {
  const chrome = resolveToolRenderer(`${CLAUDE_IN_CHROME_PREFIX}computer`);
  expect(chrome.kind).toBe("claude-in-chrome");
  // The generic MCP renderer must not claim it.
  expect(chrome.kind).not.toBe("mcp");
});

test("other mcp tools fall through to the generic mcp renderer", () => {
  const mcp = resolveToolRenderer("mcp__github__search_issues");
  expect(mcp.kind).toBe("mcp");
});

test("unknown tools keep their raw name and use the fallback renderer", () => {
  // Official `j71` is a bare subclass: the unrecognized name is the title and
  // the body is the default raw IN/OUT dump. No "unknown tool" label.
  const unknown = resolveToolRenderer("SomeToolWeHaveNeverSeen");
  expect(unknown.kind).toBe("fallback");
  expect(unknown.name).toBe("SomeToolWeHaveNeverSeen");
});

test("mcp prefix test matches the official single-line check", () => {
  // entry.js:3612 — `return $.startsWith("mcp__")`
  expect(isMcpToolName("mcp__x__y")).toBe(true);
  expect(isMcpToolName("mcp__")).toBe(true);
  expect(isMcpToolName("Bash")).toBe(false);
  expect(isMcpToolName("notmcp__x")).toBe(false);
});

test("claude-in-chrome prefix test", () => {
  expect(isClaudeInChromeToolName(`${CLAUDE_IN_CHROME_PREFIX}find`)).toBe(true);
  expect(isClaudeInChromeToolName("mcp__github__x")).toBe(false);
});

test("mcp names split into server and tool around the first separator", () => {
  // VT1/UT1: server is the segment after `mcp__`; the tool keeps any
  // further `__` joined back together.
  expect(mcpServerName("mcp__github__search_issues")).toBe("github");
  expect(mcpToolName("mcp__github__search_issues")).toBe("search_issues");
  expect(mcpToolName("mcp__srv__a__b")).toBe("a__b");
  expect(mcpServerName("mcp__")).toBe("");
  expect(mcpToolName("mcp__")).toBe("");
});

test("mcp server names are title-cased through the official dictionary", () => {
  // HT1 + {Github: "GitHub", Pubmed: "PubMed", Ai: "AI"}
  expect(humanizeMcpServerName("github")).toBe("GitHub");
  expect(humanizeMcpServerName("pubmed_search")).toBe("PubMed Search");
  expect(humanizeMcpServerName("ai_helper")).toBe("AI Helper");
  expect(humanizeMcpServerName("my_server")).toBe("My Server");
  expect(humanizeMcpServerName("")).toBe("");
});
