export const DEFAULT_INITIAL_TERMINAL_REPLAY_BYTES = 512 * 1024;

export function resolveTerminalReplayByteLimit(
  requestedValue: string | undefined,
  maximumBytes: number,
): number {
  const boundedMaximum = Math.min(
    maximumBytes,
    DEFAULT_INITIAL_TERMINAL_REPLAY_BYTES,
  );
  if (!requestedValue || !/^\d+$/.test(requestedValue)) {
    return boundedMaximum;
  }
  const requestedBytes = Number(requestedValue);
  if (!Number.isSafeInteger(requestedBytes) || requestedBytes < 1) {
    return boundedMaximum;
  }
  return Math.min(requestedBytes, boundedMaximum);
}

export function takeUtf8Tail(value: string, maximumBytes: number): string {
  const buffer = Buffer.from(value, "utf8");
  if (buffer.byteLength <= maximumBytes) return value;

  let start = buffer.byteLength - maximumBytes;
  while (start < buffer.byteLength && (buffer[start]! & 0xc0) === 0x80) {
    start += 1;
  }
  return buffer.subarray(start).toString("utf8");
}
