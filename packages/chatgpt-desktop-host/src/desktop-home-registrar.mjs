// The original new-chat composer has no GI footer. Register its committed
// original scope in the same single-owner registry used by GI. This lease is
// document-local editing ownership and never conveys native RPC authority.
export function createDesktopHomeRegistrar({
  React,
  registry,
  footerOwnership,
  Registrar,
  enabled,
} = {}) {
  if (
    !React ||
    ![
      "createElement",
      "memo",
      "useMemo",
      "useRef",
      "useLayoutEffect",
      "useSyncExternalStore",
    ].every((key) => typeof React[key] === "function") ||
    !registry ||
    !["attach", "getSnapshot", "subscribe"].every(
      (key) => typeof registry[key] === "function",
    ) ||
    !footerOwnership ||
    !["createSlot", "commitTarget"].every(
      (key) => typeof footerOwnership[key] === "function",
    ) ||
    typeof Registrar !== "function" ||
    typeof enabled !== "boolean"
  ) {
    throw Object.assign(new Error("Desktop home registrar unavailable"), {
      code: "HOME_REGISTRAR_INVALID_CONFIG",
    });
  }
  const StableRegistrar = React.memo(Registrar);
  return function DesktopHomeRegistrar({ scope }) {
    const owner = React.useRef(null);
    const slot = React.useRef(null);
    if (slot.current === null) slot.current = footerOwnership.createSlot();
    const hostId = scope?.hostId,
      conversationId = scope?.conversationId,
      clientThreadId = scope?.clientThreadId,
      isMain = scope?.isMain;
    // Native creation retires the draft owner. A later draft in the same
    // mounted component is a new source; the original client keeps its source
    // while its conversation ID changes from null to the native ID.
    if (
      owner.current === null ||
      owner.current.clientThreadId !== clientThreadId
    )
      owner.current = { clientThreadId, token: {} };
    const ownerToken = owner.current.token;
    // Equal primitive identity in an unrelated parent rerender is not a new
    // confirmation. Mode and pane leases separately revoke explicit changes.
    const stableScope = React.useMemo(
      () => scope,
      [hostId, conversationId, clientThreadId, isMain],
    );
    React.useLayoutEffect(() => {
      if (!enabled || isMain !== true) return undefined;
      try {
        return registry.attach(ownerToken, {
          hostId,
          conversationId,
          clientThreadId,
        });
      } catch {
        return undefined;
      }
    }, [hostId, conversationId, clientThreadId, isMain, ownerToken]);
    const snapshot = React.useSyncExternalStore(
      registry.subscribe,
      registry.getSnapshot,
      () => null,
    );
    const selection =
      snapshot && Object.hasOwn(snapshot, "selected")
        ? snapshot.selected
        : snapshot;
    const selected = selection?.owner === ownerToken ? selection : null;
    React.useLayoutEffect(() => {
      if (!selected) return undefined;
      let releaseSlot;
      try {
        releaseSlot = slot.current.commit(selected.paneId);
        const releaseTarget = footerOwnership.commitTarget(
          {
            paneId: selected.paneId,
            tabKey: selected.tabKey,
            hostId,
            conversationId,
            clientThreadId,
          },
          selected.layoutRevision,
        );
        return () => {
          releaseTarget();
          releaseSlot();
        };
      } catch {
        releaseSlot?.();
        return undefined;
      }
    }, [
      selected?.paneId,
      selected?.tabKey,
      selected?.layoutRevision,
      selected?.selectionEpoch,
      hostId,
      conversationId,
      clientThreadId,
    ]);
    return React.createElement(StableRegistrar, {
      scope: stableScope,
      paneLease: slot.current.lease,
    });
  };
}
