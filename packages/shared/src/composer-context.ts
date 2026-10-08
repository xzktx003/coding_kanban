/** Immutable content captured when a message is composed, then frozen in its outbox entry. */
export interface ComposerContext {
  id: string;
  kind: "paste" | "quote" | "file";
  name: string;
  text: string;
  path?: string;
  range?: { start: number; end: number };
  sourceThreadId?: string;
  sourceItemId?: string;
}

export function composeContextText(text: string, contexts: ComposerContext[] = []): string {
  return [text, ...contexts.map((item) => {
    const label = item.kind === "paste" ? "粘贴的文本" : item.kind === "quote" ? "引用的回答" : "文件快照";
    const source = item.path ?? item.sourceThreadId;
    const fence = "`".repeat(Math.max(3, ...(item.text.match(/`+/g) ?? []).map(s => s.length + 1)));
    return `[${label}：${item.name}${source ? ` · ${source}` : ""}${item.range ? `:${item.range.start}-${item.range.end}` : ""}]\n${fence}\n${item.text}\n${fence}`;
  })].filter(Boolean).join("\n\n");
}
