// Unconnected research prototype. The caller must already have the exact,
// hash-pinned original createRoot function and its original root container.
// Capturing a UI gesture does not authenticate a user or authorize an RPC.
export function createRootWithDelegateProbe({
  window: win,
  root,
  createRoot,
  probe,
}) {
  if (typeof createRoot !== "function")
    throw new TypeError("Expected createRoot");
  const unchanged = () => ({
    value: Reflect.apply(createRoot, undefined, [root]),
    active: false,
    restored: true,
  });
  if (
    !win?.document ||
    !win.Element ||
    !(root instanceof win.Element) ||
    root.ownerDocument !== win.document ||
    !root.isConnected ||
    win.document.getElementById("root") !== root ||
    Object.hasOwn(root, "addEventListener") ||
    !Object.isExtensible(root) ||
    typeof probe?.wrapDelegatedListener !== "function"
  )
    return unchanged();

  let proto = Object.getPrototypeOf(root),
    descriptor;
  for (
    let depth = 0;
    proto && depth < 32;
    depth++, proto = Object.getPrototypeOf(proto)
  ) {
    descriptor = Object.getOwnPropertyDescriptor(proto, "addEventListener");
    if (descriptor) break;
  }
  if (
    !descriptor ||
    typeof descriptor.value !== "function" ||
    root.addEventListener !== descriptor.value
  )
    return unchanged();
  const originalAdd = descriptor.value,
    counts = { click: 0, keydown: 0 };
  let enabled = false,
    invalid = false,
    installed = false,
    restored = false,
    value,
    failure,
    threw = false;
  function intercept(type, listener, options) {
    const args = Array.from(arguments);
    let wrappedType;
    if (this === root && (type === "click" || type === "keydown")) {
      if (options === false && typeof listener === "function") {
        try {
          const wrapped = probe.wrapDelegatedListener(root, listener);
          if (typeof wrapped !== "function")
            throw new TypeError("Invalid delegate");
          args[1] = function (...eventArgs) {
            return Reflect.apply(enabled ? wrapped : listener, this, eventArgs);
          };
          wrappedType = type;
        } catch {
          invalid = true;
        }
      } else if (options !== true) invalid = true;
    }
    const result = Reflect.apply(originalAdd, this, args);
    if (wrappedType) counts[wrappedType]++;
    return result;
  }
  try {
    Object.defineProperty(root, "addEventListener", {
      value: intercept,
      writable: true,
      configurable: true,
      enumerable: false,
    });
    installed = true;
    value = Reflect.apply(createRoot, undefined, [root]);
  } catch (error) {
    threw = true;
    failure = error;
  } finally {
    if (installed) {
      try {
        const own = Object.getOwnPropertyDescriptor(root, "addEventListener");
        // Never overwrite or remove a different owner's replacement.
        if (own?.value === intercept && own.configurable === true)
          delete root.addEventListener;
        restored =
          !Object.hasOwn(root, "addEventListener") &&
          root.addEventListener === originalAdd;
      } catch {
        restored = false;
      }
    }
  }
  if (threw) throw failure;
  enabled =
    restored &&
    !invalid &&
    counts.click === 1 &&
    counts.keydown === 1 &&
    value != null &&
    typeof value.then !== "function";
  return { value, active: enabled, restored };
}
