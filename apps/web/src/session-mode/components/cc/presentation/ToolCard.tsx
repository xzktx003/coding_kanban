/**
 * The tool card shell, aligned with the official base class `z4`
 * (entry/chunk_z4.js) in Claude Code VS Code 2.1.311.
 *
 * Official default body:
 *   {description && <O6>{description}</O6>}
 *   {(IN || OUT) && <div class={toolBody}><div class={toolBodyGrid}>…</div></div>}
 *
 * Reference: docs/designs/claude-render-alignment/tool-card-contract-20261027.md §1
 */

import type { ReactNode } from "react";
import { activatable, isBigContent } from "./primitives";

export interface ToolCardContext {
  /** Opens arbitrary text in an editor tab, as `ctx.fileOpener.openContent`. */
  openContent?: (text: string, title: string) => void;
  /** Opens a file, optionally at a line or matching text. */
  openFile?: (
    path: string,
    options?: { startLine?: number; endLine?: number; searchText?: string },
  ) => void;
}

/** `O6` — the secondary line used for descriptions and denial reasons. */
export function SecondaryLine({
  children,
  onClick,
  expanded,
}: {
  children: ReactNode;
  onClick?: () => void;
  expanded?: boolean;
}) {
  const interactive = onClick
    ? {
        role: "button" as const,
        tabIndex: 0,
        onClick,
        onKeyDown: (event: React.KeyboardEvent) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          if (!event.repeat) onClick();
        },
      }
    : {};
  return (
    <div
      className="claude-secondary-line"
      aria-expanded={expanded}
      {...interactive}
    >
      <span className="claude-secondary-line-content">{children}</span>
    </div>
  );
}

/**
 * One labeled row of the IN/OUT grid. The content region only becomes
 * activatable once the text is big, matching the official `Qk` gate.
 */
export function ToolBodyRow({
  label,
  children,
  openText,
  openTitle,
  context,
  disableClipping,
}: {
  label: "IN" | "OUT";
  children: ReactNode;
  openText?: string;
  openTitle?: string;
  context?: ToolCardContext;
  disableClipping?: boolean;
}) {
  const canOpen =
    !!openText &&
    !!context?.openContent &&
    !!openTitle &&
    isBigContent(openText);
  const onActivate = canOpen
    ? () => context!.openContent!(openText!, openTitle!)
    : undefined;

  return (
    <div className="claude-tool-body-row">
      <div className="claude-tool-body-row-label">{label}</div>
      <div
        className={`claude-tool-body-row-content${
          disableClipping ? " claude-tool-body-row-content-unclipped" : ""
        }`}
        {...activatable(onActivate)}
      >
        {children}
      </div>
    </div>
  );
}

/** The default raw-JSON IN row. */
export function ToolInputRow({
  input,
  toolName,
  context,
}: {
  input: Record<string, unknown> | undefined;
  toolName: string;
  context?: ToolCardContext;
}) {
  if (!input || Object.keys(input).length === 0) return null;
  const text = JSON.stringify(input, null, 2);
  return (
    <ToolBodyRow
      label="IN"
      openText={text}
      openTitle={`${toolName} tool input`}
      context={context}
    >
      <pre>{text}</pre>
    </ToolBodyRow>
  );
}

/** The default OUT row. */
export function ToolOutputRow({
  text,
  toolName,
  context,
  children,
}: {
  text: string;
  toolName: string;
  context?: ToolCardContext;
  children?: ReactNode;
}) {
  if (!text && !children) return null;
  return (
    <ToolBodyRow
      label="OUT"
      openText={text}
      openTitle={`${toolName} tool output`}
      context={context}
    >
      {children ?? <pre>{text}</pre>}
    </ToolBodyRow>
  );
}

/**
 * The card body wrapper. Renders nothing when neither row is present, which
 * is what keeps header-only cards (Read, Skill, …) free of empty chrome.
 */
export function ToolBody({
  description,
  children,
}: {
  description?: ReactNode;
  children?: ReactNode;
}) {
  const hasRows = Array.isArray(children)
    ? children.some((child) => child !== null && child !== undefined && child !== false)
    : children !== null && children !== undefined && children !== false;

  return (
    <>
      {description ? <SecondaryLine>{description}</SecondaryLine> : null}
      {hasRows ? (
        <div className="claude-tool-body">
          <div className="claude-tool-body-grid">{children}</div>
        </div>
      ) : null}
    </>
  );
}

/** The card header. `name` uses the primary style, `secondary` the muted one. */
export function ToolHeader({
  name,
  secondary,
  secondaryPlaintext,
  trailing,
}: {
  name: ReactNode;
  secondary?: ReactNode;
  /** Used where the official card picks `toolNameTextSecondaryPlaintext`. */
  secondaryPlaintext?: boolean;
  trailing?: ReactNode;
}) {
  return (
    <>
      <span className="claude-tool-name-text">{name}</span>
      {secondary ? (
        <span
          className={
            secondaryPlaintext
              ? "claude-tool-name-text-secondary-plaintext"
              : "claude-tool-name-text-secondary"
          }
        >
          {secondary}
        </span>
      ) : null}
      {trailing}
    </>
  );
}

/** A file name rendered as the official clickable `v8` link. */
export function FileLink({
  path,
  label,
  onOpen,
  children,
}: {
  path: string;
  label?: string;
  onOpen?: () => void;
  /** Rendered after the name, e.g. NotebookEdit's `:cell_id` suffix. */
  children?: ReactNode;
}) {
  const text = label ?? path.split(/[\\/]/).pop() ?? path;
  if (!onOpen)
    return (
      <>
        {text}
        {children}
      </>
    );
  return (
    <a
      href="#"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onOpen();
      }}
    >
      {text}
      {children}
    </a>
  );
}
