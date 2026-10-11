import MarkdownIt from "markdown-it";
import type { CodexErrorInfo } from "@session/bindings/v2/CodexErrorInfo";

const linkifier = new MarkdownIt({ linkify: true }).linkify;
type SourceRange = readonly [number, number];
type MarkupObservation = {
  markers: Map<number, SourceRange>;
  ranges: SourceRange[];
};
const formatting = new MarkdownIt({ linkify: true });
// Observe existing delimiter rules rather than interpreting underscores inside
// URLs as emphasis. This parser never formats or replaces provider text.
formatting.inline.ruler.before(
  "strikethrough",
  "native-error-positions",
  (state, silent) => {
    const marker = state.src[state.pos];
    if (silent || !["*", "_", "~"].includes(marker)) return false;
    const observation = state.env as MarkupObservation;
    const { length } = state.scanDelims(state.pos, marker !== "_");
    if (marker === "~" && length < 2) return false;
    let index = state.tokens.length + (state.pending ? 1 : 0);
    let position = state.pos;
    const end = position + length;
    if (marker === "~" && length % 2)
      observation.markers.set(index++, [position, ++position]);
    const step = marker === "~" ? 2 : 1;
    while (position < end) {
      observation.markers.set(index++, [position, position + step]);
      position += step;
    }
    return false;
  },
);
formatting.inline.ruler2.before(
  "balance_pairs",
  "native-error-marker-ranges",
  (state) => {
    const observation = state.env as MarkupObservation;
    for (const [index, range] of observation.markers) {
      const token = state.tokens[index];
      if (token) token.meta = { ...token.meta, nativeErrorRange: range };
    }
    return false;
  },
);
formatting.inline.ruler2.before(
  "fragments_join",
  "native-error-formatting-ranges",
  (state) => {
    const observation = state.env as MarkupObservation;
    const starts: number[] = [];
    for (const token of state.tokens) {
      const range = token.meta?.nativeErrorRange as SourceRange | undefined;
      if (!range) continue;
      if (["em_open", "strong_open", "s_open"].includes(token.type))
        starts.push(range[0]);
      else if (["em_close", "strong_close", "s_close"].includes(token.type)) {
        const start = starts.pop();
        if (start !== undefined) observation.ranges.push([start, range[1]]);
      }
    }
    return false;
  },
);

export function nativeErrorMessage(message: string | undefined) {
  if (!message) return "本轮执行失败：未返回具体错误，请查看运行日志。";
  try {
    const parsed: unknown = JSON.parse(message);
    if (parsed && typeof parsed === "object" && "error" in parsed) {
      const error = parsed.error;
      if (
        error &&
        typeof error === "object" &&
        "message" in error &&
        typeof error.message === "string"
      )
        return error.message;
    }
  } catch {
    // Native vln leaves ordinary provider text unchanged.
  }
  return message;
}

/** Native mOi keeps Markdown syntax literal and links bare valid HTTP URLs. */
export function nativeErrorParts(
  message: string,
): Array<{ text: string; href?: string }> {
  const protectedRanges = Array.from(
    message.matchAll(
      /(`+)[\s\S]*?\1|!?\[[^\]\r\n]*\]\([^\r\n]*?\)|<[^>\r\n]*>/g,
    ),
    (match) => [match.index, match.index + match[0].length] as const,
  );
  const observation: MarkupObservation = { markers: new Map(), ranges: [] };
  formatting.parseInline(message, observation);
  protectedRanges.push(...observation.ranges);
  const parts: Array<{ text: string; href?: string }> = [];
  let position = 0;
  for (const match of linkifier.match(message) ?? []) {
    if (
      !/^https?:\/\//i.test(match.raw) ||
      !URL.canParse(match.url) ||
      protectedRanges.some(
        ([start, end]) => match.index < end && match.lastIndex > start,
      )
    )
      continue;
    if (match.index > position)
      parts.push({ text: message.slice(position, match.index) });
    parts.push({ text: match.raw, href: match.url });
    position = match.lastIndex;
  }
  if (position < message.length) parts.push({ text: message.slice(position) });
  return parts;
}

export function nativeReconnectProgress(message: string) {
  const match = /^Reconnecting(?:\.\.\.)?\s+(\d+)\/(\d+)$/.exec(message.trim());
  return match ? `${Number(match[1])}/${Number(match[2])}` : null;
}

export function nativeRetryIsOverloaded(errorInfo?: CodexErrorInfo | null) {
  const disconnected =
    typeof errorInfo === "object" &&
    errorInfo !== null &&
    "responseStreamDisconnected" in errorInfo
      ? errorInfo.responseStreamDisconnected
      : null;
  return (
    errorInfo === "serverOverloaded" ||
    (typeof disconnected === "object" &&
      disconnected !== null &&
      disconnected.httpStatusCode === 429)
  );
}
