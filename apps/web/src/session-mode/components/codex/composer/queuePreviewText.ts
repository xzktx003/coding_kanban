import MarkdownIt from "markdown-it";
import type { FollowupMessage } from "@agent-orchestrator/shared";
const markdown = new MarkdownIt({ html: false });
/** Mirrors the native queued summary where our captured context types overlap. */
export function queuePreviewText(
  message: Pick<FollowupMessage, "text" | "images" | "contexts">,
): string {
  if (message.text.trim()) {
    if (!/^(?:`{3,}|~{3,})/.test(message.text.trim())) return message.text;
    return markdown
      .parse(message.text, {})
      .flatMap((token) =>
        token.type === "inline"
          ? (token.children ?? []).map((child) => child.content)
          : token.type === "fence" || token.type === "code_block"
            ? [token.content]
            : [],
      )
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }
  const contexts = message.contexts ?? [];
  const pastes = contexts.filter((item) => item.kind === "paste");
  if (pastes.length) {
    // Native Y5t: whitespace-normalized 80 UTF-16-unit attachment title.
    // The complete captured text stays in contexts for the details sheet.
    const normalized = pastes[0].text.trim().replace(/\s+/g, " ");
    const preview =
      (normalized.length > 80 ? `${normalized.slice(0, 79)}…` : normalized) ||
      "粘贴的文本";
    return pastes.length > 1
      ? `${preview} (+其余 ${pastes.length - 1} 个粘贴文本附件)`
      : preview;
  }
  if (contexts.length) {
    const files = contexts.filter(
      (item) => item.kind === "file" && !item.range,
    );
    const selections = contexts.filter(
      (item) => item.kind === "quote" || (item.kind === "file" && item.range),
    );
    return [
      files.length
        ? `${files.length} 个文件：${files.map((item) => item.name).join("、")}`
        : "",
      selections.length ? `${selections.length} 个已选文本片段` : "",
    ]
      .filter(Boolean)
      .join(" · ");
  }
  return message.images.length ? `${message.images.length} 张图像` : "空消息";
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
export function queuePreviewLabel(summary: string): string {
  const parts: string[] = [];
  for (const { segment } of graphemes.segment(
    summary.replace(/\s+/g, " ").trim(),
  )) {
    if (parts.length === 80) return `${parts.slice(0, 79).join("")}…`;
    parts.push(segment);
  }
  return parts.join("");
}
