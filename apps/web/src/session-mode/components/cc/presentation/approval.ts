/**
 * Approval-card text and button model, aligned with the official Claude Code
 * VS Code extension 2.1.311 (`entry/chunk_i81_2.js` and each tool's
 * `permissionRequest`).
 *
 * Reference: docs/designs/claude-render-alignment/tool-card-contract-20261027.md §4–5
 */

export const APPROVAL_KEYBOARD_HINT = "Esc to cancel";
export const APPROVAL_REJECT_PLACEHOLDER = "Tell Claude what to do instead";
export const SKILL_NOTE =
  "Claude may use instructions, code, or files from this skill.";

const basename = (path: string) => path.split(/[\\/]/).pop() || path;

export interface ApprovalHeader {
  /** Sentence shown above the request body. */
  text: string;
  /** The portion rendered in the emphasized path style, if any. */
  path?: string;
  /** Extra description lines below the header. */
  description?: string[];
  /** Whether the request body is editable, as Bash's command is. */
  editable?: "command";
}

/**
 * The per-tool approval header. Returning undefined means the tool has no
 * custom card and the generic shell supplies its own text, matching
 * `permissionRequest` returning null officially.
 */
export function approvalHeader(
  toolName: string,
  input: Record<string, unknown>,
): ApprovalHeader | undefined {
  const str = (key: string) =>
    typeof input[key] === "string" ? (input[key] as string) : undefined;

  switch (toolName) {
    case "Bash":
      return {
        text: "Allow this bash command?",
        description: str("description") ? [str("description")!] : undefined,
        editable: "command",
      };
    case "PowerShell":
      return {
        text: "Allow this PowerShell command?",
        description: str("description") ? [str("description")!] : undefined,
        editable: "command",
      };
    case "Read":
      return {
        text: "Allow reading from",
        path: basename(str("file_path") ?? ""),
      };
    case "Edit":
      return {
        text: "Make this edit to",
        path: basename(str("file_path") ?? ""),
      };
    case "Write":
      return {
        text: "Allow write to",
        path: basename(str("file_path") ?? ""),
      };
    case "Glob":
      return str("path")
        ? { text: "Allow glob search in", path: str("path") }
        : // Note the official fallback carries no question mark.
          { text: "Allow this glob command" };
    case "Grep":
      return str("path")
        ? { text: "Allow grep in", path: str("path") }
        : { text: "Allow this grep command" };
    case "Search":
      return str("path")
        ? { text: "Allow searching in", path: str("path") }
        : { text: "Allow this search" };
    case "WebFetch":
      return { text: "Allow fetching this url?" };
    case "WebSearch":
      return { text: "Allow searching for this query?" };
    case "SandboxNetworkAccess":
      return { text: "Allow network connection to this host?" };
    case "Skill": {
      const skill = (str("skill") ?? "").replace(/^\//, "");
      const description = [SKILL_NOTE];
      if (str("args")) description.push(`Arguments: ${str("args")}`);
      return { text: "Use skill", path: `/${skill}`, description };
    }
    default:
      return undefined;
  }
}

export type ApprovalMode = "default" | "plan" | "questions";

export interface ApprovalButtonModel {
  /** `1`-based shortcut badge, matching the official numbering. */
  shortcut: number;
  label: string;
  kind: "accept" | "accept-always" | "reject";
  primary: boolean;
}

export interface ApprovalButtonsInput {
  mode: ApprovalMode;
  /** Whether an "always allow" option is offered. */
  offersAlways?: boolean;
  /** Plan mode with comments shifts the reject label to feedback. */
  hasComments?: boolean;
  /** Plan mode's auto variant changes the accept label. */
  autoMode?: boolean;
}

/**
 * The official button row. Shortcut numbers are assigned over the visible
 * buttons rather than fixed per role, so hiding one renumbers the rest.
 */
export function approvalButtons({
  mode,
  offersAlways = false,
  hasComments = false,
  autoMode = false,
}: ApprovalButtonsInput): ApprovalButtonModel[] {
  const buttons: Omit<ApprovalButtonModel, "shortcut">[] = [];

  if (mode === "questions") {
    buttons.push({ label: "Submit answers", kind: "accept", primary: true });
  } else if (mode === "plan") {
    buttons.push({
      label: autoMode ? "Yes, and use auto mode" : "Yes, and auto-accept",
      kind: "accept",
      primary: true,
    });
    buttons.push({
      label: "Yes, and manually approve edits",
      kind: "accept-always",
      primary: false,
    });
  } else {
    buttons.push({ label: "Yes", kind: "accept", primary: true });
    if (offersAlways)
      buttons.push({
        label: "Yes, and don't ask again",
        kind: "accept-always",
        primary: false,
      });
  }

  if (mode !== "questions")
    buttons.push({
      label:
        mode === "plan"
          ? hasComments
            ? "Send feedback and keep planning"
            : "No, keep planning"
          : "No",
      kind: "reject",
      primary: false,
    });

  return buttons.map((button, index) => ({ ...button, shortcut: index + 1 }));
}

/** Plan-mode approval text, which changes once inline comments exist. */
export function planApprovalText(commentCount: number): {
  header: string;
  description: string;
} {
  if (commentCount > 0)
    return {
      header: "Continue planning",
      description: `${commentCount} comment${commentCount === 1 ? "" : "s"} will be included as feedback`,
    };
  return {
    header: "Accept this plan?",
    description: "Select text in the preview to add comments",
  };
}
