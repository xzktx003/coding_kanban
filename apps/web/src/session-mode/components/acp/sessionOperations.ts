import { useAcpStore } from "@session/stores/useAcpStore";

// Native session/load and session/new change connection context. Serialize
// operations across project hooks and skip superseded work before issuing RPCs.
let version = 0;
let pending: Promise<unknown> = Promise.resolve();

export function invalidateAcpSessionOperation() {
  version++;
  const wasTransitioning = Boolean(useAcpStore.getState().sessionTransition);
  useAcpStore.setState({
    sessionTransition: null,
    connecting: false,
    ...(wasTransitioning
      ? {
          sessionTransitionError:
            "会话切换已取消，请重新打开目标会话以确认连接上下文。",
        }
      : {}),
  });
}

export function runAcpSessionOperation<T>(
  label: string,
  operation: (ownsSelection: () => boolean) => Promise<T>,
): Promise<T | undefined> {
  const currentVersion = ++version;
  useAcpStore.setState({
    sessionTransition: { version: currentVersion, label },
    sessionTransitionError: null,
  });
  const ownsSelection = () =>
    currentVersion === version &&
    useAcpStore.getState().sessionTransition?.version === currentVersion;
  const result = pending
    .catch(() => {})
    .then(async () => {
      if (!ownsSelection()) return;
      try {
        return await operation(ownsSelection);
      } finally {
        if (ownsSelection()) useAcpStore.setState({ sessionTransition: null });
      }
    });
  pending = result;
  return result;
}
