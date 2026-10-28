/**
 * Tool renderer resolution, aligned with the official Claude Code VS Code
 * extension 2.1.311.
 *
 * The official webview resolves one renderer instance per tool name in `Oz`
 * (entry/chunk_a_0.js): exact name match over a fixed list, then the
 * claude-in-chrome prefix, then the generic `mcp__` prefix, then a bare
 * fallback that keeps the raw tool name as the title.
 *
 * Reference: docs/designs/claude-render-alignment/tool-card-contract-20261027.md
 */

export const MCP_PREFIX = "mcp__";
export const CLAUDE_IN_CHROME_PREFIX = "mcp__claude-in-chrome__";

/** entry.js:3612 — the official check is this single prefix test. */
export function isMcpToolName(name: string): boolean {
  return name.startsWith(MCP_PREFIX);
}

/** chunk_$T1.js — checked before {@link isMcpToolName} in the official order. */
export function isClaudeInChromeToolName(name: string): boolean {
  return name.startsWith(CLAUDE_IN_CHROME_PREFIX);
}

/** `VT1` — the segment after `mcp__`, up to the next separator. */
export function mcpServerName(name: string): string {
  return name.slice(MCP_PREFIX.length).split("__")[0] || "";
}

/** `UT1` — everything after the server segment, rejoined on `__`. */
export function mcpToolName(name: string): string {
  return name.slice(MCP_PREFIX.length).split("__").slice(1).join("__") || "";
}

/** `HT1`'s dictionary of specially-cased words. */
const SERVER_WORD_OVERRIDES: Record<string, string> = {
  Github: "GitHub",
  Pubmed: "PubMed",
  Ai: "AI",
};

/**
 * `HT1` — split on `_`, title-case each word, then map known words through
 * the override dictionary.
 */
export function humanizeMcpServerName(server: string): string {
  return server
    .split("_")
    .filter((word) => word.length > 0)
    .map((word) => {
      const titled = word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      return SERVER_WORD_OVERRIDES[titled] ?? titled;
    })
    .join(" ");
}

/** Which renderer family resolved, used to pick the component. */
export type ToolRendererKind =
  | "builtin"
  | "claude-in-chrome"
  | "mcp"
  | "fallback";

export interface ToolRenderer {
  /** For built-ins the official tool name; for the fallback the raw name. */
  name: string;
  kind: ToolRendererKind;
  /** Present for MCP renderers, which derive a display name from the parts. */
  serverName?: string;
  toolName?: string;
  humanizedServerName?: string;
}

/**
 * The tools the official registry constructs explicitly. Keep this list in
 * sync with `Oz`'s instance list — anything absent falls through to the
 * generic MCP or fallback renderer, which is the official behavior.
 */
export const BUILTIN_TOOL_NAMES = [
  "AgentOutputTool",
  "Artifact",
  "Bash",
  "PowerShell",
  "TaskOutput",
  "Agent",
  "TodoWrite",
  "Read",
  "Write",
  "Edit",
  "Glob",
  "Grep",
  "Search",
  "WebFetch",
  "WebSearch",
  "ExitPlanMode",
  "ReadCoalesced",
  "NotebookEdit",
  "SendUserFile",
  "Skill",
  "AskUserQuestion",
  "ToolSearch",
  "SandboxNetworkAccess",
] as const;

export type BuiltinToolName = (typeof BUILTIN_TOOL_NAMES)[number];

const BUILTIN_TOOL_SET: ReadonlySet<string> = new Set(BUILTIN_TOOL_NAMES);

/**
 * `Oz(toolName, ctx)`. `Task` is rewritten to `Agent` before lookup, so a
 * sub-agent spawn renders through the Agent card.
 */
export function resolveToolRenderer(rawName: string): ToolRenderer {
  const name = rawName === "Task" ? "Agent" : rawName;

  if (BUILTIN_TOOL_SET.has(name)) return { name, kind: "builtin" };

  if (isClaudeInChromeToolName(rawName)) {
    const toolName = rawName.slice(CLAUDE_IN_CHROME_PREFIX.length);
    return { name: rawName, kind: "claude-in-chrome", toolName };
  }

  if (isMcpToolName(rawName)) {
    const serverName = mcpServerName(rawName);
    return {
      name: rawName,
      kind: "mcp",
      serverName,
      toolName: mcpToolName(rawName),
      humanizedServerName: humanizeMcpServerName(serverName),
    };
  }

  // `j71`: the raw name is the title, the body is the default IN/OUT dump.
  return { name: rawName, kind: "fallback" };
}
