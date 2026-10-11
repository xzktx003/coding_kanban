/** The last fenced block in the latest assistant message that contains one. */
export function lastAssistantCodeBlock(events: readonly unknown[]): string | null {
  let found: string | null = null;
  for (const event of events) {
    const item = (event as { params?: { item?: { type?: string; text?: unknown } } })
      ?.params?.item;
    if (item?.type !== "agentMessage" || typeof item.text !== "string") continue;
    const blocks = [...item.text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)];
    if (blocks.length) found = blocks.at(-1)![1].replace(/\n$/, "");
  }
  return found;
}
