import { useMemo, type ReactNode } from "react";
import { toast } from "sonner";
import { openWorkspaceFileReference } from "@session/services/openWorkspaceFileReference";
import { openVsCodePanel } from "@session/stores/useVsCodePanelStore";
import { editorHostFor } from "@session/features/codex-host/bridge";
import { sessionDraftKey } from "@session/stores/useSessionDraftStore";
import { NativeCodeFence } from "./NativeCodeFence";
import { CodexMarkdown } from "./CodexMarkdown";
import { resolveLiteralFilePath } from "./fileReference";
import { NativeFileCitationPill } from "@session/features/native-citations/NativeFileCitationPill";
import { parseNativeFileCitations } from "@session/features/native-citations/nativeFileCitations";
import type {
  NativeCitationFileReference,
  NativeCitationOwner,
} from "@session/features/native-citations/NativeFileCitationPill";
import { useCodexContentOwner } from "./ownerContext";

/** Same open path as the settled CodexMarkdown renderer so a live-tail pill
 * presents the exact file-open behavior instead of a second divergent handler.
 */
function nativeFileCitationOpen(
  reference: NativeCitationFileReference,
  captured: NativeCitationOwner,
) {
  const root = captured.cwd
    ? resolveLiteralFilePath(captured.cwd)
    : reference.path.startsWith("/")
      ? "/"
      : null;
  if (!root) {
    toast.error("无法确定文件所属会话目录");
    return;
  }
  void openWorkspaceFileReference(reference, root, (target) => {
    const host = editorHostFor({
      cwd: target.root,
      threadId: captured.threadId ?? null,
      draftOwner: sessionDraftKey(
        "codex",
        captured.threadId ?? null,
        target.root,
      ),
    });
    if (host) {
      openVsCodePanel();
      void host.command({
        type: "openLocation",
        path: target.path,
        line: reference.line,
        column: 1,
      });
    }
  });
}

type LiveBlock =
  | { type: "text"; text: string }
  | { type: "table"; text: string }
  | { type: "code"; language: string; text: string; open: boolean };

const INLINE = /\*\*([^*\n]+)\*\*|`([^`\n]+)`/g;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/;

function startsGfmTable(lines: string[], index: number) {
  return (
    lines[index]?.includes("|") === true &&
    TABLE_SEPARATOR.test(lines[index + 1] ?? "")
  );
}

export function parseLiveBlocks(source: string): LiveBlock[] {
  const blocks: LiveBlock[] = [];
  const text: string[] = [];
  const lines = source.split("\n");
  let fence: { language: string; marker: string; lines: string[] } | null = null;
  const flush = () => {
    if (!text.length) return;
    blocks.push({ type: "text", text: text.join("\n") });
    text.length = 0;
  };
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const marker = /^\s*(`{3,}|~{3,})([A-Za-z0-9_+-]*)\s*$/.exec(line);
    if (
      marker &&
      (!fence ||
        (!marker[2] &&
          marker[1][0] === fence.marker[0] &&
          marker[1].length >= fence.marker.length))
    ) {
      if (fence) {
        flush();
        blocks.push({
          type: "code",
          language: fence.language || "text",
          text: fence.lines.join("\n"),
          open: false,
        });
        fence = null;
      } else {
        flush();
        fence = { language: marker[2], marker: marker[1], lines: [] };
      }
      continue;
    }
    if (fence) {
      fence.lines.push(line);
      continue;
    }
    if (startsGfmTable(lines, index)) {
      flush();
      const table = [line, lines[++index]];
      while (index + 1 < lines.length && lines[index + 1].includes("|"))
        table.push(lines[++index]);
      blocks.push({ type: "table", text: table.join("\n") });
      continue;
    }
    text.push(line);
  }
  if (fence)
    blocks.push({
      type: "code",
      language: fence.language || "text",
      text: fence.lines.join("\n"),
      open: true,
    });
  else flush();
  return blocks;
}

type InlineToken = {
  start: number;
  end: number;
  kind: "strong" | "code" | "citation";
  citation?: Parameters<typeof NativeFileCitationPill>[0]["citation"];
};

/** Merge inline emphasis/code runs and native file-citation directives into a
 * single source-ordered, non-overlapping stream so a citation never renders
 * twice. A directive that starts at the same offset as a bold/code marker wins
 * (that marker belongs to the directive's own source), while a directive inside
 * an inline code span stays literal, matching the settled renderer.
 */
function inlineTokens(value: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  for (const match of value.matchAll(INLINE)) {
    tokens.push({
      start: match.index,
      end: match.index + match[0].length,
      kind: match[1] !== undefined ? "strong" : "code",
    });
  }
  for (const match of parseNativeFileCitations(value)) {
    tokens.push({
      start: match.sourceStart,
      end: match.sourceEnd,
      kind: "citation",
      citation: match.citation,
    });
  }
  tokens.sort(
    (a, b) => a.start - b.start || (a.kind === "citation" ? -1 : 1),
  );
  const merged: InlineToken[] = [];
  for (const token of tokens) {
    if (token.start < (merged.at(-1)?.end ?? 0)) continue;
    merged.push(token);
  }
  return merged;
}

function renderLiveText(
  value: string,
  owner: NativeCitationOwner,
  onOpen: (
    reference: NativeCitationFileReference,
    owner: NativeCitationOwner,
  ) => void,
  keys: { n: number } = { n: 0 },
): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const token of inlineTokens(value)) {
    if (token.start < cursor) continue;
    if (token.start > cursor) nodes.push(value.slice(cursor, token.start));
    if (token.kind === "citation" && token.citation) {
      nodes.push(
        <NativeFileCitationPill
          key={keys.n++}
          citation={token.citation}
          owner={owner}
          onOpen={onOpen}
        />,
      );
    } else if (token.kind === "strong") {
      // A citation nested inside **emphasis** renders as a pill inside the
      // strong (matching the settled CodexMarkdown) instead of staying literal.
      // We re-parse the strong inner so a directive there becomes a pill, while
      // an inline code span inside the strong keeps its source literal.
      const inner = value.slice(token.start + 2, token.end - 2);
      nodes.push(
        <strong key={keys.n++}>{renderLiveText(inner, owner, onOpen, keys)}</strong>,
      );
    } else if (token.kind === "code") {
      nodes.push(<code key={keys.n++}>{value.slice(token.start + 1, token.end - 1)}</code>);
    }
    cursor = token.end;
  }
  if (cursor < value.length) nodes.push(value.slice(cursor));
  return nodes;
}

/** The changing tail paints immediately. Closed blocks keep the full renderer. */
export function LiveMarkdownTail({
  value,
  threadId,
}: {
  value: string;
  threadId?: string;
}) {
  const blocks = useMemo(() => parseLiveBlocks(value), [value]);
  const owner = useCodexContentOwner(threadId);
  return (
    <div className="codex-markdown" data-streaming-live-tail>
      {blocks.map((block, index) =>
        block.type === "code" ? (
          <NativeCodeFence
            key={index}
            code={block.text}
            language={block.language}
            streaming={block.open}
          />
        ) : block.type === "table" ? (
          <CodexMarkdown
            key={index}
            value={block.text}
            threadId={threadId}
            streaming
          />
        ) : (
          <div key={index} className="whitespace-pre-wrap break-words">
            {renderLiveText(block.text, owner, nativeFileCitationOpen)}
          </div>
        ),
      )}
    </div>
  );
}
