export type FormatKind =
  | "bold"
  | "italic"
  | "paragraph"
  | "h1"
  | "h2"
  | "h3"
  | "ul"
  | "ol"
  | "check"
  | "link";

function toggleChecklist(value: string) {
  const mark = /^- \[[ xX]\] /;
  const lines = value.split("\n");
  const content = lines.filter((line) => line.trim());
  if (content.length && content.every((line) => mark.test(line))) {
    return lines.map((line) => line.replace(mark, "")).join("\n");
  }
  return lines
    .map((line) =>
      line.trim()
        ? `- [ ] ${line.replace(/^(#{1,3} |[-*] |\d+\. )/, "")}`
        : line,
    )
    .join("\n");
}

function prefixLines(value: string, prefix: (index: number) => string) {
  return value.split("\n").map((line, index) => prefix(index) + line).join("\n");
}

/** Replacement for the selected composer text. A collapsed selection stays put. */
export function formatSelection(
  selected: string,
  kind: FormatKind,
  href = "",
): string | { error: string } | null {
  if (!selected && kind !== "paragraph") return null;
  if (kind === "bold") return `**${selected}**`;
  if (kind === "italic") return `*${selected}*`;
  if (kind === "paragraph")
    return selected
      .split("\n")
      .map((line) => line.replace(/^(#{1,3} |[-*] |\d+\. )/, ""))
      .join("\n");
  if (kind === "h1" || kind === "h2" || kind === "h3") {
    const marks = { h1: "# ", h2: "## ", h3: "### " }[kind];
    return prefixLines(selected, () => marks);
  }
  if (kind === "ul") return prefixLines(selected, () => "- ");
  if (kind === "ol") return prefixLines(selected, (index) => `${index + 1}. `);
  if (kind === "check") return toggleChecklist(selected);
  const url = href.trim();
  if (!/^https?:\/\//i.test(url)) return { error: "输入 HTTP 或 HTTPS 链接" };
  return `[${selected}](${url})`;
}

/** Formats the selected draft text. A caret formats the current line. */
export function formatDraftRange(
  value: string,
  start: number,
  end: number,
  kind: FormatKind,
): { value: string; start: number; end: number } | null {
  let from = Math.max(0, Math.min(value.length, start));
  let to = Math.max(from, Math.min(value.length, end));
  if (from === to) {
    from = value.lastIndexOf("\n", Math.max(0, from - 1)) + 1;
    const lineEnd = value.indexOf("\n", to);
    to = lineEnd === -1 ? value.length : lineEnd;
  }
  const formatted = formatSelection(value.slice(from, to), kind);
  if (typeof formatted !== "string") return null;
  return {
    value: value.slice(0, from) + formatted + value.slice(to),
    start: from,
    end: from + formatted.length,
  };
}
