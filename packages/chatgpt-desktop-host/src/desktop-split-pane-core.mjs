import { createDesktopPaneLayout } from "./desktop-pane-layout.mjs";
import { encodeWireValue, decodeWireValue } from "./wire-value.mjs";

const SCOPE_KEYS = ["hostId", "conversationId", "clientThreadId"];
const MAX_OWNERS = 16;
const MAX_TABS = 128;
const MAX_DRAFT_SOURCES = 32;
const CONTEXT_LIMITS = Object.freeze({
  maxEncodedBytes: 65536,
  maxDecodedBytes: 65536,
  maxNodes: 2048,
  maxDepth: 16,
});
const failure = (code) =>
  Object.assign(new Error("Desktop split pane unavailable"), { code });

function visibleTabKeys(node) {
  return node.type === "group"
    ? node.keys
    : [...visibleTabKeys(node.first), ...visibleTabKeys(node.second)];
}
function paneGroups(node) {
  return node.type === "group"
    ? [node]
    : [...paneGroups(node.first), ...paneGroups(node.second)];
}
function numberedTabKeys(snapshot) {
  const visible = new Set(visibleTabKeys(snapshot.layout.tree));
  return snapshot.entries.filter((entry) => visible.has(entry.key)).map((entry) => entry.key);
}

// Scope comes only from a committed original GI boundary. It identifies a
// presentation target; it does not authorize a connection, resume or send.
function nativeScope(value) {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw Error();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const names = Reflect.ownKeys(descriptors);
    if (
      names.length !== SCOPE_KEYS.length ||
      names.some((name) => !SCOPE_KEYS.includes(name))
    )
      throw Error();
    const scope = {};
    for (const name of SCOPE_KEYS) {
      const descriptor = descriptors[name];
      if (!descriptor || !Object.hasOwn(descriptor, "value")) throw Error();
      const item = descriptor.value;
      if (name === "conversationId" && item === null) {
        scope[name] = null;
        continue;
      }
      if (
        typeof item !== "string" ||
        item.length === 0 ||
        item.length > 512 ||
        /[\x00-\x1f\x7f]/.test(item)
      )
        throw Error();
      scope[name] = item;
    }
    return Object.freeze(scope);
  } catch {
    throw failure("SPLIT_PANE_INVALID_SCOPE");
  }
}
// Inspect only the fixed identity fields of a live original scope. Extra
// values remain in the original providers and are never copied or invoked.
function liveContextMatches(value, identity) {
  try {
    const scope = nativeScope(identity);
    function own(object, key, optional = false) {
      if (!object || typeof object !== "object") throw Error();
      const descriptor = Object.getOwnPropertyDescriptor(object, key);
      if (!descriptor && optional) return undefined;
      if (!descriptor || !Object.hasOwn(descriptor, "value")) throw Error();
      return descriptor.value;
    }
    const thread = own(value, "thread"),
      route = own(value, "route"),
      composer = own(value, "composer"),
      routeThreadId = own(route, "clientThreadId", true),
      routeHostId = own(route, "hostId", true),
      routeKind = own(route, "routeKind", true);
    const routeConversation = own(route, "conversationId", true);
    const routeMatches =
      routeKind === "client-local-thread"
        ? routeThreadId === scope.clientThreadId && routeConversation == null
        : (routeConversation ?? null) === scope.conversationId;
    return (
      own(thread, "clientThreadId") === scope.clientThreadId &&
      routeMatches &&
      (routeHostId == null || routeHostId === scope.hostId) &&
      (routeThreadId == null || routeThreadId === scope.clientThreadId) &&
      own(composer, "clientThreadId") === scope.clientThreadId &&
      own(composer, "conversationId") === scope.conversationId
    );
  } catch {
    return false;
  }
}
function captureContext(value, scope, encoded) {
  if (value === undefined) return undefined;
  try {
    // Detach the complete bounded graph from native provider objects before it
    // is retained by a background pane. Never read accessors or toJSON.
    const detached = decodeWireValue(
      encoded ?? encodeWireValue(value, CONTEXT_LIMITS),
      CONTEXT_LIMITS,
    );
    const seen = new WeakSet();
    function freezeData(item) {
      if (item === null || typeof item !== "object" || seen.has(item)) return;
      if (
        !Array.isArray(item) &&
        ![Object.prototype, null].includes(Object.getPrototypeOf(item))
      )
        throw Error();
      seen.add(item);
      for (const descriptor of Object.values(
        Object.getOwnPropertyDescriptors(item),
      )) {
        if (!Object.hasOwn(descriptor, "value")) throw Error();
        freezeData(descriptor.value);
      }
      Object.freeze(item);
    }
    freezeData(detached);
    function copyData(source) {
      if (
        !source ||
        typeof source !== "object" ||
        Array.isArray(source) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(source))
      )
        throw Error();
      const descriptors = Object.getOwnPropertyDescriptors(source),
        copy = {};
      for (const key of Reflect.ownKeys(descriptors)) {
        if (
          typeof key !== "string" ||
          ["__proto__", "prototype", "constructor"].includes(key) ||
          !Object.hasOwn(descriptors[key], "value")
        )
          throw Error();
        Object.defineProperty(copy, key, {
          value: descriptors[key].value,
          enumerable: descriptors[key].enumerable,
          writable: false,
          configurable: false,
        });
      }
      return Object.freeze(copy);
    }
    const outer = copyData(detached);
    if (Reflect.ownKeys(outer).sort().join(",") !== "composer,route,thread")
      throw Error();
    const thread = copyData(outer.thread),
      route = copyData(outer.route),
      composer = copyData(outer.composer);
    if (!liveContextMatches({ thread, route, composer }, scope)) throw Error();
    return Object.freeze({ thread, route, composer });
  } catch {
    throw failure("SPLIT_PANE_INVALID_CONTEXT");
  }
}
function selectedGroup(tree, id) {
  const stack = [tree];
  while (stack.length) {
    const node = stack.pop();
    if (node.type === "group") {
      if (node.id === id) return node;
    } else if (node.type === "split") {
      stack.push(node.first, node.second);
    }
  }
  return null;
}

/**
 * Document-local presentation state and the sole footer-layout binding.
 * Only an actually committed original GI may attach a scope. A detached scope
 * may remain visible as a presentation reference, but cannot own the footer.
 * The registry never creates, resumes, selects, stops, or sends to native
 * threads. Selecting a different key revokes input synchronously and waits for
 * the matching real original GI to attach. Different pane owners may coexist,
 * but multiple owners for the selected identity fail closed.
 */
export function createDesktopSplitPaneRegistry({
  footerOwnership,
  idFactory,
} = {}) {
  if (
    !footerOwnership ||
    !["bindPaneLayout", "clearTarget"].every(
      (name) => typeof footerOwnership[name] === "function",
    )
  ) {
    throw failure("SPLIT_PANE_INVALID_CONFIG");
  }
  const layout = createDesktopPaneLayout(idFactory ? { idFactory } : {});
  const owners = new Map();
  const retiredDraftSources = new WeakSet();
  const entries = new Map();
  const byIdentity = new Map();
  const listeners = new Set();
  let nextKey = 0,
    epoch = 0,
    captureRevision = 0,
    closed = false,
    snapshot;
  const notify = () => {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        /* Revoke every subscriber. */
      }
    }
  };
  const publish = () => {
    if (epoch >= Number.MAX_SAFE_INTEGER) {
      owners.clear();
      footerOwnership.clearTarget();
    } else epoch++;
    const current = layout.getSnapshot();
    const group = selectedGroup(current.tree, current.activeGroupId);
    const matching = [...owners.values()].filter(
      (record) => record.key === group?.selected,
    );
    const candidate = matching.length === 1 ? matching[0] : null;
    const selected =
      candidate &&
      entries.get(candidate.key) === candidate.entry &&
      group?.selected === candidate.key
        ? Object.freeze({
            owner: candidate.owner,
            paneId: group.id,
            tabKey: candidate.key,
            layoutRevision: current.revision,
            selectionEpoch: epoch,
            scope: candidate.entry.scope,
          })
        : null;
    snapshot = Object.freeze({
      layout: current,
      captureRevision,
      entries: Object.freeze(
        [...entries.values()].map((entry) =>
          Object.freeze({
            key: entry.key,
            scope: entry.scope,
            context: entry.context,
          }),
        ),
      ),
      selected,
    });
    notify();
  };
  const unbind = footerOwnership.bindPaneLayout(layout);
  let unsubscribe;
  try {
    unsubscribe = layout.subscribe(() => {
      if (!closed) publish();
    });
    publish();
  } catch (error) {
    unbind();
    throw error;
  }
  // A home composer is not restorable as a background transcript. Remove its
  // inactive tab only after another committed route has been selected, while
  // retaining its identity/source so the original draft can reattach later.
  function hideUnownedDraftTabs() {
    const state = layout.getSnapshot();
    const selected = selectedGroup(state.tree, state.activeGroupId)?.selected;
    const target = entries.get(selected);
    if (!target || target.scope.conversationId === null) return;
    for (const entry of entries.values()) {
      if (
        entry.scope.conversationId === null &&
        entry.key !== selected &&
        ![...owners.values()].some((record) => record.key === entry.key)
      )
        layout.close(entry.key);
    }
  }
  function remember(value, context, options = {}) {
    if (closed) throw failure("SPLIT_PANE_CLOSED");
    let scope, captured;
    try {
      scope = nativeScope(value);
      if (
        !options ||
        typeof options !== "object" ||
        Object.keys(options).some(
          (key) =>
            key !== "focus" && key !== "discardContext" && key !== "source",
        ) ||
        (options.focus !== undefined && typeof options.focus !== "boolean") ||
        (options.discardContext !== undefined &&
          typeof options.discardContext !== "boolean") ||
        (options.source !== undefined &&
          (!options.source || typeof options.source !== "object"))
      )
        throw failure("SPLIT_PANE_INVALID_CONFIG");
      const staleSource =
        scope.conversationId === null &&
        options.source &&
        retiredDraftSources.has(options.source);
      const staleClient =
        scope.conversationId === null &&
        [...entries.values()].some(
          (entry) =>
            entry.scope.clientThreadId === scope.clientThreadId &&
            entry.scope.conversationId !== null,
        );
      if (staleSource || staleClient) throw failure("SPLIT_PANE_STALE_SCOPE");
      captured = captureContext(context, scope);
      if (options.discardContext === true && captured !== undefined)
        throw failure("SPLIT_PANE_INVALID_CONFIG");
    } catch (error) {
      if (error?.code === "SPLIT_PANE_STALE_SCOPE") throw error;
      footerOwnership.clearTarget();
      captureRevision++;
      owners.clear();
      publish();
      throw error;
    }
    footerOwnership.clearTarget();
    const identity = JSON.stringify(SCOPE_KEYS.map((name) => scope[name]));
    let entry = byIdentity.get(identity),
      created = false,
      promoted = false;
    // A committed original new-chat boundary keeps its source object while
    // the user changes execution host. Keep that draft's presentation key;
    // a client string alone cannot join drafts from different boundaries.
    if (!entry && scope.conversationId === null && options.source) {
      const drafts = [...entries.values()].filter(
        (candidate) =>
          candidate.scope.clientThreadId === scope.clientThreadId &&
          candidate.scope.conversationId === null &&
          candidate.draftSources.has(options.source),
      );
      if (drafts.length > 1) {
        owners.clear();
        captureRevision++;
        publish();
        throw failure("SPLIT_PANE_AMBIGUOUS_CLIENT");
      }
      if (drafts.length === 1) {
        entry = drafts[0];
        for (const [owner, record] of owners)
          if (record.entry === entry) owners.delete(owner);
        byIdentity.delete(
          JSON.stringify(SCOPE_KEYS.map((name) => entry.scope[name])),
        );
        entry.scope = scope;
        entry.context = captured;
        byIdentity.set(identity, entry);
        promoted = true;
      }
    }
    if (!entry && scope.conversationId !== null) {
      const drafts = [...entries.values()].filter(
        (candidate) =>
          candidate.scope.clientThreadId === scope.clientThreadId &&
          candidate.scope.conversationId === null,
      );
      if (drafts.length > 1) {
        owners.clear();
        captureRevision++;
        publish();
        throw failure("SPLIT_PANE_AMBIGUOUS_CLIENT");
      }
      if (drafts.length === 1) {
        entry = drafts[0];
        for (const source of entry.draftSources)
          retiredDraftSources.add(source);
        entry.draftSources.clear();
        for (const [owner, record] of owners) {
          if (record.entry === entry) owners.delete(owner);
        }
        byIdentity.delete(
          JSON.stringify(SCOPE_KEYS.map((name) => entry.scope[name])),
        );
        entry.scope = scope;
        entry.context = captured;
        byIdentity.set(identity, entry);
        promoted = true;
      }
    }
    if (!entry) {
      if (entries.size >= MAX_TABS || nextKey >= Number.MAX_SAFE_INTEGER) {
        publish();
        throw failure("SPLIT_PANE_TAB_LIMIT");
      }
      entry = {
        key: `native-${++nextKey}`,
        scope,
        context: captured,
        draftSources: new Set(),
      };
      entries.set(entry.key, entry);
      byIdentity.set(identity, entry);
      created = true;
    }
    try {
      if (
        scope.conversationId === null &&
        options.source &&
        !entry.draftSources.has(options.source)
      ) {
        if (entry.draftSources.size >= MAX_DRAFT_SOURCES)
          throw failure("SPLIT_PANE_SOURCE_LIMIT");
        entry.draftSources.add(options.source);
      }
      if (
        !created &&
        !promoted &&
        (captured !== undefined || options.discardContext === true)
      )
        entry.context = captured;
      captureRevision++;
      if (created || (!promoted && options.focus !== false))
        layout.open(entry.key);
      hideUnownedDraftTabs();
      publish();
      return entry.key;
    } catch (error) {
      if (created) {
        entries.delete(entry.key);
        byIdentity.delete(identity);
      }
      publish();
      throw error;
    }
  }
  function commit(owner, key, value) {
    if (closed) throw failure("SPLIT_PANE_CLOSED");
    if (owner && typeof owner === "object" && retiredDraftSources.has(owner)) {
      let scope;
      try {
        scope = nativeScope(value);
      } catch {
        /* Malformed input takes the revoking path below. */
      }
      if (scope?.conversationId === null)
        throw failure("SPLIT_PANE_STALE_SCOPE");
    }
    footerOwnership.clearTarget();
    if (!owner || typeof owner !== "object") {
      publish();
      throw failure("SPLIT_PANE_INVALID_OWNER");
    }
    owners.delete(owner);
    let scope;
    try {
      scope = nativeScope(value);
    } catch (error) {
      publish();
      throw error;
    }
    if (owners.size >= MAX_OWNERS) {
      publish();
      throw failure("SPLIT_PANE_OWNER_LIMIT");
    }
    const entry = entries.get(key);
    if (
      !entry ||
      !SCOPE_KEYS.every((name) => entry.scope[name] === scope[name])
    ) {
      publish();
      throw failure("SPLIT_PANE_INVALID_SCOPE");
    }
    if (scope.conversationId === null && !entry.draftSources.has(owner)) {
      if (entry.draftSources.size >= MAX_DRAFT_SOURCES) {
        publish();
        throw failure("SPLIT_PANE_SOURCE_LIMIT");
      }
      entry.draftSources.add(owner);
    }
    const record = { owner, key: entry.key, entry };
    owners.set(owner, record);
    publish();
    return () => {
      if (closed || owners.get(owner) !== record) return;
      footerOwnership.clearTarget();
      owners.delete(owner);
      hideUnownedDraftTabs();
      publish();
    };
  }
  return Object.freeze({
    getSnapshot: () => snapshot,
    subscribe(listener) {
      if (typeof listener !== "function")
        throw failure("SPLIT_PANE_INVALID_LISTENER");
      if (closed) return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    attach(owner, value) {
      if (closed) throw failure("SPLIT_PANE_CLOSED");
      if (!owner || typeof owner !== "object") {
        footerOwnership.clearTarget();
        publish();
        throw failure("SPLIT_PANE_INVALID_OWNER");
      }
      const key = remember(value, undefined, { source: owner });
      return commit(owner, key, value);
    },
    remember,
    commit,
    invalidate() {
      if (closed) return;
      captureRevision++;
      footerOwnership.clearTarget();
      owners.clear();
      publish();
    },
    focus(key) {
      return !closed && entries.has(key) ? layout.focus(key) : false;
    },
    focusGroup(id) {
      return !closed ? layout.focusGroup(id) : false;
    },
    place(key, groupId, edge, beforeKey) {
      return !closed && entries.has(key)
        ? layout.place(key, groupId, edge, beforeKey)
        : false;
    },
    mergeGroups(sourceId, targetId) {
      return !closed ? layout.mergeGroups(sourceId, targetId) : false;
    },
    resize(id, ratio) {
      return !closed ? layout.resize(id, ratio) : false;
    },
    closeGroup(id) {
      if (closed) return false;
      const pane = selectedGroup(layout.getSnapshot().tree, id);
      if (!pane || !layout.closeGroup(id)) return false;
      const removed = new Set(pane.keys);
      // Retire only the closed pane's local presentation references and
      // committed input owners. Late cleanup cannot alter another pane.
      for (const key of removed) {
        const entry = entries.get(key);
        if (!entry) continue;
        entries.delete(key);
        byIdentity.delete(JSON.stringify(SCOPE_KEYS.map((name) => entry.scope[name])));
      }
      for (const [owner, record] of owners)
        if (removed.has(record.key)) owners.delete(owner);
      publish();
      return true;
    },
    closeEmptyGroup(id) {
      return !closed ? layout.closeEmptyGroup(id) : false;
    },
    close(key) {
      if (closed) return false;
      const entry = entries.get(key);
      if (!entry || !layout.close(key)) return false;
      entries.delete(key);
      byIdentity.delete(
        JSON.stringify(SCOPE_KEYS.map((name) => entry.scope[name])),
      );
      publish();
      return true;
    },
    dispose() {
      if (closed) return;
      closed = true;
      footerOwnership.clearTarget();
      owners.clear();
      entries.clear();
      byIdentity.clear();
      try {
        unsubscribe();
      } finally {
        unbind();
      }
      publish();
      listeners.clear();
    },
  });
}

/**
 * React presentation for an already authenticated, single desktop document.
 * React, JSX, scope capture/providers and the passive original transcript are
 * supplied by the pinned renderer integration. This module never imports a
 * second React or creates a root. Native transport authority remains separate.
 */
export function createDesktopSplitPaneRuntime({
  React,
  jsx,
  layoutRuntime,
  useNativeContext,
  useNativeTitle = () => null,
  useNavigationContext,
  activateTarget,
  createNavigationNonce = () => globalThis.crypto.randomUUID(),
  renderProviders,
  PassiveTranscript,
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
    ].every((name) => typeof React[name] === "function") ||
    !jsx ||
    typeof jsx.jsx !== "function" ||
    typeof useNativeTitle !== "function" ||
    typeof jsx.jsxs !== "function" ||
    typeof enabled !== "boolean" ||
    !layoutRuntime ||
    ![
      "DesktopLayoutBoundary",
      "DesktopPaneOwnershipProvider",
      "renderLayout",
    ].every((name) => typeof layoutRuntime[name] === "function") ||
    typeof useNativeContext !== "function" ||
    typeof useNavigationContext !== "function" ||
    (activateTarget !== undefined && typeof activateTarget !== "function") ||
    typeof createNavigationNonce !== "function" ||
    typeof renderProviders !== "function" ||
    (PassiveTranscript !== undefined && typeof PassiveTranscript !== "function")
  )
    throw failure("SPLIT_PANE_INVALID_CONFIG");
  if (!enabled)
    return Object.freeze({
      registry: null,
      DesktopSplitPaneBoundary: ({ component, originalProps }) =>
        jsx.jsx(component, originalProps),
      dispose() {},
    });
  const registry = createDesktopSplitPaneRegistry({
    footerOwnership: layoutRuntime.footerOwnership,
    idFactory,
  });
  const dragging = { key: null };
  const attempts = new Map();
  let activeAttempt = null;
  const sameScope = (a, b) =>
    !!a && !!b && SCOPE_KEYS.every((key) => a[key] === b[key]);
  const selectedEntry = (snapshot) => {
    const group = selectedGroup(
      snapshot.layout.tree,
      snapshot.layout.activeGroupId,
    );
    return (
      snapshot.entries.find((entry) => entry.key === group?.selected) ?? null
    );
  };
  function EntryTitle({ entry, fallback }) {
    const value = useNativeTitle(entry.scope);
    const title =
      typeof value === "string" &&
      value.trim().length > 0 &&
      value.length <= 512 &&
      !/[\x00-\x1f\x7f]/.test(value)
        ? value.trim()
        : fallback;
    return title;
  }
  function Group({
    node,
    snapshot,
    activeKey,
    content,
    activate,
    originalScope,
  }) {
    const entry = snapshot.entries.find((item) => item.key === node.selected);
    let body = null;
    if (entry?.key === activeKey) body = content;
    else if (
      entry?.context &&
      entry.scope.conversationId !== null &&
      !sameScope(entry.scope, originalScope) &&
      PassiveTranscript
    ) {
      body = jsx.jsx("div", {
        "data-desktop-split-passive": entry.key,
        style: { display: "flex", flex: "1 1 0", minHeight: 0 },
        // Stop native action handlers on press as well as click. Do not
        // prevent the browser's text selection, scrolling or context menu.
        onPointerDownCapture: (event) => event.stopPropagation(),
        onPointerUpCapture: (event) => event.stopPropagation(),
        onMouseDownCapture: (event) => event.stopPropagation(),
        onMouseUpCapture: (event) => event.stopPropagation(),
        onContextMenuCapture: (event) => event.stopPropagation(),
        onDoubleClickCapture: (event) => event.stopPropagation(),
        onAuxClickCapture: (event) => {
          event.preventDefault();
          event.stopPropagation();
        },
        onDropCapture: (event) => {
          if (dragging.key !== null) return;
          event.preventDefault();
          event.stopPropagation();
        },
        onClickCapture: (event) => {
          // A side-chat transcript can contain links and native actions. Such
          // actions first activate their original route. Plain text clicks do
          // not navigate, preserving text selection and browser copy.
          const selection = event.currentTarget.ownerDocument.getSelection?.();
          event.stopPropagation();
          const action = event.target?.closest?.(
            'a,button,input,select,textarea,[role="button"],[role="link"],[tabindex]',
          );
          if (!action) return;
          try {
            if (!selection || selection.isCollapsed) activate(event, entry.key);
          } finally {
            event.preventDefault();
          }
        },
        onKeyDownCapture: (event) => {
          event.stopPropagation();
          if (!["Enter", " "].includes(event.key)) return;
          event.preventDefault();
          activate(event, entry.key);
        },
        onKeyUpCapture: (event) => event.stopPropagation(),
        children: renderProviders(
          entry.context,
          jsx.jsx(PassiveTranscript, {
            conversationId: entry.scope.conversationId,
            hostId: entry.scope.hostId,
            isReadOnly: true,
            retainActiveInterest: false,
            trackReadState: true,
          }),
        ),
      });
    } else if (entry)
      body = jsx.jsx("div", {
        "data-desktop-split-waiting": "",
        children: entry.context ? "会话内容暂不可用" : "此会话暂不能分屏或切回",
      });
    else
      body = jsx.jsx("button", {
        type: "button",
        onClick: () => registry.focusGroup(node.id),
        children: "选择此窗格后从侧栏打开会话",
      });
    const tabs = node.keys.map((key) => {
      const index = numberedTabKeys(snapshot).indexOf(key);
      const tab = snapshot.entries.find((item) => item.key === key);
      const restorable = !!tab?.context && tab.scope.conversationId !== null;
      const unavailable = !restorable && !sameScope(tab?.scope, originalScope);
      const inputTarget =
        snapshot.selected?.paneId === node.id &&
        snapshot.selected?.tabKey === key;
      return jsx.jsx(
        "button",
        {
          type: "button",
          role: "tab",
          "aria-selected":
            node.selected === key && snapshot.layout.activeGroupId === node.id,
          "data-desktop-split-tab": key,
          "aria-disabled": unavailable || undefined,
          title: unavailable ? "此会话暂不能分屏或切回" : undefined,
          onClick: (event) => activate(event, key),
          draggable: restorable,
          onDragStart: (event) => {
            if (!restorable) {
              event.preventDefault();
              return;
            }
            dragging.key = key;
            try {
              event.dataTransfer?.setData(
                "application/x-chatgpt-desktop-pane",
                key,
              );
            } catch {
              /* Local drag state remains authoritative. */
            }
          },
          onDragEnd: () => {
            dragging.key = null;
          },
          style: {
            border: 0,
            background: inputTarget ? "var(--surface-hover,#e9e9e9)" : "transparent",
            color: "inherit",
            fontWeight: inputTarget ? 600 : 400,
            padding: "6px 9px",
            cursor: "pointer",
            minWidth: 0,
            maxWidth: 160,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          },
          children: jsx.jsx(EntryTitle, {
            entry: tab,
            fallback: tab?.scope.conversationId === null ? "新会话" : `会话 ${index + 1}`,
          }),
        },
        key,
      );
    });
    const actions = entry
      ? [
          ["left", "向左拆分"],
          ["right", "向右拆分"],
          ["top", "向上拆分"],
          ["bottom", "向下拆分"],
        ].map(([edge, label]) =>
          jsx.jsx(
            "button",
            {
              type: "button",
              title:
                entry.context && entry.scope.conversationId !== null
                  ? label
                  : "此会话暂不能分屏或切回",
              "aria-label": label,
              disabled: !entry.context || entry.scope.conversationId === null,
              onClick: () => registry.place(entry.key, node.id, edge),
              style: {
                border: 0,
                borderRadius: 5,
                background: "transparent",
                color: "inherit",
                cursor:
                  entry.context && entry.scope.conversationId !== null
                    ? "pointer"
                    : "not-allowed",
                opacity:
                  entry.context && entry.scope.conversationId !== null
                    ? 1
                    : 0.45,
                padding: "4px",
              },
              children: { left: "←", right: "→", top: "↑", bottom: "↓" }[edge],
            },
            edge,
          ),
        )
      : [];
    if (entry)
      actions.push(
        jsx.jsx(
          "button",
          {
            type: "button",
            title: "关闭整个窗格，不会停止任务",
            "aria-label": "关闭窗格",
            onClick: () => registry.closeGroup(node.id),
            style: {
              border: 0,
              borderRadius: 5,
              background: "transparent",
              color: "inherit",
              cursor: "pointer",
              padding: "4px",
            },
            children: "×",
          },
          "close",
        ),
      );
    if (!entry && snapshot.layout.tree.type !== "group")
      actions.push(
        jsx.jsx(
          "button",
          {
            type: "button",
            title: "关闭空窗格",
            "aria-label": "关闭空窗格",
            onClick: () => registry.closeEmptyGroup(node.id),
            style: {
              border: 0,
              borderRadius: 5,
              background: "transparent",
              color: "inherit",
              cursor: "pointer",
              padding: "4px",
            },
            children: "×",
          },
          "close-empty",
        ),
      );
    const peers = paneGroups(snapshot.layout.tree).filter(
      (group) => group.id !== node.id,
    );
    if (peers.length) {
      const destinations = (operation) => peers.map((group) => jsx.jsx("option", {
        value: `${operation}:${group.id}`,
        children: `窗格 ${paneGroups(snapshot.layout.tree).findIndex((item) => item.id === group.id) + 1}`,
      }, group.id));
      actions.unshift(jsx.jsxs("select", {
        "aria-label": "移动或合并窗格",
        title: "移动当前会话，或将此窗格的全部标签合并到另一个窗格；不会停止任务",
        value: "",
        onChange: (event) => {
          const value = event.currentTarget.value,
            target = peers.find((group) => value.endsWith(`:${group.id}`));
          if (!target) return;
          if (value === `merge:${target.id}`) registry.mergeGroups(node.id, target.id);
          else if (value === `move:${target.id}` && entry?.context && entry.scope.conversationId !== null)
            registry.place(entry.key, target.id, "center");
        },
        style: {
          border: "1px solid var(--border-light,#e5e5e5)",
          borderRadius: 5,
          background: "var(--main-surface-primary,#fff)",
          color: "inherit",
          maxWidth: 105,
          fontSize: 12,
          padding: "3px 4px",
        },
        children: [
          jsx.jsx("option", { value: "", disabled: true, children: "移动 / 合并" }),
          jsx.jsx("optgroup", {
            label: "移动当前会话到",
            disabled: !entry?.context || entry.scope.conversationId === null,
            children: destinations("move"),
          }),
          jsx.jsx("optgroup", {
            label: "合并整个窗格到",
            children: destinations("merge"),
          }),
        ],
      }, "move-merge"));
    }
    return jsx.jsxs("section", {
      "data-desktop-split-group": node.id,
      "data-desktop-split-active": snapshot.layout.activeGroupId === node.id ? "" : undefined,
      "aria-label": `会话窗格 ${paneGroups(snapshot.layout.tree).findIndex((group) => group.id === node.id) + 1}`,
      "data-desktop-split-single":
        snapshot.layout.tree.type === "group" && node.keys.length <= 1
          ? ""
          : undefined,
      onDragOver: (event) => {
        if (dragging.key !== null) event.preventDefault();
      },
      onDropCapture: (event) => {
        const key = dragging.key;
        dragging.key = null;
        if (key === null) return;
        event.preventDefault();
        event.stopPropagation();
        const tab = event.target?.closest?.("[data-desktop-split-tab]");
        const beforeKey = tab?.getAttribute("data-desktop-split-tab");
        if (tab && event.currentTarget.contains(tab) && node.keys.includes(beforeKey)) {
          if (key !== beforeKey) registry.place(key, node.id, "center", beforeKey);
          return;
        }
        const rect = event.currentTarget.getBoundingClientRect();
        if (!(rect.width > 0 && rect.height > 0)) return;
        const x = (event.clientX - rect.left) / rect.width,
          y = (event.clientY - rect.top) / rect.height;
        const edge =
          x < 0.25
            ? "left"
            : x > 0.75
              ? "right"
              : y < 0.25
                ? "top"
                : y > 0.75
                  ? "bottom"
                  : "center";
        registry.place(key, node.id, edge);
      },
      style: {
        position: "relative",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        minWidth: 0,
        minHeight: 0,
        width: "100%",
        height: "100%",
      },
      children: [
        jsx.jsx("style", {
          children:
            "[data-desktop-split-group] > [data-desktop-split-toolbar] { position:relative; z-index:50; } [data-desktop-split-single] > [data-desktop-split-toolbar] { position:absolute; right:6px; top:4px; opacity:0; pointer-events:none; border-radius:7px; background:var(--main-surface-primary,#fff); box-shadow:0 1px 6px #0002; } [data-desktop-split-single]:hover > [data-desktop-split-toolbar], [data-desktop-split-single]:focus-within > [data-desktop-split-toolbar] { opacity:1; pointer-events:auto; } @media (hover:none) { main[data-codex-history-swipe-page]:has([data-desktop-split-group]) [data-slot=thread-summary-panel-item] > [data-slot=thread-summary-panel-item-actions] { position:relative; inset:auto; margin-inline-end:0; opacity:1; pointer-events:auto; } }",
        }),
        jsx.jsxs("div", {
          "data-desktop-split-toolbar": "",
          style: {
            display: "flex",
            alignItems: "center",
            minHeight: 28,
            gap: 2,
            flex: "0 0 auto",
          },
          children: [
            jsx.jsx("div", {
              role: "tablist",
              style: {
                display: "flex",
                flex: "1 1 auto",
                minWidth: 0,
                overflow: "auto",
              },
              children: tabs,
            }),
            ...actions,
          ],
        }),
        jsx.jsx("div", {
          style: {
            display: "flex",
            flexDirection: "column",
            flex: "1 1 0",
            minWidth: 0,
            minHeight: 0,
            overflow: "hidden",
          },
          children: body,
        }),
      ],
    });
  }
  function Divider({ node, horizontal }) {
    const draggingPointer = React.useRef(null);
    const update = (event) => {
      const rect = event.currentTarget.parentElement?.getBoundingClientRect();
      const length = horizontal ? rect?.width : rect?.height;
      if (!(length > 0)) return;
      const position = horizontal
        ? event.clientX - rect.left
        : event.clientY - rect.top;
      registry.resize(node.id, Math.round((position * 100) / length));
    };
    return jsx.jsx("div", {
      role: "separator",
      tabIndex: 0,
      "aria-orientation": horizontal ? "vertical" : "horizontal",
      "aria-label": horizontal ? "调整左右窗格比例" : "调整上下窗格比例",
      "aria-valuemin": 15,
      "aria-valuemax": 85,
      "aria-valuenow": node.ratio,
      style: {
        flex: "0 0 8px",
        background: "var(--border-light,#e5e5e5)",
        cursor: horizontal ? "col-resize" : "row-resize",
        touchAction: "none",
      },
      onPointerDown: (event) => {
        if (event.button !== 0) return;
        draggingPointer.current = event.pointerId;
        try { event.currentTarget.setPointerCapture?.(event.pointerId); }
        catch { draggingPointer.current = null; }
        event.preventDefault();
      },
      onPointerMove: (event) => {
        if (draggingPointer.current === event.pointerId) update(event);
      },
      onPointerUp: (event) => {
        if (draggingPointer.current === event.pointerId) {
          update(event);
          draggingPointer.current = null;
          try { event.currentTarget.releasePointerCapture?.(event.pointerId); }
          catch { /* Capture may already have been released by the browser. */ }
        }
      },
      onLostPointerCapture: () => { draggingPointer.current = null; },
      onPointerCancel: () => {
        draggingPointer.current = null;
      },
      onKeyDown: (event) => {
        let next;
        if (event.key === "Home") next = 15;
        else if (event.key === "End") next = 85;
        else if (
          (horizontal && event.key === "ArrowLeft") ||
          (!horizontal && event.key === "ArrowUp")
        )
          next = node.ratio - 5;
        else if (
          (horizontal && event.key === "ArrowRight") ||
          (!horizontal && event.key === "ArrowDown")
        )
          next = node.ratio + 5;
        if (next !== undefined) {
          event.preventDefault();
          registry.resize(node.id, next);
        }
      },
    });
  }
  function Tree({
    node,
    snapshot,
    activeKey,
    content,
    activate,
    originalScope,
  }) {
    if (node.type === "group")
      return jsx.jsx(Group, {
        node,
        snapshot,
        activeKey,
        content,
        activate,
        originalScope,
      });
    const horizontal = node.direction === "horizontal";
    return jsx.jsxs("div", {
      "data-desktop-split-branch": node.id,
      style: {
        display: "flex",
        flexDirection: horizontal ? "row" : "column",
        width: "100%",
        height: "100%",
        minWidth: 0,
        minHeight: 0,
        overflow: "hidden",
      },
      children: [
        jsx.jsx("div", {
          style: {
            flex: `0 0 ${node.ratio}%`,
            minWidth: 0,
            minHeight: 0,
            overflow: "hidden",
          },
          children: jsx.jsx(Tree, {
            node: node.first,
            snapshot,
            activeKey,
            content,
            activate,
            originalScope,
          }),
        }),
        jsx.jsx(Divider, { node, horizontal }),
        jsx.jsx("div", {
          style: {
            flex: "1 1 0",
            minWidth: 0,
            minHeight: 0,
            overflow: "hidden",
          },
          children: jsx.jsx(Tree, {
            node: node.second,
            snapshot,
            activeKey,
            content,
            activate,
            originalScope,
          }),
        }),
      ],
    });
  }
  function SelectedGI({
    entry,
    snapshot,
    component,
    originalProps,
    originalScope,
    scopeReady,
    canOwn,
    activate,
  }) {
    const owner = React.useRef(null);
    const { hostId, conversationId, clientThreadId } = entry.scope;
    if (
      owner.current === null ||
      owner.current.clientThreadId !== clientThreadId
    )
      owner.current = { clientThreadId, token: {} };
    const ownerToken = owner.current.token;
    React.useLayoutEffect(() => {
      if (!scopeReady || !canOwn || !entry.key) return undefined;
      try {
        return registry.commit(ownerToken, entry.key, {
          hostId,
          conversationId,
          clientThreadId,
        });
      } catch {
        return undefined;
      }
    }, [
      entry.key,
      hostId,
      conversationId,
      clientThreadId,
      scopeReady,
      canOwn,
      ownerToken,
      snapshot.captureRevision,
    ]);
    const selected =
      snapshot.selected?.owner === ownerToken ? snapshot.selected : null;
    const visibleKeys = numberedTabKeys(snapshot);
    const targetIndex = visibleKeys.indexOf(selected?.tabKey);
    const showTarget =
      (snapshot.layout.tree.type !== "group" || visibleKeys.length > 1) &&
      targetIndex >= 0;
    const custom = ({ content, footer }) =>
      layoutRuntime.renderLayout({
        content: jsx.jsx("div", {
          "aria-hidden": scopeReady ? undefined : true,
          style: {
            visibility: scopeReady ? "visible" : "hidden",
            pointerEvents: scopeReady ? undefined : "none",
            height: "100%",
            minHeight: 0,
            minWidth: 0,
          },
          children: jsx.jsx(Tree, {
            node: snapshot.layout.tree,
            snapshot,
            // Content selection is presentation state, while the footer still
            // requires the separately committed unique owner. On first mount
            // that owner is not yet present. Do not re-provide the current
            // native scope through a passive renderer during this gap.
            activeKey: scopeReady && canOwn && selectedEntry(snapshot)?.key === entry.key
              ? entry.key : null,
            content,
            activate,
            originalScope,
          }),
        }),
        footer:
          scopeReady && canOwn && selected && footer != null
            ? jsx.jsxs(React.Fragment, {
                  children: [
                    showTarget ? jsx.jsxs("div", {
                      "data-desktop-split-input-target": "",
                      role: "status",
                      "aria-live": "polite",
                      style: {
                        padding: "4px 12px",
                        color: "var(--text-secondary,#666)",
                        fontSize: 12,
                      },
                      children: [
                        "当前输入目标：",
                        jsx.jsx(EntryTitle, {
                          entry,
                          fallback: entry.scope.conversationId === null ? "新会话" : `会话 ${targetIndex + 1}`,
                        }),
                      ],
                    }) : null,
                    footer,
                  ],
                })
            : null,
      });
    return jsx.jsx(layoutRuntime.DesktopPaneOwnershipProvider, {
      paneId: selected?.paneId,
      tabKey: selected?.tabKey,
      layoutRevision: selected?.layoutRevision,
      children: jsx.jsx(layoutRuntime.DesktopLayoutBoundary, {
        component,
        // An original route can arrive after the user selected a different
        // pane. Keep its real scope but suppress GI's automatic resume until
        // an explicit selection authorizes this exact route again.
        originalProps:
          scopeReady && canOwn
            ? originalProps
            : { ...originalProps, shouldResume: false },
        nativeScope: originalScope,
        manageFooter: scopeReady && canOwn && !!selected,
        renderCustomLayout: custom,
        selectionEpoch: selected?.selectionEpoch,
      }),
    });
  }
  function ActiveSplitPaneBoundary({ component, originalProps, nativeScope }) {
    const captured = useNativeContext(nativeScope),
      navigation = useNavigationContext(nativeScope),
      previous = React.useRef(null),
      source = React.useRef(null);
    const { hostId, conversationId, clientThreadId } = nativeScope ?? {};
    // One presentation source follows one original client identity. When the
    // same React boundary later opens a different new chat, give it a fresh
    // token; effects from the previous client keep their captured old token.
    if (
      source.current === null ||
      source.current.clientThreadId !== clientThreadId
    )
      source.current = { clientThreadId, token: {} };
    const sourceToken = source.current.token;
    const pathname = navigation?.pathname,
      search = navigation?.search,
      marker = navigation?.marker ?? null;
    let routeMatches = false;
    try {
      const routeDescriptor = Object.getOwnPropertyDescriptor(
        captured,
        "route",
      );
      if (!routeDescriptor || !Object.hasOwn(routeDescriptor, "value"))
        throw Error();
      const route = routeDescriptor.value;
      const pathnameDescriptor = Object.getOwnPropertyDescriptor(
        route,
        "pathname",
      );
      const searchDescriptor = Object.getOwnPropertyDescriptor(route, "search");
      routeMatches =
        typeof pathname === "string" &&
        typeof search === "string" &&
        (marker === null ||
          (typeof marker === "string" &&
            marker.length > 0 &&
            marker.length <= 160)) &&
        !!pathnameDescriptor &&
        Object.hasOwn(pathnameDescriptor, "value") &&
        pathnameDescriptor.value === pathname &&
        (!searchDescriptor || Object.hasOwn(searchDescriptor, "value")) &&
        (searchDescriptor?.value ?? "") === search;
    } catch {
      routeMatches = false;
    }
    // The original scope provider can allocate equal values on every render.
    // Depend on a bounded descriptor-only value signature, not object identity;
    // otherwise our own registry notification creates an infinite render loop.
    let captureSignature = null,
      liveOnly = false;
    try {
      captureSignature = encodeWireValue(captured, CONTEXT_LIMITS);
      // The wire format also supports typed values; retained provider scopes
      // intentionally accept only bounded detached plain-data graphs.
      captureContext(captured, nativeScope, captureSignature);
    } catch {
      // Preserve the real current GI and its original providers when a draft,
      // attachment or other native value cannot be safely snapshotted. The
      // registry records its identity only, never the live graph itself.
      liveOnly = liveContextMatches(captured, nativeScope);
      captureSignature = liveOnly ? "\0live-context" : null;
    }
    const snapshot = React.useSyncExternalStore(
      registry.subscribe,
      registry.getSnapshot,
      registry.getSnapshot,
    );
    const identity = JSON.stringify([hostId, conversationId, clientThreadId]);
    React.useLayoutEffect(() => {
      try {
        if (captureSignature === null || !routeMatches) {
          registry.invalidate();
          previous.current = null;
          return;
        }
        const scope = { hostId, conversationId, clientThreadId };
        const record = marker === null ? null : attempts.get(marker);
        const before = registry.getSnapshot();
        const desired = selectedEntry(before);
        const markerCurrent =
          record &&
          activeAttempt === record &&
          desired?.key === record.key &&
          sameScope(record.scope, scope);
        const stale = marker !== null && !markerCurrent;
        if (marker === null && previous.current?.identity !== identity)
          activeAttempt = null;
        // A late pane navigation must never reopen a closed tab or refocus it.
        const existing = before.entries.find((entry) =>
          sameScope(entry.scope, scope),
        );
        if (!stale || existing)
          registry.remember(scope, liveOnly ? undefined : captured, {
            focus: !stale && previous.current?.identity !== identity,
            discardContext: liveOnly,
            source: sourceToken,
          });
        previous.current = { identity, signature: captureSignature };
      } catch {
        previous.current = null;
      }
    }, [
      hostId,
      conversationId,
      clientThreadId,
      captureSignature,
      pathname,
      search,
      marker,
      routeMatches,
      sourceToken,
    ]);
    const scopeReady =
      captureSignature !== null &&
      routeMatches &&
      // Updating a detached background snapshot does not replace the current
      // original provider's verified target. Keep its real footer mounted;
      // remember/captureRevision still revoke and recommit the input lease.
      previous.current?.identity === identity;
    const entry = snapshot.entries.find((item) =>
      sameScope(item.scope, nativeScope),
    ) ?? { key: null, scope: nativeScope };
    const arrival = marker === null ? null : attempts.get(marker);
    const canOwn =
      marker === null ||
      (!!arrival &&
        arrival === activeAttempt &&
        selectedEntry(snapshot)?.key === arrival.key &&
        sameScope(arrival.scope, nativeScope));
    const activate = (event, key) => {
      const selected = registry
        .getSnapshot()
        .entries.find((item) => item.key === key);
      if (!selected) return;
      if (
        !sameScope(selected.scope, nativeScope) &&
        (!selected.context || selected.scope.conversationId === null)
      )
        return;
      registry.focus(key);
      // A fresh gesture invalidates every earlier asynchronous authority ACK.
      activeAttempt = null;
      if (sameScope(selected.scope, nativeScope)) {
        const original = marker === null ? null : attempts.get(marker);
        if (original?.key === key && sameScope(original.scope, nativeScope))
          activeAttempt = original;
        return;
      }
      let nonce;
      try {
        nonce = createNavigationNonce();
        if (
          typeof nonce !== "string" ||
          nonce.length === 0 ||
          nonce.length > 160 ||
          attempts.has(nonce)
        )
          return;
      } catch {
        return;
      }
      const revision = registry.getSnapshot().layout.revision;
      const record = { key, scope: selected.scope, nonce, revision };
      activeAttempt = record;
      attempts.set(nonce, record);
      while (attempts.size > MAX_TABS)
        attempts.delete(attempts.keys().next().value);
      const isCurrent = () =>
        activeAttempt === record &&
        registry.getSnapshot().layout.revision === revision &&
        selectedEntry(registry.getSnapshot())?.key === key &&
        sameScope(selectedEntry(registry.getSnapshot())?.scope, record.scope);
      const action = navigation?.activateTarget ?? activateTarget;
      if (typeof action !== "function") return;
      try {
        const result = action({
          event,
          scope: selected.scope,
          state: { __chatgptDesktopPaneNavigation: nonce },
          isCurrent,
        });
        Promise.resolve(result).catch(() => {});
      } catch {
        // Never fall back to unguarded original navigation.
      }
    };
    return jsx.jsx(SelectedGI, {
      entry,
      snapshot,
      component,
      originalProps,
      originalScope: nativeScope,
      scopeReady,
      canOwn,
      activate,
    });
  }
  function DesktopSplitPaneBoundary({ component, originalProps, nativeScope }) {
    const eligible =
      originalProps?.showComposer === true &&
      originalProps.isReadOnly !== true &&
      originalProps.renderLayout == null;
    if (!eligible) return jsx.jsx(component, originalProps);
    return jsx.jsx(ActiveSplitPaneBoundary, {
      component,
      originalProps,
      nativeScope,
    });
  }
  return Object.freeze({
    DesktopSplitPaneBoundary,
    registry,
    dispose() {
      activeAttempt = null;
      attempts.clear();
      registry.dispose();
    },
  });
}
