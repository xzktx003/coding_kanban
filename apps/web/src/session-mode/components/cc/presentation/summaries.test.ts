import { expect, test } from "vitest";
import {
  artifactAction,
  artifactUrl,
  editSummary,
  globSummary,
  grepQualifiers,
  grepSummary,
  isNonClickablePath,
  mcpSecondaryText,
  notebookStatus,
  planModeStatus,
  readOpenTarget,
  readRangeSuffix,
  safeHttpUrl,
  sendUserFileFailed,
  toolDenialReason,
  toolSearchSummary,
  TOOL_DENIAL_PREFIX,
  webSearchDescription,
  writeSummary,
} from "./summaries";

// Ground truth: docs/designs/claude-render-alignment/tool-card-contract-20261027.md §4

test("Edit summary pluralizes and reports both directions", () => {
  expect(editSummary("a\nb", "x\ny\nz")).toBe(
    "Added 3 lines, removed 2 lines",
  );
  expect(editSummary("", "x")).toBe("Added 1 line");
  expect(editSummary("a", "")).toBe("Removed 1 line");
  expect(editSummary("", "")).toBe("Modified");
  expect(editSummary("a", "b", true)).toBe("Edit failed");
});

test("Write summary counts lines and distinguishes non-string content", () => {
  expect(writeSummary("one")).toBe("1 line");
  expect(writeSummary("one\ntwo")).toBe("2 lines");
  expect(writeSummary({ not: "a string" })).toBe("Write succeeded");
  expect(writeSummary("one", true)).toBe("Write failed");
});

test("Glob treats the literal no-files output as zero", () => {
  // The official card special-cases this string rather than counting it
  // as one result line.
  expect(globSummary("No files found")).toBe("No files found");
  expect(globSummary("")).toBe("No files found");
  expect(globSummary(undefined)).toBe("No files found");
  expect(globSummary("a.ts")).toBe("Found 1 file");
  expect(globSummary("a.ts\nb.ts")).toBe("Found 2 files");
  // Blank lines are not results.
  expect(globSummary("a.ts\n\nb.ts\n")).toBe("Found 2 files");
});

test("Grep counts output lines without the no-files special case", () => {
  expect(grepSummary("")).toBe("No matches found");
  expect(grepSummary(undefined)).toBe("No matches found");
  expect(grepSummary("hit")).toBe("1 line of output");
  expect(grepSummary("a\nb\nc")).toBe("3 lines of output");
  // Unlike Glob, this phrase is just output here.
  expect(grepSummary("No files found")).toBe("1 line of output");
});

test("ToolSearch summary pluralizes tools", () => {
  expect(toolSearchSummary(0)).toBe("No tools found");
  expect(toolSearchSummary(1)).toBe("Found 1 tool");
  expect(toolSearchSummary(4)).toBe("Found 4 tools");
});

test("Grep qualifiers appear only when present and keep their order", () => {
  expect(grepQualifiers({})).toBe("");
  expect(grepQualifiers({ path: "src" })).toBe(" (in src)");
  expect(grepQualifiers({ path: "src", glob: "*.ts", type: "ts" })).toBe(
    " (in src, glob: *.ts, type: ts)",
  );
  expect(grepQualifiers({ glob: "*.ts" })).toBe(" (glob: *.ts)");
});

test("Read range suffix is 1-based and distinguishes offset-only", () => {
  expect(readRangeSuffix({})).toBe("");
  expect(readRangeSuffix({ offset: 9, limit: 20 })).toBe(" (lines 10-29)");
  expect(readRangeSuffix({ offset: 9 })).toBe(" (from line 10)");
  // A limit alone has no displayed range in the official card.
  expect(readRangeSuffix({ limit: 20 })).toBe("");
});

test("Read open target is computed separately from the displayed range", () => {
  expect(readOpenTarget({})).toEqual({ startLine: 1, endLine: undefined });
  expect(readOpenTarget({ offset: 9, limit: 20 })).toEqual({
    startLine: 10,
    endLine: 29,
  });
  // Unlike the suffix, a bare limit still narrows the open target.
  expect(readOpenTarget({ limit: 5 })).toEqual({ startLine: 1, endLine: 5 });
});

test("NotebookEdit and plan mode status strings", () => {
  expect(notebookStatus(false)).toBe("Pending");
  expect(notebookStatus(true)).toBe("Success");
  expect(notebookStatus(true, true)).toBe("Failed");

  // Plan mode renders nothing until a result arrives.
  expect(planModeStatus(false)).toBeUndefined();
  expect(planModeStatus(true)).toBe("User approved the plan");
  expect(planModeStatus(true, true)).toBe("Stayed in plan mode");
});

test("WebSearch description joins only non-empty domain lists", () => {
  expect(webSearchDescription({})).toBeUndefined();
  expect(webSearchDescription({ allowed_domains: [] })).toBeUndefined();
  expect(webSearchDescription({ allowed_domains: ["a.com"] })).toBe(
    "Allowed: a.com",
  );
  expect(
    webSearchDescription({
      allowed_domains: ["a.com", "b.com"],
      blocked_domains: ["c.com"],
    }),
  ).toBe("Allowed: a.com, b.com · Blocked: c.com");
});

test("MCP secondary text follows the official field priority", () => {
  // query wins over message, which wins over path, and so on.
  expect(mcpSecondaryText({ path: "/x", query: "q", message: "m" })).toBe("q");
  expect(mcpSecondaryText({ path: "/x", message: "m" })).toBe("m");
  expect(mcpSecondaryText({})).toBeUndefined();
  expect(mcpSecondaryText(undefined)).toBeUndefined();
  // Non-string and empty values are skipped, not rendered.
  expect(mcpSecondaryText({ query: 5, message: "m" })).toBe("m");
  expect(mcpSecondaryText({ query: "", message: "m" })).toBe("m");
});

test("MCP channel and url fields get special formatting", () => {
  expect(mcpSecondaryText({ channel: "general" })).toBe("#general");
  expect(mcpSecondaryText({ url: "https://example.com/a/b?c=d" })).toBe(
    "example.com",
  );
  // An unparseable url falls back to a 30-char truncation.
  const bad = "not a url ".repeat(10);
  expect(mcpSecondaryText({ url: bad })).toBe(`${bad.slice(0, 30)}…`);
});

test("MCP other fields truncate at 40 characters", () => {
  const long = "q".repeat(45);
  expect(mcpSecondaryText({ query: long })).toBe(`${"q".repeat(40)}…`);
  const exact = "q".repeat(40);
  expect(mcpSecondaryText({ query: exact })).toBe(exact);
});

test("artifact action is derived from the result prefix", () => {
  expect(artifactAction("Opened the Artifact at https://x.test/a")).toBe(
    "Opened",
  );
  expect(artifactAction("Created a thing")).toBe("Created");
  expect(artifactAction("Published at https://x.test/a")).toBe("Published");
  expect(artifactAction(undefined)).toBe("Published");
});

test("artifact url is extracted only from a recognized single-url result", () => {
  expect(artifactUrl("Published at https://x.test/a")).toBe("https://x.test/a");
  expect(artifactUrl("Opened the Artifact at https://x.test/b")).toBe(
    "https://x.test/b",
  );
  // Unrecognized prefix, error results, and ambiguous multi-url results yield nothing.
  expect(artifactUrl("Something at https://x.test/a")).toBeUndefined();
  expect(artifactUrl("Published at https://x.test/a", true)).toBeUndefined();
  expect(
    artifactUrl("Published at https://x.test/a and at https://y.test/b"),
  ).toBeUndefined();
});

test("only http(s) urls are linkified", () => {
  expect(safeHttpUrl("https://x.test")).toBe("https://x.test");
  expect(safeHttpUrl("http://x.test")).toBe("http://x.test");
  expect(safeHttpUrl("javascript:alert(1)")).toBeUndefined();
  expect(safeHttpUrl("file:///etc/passwd")).toBeUndefined();
  expect(safeHttpUrl("not a url")).toBeUndefined();
  expect(safeHttpUrl(undefined)).toBeUndefined();
});

test("windows and UNC paths are not turned into links", () => {
  expect(isNonClickablePath("\\\\server\\share\\f.txt")).toBe(true);
  expect(isNonClickablePath("C:\\Users\\f.txt")).toBe(true);
  expect(isNonClickablePath("/home/user/f.txt")).toBe(false);
  expect(isNonClickablePath("relative/f.txt")).toBe(false);
});

test("SendUserFile shows output only on real delivery failure", () => {
  expect(sendUserFileFailed("Sent 1 file", false)).toBe(false);
  expect(sendUserFileFailed(undefined, false)).toBe(false);
  expect(sendUserFileFailed("anything", true)).toBe(true);
  expect(sendUserFileFailed("The file was NOT delivered to the user")).toBe(
    true,
  );
  expect(sendUserFileFailed("it reached only one of its viewers")).toBe(true);
});

test("a user's denial reason is separated from a tool error", () => {
  expect(
    toolDenialReason({
      is_error: true,
      content: `${TOOL_DENIAL_PREFIX} Use a different file instead.`,
    }),
  ).toBe("Use a different file instead.");

  // An internal tool error is not a denial and must render differently.
  expect(
    toolDenialReason({
      is_error: true,
      content: "<tool_use_error>File not found</tool_use_error>",
    }),
  ).toBeUndefined();

  // These two must stay undefined because of the guards, not because the
  // content happens to be shorter than the prefix: both are long enough that
  // a missing guard would slice out real text and show it as a user reason.
  expect(
    toolDenialReason({
      is_error: true,
      content: `<tool_use_error>${"E".repeat(400)}</tool_use_error>`,
    }),
  ).toBeUndefined();
  expect(
    toolDenialReason({
      is_error: true,
      content: `Server error: ${"detail ".repeat(60)}`,
    }),
  ).toBeUndefined();
  // A denial with no typed reason yields nothing to show.
  expect(
    toolDenialReason({ is_error: true, content: TOOL_DENIAL_PREFIX }),
  ).toBeUndefined();
  // Successful results never carry a denial reason.
  expect(toolDenialReason({ is_error: false, content: "ok" })).toBeUndefined();
  expect(toolDenialReason({ content: "ok" })).toBeUndefined();
});
