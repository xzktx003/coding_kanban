export const TERMINAL_REPLAY_WRITE_CHARS = 2 * 1024;

export function splitTerminalReplayWrite(
  data: string,
  maxChunkChars = TERMINAL_REPLAY_WRITE_CHARS,
): string[] {
  if (!data || data.length <= maxChunkChars) {
    return data ? [data] : [];
  }

  const chunks: string[] = [];
  let start = 0;
  while (start < data.length) {
    let end = Math.min(start + maxChunkChars, data.length);
    const lastCodeUnit = data.charCodeAt(end - 1);
    const nextCodeUnit = data.charCodeAt(end);
    if (
      end < data.length &&
      lastCodeUnit >= 0xd800 &&
      lastCodeUnit <= 0xdbff &&
      nextCodeUnit >= 0xdc00 &&
      nextCodeUnit <= 0xdfff
    ) {
      end += 1;
    }
    chunks.push(data.slice(start, end));
    start = end;
  }
  return chunks;
}
