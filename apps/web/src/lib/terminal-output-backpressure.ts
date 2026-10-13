export interface TerminalOutputBackpressureLimits {
  maxPendingChars: number;
  maxPendingChunks: number;
}

export interface TerminalOutputBackpressureState {
  pendingChars: number;
  pendingChunks: number;
}

export const DEFAULT_TERMINAL_OUTPUT_BACKPRESSURE_LIMITS: TerminalOutputBackpressureLimits =
  {
    maxPendingChars: 1024 * 1024,
    maxPendingChunks: 1024,
  };

export function createTerminalOutputBackpressureState(): TerminalOutputBackpressureState {
  return {
    pendingChars: 0,
    pendingChunks: 0,
  };
}

export function measureTerminalOutputChunks(chunks: readonly string[]): {
  chars: number;
  chunks: number;
} {
  return {
    chars: chunks.reduce((total, chunk) => total + chunk.length, 0),
    chunks: chunks.length,
  };
}

export function reserveTerminalOutputCapacity(
  state: TerminalOutputBackpressureState,
  chunks: readonly string[],
  limits: TerminalOutputBackpressureLimits = DEFAULT_TERMINAL_OUTPUT_BACKPRESSURE_LIMITS,
): boolean {
  const measured = measureTerminalOutputChunks(chunks);
  if (
    state.pendingChars + measured.chars > limits.maxPendingChars ||
    state.pendingChunks + measured.chunks > limits.maxPendingChunks
  ) {
    return false;
  }

  state.pendingChars += measured.chars;
  state.pendingChunks += measured.chunks;
  return true;
}

export function releaseTerminalOutputCapacity(
  state: TerminalOutputBackpressureState,
  chunk: string,
): void {
  state.pendingChars = Math.max(0, state.pendingChars - chunk.length);
  state.pendingChunks = Math.max(0, state.pendingChunks - 1);
}

export function resetTerminalOutputCapacity(
  state: TerminalOutputBackpressureState,
): void {
  state.pendingChars = 0;
  state.pendingChunks = 0;
}
