export interface CodexPriorConversation {
  conversation: Array<{
    role: "user" | "assistant";
    content: Array<{ content_type: "text"; text: string }>;
  }>;
  diff: { type: "output_diff"; diff: string } | null;
}
const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
/** Mirrors enabled VSIX sFi semantics using native thread data, with no plugin code import. */
export function projectCodexPriorConversation(
  value: unknown,
): CodexPriorConversation {
  const wrapper = object(value),
    thread = object(wrapper?.thread) ?? wrapper;
  if (!Array.isArray(thread?.turns))
    throw new Error("原生会话历史格式不兼容，未委派到云端");
  const conversation: CodexPriorConversation["conversation"] = [];
  let lastDiff: string | null = null;
  for (const raw of thread.turns) {
    const turn = object(raw);
    if (!turn || !Array.isArray(turn.items)) continue;
    const status =
      typeof turn.status === "string" ? turn.status : object(turn.status)?.type;
    const completed = status === "completed";
    if (completed && typeof turn.diff === "string") lastDiff = turn.diff;
    for (const rawItem of turn.items) {
      const item = object(rawItem);
      if (!item) continue;
      if (item.type === "userMessage" && Array.isArray(item.content)) {
        const text = item.content
          .map(object)
          .filter(
            (entry) => entry?.type === "text" && typeof entry.text === "string",
          )
          .map((entry) => entry!.text as string)
          .join("\n");
        conversation.push({
          role: "user",
          content: [{ content_type: "text", text }],
        });
      } else if (
        item.type === "agentMessage" &&
        completed &&
        typeof item.text === "string"
      ) {
        conversation.push({
          role: "assistant",
          content: [{ content_type: "text", text: item.text }],
        });
      } else if (
        completed &&
        item.type === "turnDiff" &&
        typeof item.diff === "string"
      )
        lastDiff = item.diff;
    }
  }
  if (JSON.stringify(conversation).length > 2 * 1024 * 1024)
    throw new Error("原生公开对话超出云委派限制，请减少历史范围");
  return {
    conversation,
    diff: lastDiff === null ? null : { type: "output_diff", diff: lastDiff },
  };
}
