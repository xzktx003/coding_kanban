// Unconnected research prototype. This local evidence does not authenticate a
// browser, authorize an RPC, or prove that a native write was caused by it.
export const SIDEBAR_ATTEMPT_STATE_KEY = "__chatgptDesktopConnectAttempt";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_PENDING = 16;
const TTL_MS = 30_000;
const error = () =>
  Object.assign(new Error("Sidebar navigation probe unavailable"), {
    code: "SIDEBAR_PROBE_INVALID",
  });
const safeHost = (value) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 256 &&
  !/[\x00-\x1f\x7f]/.test(value);

function dataObject(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    return null;
  const descriptors = Object.getOwnPropertyDescriptors(value),
    out = {};
  for (const key of Reflect.ownKeys(descriptors)) {
    const descriptor = descriptors[key];
    if (
      typeof key !== "string" ||
      !("value" in descriptor) ||
      !descriptor.enumerable
    )
      return null;
    Object.defineProperty(out, key, {
      value: descriptor.value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return out;
}

/**
 * Wraps only the original model-backed navigateToLocalConversation provider.
 * The row is used solely to restrict the input source; the thread and any
 * explicit host come from provider arguments, never from DOM text or attributes.
 * If the provider omits its host, the original route must resolve it before an
 * intent is enqueued. The integration must
 * supply the exact original delegated listener for the actual React root; this
 * prototype does not find, install, or authenticate that listener. A route carries one
 * opaque attempt ID, looked up only in this document's private in-memory map.
 * The scope lease is owned by the host integration, which must notify every
 * account/instance revision, including a new confirmation with the same value.
 * Every notification irrevocably revokes this probe. The supplied synchronous
 * callback is just observation/enqueue evidence.
 * Production must independently authenticate the user and bind the attempt,
 * native view, account, generations and exact RPC at the actual transport.
 */
export function createBrowserSidebarNavigationProbe(options = {}) {
  const { window: win, documentScope, scopeLease, onAttempt } = options;
  const scope = dataObject(documentScope);
  if (
    !win?.document ||
    !win?.crypto ||
    typeof win.crypto.randomUUID !== "function" ||
    !win.performance ||
    typeof win.performance.now !== "function" ||
    !win.Event ||
    !win.MouseEvent ||
    !win.KeyboardEvent ||
    !win.Element ||
    typeof win.setTimeout !== "function" ||
    typeof win.clearTimeout !== "function" ||
    !scopeLease ||
    typeof scopeLease.getSnapshot !== "function" ||
    typeof scopeLease.isCurrent !== "function" ||
    typeof scopeLease.subscribe !== "function" ||
    typeof onAttempt !== "function" ||
    !scope ||
    Object.keys(scope).length !== 3 ||
    !["profileId", "generation", "viewId"].every(
      (k) => typeof scope[k] === "string" && UUID.test(scope[k]),
    )
  )
    throw error();
  Object.freeze(scope);
  const attempts = new Map(),
    wrappers = new WeakMap(),
    observedEvents = new WeakSet();
  let active = null,
    disposed = false,
    revoked = false,
    scopeToken,
    unsubscribe;
  function retire(record, result = false) {
    if (attempts.get(record.attemptId) !== record) return;
    attempts.delete(record.attemptId);
    win.clearTimeout(record.timer);
    if (!record.finished) {
      record.finished = true;
      record.resolve(result);
    }
  }
  function revoke() {
    if (revoked) return;
    revoked = true;
    active = null;
    for (const record of attempts.values()) retire(record);
  }
  function current() {
    if (disposed || revoked) return false;
    try {
      if (
        scopeLease.getSnapshot() === scopeToken &&
        scopeLease.isCurrent(scopeToken, scope) === true
      )
        return true;
    } catch {
      /* A failed lease check fails closed. */
    }
    revoke();
    return false;
  }
  function enqueue(candidate) {
    try {
      const queued = onAttempt(candidate);
      // The callback must enqueue synchronously; it must not hide a failed
      // asynchronous acknowledgement behind a locally valid receipt.
      if (queued && typeof queued.then === "function") {
        Promise.resolve(queued).catch(() => {});
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }
  function capture(root, event) {
    try {
      if (
        !current() ||
        !(event instanceof win.Event) ||
        observedEvents.has(event) ||
        event.currentTarget !== root ||
        ![2, 3].includes(event.eventPhase) ||
        event.isTrusted !== true ||
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      )
        return;
      if (event.type === "click") {
        if (!(event instanceof win.MouseEvent) || event.button !== 0) return;
      } else if (event.type === "keydown") {
        if (
          !(event instanceof win.KeyboardEvent) ||
          !["Enter", " "].includes(event.key) ||
          event.repeat ||
          event.isComposing
        )
          return;
      } else return;
      const path = event.composedPath();
      if (!Array.isArray(path) || path.length > 256 || !path.includes(root))
        return;
      const elements = path.filter((node) => node instanceof win.Element);
      const rows = elements.filter((node) =>
        node.hasAttribute("data-app-action-sidebar-thread-row"),
      );
      if (rows.length !== 1) return;
      const row = rows[0],
        rowIndex = elements.indexOf(row);
      if (
        row.getAttribute("data-app-action-sidebar-thread-kind") !== "local" ||
        row.getAttribute("aria-disabled") === "true" ||
        row.getAttribute("data-sidebar-thread-actions-disabled") === "true" ||
        elements.some(
          (node) => node.getAttribute("data-app-shell-active-page") === "false",
        ) ||
        !row.isConnected ||
        row.ownerDocument !== win.document ||
        elements.indexOf(root) <= rowIndex ||
        (event.type === "keydown" && event.target !== row)
      )
        return;
      for (const node of elements.slice(0, rowIndex)) {
        const tag = node.tagName?.toLowerCase(),
          role = node.getAttribute("role");
        if (
          ["button", "input", "textarea", "select", "a"].includes(tag) ||
          node.isContentEditable ||
          [
            "button",
            "link",
            "menuitem",
            "menuitemcheckbox",
            "menuitemradio",
            "textbox",
            "combobox",
            "checkbox",
          ].includes(role)
        )
          return;
      }
      return { event, row };
    } catch {
      return;
    }
  }
  try {
    scopeToken = scopeLease.getSnapshot();
    if (scopeToken == null || scopeLease.isCurrent(scopeToken, scope) !== true)
      throw error();
    unsubscribe = scopeLease.subscribe(revoke);
    if (typeof unsubscribe !== "function" || !current()) throw error();
  } catch {
    disposed = true;
    revoke();
    try {
      if (typeof unsubscribe === "function") unsubscribe();
    } catch {
      /* Retired. */
    }
    throw error();
  }
  function wrapDelegatedListener(root, listener) {
    if (
      !(root instanceof win.Element) ||
      root.ownerDocument !== win.document ||
      !root.isConnected ||
      typeof listener !== "function"
    )
      throw error();
    return function (...args) {
      // Only a caller-provided original React delegate can establish this
      // synchronous frame. Any nested invocation invalidates the outer frame.
      active = null;
      const captured = this === root ? capture(root, args[0]) : undefined;
      active = captured ?? null;
      try {
        return Reflect.apply(listener, this, args);
      } finally {
        if (active === captured) active = null;
      }
    };
  }
  function wrapNavigation(navigate) {
    if (typeof navigate !== "function") throw error();
    const prior = wrappers.get(navigate);
    if (prior) return prior;
    const wrapped = function (...args) {
      const captured = active;
      active = null;
      if (captured) observedEvents.add(captured.event);
      const ordinary = () => Reflect.apply(navigate, this, args);
      if (
        !captured ||
        !current() ||
        ![2, 3].includes(captured.event.eventPhase) ||
        !captured.row.isConnected ||
        captured.row.ownerDocument !== win.document ||
        (captured.event.type === "click" && captured.event.defaultPrevented) ||
        args.length < 1 ||
        args.length > 3 ||
        !UUID.test(args[0] ?? "") ||
        (args[1] != null && !safeHost(args[1])) ||
        attempts.size >= MAX_PENDING
      )
        return ordinary();
      const originalOptions = args[2] == null ? {} : dataObject(args[2]);
      const originalState =
        originalOptions?.state == null ? {} : dataObject(originalOptions.state);
      if (
        !originalOptions ||
        !originalState ||
        Object.hasOwn(originalState, SIDEBAR_ATTEMPT_STATE_KEY)
      )
        return ordinary();
      let attemptId;
      try {
        attemptId = win.crypto.randomUUID();
      } catch {
        return ordinary();
      }
      if (!UUID.test(attemptId) || attempts.has(attemptId)) return ordinary();
      const candidate = Object.freeze({
        v: 1,
        action: "connect",
        attemptId,
        ...scope,
        hostId: args[1] ?? null,
        threadId: args[0],
      });
      let resolve;
      const ready = new Promise((done) => {
        resolve = done;
      });
      const record = {
        attemptId,
        candidate,
        ready,
        resolve,
        finished: false,
        claimed: false,
        expires: win.performance.now() + TTL_MS,
        timer: null,
      };
      attempts.set(attemptId, record);
      record.timer = win.setTimeout(() => retire(record), TTL_MS);
      const nextOptions = {
        ...originalOptions,
        state: { ...originalState, [SIDEBAR_ATTEMPT_STATE_KEY]: attemptId },
      };
      let result;
      try {
        result = Reflect.apply(navigate, this, [args[0], args[1], nextOptions]);
      } catch (cause) {
        retire(record);
        throw cause;
      }
      if (result !== true || !current()) {
        retire(record);
        return result;
      }
      if (candidate.hostId !== null && !enqueue(candidate)) {
        retire(record);
        return result;
      }
      record.finished = true;
      record.resolve(true);
      return result;
    };
    wrappers.set(navigate, wrapped);
    return wrapped;
  }
  function prepareExplicit({event,hostId,threadId,state,sourceToken} = {}) {
    try {
      if (!current() || !(event instanceof win.Event) || observedEvents.has(event) || event.isTrusted !== true ||
          ![1,2,3].includes(event.eventPhase) || (event.type === "click" && event.defaultPrevented) || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
          !(event.target instanceof win.Element) || !(event.currentTarget instanceof win.Element) ||
          !event.target.isConnected || event.target.ownerDocument !== win.document || !event.currentTarget.isConnected ||
          event.currentTarget.ownerDocument !== win.document || !UUID.test(threadId ?? "") || !safeHost(hostId) ||
          (sourceToken !== undefined && (typeof sourceToken !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(sourceToken))) || attempts.size >= MAX_PENDING)
        return null;
      if (event.type === "click") {
        if (!(event instanceof win.MouseEvent) || event.button !== 0) return null;
      } else if (event.type === "keydown") {
        if (!(event instanceof win.KeyboardEvent) || !["Enter"," "].includes(event.key) || event.repeat || event.isComposing) return null;
      } else return null;
      const path = event.composedPath();
      if (!Array.isArray(path) || path.length > 256 || !path.includes(event.currentTarget)) return null;
      const originalState = state == null ? {} : dataObject(state);
      if (!originalState || Object.hasOwn(originalState,SIDEBAR_ATTEMPT_STATE_KEY)) return null;
      observedEvents.add(event);
      const attemptId = win.crypto.randomUUID();
      if (!UUID.test(attemptId) || attempts.has(attemptId)) return null;
      const candidate = Object.freeze({v:1,action:"connect",attemptId,...scope,hostId,threadId,...(sourceToken === undefined ? {} : {sourceToken})});
      let resolve;
      const ready = new Promise(done => { resolve = done; });
      const record = {attemptId,candidate,ready,resolve,finished:false,claimed:false,expires:win.performance.now()+TTL_MS,timer:null};
      attempts.set(attemptId,record);
      record.timer = win.setTimeout(() => retire(record),TTL_MS);
      if (!enqueue(candidate)) { retire(record); return null; }
      return Object.freeze({candidate,state:{...originalState,[SIDEBAR_ATTEMPT_STATE_KEY]:attemptId},
        commit() {
          if (attempts.get(attemptId) !== record || record.finished || !current() || win.performance.now() >= record.expires) return false;
          record.finished = true; record.resolve(true); return true;
        },
        cancel() { retire(record); },
      });
    } catch { return null; }
  }
  async function consumeAttempt({ state, hostId, threadId } = {}) {
    const checked = dataObject(state),
      id = checked?.[SIDEBAR_ATTEMPT_STATE_KEY];
    if (!current() || typeof id !== "string" || !UUID.test(id)) return null;
    const record = attempts.get(id);
    if (
      !record ||
      record.claimed ||
      !safeHost(hostId) ||
      (record.candidate.hostId !== null && record.candidate.hostId !== hostId) ||
      record.candidate.threadId !== threadId ||
      win.performance.now() >= record.expires
    )
      return null;
    record.claimed = true;
    const accepted = await record.ready;
    let valid =
      accepted &&
      current() &&
      attempts.get(id) === record &&
      win.performance.now() < record.expires;
    let candidate = record.candidate;
    if (valid && candidate.hostId === null) {
      candidate = Object.freeze({ ...candidate, hostId });
      valid =
        enqueue(candidate) &&
        current() &&
        attempts.get(id) === record &&
        win.performance.now() < record.expires;
    }
    retire(record);
    return valid ? candidate : null;
  }
  return Object.freeze({
    wrapDelegatedListener,
    wrapNavigation,
    prepareExplicit,
    consumeAttempt,
    dispose() {
      if (disposed) return;
      disposed = true;
      revoke();
      try {
        unsubscribe();
      } catch {
        /* Retired. */
      }
    },
  });
}
