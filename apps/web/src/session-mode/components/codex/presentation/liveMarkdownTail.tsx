import { useMemo } from "react";
import { NativeCodeFence } from "./NativeCodeFence";

type LiveBlock =
  | { type: "text"; text: string }
  | { type: "code"; language: string; text: string; open: boolean };

const INLINE = /\*\*([^*\n]+)\*\*|`([^`\n]+)`/g;

export function parseLiveBlocks(source: string): LiveBlock[] {
  const blocks: LiveBlock[] = [];
  const text: string[] = [];
  let fence: { language: string; marker: string; lines: string[] } | null = null;
  const flush = () => {
    if (!text.length) return;
    blocks.push({ type: "text", text: text.join("\n") });
    text.length = 0;
  };
  for (const line of source.split("\n")) {
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
    if (fence) fence.lines.push(line);
    else text.push(line);
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

function inlineText(value: string) {
  const nodes = [];
  let cursor = 0;
  let index = 0;
  for (const match of value.matchAll(INLINE)) {
    if (match.index > cursor) nodes.push(value.slice(cursor, match.index));
    nodes.push(
      match[1] !== undefined ? (
        <strong key={index}>{match[1]}</strong>
      ) : (
        <code key={index}>{match[2]}</code>
      ),
    );
    index += 1;
    cursor = match.index + match[0].length;
  }
  if (cursor < value.length) nodes.push(value.slice(cursor));
  return nodes;
}

/** The changing tail paints immediately. Closed blocks keep the full renderer. */
export function LiveMarkdownTail({ value }: { value: string }) {
  const blocks = useMemo(() => parseLiveBlocks(value), [value]);
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
        ) : (
          <div key={index} className="whitespace-pre-wrap break-words">
            {inlineText(block.text)}
          </div>
        ),
      )}
    </div>
  );
}
