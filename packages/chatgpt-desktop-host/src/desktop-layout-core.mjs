const failure = (code, message) => Object.assign(new Error(message), { code });
const CONFIG_KEY = '__chatgptDesktopLayoutEnabled';
const SCOPE_KEYS = ['hostId', 'conversationId', 'clientThreadId'];

function readIdentity(value, keys) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const names = Reflect.ownKeys(value);
  if (names.length !== keys.length || keys.some(key => !names.includes(key))) return null;
  const result = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    const item = descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : null;
    if (key === 'conversationId' && descriptor && Object.hasOwn(descriptor, 'value') && item === null) {
      result[key] = null;
      continue;
    }
    if (typeof item !== 'string' || item.length === 0 || item.length > 512 || /[\x00-\x1f\x7f]/.test(item)) return null;
    result[key] = item;
  }
  return Object.freeze(result);
}

/**
 * Tracks our own committed footer slot, not native send authority. The caller
 * must confirm the selected pane and its verified original thread scope. A
 * footer registrar must independently check its actual native scope against
 * the resulting slot lease and also hold the separate mode/host authority.
 */
export function createDesktopFooterOwnership() {
  const claims = new Map();
  const listeners = new Set();
  let binding = null;
  let target = null;
  let current = null;

  function matchesLayout(candidate) {
    if (binding === null || candidate === null) return false;
    try {
      const snapshot = binding.layout.getSnapshot();
      if (snapshot !== candidate.snapshot || snapshot?.version !== 1 ||
          !Number.isSafeInteger(snapshot.revision) || snapshot.revision !== candidate.revision ||
          snapshot.activeGroupId !== candidate.paneId) return false;
      const stack = [snapshot.tree];
      let active = null;
      let count = 0;
      while (stack.length > 0) {
        if (++count > 128) return false;
        const node = stack.pop();
        if (!node || typeof node !== 'object') return false;
        if (node.type === 'group') {
          if (node.id === candidate.paneId) {
            if (active !== null) return false;
            active = node;
          }
        } else if (node.type === 'split') {
          stack.push(node.first, node.second);
        } else return false;
      }
      return active !== null && Array.isArray(active.keys) && active.selected === candidate.tabKey &&
        active.keys.includes(candidate.tabKey);
    } catch {
      return false;
    }
  }

  function update() {
    current = null;
    if (matchesLayout(target) && claims.size === 1) {
      const [slot, claim] = claims.entries().next().value;
      if (claim.paneId === target.paneId) current = { slot, token: Object.freeze({}), target };
    }
    for (const listener of [...listeners]) {
      try { listener(); } catch { /* A subscriber cannot prevent revocation. */ }
    }
  }

  function confirmTarget(value) {
    // A malformed or repeated confirmation must revoke all older tokens too.
    target = null;
    try {
      const identity = readIdentity(value, ['paneId', 'tabKey', ...SCOPE_KEYS]);
      const snapshot = binding?.layout.getSnapshot();
      const candidate = identity === null ? null : { ...identity, snapshot, revision: snapshot?.revision };
      if (matchesLayout(candidate)) target = candidate;
    } catch { /* Reject exotic input or an unavailable pane model. */ }
    update();
    return target !== null;
  }

  function bindPaneLayout(layout) {
    target = null;
    update();
    if (binding !== null || !layout || typeof layout.getSnapshot !== 'function' || typeof layout.subscribe !== 'function') {
      throw failure('DESKTOP_FOOTER_INVALID_LAYOUT', 'One pane layout binding is required');
    }
    const next = { layout, unsubscribe: null };
    binding = next;
    try {
      next.unsubscribe = layout.subscribe(() => {
        if (binding !== next) return;
        target = null;
        update();
      });
      if (typeof next.unsubscribe !== 'function') throw Error('Invalid pane subscription');
    } catch {
      binding = null;
      update();
      throw failure('DESKTOP_FOOTER_INVALID_LAYOUT', 'Pane layout subscription failed');
    }
    return () => {
      if (binding !== next) return;
      binding = null;
      target = null;
      try { next.unsubscribe(); } finally { update(); }
    };
  }

  function commitTarget(value, expectedRevision) {
    try {
      if (!Number.isSafeInteger(expectedRevision) || binding?.layout.getSnapshot()?.revision !== expectedRevision) {
        confirmTarget(null);
        return () => {};
      }
    } catch {
      confirmTarget(null);
      return () => {};
    }
    if (!confirmTarget(value)) return () => {};
    const confirmation = target;
    return () => {
      if (target !== confirmation) return;
      target = null;
      update();
    };
  }

  function createSlot() {
    const slot = {};
    const lease = Object.freeze({
      getSnapshot: () => current?.slot === slot && matchesLayout(current.target) ? current.token : null,
      subscribe(listener) {
        if (typeof listener !== 'function') throw failure('DESKTOP_FOOTER_INVALID_LISTENER', 'Footer listener must be a function');
        const subscription = () => listener();
        listeners.add(subscription);
        return () => listeners.delete(subscription);
      },
      isCurrent(token, scope) {
        let identity;
        try { identity = readIdentity(scope, SCOPE_KEYS); } catch { return false; }
        return identity !== null && current?.slot === slot && current.token === token && matchesLayout(current.target) &&
          SCOPE_KEYS.every(key => current.target[key] === identity[key]);
      },
    });
    return Object.freeze({
      lease,
      commit(paneId) {
        const identity = readIdentity({ paneId }, ['paneId']);
        const claim = { paneId: identity?.paneId ?? null };
        claims.set(slot, claim);
        update();
        return () => {
          if (claims.get(slot) !== claim) return;
          claims.delete(slot);
          update();
        };
      },
    });
  }

  return Object.freeze({ bindPaneLayout, confirmTarget, commitTarget, clearTarget: () => confirmTarget(null), createSlot });
}

/**
 * Read a document-scoped, immutable pre-bootstrap decision. A document with no
 * decision stays transparent. Accessors and mutable flags are not accepted.
 */
export function readDesktopLayoutConfig(host = globalThis) {
  if ((typeof host !== 'object' && typeof host !== 'function') || host === null) {
    throw failure('DESKTOP_LAYOUT_INVALID_CONFIG', 'Desktop layout host is required');
  }
  const descriptor = Object.getOwnPropertyDescriptor(host, CONFIG_KEY);
  if (descriptor === undefined) return Object.freeze({ enabled: false });
  if (!Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'boolean' || descriptor.writable || descriptor.configurable) {
    throw failure('DESKTOP_LAYOUT_INVALID_CONFIG', 'Desktop layout decision must be immutable');
  }
  return Object.freeze({ enabled: descriptor.value });
}

/**
 * React and JSX are supplied by the original desktop renderer. The decision
 * is fixed before GI mounts: switching it later could remount the composer and
 * lose native draft state. This is an active-surface layout boundary only;
 * rendering additional threads is deliberately unavailable pending proof.
 */
export function createDesktopLayoutRuntime({ React, jsx, enabled = false } = {}) {
  if (!React || ['createElement', 'createContext', 'useContext', 'useRef', 'useLayoutEffect'].some(key => typeof React[key] !== 'function') || !jsx || typeof jsx.jsx !== 'function' || typeof jsx.jsxs !== 'function') {
    throw failure('DESKTOP_LAYOUT_INVALID_RUNTIME', 'Native React and JSX runtime are required');
  }
  if (typeof enabled !== 'boolean') throw failure('DESKTOP_LAYOUT_INVALID_CONFIG', 'Invalid desktop layout decision');
  const snapshot = Object.freeze({ enabled, readonlyPanes: 'unverified' });
  const footerOwnership = createDesktopFooterOwnership();
  const PaneContext = React.createContext(null);
  const FooterContext = React.createContext(null);

  function DesktopPaneOwnershipProvider({ paneId, tabKey, layoutRevision, children }) {
    return jsx.jsx(PaneContext.Provider, { value: { paneId, tabKey, layoutRevision }, children });
  }

  function FooterOwnershipProvider({ children }) {
    const paneId = React.useContext(PaneContext)?.paneId;
    const slot = React.useRef(null);
    if (slot.current === null) slot.current = footerOwnership.createSlot();
    React.useLayoutEffect(() => slot.current.commit(paneId), [paneId]);
    return jsx.jsx(FooterContext.Provider, { value: slot.current.lease, children });
  }

  function useDesktopFooterOwnership() {
    return React.useContext(FooterContext);
  }

  function renderLayout({ content, footer }) {
    return jsx.jsxs('div', {
      'data-chatgpt-desktop-layout': '',
      style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, minWidth: 0, width: '100%' },
      children: [
        jsx.jsx('div', {
          'data-chatgpt-desktop-active': '',
          style: { display: 'flex', flexDirection: 'column', flex: '1 1 0', minHeight: 0, minWidth: 0 },
          children: content,
        }),
        footer == null ? null : jsx.jsx('div', {
          'data-chatgpt-desktop-footer': '',
          style: { flex: '0 0 auto', minWidth: 0 },
          children: jsx.jsx(FooterOwnershipProvider, { children: footer }),
        }),
      ],
    });
  }

  function DesktopLayoutBoundary({ component, originalProps, nativeScope, manageFooter = true, renderCustomLayout, selectionEpoch }) {
    const pane = React.useContext(PaneContext);
    const paneId = pane?.paneId;
    const tabKey = pane?.tabKey;
    const layoutRevision = pane?.layoutRevision;
    const hostId = nativeScope?.hostId;
    const conversationId = nativeScope?.conversationId;
    const clientThreadId = nativeScope?.clientThreadId;
    React.useLayoutEffect(() => {
      if (!manageFooter) return;
      if (!enabled || originalProps.renderLayout != null) {
        footerOwnership.clearTarget();
        return;
      }
      return footerOwnership.commitTarget({ paneId, tabKey, hostId, conversationId, clientThreadId }, layoutRevision);
    }, [paneId, tabKey, layoutRevision, hostId, conversationId, clientThreadId, originalProps.renderLayout, manageFooter, selectionEpoch]);
    // Do not replace an already supplied native layout or alter any native
    // visibility, resume, read-only, composer, or permission prop.
    const props = enabled && originalProps.renderLayout == null
      ? { ...originalProps, renderLayout: renderCustomLayout ?? renderLayout }
      : originalProps;
    return jsx.jsx(component, props);
  }

  return Object.freeze({
    DesktopLayoutBoundary,
    DesktopPaneOwnershipProvider,
    footerOwnership,
    renderLayout,
    useDesktopFooterOwnership,
    getSnapshot: () => snapshot,
    requestReadonlyPane() {
      throw failure('DESKTOP_READONLY_PANE_UNVERIFIED', 'Readonly desktop panes require native provider verification');
    },
  });
}
