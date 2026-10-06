import type { CCMessage } from '../types/messages';

/**
 * Parse lines from a Claude Code session JSONL file into CCMessage objects.
 * Replicates the normalization previously done in the Rust resume_session handler:
 * - Filters to types: user | assistant | system | result
 * - Normalizes user messages from {message:{role,content}} to top-level text/content
 * - Ensures session_id is present on every message
 */
export function parseSessionJsonl(lines: string[], sessionId: string): CCMessage[] {
  const messages: CCMessage[] = [];

  for (const rawLine of lines) {
    const line = rawLine.replace(/\0/g, '').trim();
    if (!line || !line.endsWith('}')) continue;

    let val: Record<string, unknown>;
    try {
      val = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    const msgType = typeof val.type === 'string' ? val.type : '';
    if (!['user', 'assistant', 'system', 'result'].includes(msgType)) continue;

    // Only keep real user messages (those with permissionMode set by the CLI).
    // System-injected entries (slash commands, meta messages) never have permissionMode.
    if (msgType === 'user') {
      if (val.permissionMode === undefined || val.permissionMode === null) continue;

      const msg = val.message as Record<string, unknown> | undefined;
      const content = msg?.content;
      if (typeof content === 'string') {
        val.text = content;
        delete val.message;
      } else if (Array.isArray(content)) {
        val.content = content;
        delete val.message;
      }
    }

    if (!val.session_id) val.session_id = sessionId;

    messages.push(val as unknown as CCMessage);
  }

  return messages;
}
