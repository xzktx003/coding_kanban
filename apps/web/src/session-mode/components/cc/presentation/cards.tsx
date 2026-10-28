/**
 * Per-tool cards, aligned with the official Claude Code VS Code extension
 * 2.1.311. Each export mirrors one `z4` subclass from the decompiled webview.
 *
 * Reference: docs/designs/claude-render-alignment/tool-card-contract-20261027.md §4
 */

import type { ReactNode } from "react";
import type { ToolResultBlock, ToolUseBlock } from "../types/messages";
import { toolResultText } from "./primitives";
import {
  FileLink,
  SecondaryLine,
  ToolBody,
  ToolHeader,
  ToolInputRow,
  ToolOutputRow,
  type ToolCardContext,
} from "./ToolCard";
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
  webSearchDescription,
  writeSummary,
} from "./summaries";
import {
  humanizeMcpServerName,
  mcpServerName,
  mcpToolName,
  resolveToolRenderer,
  CLAUDE_IN_CHROME_PREFIX,
} from "./registry";

export interface CardProps {
  block: ToolUseBlock;
  result?: ToolResultBlock | null;
  context?: ToolCardContext;
  /** Rendered in place of the raw OUT text, e.g. a diff or markdown view. */
  renderOutput?: (text: string) => ReactNode;
}

interface Card {
  header: (props: CardProps) => ReactNode;
  /** Returning null means the card is header-only. */
  body: (props: CardProps) => ReactNode;
  /** Suppresses the whole card, as `hidden = true` does officially. */
  hidden?: boolean;
}

const input = ({ block }: CardProps) => block.input ?? {};
const resultText = ({ result }: CardProps) =>
  result ? toolResultText(result.content) : "";
const basename = (path: string) => path.split(/[\\/]/).pop() || path;

/** The default body: the IN/OUT grid. */
function defaultBody(props: CardProps, toolName: string): ReactNode {
  const text = resultText(props);
  return (
    <ToolBody>
      <ToolInputRow
        input={input(props)}
        toolName={toolName}
        context={props.context}
      />
      <ToolOutputRow text={text} toolName={toolName} context={props.context}>
        {text && props.renderOutput ? props.renderOutput(text) : undefined}
      </ToolOutputRow>
    </ToolBody>
  );
}

/** A denial reason line, shown instead of output when the user rejected. */
function denialLine(props: CardProps): ReactNode {
  const reason = props.result ? toolDenialReason(props.result) : undefined;
  if (!reason) return null;
  return (
    <SecondaryLine>
      <b>Reason: </b> {reason}
    </SecondaryLine>
  );
}

// ---------------------------------------------------------------- Bash shell

function commandCard(toolName: string, commandLabel: string): Card {
  return {
    header: (props) => (
      <ToolHeader
        name={`${toolName} `}
        secondary={input(props).description as string | undefined}
        secondaryPlaintext
      />
    ),
    body: (props) => {
      const denial = denialLine(props);
      const command = (input(props).command as string) ?? "";
      const text = resultText(props);
      return (
        <>
          {denial}
          <ToolBody>
            <ToolInputRow
              input={command ? { command } : undefined}
              toolName={toolName}
              context={props.context}
            />
            {/* Official: output is suppressed once a denial reason shows. */}
            {denial ? null : (
              <ToolOutputRow
                text={text}
                toolName={toolName}
                context={props.context}
              />
            )}
          </ToolBody>
        </>
      );
    },
  };
}

// --------------------------------------------------------------- File tools

const readCard: Card = {
  header: (props) => {
    const path = input(props).file_path as string | undefined;
    if (!path) return <ToolHeader name="Read" />;
    const target = readOpenTarget(input(props));
    return (
      <ToolHeader
        name="Read "
        secondary={
          <FileLink
            path={path}
            onOpen={
              props.context?.openFile
                ? () => props.context!.openFile!(path, target)
                : undefined
            }
          />
        }
        trailing={
          readRangeSuffix(input(props)) ? (
            <span>{readRangeSuffix(input(props))}</span>
          ) : undefined
        }
      />
    );
  },
  // Official `zT1.body` returns null: the Read card is header-only.
  body: () => null,
};

const editCard: Card = {
  header: (props) => {
    const path = input(props).file_path as string | undefined;
    if (!path) return <ToolHeader name="Edit" secondary=" file" />;
    return (
      <ToolHeader
        name="Edit "
        secondary={
          <FileLink
            path={path}
            onOpen={
              props.context?.openFile
                ? () =>
                    props.context!.openFile!(path, {
                      searchText: input(props).new_string as string | undefined,
                    })
                : undefined
            }
          />
        }
      />
    );
  },
  body: (props) => (
    <>
      <SecondaryLine>
        {editSummary(
          input(props).old_string as string | undefined,
          input(props).new_string as string | undefined,
          props.result?.is_error,
        )}
      </SecondaryLine>
      {denialLine(props)}
      {props.renderOutput
        ? props.renderOutput(resultText(props))
        : null}
    </>
  ),
};

const writeCard: Card = {
  header: (props) => {
    const path = input(props).file_path as string | undefined;
    if (!path) return <ToolHeader name="Write" secondary=" file" />;
    return (
      <ToolHeader
        name="Write "
        secondary={
          <FileLink
            path={path}
            onOpen={
              props.context?.openFile
                ? () => props.context!.openFile!(path)
                : undefined
            }
          />
        }
      />
    );
  },
  body: (props) => {
    const content = input(props).content;
    const text =
      typeof content === "string" ? content : JSON.stringify(content, null, 2);
    const path = (input(props).file_path as string) ?? "";
    return (
      <>
        <SecondaryLine>
          {writeSummary(content, props.result?.is_error)}
        </SecondaryLine>
        {denialLine(props)}
        <ToolBody>
          <ToolOutputRow
            text={text}
            toolName={`Write ${basename(path) || "file"}`}
            context={props.context}
          />
        </ToolBody>
      </>
    );
  },
};

// Keeps the import list above tidy while staying a plain function call.
function require_writeSummary(content: unknown, isError?: boolean) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return writeSummaryImpl(content, isError);
}
import { writeSummary as writeSummaryImpl } from "./summaries";

// --------------------------------------------------------------- Search tools

const globCard: Card = {
  header: (props) => (
    <ToolHeader
      name="Glob"
      secondary={`pattern: "${input(props).pattern ?? ""}"`}
    />
  ),
  body: (props) => {
    if (!props.result) return null;
    const text = resultText(props);
    return (
      <SecondaryLine
        onClick={
          text && props.context?.openContent
            ? () => props.context!.openContent!(text, "Glob output")
            : undefined
        }
      >
        {globSummary(text)}
      </SecondaryLine>
    );
  },
};

const grepCard: Card = {
  header: (props) => (
    <ToolHeader
      name="Grep"
      secondary={`"${input(props).pattern ?? ""}"${grepQualifiers(input(props))}`}
    />
  ),
  body: (props) => {
    if (!props.result) return null;
    const text = resultText(props);
    return (
      <SecondaryLine
        onClick={
          text && props.context?.openContent
            ? () => props.context!.openContent!(text, "Grep output")
            : undefined
        }
      >
        {grepSummary(text)}
      </SecondaryLine>
    );
  },
};

const searchCard: Card = {
  header: (props) => (
    <ToolHeader
      name="Search"
      secondary={`pattern: "${input(props).pattern ?? ""}"`}
    />
  ),
  body: (props) => defaultBody(props, "Search"),
};

// ------------------------------------------------------------------ Web tools

const webFetchCard: Card = {
  header: (props) => {
    const url = input(props).url as string | undefined;
    const href = safeHttpUrl(url);
    return (
      <ToolHeader
        name="Web Fetch"
        secondary={
          href ? (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {url}
            </a>
          ) : (
            url
          )
        }
      />
    );
  },
  body: (props) => {
    const resultUrl = (props.result as { url?: string } | null | undefined)
      ?.url;
    if (props.result && !props.result.is_error && resultUrl)
      return (
        <div className="claude-tool-body-plain-text">
          Fetched from {resultUrl}
        </div>
      );
    // No IN row for WebFetch; fall back to the OUT row only.
    const text = resultText(props);
    return (
      <ToolBody>
        <ToolOutputRow
          text={text}
          toolName="WebFetch"
          context={props.context}
        />
      </ToolBody>
    );
  },
};

const webSearchCard: Card = {
  header: (props) => (
    <ToolHeader
      name="Web Search"
      secondary={input(props).query as string | undefined}
    />
  ),
  body: (props) => {
    const text = resultText(props);
    return (
      <ToolBody description={webSearchDescription(input(props))}>
        <ToolOutputRow
          text={text}
          toolName="WebSearch"
          context={props.context}
        />
      </ToolBody>
    );
  },
};

// ----------------------------------------------------------- Agent and skill

const agentCard: Card = {
  header: (props) => (
    <ToolHeader
      name="Agent:"
      secondary={input(props).description as string | undefined}
    />
  ),
  body: (props) => {
    const prompt = input(props).prompt as string | undefined;
    if (!prompt) return null;
    return (
      <ToolBody>
        <ToolOutputRow
          text={prompt}
          toolName="Agent"
          context={props.context}
        />
      </ToolBody>
    );
  },
};

const skillCard: Card = {
  header: (props) => {
    const skill = ((input(props).skill as string) ?? "").replace(/^\//, "");
    return <ToolHeader name={skill} secondary=" skill" />;
  },
  // Official `AT1.body` returns null.
  body: () => null,
};

const taskOutputCard: Card = {
  header: (props) => (
    <ToolHeader
      name="TaskOutput "
      secondary={
        input(props).task_id ? `task: "${input(props).task_id}"` : undefined
      }
    />
  ),
  body: (props) => {
    const text = resultText(props);
    return (
      <ToolBody>
        <ToolOutputRow
          text={text}
          toolName="TaskOutput"
          context={props.context}
        />
      </ToolBody>
    );
  },
};

// ------------------------------------------------------------------- Various

const todoWriteCard: Card = {
  header: () => <ToolHeader name="Update Todos" />,
  body: (props) => {
    const todos = input(props).todos;
    if (!Array.isArray(todos)) return defaultBody(props, "TodoWrite");
    return (
      <div className="claude-todo-list-container">
        <ul className="claude-todo-list">
          {todos.map((todo, index) => {
            const status = (todo as { status?: string }).status;
            return (
              <li
                key={index}
                className={`claude-todo-item${
                  status === "completed" ? " claude-todo-completed" : ""
                }`}
              >
                <input
                  type="checkbox"
                  disabled
                  checked={status === "completed"}
                  ref={(node) => {
                    // in_progress is shown as an indeterminate box, which
                    // cannot be expressed through the checked attribute.
                    if (node) node.indeterminate = status === "in_progress";
                  }}
                />
                <span className="claude-todo-content">
                  {(todo as { content?: string }).content}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    );
  },
};

const notebookEditCard: Card = {
  header: (props) => {
    const path = input(props).notebook_path as string | undefined;
    if (!path) return <ToolHeader name="Edit Notebook Cell" />;
    const cellId = input(props).cell_id as string | undefined;
    return (
      <ToolHeader
        name="Edit Notebook Cell "
        secondary={
          <FileLink
            path={path}
            onOpen={
              props.context?.openFile
                ? () => props.context!.openFile!(path)
                : undefined
            }
          >
            {cellId ? <span>:{cellId}</span> : null}
          </FileLink>
        }
      />
    );
  },
  body: (props) => (
    <>
      <SecondaryLine>
        {notebookStatus(!!props.result, props.result?.is_error)}
      </SecondaryLine>
      <div className="claude-tool-body">
        <div className="claude-tool-body-row-content claude-tool-body-row-content-unclipped">
          <pre>{(input(props).new_source as string) ?? "[No content]"}</pre>
        </div>
      </div>
    </>
  ),
};

const exitPlanModeCard: Card = {
  header: (props) => {
    const planFile = input(props).planFilePath as string | undefined;
    if (planFile)
      return (
        <ToolHeader
          // U+2019, matching the official string exactly.
          name={"Claude’s Plan "}
          secondary={
            <FileLink
              path={planFile}
              onOpen={
                props.context?.openFile
                  ? () => props.context!.openFile!(planFile)
                  : undefined
              }
            />
          }
        />
      );
    return (
      <ToolHeader
        name={input(props).plan ? "Claude’s Plan" : "Plan Mode"}
      />
    );
  },
  body: (props) => {
    const status = planModeStatus(!!props.result, props.result?.is_error);
    return status ? <SecondaryLine>{status}</SecondaryLine> : null;
  },
};

const askUserQuestionCard: Card = {
  header: (props) => {
    const questions = input(props).questions;
    const count = Array.isArray(questions)
      ? questions.filter(
          (q) => typeof (q as { question?: unknown })?.question === "string",
        ).length
      : 0;
    return <ToolHeader name={count === 1 ? "Question" : "Questions"} />;
  },
  body: (props) => {
    const text = resultText(props);
    if (!text) return null;
    return (
      <ToolBody>
        <ToolOutputRow
          text={text}
          toolName="AskUserQuestion"
          context={props.context}
        />
      </ToolBody>
    );
  },
};

const toolSearchCard: Card = {
  header: (props) => (
    <ToolHeader
      name="Search tools"
      secondary={`"${input(props).query ?? "…"}"`}
    />
  ),
  body: () => null,
  // Official `NT1.hidden = true`: the card is suppressed from the transcript.
  hidden: true,
};

const sandboxNetworkCard: Card = {
  header: (props) => (
    <ToolHeader
      name="Network Access"
      secondary={input(props).host as string | undefined}
    />
  ),
  body: (props) => {
    const text = resultText(props);
    return (
      <ToolBody>
        <ToolOutputRow
          text={text}
          toolName="SandboxNetworkAccess"
          context={props.context}
        />
      </ToolBody>
    );
  },
};

const readCoalescedCard: Card = {
  header: (props) => {
    const reads = input(props).fileReads;
    if (!Array.isArray(reads)) return <ToolHeader name="Read" />;
    return (
      <>
        <span className="claude-tool-name-text">Read </span>
        {reads.map((read, index) => {
          const entry = read as {
            file_path?: string;
            offset?: number;
            limit?: number;
          };
          const path = entry.file_path ?? "";
          return (
            <span key={index}>
              {index > 0 ? <span>, </span> : null}
              <span className="claude-tool-name-text-secondary">
                <FileLink
                  path={path}
                  onOpen={
                    props.context?.openFile
                      ? () =>
                          props.context!.openFile!(path, readOpenTarget(entry))
                      : undefined
                  }
                />
              </span>
              {readRangeSuffix(entry) ? (
                <span>{readRangeSuffix(entry)}</span>
              ) : null}
            </span>
          );
        })}
      </>
    );
  },
  // Official `XT1.body` returns null.
  body: () => null,
};

const sendUserFileCard: Card = {
  header: (props) => {
    const files = input(props).files;
    const list = (Array.isArray(files) ? files : [])
      .filter((f): f is string => typeof f === "string")
      .map((f) => f.trim())
      .filter((f) => f.length > 0);
    if (list.length === 0) return <ToolHeader name="SendUserFile" />;
    return (
      <>
        <span className="claude-tool-name-text">Sent </span>
        {list.map((path, index) => (
          <span key={index}>
            {index > 0 ? <span>, </span> : null}
            <span className="claude-tool-name-text-secondary">
              {isNonClickablePath(path) ? (
                path
              ) : (
                <FileLink
                  path={path}
                  onOpen={
                    props.context?.openFile
                      ? () => props.context!.openFile!(path)
                      : undefined
                  }
                />
              )}
            </span>
          </span>
        ))}
      </>
    );
  },
  body: (props) => {
    const caption = input(props).caption;
    const text = resultText(props);
    const failed = sendUserFileFailed(text, props.result?.is_error);
    return (
      <ToolBody
        description={typeof caption === "string" ? caption : undefined}
      >
        {failed ? (
          <ToolOutputRow
            text={text}
            toolName="SendUserFile"
            context={props.context}
          />
        ) : null}
      </ToolBody>
    );
  },
};

const artifactCard: Card = {
  header: (props) => (
    <ToolHeader
      name="Artifact"
      secondary={input(props).file_path as string | undefined}
    />
  ),
  body: (props) => {
    const href = artifactUrl(props.result?.content, props.result?.is_error);
    if (!href) {
      const text = resultText(props);
      return (
        <ToolBody>
          <ToolOutputRow
            text={text}
            toolName="Artifact"
            context={props.context}
          />
        </ToolBody>
      );
    }
    return (
      <div className="claude-tool-body-plain-text">
        {artifactAction(props.result?.content)} —{" "}
        <span className="claude-tool-name-text-secondary">
          <a href={href} target="_blank" rel="noopener noreferrer">
            Open artifact ↗
          </a>
        </span>
      </div>
    );
  },
};

/** `d_1` — renders nothing at all. */
const agentOutputCard: Card = {
  header: () => <ToolHeader name="AgentOutputTool" />,
  body: () => null,
};

// ------------------------------------------------------------------ Fallbacks

const mcpCard: Card = {
  header: (props) => {
    const raw = props.block.name;
    const server = humanizeMcpServerName(mcpServerName(raw));
    const tool = mcpToolName(raw);
    return (
      <ToolHeader
        name={`${server} [${tool}]`}
        secondary={mcpSecondaryText(input(props))}
      />
    );
  },
  body: (props) => {
    // No IN row for MCP tools.
    const text = resultText(props);
    return (
      <ToolBody>
        <ToolOutputRow
          text={text}
          toolName={props.block.name}
          context={props.context}
        >
          {text && props.renderOutput ? props.renderOutput(text) : undefined}
        </ToolOutputRow>
      </ToolBody>
    );
  },
};

const claudeInChromeCard: Card = {
  header: (props) => {
    const toolName = props.block.name.slice(CLAUDE_IN_CHROME_PREFIX.length);
    const tabId = input(props).tabId;
    return (
      <ToolHeader
        name={`Claude in Chrome [${humanizeMcpServerName(toolName)}]`}
        trailing={
          tabId !== undefined ? (
            <a
              href={`https://clau.de/chrome/tab/${tabId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="claude-tab-link"
            >
              [Show Tab]
            </a>
          ) : undefined
        }
      />
    );
  },
  body: (props) => defaultBody(props, props.block.name),
};

/** `j71` — the raw name is the title and the body is the default dump. */
const fallbackCard: Card = {
  header: (props) => <ToolHeader name={props.block.name} />,
  body: (props) => defaultBody(props, props.block.name),
};

const BUILTIN_CARDS: Record<string, Card> = {
  Bash: commandCard("Bash", "bash"),
  PowerShell: commandCard("PowerShell", "PowerShell"),
  Read: readCard,
  Edit: editCard,
  Write: writeCard,
  Glob: globCard,
  Grep: grepCard,
  Search: searchCard,
  WebFetch: webFetchCard,
  WebSearch: webSearchCard,
  Agent: agentCard,
  Skill: skillCard,
  TaskOutput: taskOutputCard,
  TodoWrite: todoWriteCard,
  NotebookEdit: notebookEditCard,
  ExitPlanMode: exitPlanModeCard,
  AskUserQuestion: askUserQuestionCard,
  ToolSearch: toolSearchCard,
  SandboxNetworkAccess: sandboxNetworkCard,
  ReadCoalesced: readCoalescedCard,
  SendUserFile: sendUserFileCard,
  Artifact: artifactCard,
  AgentOutputTool: agentOutputCard,
};

/** Resolves the card for a tool name, following the official dispatch order. */
export function cardFor(toolName: string): Card {
  const renderer = resolveToolRenderer(toolName);
  switch (renderer.kind) {
    case "builtin":
      return BUILTIN_CARDS[renderer.name] ?? fallbackCard;
    case "claude-in-chrome":
      return claudeInChromeCard;
    case "mcp":
      return mcpCard;
    default:
      return fallbackCard;
  }
}

/** Renders a complete tool card: header plus body. */
export function ToolCardView(props: CardProps) {
  const card = cardFor(props.block.name);
  if (card.hidden) return null;
  return (
    <div className="claude-tool-card">
      <div className="claude-tool-summary">
        <span className="claude-tool-name">{card.header(props)}</span>
      </div>
      {card.body(props)}
    </div>
  );
}
