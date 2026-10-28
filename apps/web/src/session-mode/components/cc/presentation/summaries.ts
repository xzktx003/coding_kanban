/**
 * Summary-line text for tool cards, aligned with the official Claude Code
 * VS Code extension 2.1.311.
 *
 * These are the literal strings the official cards render, extracted from
 * the decompiled webview. Keeping them as pure functions makes each one
 * directly assertable.
 *
 * Reference: docs/designs/claude-render-alignment/tool-card-contract-20261027.md §4
 */

/** `Iw5` — Edit's line-delta summary. */
export function editSummary(
  oldString: string | undefined,
  newString: string | undefined,
  isError?: boolean,
): string {
  if (isError) return "Edit failed";
  const added = newString ? newString.split("\n").length : 0;
  const removed = oldString ? oldString.split("\n").length : 0;
  const plural = (n: number) => (n === 1 ? "line" : "lines");

  if (added > 0 && removed > 0)
    return `Added ${added} ${plural(added)}, removed ${removed} ${plural(removed)}`;
  if (added > 0) return `Added ${added} ${plural(added)}`;
  if (removed > 0) return `Removed ${removed} ${plural(removed)}`;
  return "Modified";
}

/** `fw5` — Write's summary. */
export function writeSummary(
  content: unknown,
  isError?: boolean,
): string {
  if (isError) return "Write failed";
  if (typeof content !== "string") return "Write succeeded";
  const lines = content.split("\n").length;
  return `${lines} ${lines === 1 ? "line" : "lines"}`;
}

/** Glob's result summary. `No files found` output counts as zero. */
export function globSummary(output: string | undefined): string {
  const trimmed = output?.trim();
  const count =
    trimmed && trimmed !== "No files found"
      ? trimmed.split("\n").filter((line) => line.length > 0).length
      : 0;
  if (count === 0) return "No files found";
  if (count === 1) return "Found 1 file";
  return `Found ${count} files`;
}

/** Grep's result summary. */
export function grepSummary(output: string | undefined): string {
  const trimmed = output?.trim();
  const count = trimmed
    ? trimmed.split("\n").filter((line) => line.length > 0).length
    : 0;
  if (count === 0) return "No matches found";
  if (count === 1) return "1 line of output";
  return `${count} lines of output`;
}

/** ToolSearch's result summary. */
export function toolSearchSummary(count: number): string {
  if (count === 0) return "No tools found";
  if (count === 1) return "Found 1 tool";
  return `Found ${count} tools`;
}

/** Grep's parenthesized qualifier suffix, from path/glob/type. */
export function grepQualifiers(input: {
  path?: string;
  glob?: string;
  type?: string;
}): string {
  const parts: string[] = [];
  if (input.path) parts.push(`in ${input.path}`);
  if (input.glob) parts.push(`glob: ${input.glob}`);
  if (input.type) parts.push(`type: ${input.type}`);
  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}

/** Read's displayed line-range suffix. Distinct from the open-file target. */
export function readRangeSuffix(input: {
  offset?: number;
  limit?: number;
}): string {
  const { offset, limit } = input;
  if (offset !== undefined && limit !== undefined)
    return ` (lines ${offset + 1}-${offset + limit})`;
  if (offset !== undefined) return ` (from line ${offset + 1})`;
  return "";
}

/** Where clicking a Read card's file name should land. */
export function readOpenTarget(input: { offset?: number; limit?: number }): {
  startLine: number;
  endLine?: number;
} {
  const startLine = input.offset ? input.offset + 1 : 1;
  const endLine =
    input.limit !== undefined ? startLine + input.limit - 1 : undefined;
  return { startLine, endLine };
}

/** NotebookEdit's status line. */
export function notebookStatus(hasResult: boolean, isError?: boolean): string {
  if (!hasResult) return "Pending";
  return isError ? "Failed" : "Success";
}

/** ExitPlanMode's body text. Returns undefined before a result arrives. */
export function planModeStatus(
  hasResult: boolean,
  isError?: boolean,
): string | undefined {
  if (!hasResult) return undefined;
  return isError ? "Stayed in plan mode" : "User approved the plan";
}

/** WebSearch's description line, joining the domain lists with ` · `. */
export function webSearchDescription(input: {
  allowed_domains?: string[];
  blocked_domains?: string[];
}): string | undefined {
  const parts: string[] = [];
  if (input.allowed_domains?.length)
    parts.push(`Allowed: ${input.allowed_domains.join(", ")}`);
  if (input.blocked_domains?.length)
    parts.push(`Blocked: ${input.blocked_domains.join(", ")}`);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

/**
 * `xw5` — the generic MCP card's secondary text. Scans the input for the
 * first present string field in this fixed priority order.
 */
const MCP_SECONDARY_FIELDS = [
  "query",
  "message",
  "channel",
  "repo",
  "url",
  "path",
  "title",
  "search",
  "text",
] as const;

export function mcpSecondaryText(
  input: Record<string, unknown> | undefined,
): string | undefined {
  if (!input) return undefined;
  for (const field of MCP_SECONDARY_FIELDS) {
    const value = input[field];
    if (typeof value !== "string" || value.length === 0) continue;

    if (field === "channel") return `#${value}`;
    if (field === "url") {
      try {
        return new URL(value).hostname;
      } catch {
        return value.length > 30 ? `${value.slice(0, 30)}…` : value;
      }
    }
    return value.length > 40 ? `${value.slice(0, 40)}…` : value;
  }
  return undefined;
}

/** Artifact's OUT label, derived from the result text. */
export function artifactAction(content: unknown): string {
  if (typeof content === "string") {
    if (content.startsWith("Opened the Artifact at http")) return "Opened";
    if (content.startsWith("Created ")) return "Created";
  }
  return "Published";
}

const ARTIFACT_PREFIXES = [
  "Published ",
  "Created a new Artifact at http",
  "An earlier attempt of this call already created the Artifact at http",
  "Opened the Artifact at http",
];

/** `yC` — extracts the artifact URL, only from a recognized result shape. */
export function artifactUrl(
  content: unknown,
  isError?: boolean,
): string | undefined {
  if (isError || typeof content !== "string") return undefined;
  if (!ARTIFACT_PREFIXES.some((prefix) => content.startsWith(prefix)))
    return undefined;
  const matches = content.match(/at (https?:\/\/\S+)/g);
  if (!matches || matches.length !== 1) return undefined;
  return matches[0].slice(3);
}

/** `IQ` — only http(s) URLs become links. */
export function safeHttpUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

/** `j61` — paths we must not turn into clickable links. */
export function isNonClickablePath(path: string): boolean {
  return (
    path.startsWith("\\\\") ||
    path.startsWith("\\\\?\\") ||
    /^[a-zA-Z]:\\/.test(path)
  );
}

/** SendUserFile only shows output when delivery actually went wrong. */
export function sendUserFileFailed(
  text: string | undefined,
  isError?: boolean,
): boolean {
  if (isError) return true;
  if (!text) return false;
  return /\bNOT\b.*\bdelivered\b|reached only one of its viewers/.test(text);
}

/** The denial-reason prefix the CLI uses when a user rejects a tool call. */
export const TOOL_DENIAL_PREFIX =
  "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.";

/**
 * `uP` — a user's typed rejection reason, distinct from a tool error.
 * Returns undefined for internal tool errors so they render differently.
 */
export function toolDenialReason(result: {
  is_error?: boolean;
  content?: unknown;
}): string | undefined {
  if (!result.is_error || typeof result.content !== "string") return undefined;
  const content = result.content;
  if (content.includes("<tool_use_error>")) return undefined;
  if (!content.startsWith(TOOL_DENIAL_PREFIX)) return undefined;
  const reason = content.slice(TOOL_DENIAL_PREFIX.length).trim();
  return reason.length > 0 ? reason : undefined;
}
