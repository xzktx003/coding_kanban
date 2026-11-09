import { createDesktopPaneLayout } from "./desktop-pane-layout.mjs";

const failure = (code) =>
  Object.assign(new Error("Desktop selected pane unavailable"), { code });
const keys = ["hostId", "conversationId", "clientThreadId"];
function nativeIdentity(value) {
  try {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Reflect.ownKeys(value).length !== 3
    )
      return null;
    const result = {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, "value")) return null;
      const field = descriptor.value;
      if (key === "conversationId" && field === null) {
        result[key] = null;
        continue;
      }
      if (
        typeof field !== "string" ||
        field.length === 0 ||
        field.length > 512 ||
        /[\x00-\x1f\x7f]/.test(field)
      )
        return null;
      result[key] = field;
    }
    return Object.freeze(result);
  } catch {
    return null;
  }
}

/** One committed original main page; all presentation state is document-local. */
export function createDesktopSelectedPaneRegistry({
  footerOwnership,
  idFactory,
} = {}) {
  if (
    !footerOwnership ||
    !["bindPaneLayout", "clearTarget"].every(
      (key) => typeof footerOwnership[key] === "function",
    )
  )
    throw failure("SELECTED_PANE_INVALID_CONFIG");
  const layout = createDesktopPaneLayout(idFactory ? { idFactory } : {}),
    records = new Map(),
    listeners = new Set();
  let snapshot = null,
    unbind = null,
    closed = false,
    nextKey = 0;
  const notify = () => {
    for (const listener of [...listeners])
      try {
        listener();
      } catch {
        /* Revocation reaches all local consumers. */
      }
  };
  const update = () => {
    footerOwnership.clearTarget();
    layout.reconcile([]);
    const entry = records.size === 1 ? [...records.values()][0] : null;
    if (entry?.scope) {
      if (!unbind) unbind = footerOwnership.bindPaneLayout(layout);
      layout.open(entry.key);
      const state = layout.getSnapshot();
      snapshot = Object.freeze({
        owner: entry.owner,
        paneId: state.activeGroupId,
        tabKey: entry.key,
        layoutRevision: state.revision,
      });
    } else {
      snapshot = null;
      if (records.size === 0 && unbind) {
        const off = unbind;
        unbind = null;
        off();
      }
    }
    notify();
  };
  return Object.freeze({
    getSnapshot: () => snapshot,
    subscribe(listener) {
      if (typeof listener !== "function")
        throw failure("SELECTED_PANE_INVALID_LISTENER");
      if (closed) return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    attach(owner, value) {
      if (closed) throw failure("SELECTED_PANE_CLOSED");
      if (!owner || typeof owner !== "object")
        throw failure("SELECTED_PANE_INVALID_OWNER");
      if (!records.has(owner) && records.size >= 16) {
        footerOwnership.clearTarget();
        throw failure("SELECTED_PANE_OWNER_LIMIT");
      }
      const scope = nativeIdentity(value),
        previous = records.get(owner);
      const same =
        scope &&
        previous?.scope &&
        keys.every((key) => scope[key] === previous.scope[key]);
      if (!same && nextKey >= Number.MAX_SAFE_INTEGER)
        throw failure("SELECTED_PANE_OWNER_LIMIT");
      // This opaque key identifies only our presentation tab, never a native
      // thread or a source of RPC/write authority.
      const entry = {
        owner,
        scope,
        key: same ? previous.key : `native-${++nextKey}`,
      };
      records.set(owner, entry);
      try {
        update();
      } catch (error) {
        if (records.get(owner) === entry) records.delete(owner);
        snapshot = null;
        notify();
        throw error;
      }
      return () => {
        if (records.get(owner) !== entry) return;
        records.delete(owner);
        update();
      };
    },
    dispose() {
      if (closed) return;
      closed = true;
      records.clear();
      update();
      listeners.clear();
    },
  });
}

export function createDesktopSelectedPaneRuntime({
  React,
  layoutRuntime,
  enabled = false,
  idFactory,
} = {}) {
  if (
    !React ||
    ![
      "createElement",
      "useRef",
      "useLayoutEffect",
      "useSyncExternalStore",
    ].every((key) => typeof React[key] === "function") ||
    !layoutRuntime ||
    typeof layoutRuntime.DesktopLayoutBoundary !== "function" ||
    typeof layoutRuntime.DesktopPaneOwnershipProvider !== "function" ||
    typeof enabled !== "boolean"
  ) {
    throw failure("SELECTED_PANE_INVALID_CONFIG");
  }
  const registry = createDesktopSelectedPaneRegistry({
    footerOwnership: layoutRuntime.footerOwnership,
    idFactory,
  });
  function DesktopSelectedPaneBoundary({
    component,
    originalProps,
    nativeScope,
  }) {
    const owner = React.useRef(null);
    if (owner.current === null) owner.current = {};
    const eligible =
      enabled &&
      originalProps.showComposer === true &&
      originalProps.isReadOnly !== true &&
      originalProps.renderLayout == null;
    const hostId = nativeScope?.hostId,
      conversationId = nativeScope?.conversationId,
      clientThreadId = nativeScope?.clientThreadId;
    React.useLayoutEffect(() => {
      if (!eligible) return;
      try {
        return registry.attach(owner.current, {
          hostId,
          conversationId,
          clientThreadId,
        });
      } catch {
        return undefined;
      }
    }, [eligible, hostId, conversationId, clientThreadId]);
    const snapshot = React.useSyncExternalStore(
      registry.subscribe,
      registry.getSnapshot,
      () => null,
    );
    const selected = snapshot?.owner === owner.current ? snapshot : null;
    return React.createElement(
      layoutRuntime.DesktopPaneOwnershipProvider,
      {
        paneId: selected?.paneId,
        tabKey: selected?.tabKey,
        layoutRevision: selected?.layoutRevision,
      },
      React.createElement(layoutRuntime.DesktopLayoutBoundary, {
        component,
        originalProps,
        nativeScope,
        manageFooter: eligible,
      }),
    );
  }
  return Object.freeze({
    DesktopSelectedPaneBoundary,
    registry,
    dispose: registry.dispose,
  });
}
