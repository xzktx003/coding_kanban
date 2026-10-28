import { expect, test } from "vitest";
import {
  APPROVAL_KEYBOARD_HINT,
  APPROVAL_REJECT_PLACEHOLDER,
  approvalButtons,
  approvalHeader,
  planApprovalText,
  SKILL_NOTE,
} from "./approval";

// Ground truth: docs/designs/claude-render-alignment/tool-card-contract-20261027.md §4-5

test("the fixed approval chrome strings match the official text", () => {
  expect(APPROVAL_KEYBOARD_HINT).toBe("Esc to cancel");
  expect(APPROVAL_REJECT_PLACEHOLDER).toBe("Tell Claude what to do instead");
  expect(SKILL_NOTE).toBe(
    "Claude may use instructions, code, or files from this skill.",
  );
});

test("file tools name the basename, not the whole path", () => {
  expect(approvalHeader("Read", { file_path: "/a/b/app.ts" })).toMatchObject({
    text: "Allow reading from",
    path: "app.ts",
  });
  expect(approvalHeader("Edit", { file_path: "/a/b/app.ts" })).toMatchObject({
    text: "Make this edit to",
    path: "app.ts",
  });
  expect(approvalHeader("Write", { file_path: "/a/b/new.ts" })).toMatchObject({
    text: "Allow write to",
    path: "new.ts",
  });
});

test("Bash's approval body is editable and carries its description", () => {
  // The official card lets the user edit the command before approving.
  const header = approvalHeader("Bash", {
    command: "rm -rf build",
    description: "Clean build output",
  });
  expect(header).toMatchObject({
    text: "Allow this bash command?",
    editable: "command",
  });
  expect(header?.description).toEqual(["Clean build output"]);

  // No description means no extra line.
  expect(approvalHeader("Bash", { command: "ls" })?.description).toBeUndefined();
});

test("PowerShell reuses the command card with its own label", () => {
  expect(approvalHeader("PowerShell", { command: "Get-ChildItem" })).toMatchObject(
    { text: "Allow this PowerShell command?", editable: "command" },
  );
});

test("search tools fall back to a path-less sentence without a question mark", () => {
  // Official asymmetry: the path variant ends in "?", the fallback does not.
  expect(approvalHeader("Glob", { path: "src" })).toMatchObject({
    text: "Allow glob search in",
    path: "src",
  });
  expect(approvalHeader("Glob", {})).toEqual({
    text: "Allow this glob command",
  });
  expect(approvalHeader("Grep", { path: "src" })).toMatchObject({
    text: "Allow grep in",
  });
  expect(approvalHeader("Grep", {})).toEqual({ text: "Allow this grep command" });
  expect(approvalHeader("Search", {})).toEqual({ text: "Allow this search" });
});

test("web and sandbox tools use their own sentences", () => {
  expect(approvalHeader("WebFetch", { url: "https://x.test" })?.text).toBe(
    "Allow fetching this url?",
  );
  expect(approvalHeader("WebSearch", { query: "q" })?.text).toBe(
    "Allow searching for this query?",
  );
  expect(approvalHeader("SandboxNetworkAccess", { host: "x.test" })?.text).toBe(
    "Allow network connection to this host?",
  );
});

test("Skill shows the slash name and always warns about skill contents", () => {
  const header = approvalHeader("Skill", { skill: "/code-review" });
  expect(header).toMatchObject({ text: "Use skill", path: "/code-review" });
  expect(header?.description?.[0]).toBe(SKILL_NOTE);

  // Arguments are appended when present.
  const withArgs = approvalHeader("Skill", {
    skill: "code-review",
    args: "--fix",
  });
  expect(withArgs?.path).toBe("/code-review");
  expect(withArgs?.description).toContain("Arguments: --fix");
});

test("a tool with no custom card yields no header", () => {
  // Official `permissionRequest` returns null and the generic shell takes over.
  expect(approvalHeader("TodoWrite", {})).toBeUndefined();
  expect(approvalHeader("SomeUnknownTool", {})).toBeUndefined();
});

test("the default button row is Yes then No with sequential shortcuts", () => {
  const buttons = approvalButtons({ mode: "default" });
  expect(buttons.map((b) => b.label)).toEqual(["Yes", "No"]);
  expect(buttons.map((b) => b.shortcut)).toEqual([1, 2]);
  expect(buttons[0].primary).toBe(true);
});

test("offering always-allow renumbers the reject shortcut", () => {
  // The official badges count visible buttons, so adding one shifts "No" to 3.
  const buttons = approvalButtons({ mode: "default", offersAlways: true });
  expect(buttons.map((b) => b.shortcut)).toEqual([1, 2, 3]);
  expect(buttons[2].label).toBe("No");
  expect(buttons[2].kind).toBe("reject");
});

test("plan mode relabels both accept and reject", () => {
  const buttons = approvalButtons({ mode: "plan" });
  expect(buttons.map((b) => b.label)).toEqual([
    "Yes, and auto-accept",
    "Yes, and manually approve edits",
    "No, keep planning",
  ]);

  // The auto variant changes only the primary label.
  expect(approvalButtons({ mode: "plan", autoMode: true })[0].label).toBe(
    "Yes, and use auto mode",
  );

  // Comments turn rejection into sending feedback.
  expect(
    approvalButtons({ mode: "plan", hasComments: true })[2].label,
  ).toBe("Send feedback and keep planning");
});

test("a question card submits answers and has no reject button", () => {
  const buttons = approvalButtons({ mode: "questions" });
  expect(buttons.map((b) => b.label)).toEqual(["Submit answers"]);
  expect(buttons.some((b) => b.kind === "reject")).toBe(false);
});

test("plan approval text switches once comments exist", () => {
  expect(planApprovalText(0)).toEqual({
    header: "Accept this plan?",
    description: "Select text in the preview to add comments",
  });
  expect(planApprovalText(1)).toEqual({
    header: "Continue planning",
    description: "1 comment will be included as feedback",
  });
  expect(planApprovalText(3).description).toBe(
    "3 comments will be included as feedback",
  );
});
