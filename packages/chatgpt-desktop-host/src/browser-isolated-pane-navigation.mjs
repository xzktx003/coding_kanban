const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const invalid = () =>
  Object.assign(new Error("Isolated pane navigation unavailable"), {
    code: "ISOLATED_PANE_NAV_UNAVAILABLE",
  });
const atom = (value) =>
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
  const output = {};
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      typeof key !== "string" ||
      !["__proto__", "prototype", "constructor"].every(
        (name) => name !== key,
      ) ||
      !descriptor ||
      !Object.hasOwn(descriptor, "value") ||
      !descriptor.enumerable
    )
      return null;
    Object.defineProperty(output, key, {
      value: descriptor.value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return output;
}

/** Explicit pane actions for this private native; no shared daemon access. */
export function createBrowserIsolatedPaneNavigation({
  window: win,
  scopeLease,
  documentScope,
} = {}) {
  const scope = dataObject(documentScope);
  if (
    !win?.document ||
    !scope ||
    Object.keys(scope).sort().join(",") !== "generation,profileId,viewId" ||
    ![scope.profileId, scope.generation, scope.viewId].every((value) =>
      UUID.test(value ?? ""),
    ) ||
    !scopeLease ||
    typeof scopeLease.getSnapshot !== "function" ||
    typeof scopeLease.isCurrent !== "function"
  )
    throw invalid();
  const seen = new WeakSet();
  let disposed = false;
  function activateExplicit({
    event,
    hostId,
    threadId,
    state,
    navigate,
    isCurrent,
  } = {}) {
    let accepted = false;
    try {
      const token = scopeLease.getSnapshot();
      if (
        disposed ||
        !token ||
        scopeLease.isCurrent(token, scope) !== true ||
        typeof isCurrent !== "function" ||
        isCurrent() !== true ||
        typeof navigate !== "function" ||
        !atom(hostId) ||
        !UUID.test(threadId ?? "") ||
        !(event instanceof win.Event) ||
        seen.has(event) ||
        event.isTrusted !== true ||
        ![1, 2, 3].includes(event.eventPhase) ||
        (event.type === "click" && event.defaultPrevented) ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        !(event.target instanceof win.Element) ||
        !(event.currentTarget instanceof win.Element) ||
        !event.target.isConnected ||
        event.target.ownerDocument !== win.document ||
        !event.currentTarget.isConnected ||
        event.currentTarget.ownerDocument !== win.document
      )
        return Promise.resolve(false);
      if (event.type === "click") {
        if (!(event instanceof win.MouseEvent) || event.button !== 0)
          return Promise.resolve(false);
      } else if (event.type === "keydown") {
        if (
          !(event instanceof win.KeyboardEvent) ||
          !["Enter", " "].includes(event.key) ||
          event.repeat ||
          event.isComposing
        )
          return Promise.resolve(false);
      } else return Promise.resolve(false);
      const path = event.composedPath(),
        checked = state == null ? {} : dataObject(state);
      if (
        !Array.isArray(path) ||
        path.length > 256 ||
        !path.includes(event.currentTarget) ||
        !checked ||
        Object.hasOwn(checked, "__chatgptDesktopConnectAttempt")
      )
        return Promise.resolve(false);
      seen.add(event);
      if (
        scopeLease.getSnapshot() !== token ||
        scopeLease.isCurrent(token, scope) !== true ||
        isCurrent() !== true
      )
        return Promise.resolve(false);
      accepted = navigate(threadId, hostId, { state: checked }) === true;
    } catch {}
    return Promise.resolve(accepted);
  }
  return Object.freeze({
    activateExplicit,
    dispose() {
      disposed = true;
    },
  });
}
