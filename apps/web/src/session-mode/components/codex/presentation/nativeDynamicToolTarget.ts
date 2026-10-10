export type NativeDynamicToolTarget = (
  | { threadId: string }
  | { clientThreadId: string }
) & { kind: "codex" | "chatgpt"; hostId?: string };
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const id = (value: unknown) =>
  typeof value === "string" &&
  value.trim() &&
  value.length <= 512 &&
  !/[\u0000-\u001f]/.test(value)
    ? value.trim()
    : null;
/** Original W/kn/aWt target contract; creation never guesses a result from its arguments. */
export function nativeDynamicToolTarget(
  value: unknown,
): NativeDynamicToolTarget | null {
  const item = object(value),
    args = object(item.arguments);
  if (item.namespace !== "codex_app") return null;
  if (item.tool === "read_thread" || item.tool === "send_message_to_thread") {
    const threadId = id(args.threadId);
    return threadId && threadId === args.threadId
      ? { kind: "codex", threadId }
      : null;
  }
  if (
    item.tool !== "create_thread" ||
    item.status !== "completed" ||
    item.success !== true
  )
    return null;
  if (item.transcriptMetadataOnly === true) {
    const target = object(item.nativeTarget), kind = target.kind;
    if (kind !== "codex" && kind !== "chatgpt") return null;
    const threadId = id(target.threadId), clientThreadId = id(target.clientThreadId);
    const identity = threadId ? { threadId } : clientThreadId && (kind === "chatgpt" || clientThreadId.startsWith("client-new-thread:")) ? { clientThreadId } : null;
    const hostId = target.hostId === undefined ? undefined : id(target.hostId);
    if (!identity || hostId === null) return null;
    return { kind, ...identity, ...(kind === "codex" && hostId ? { hostId } : {}) };
  }
  if (!Array.isArray(item.contentItems)) return null;
  const first = item.contentItems
    .map(object)
    .find((content) => content.type === "inputText");
  if (typeof first?.text !== "string" || first.text.length > 65536) return null;
  try {
    const parsed = object(JSON.parse(first.text)),
      kind = parsed.kind ?? "codex";
    if (kind !== "codex" && kind !== "chatgpt") return null;
    const threadId = id(parsed.threadId),
      clientThreadId = id(parsed.clientThreadId);
    const identity = threadId
      ? { threadId }
      : clientThreadId &&
          (kind === "chatgpt" ||
            clientThreadId.startsWith("client-new-thread:"))
        ? { clientThreadId }
        : null;
    if (!identity) return null;
    const hostId = parsed.hostId === undefined ? undefined : id(parsed.hostId);
    if (hostId === null) return null;
    return {
      kind,
      ...identity,
      ...(kind === "codex" && hostId ? { hostId } : {}),
    };
  } catch {
    return null;
  }
}
