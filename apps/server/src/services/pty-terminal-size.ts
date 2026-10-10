export interface TerminalGridSize {
  cols: number;
  rows: number;
}

export function rememberTerminalConnectionSize(
  sizes: Map<string, Map<string, TerminalGridSize>>,
  agentSessionId: string,
  connectionId: string,
  cols: number,
  rows: number,
): void {
  if (
    !agentSessionId ||
    !connectionId ||
    !Number.isInteger(cols) ||
    !Number.isInteger(rows) ||
    cols <= 0 ||
    rows <= 0 ||
    cols > 500 ||
    rows > 200
  ) {
    return;
  }

  const clients = sizes.get(agentSessionId) ?? new Map<string, TerminalGridSize>();
  clients.set(connectionId, { cols, rows });
  sizes.set(agentSessionId, clients);
}

export function releaseTerminalConnection(
  sizes: Map<string, Map<string, TerminalGridSize>>,
  agentSessionId: string,
  connectionId: string,
): TerminalGridSize | null {
  const clients = sizes.get(agentSessionId);
  if (!clients?.has(connectionId)) {
    return null;
  }

  clients.delete(connectionId);
  if (clients.size === 0) {
    sizes.delete(agentSessionId);
    return null;
  }

  let widest: TerminalGridSize | null = null;
  for (const size of clients.values()) {
    if (!widest || size.cols > widest.cols) {
      widest = size;
    }
  }
  return widest;
}
