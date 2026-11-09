// Local editing guard only. A token authorizes neither native RPC nor a turn.
// Register from the committed original composer context, never from a label,
// selected DOM row, guessed thread UUID, or a background transcript pane.
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const DOCUMENT_KEYS = ["profileId", "generation", "viewId"];
const TARGET_KEYS = ["hostId", "conversationId", "clientThreadId"];
const failure = (code) =>
  Object.assign(new Error("Input scope unavailable"), { code });

function metadata(value, keys, validate, code) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![null, Object.prototype].includes(Object.getPrototypeOf(value))
  )
    throw failure(code);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== keys.length) throw failure(code);
  const result = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(descriptors, key)?.value;
    if (
      !descriptor ||
      !Object.hasOwn(descriptor, "value") ||
      !validate(descriptor.value, key)
    )
      throw failure(code);
    result[key] = descriptor.value;
  }
  return Object.freeze(result);
}

export function createBrowserInputScope(documentScope) {
  const document = metadata(
    documentScope,
    DOCUMENT_KEYS,
    (value) => typeof value === "string" && UUID.test(value),
    "INPUT_SCOPE_INVALID_DOCUMENT",
  );
  const owners = new Map();
  let token = null,
    revision = 0,
    disposed = false;
  function revise() {
    token = null;
    revision++;
    if (revision > Number.MAX_SAFE_INTEGER) {
      disposed = true;
      owners.clear();
      return;
    }
    if (disposed || owners.size !== 1) return;
    const target = owners.values().next().value;
    if (target) token = Object.freeze({ document, target, revision });
  }
  const targetMetadata = (target) =>
    metadata(
      target,
      TARGET_KEYS,
      (value, key) =>
        (key === "conversationId" && value === null) ||
        (typeof value === "string" &&
          value.length > 0 &&
          value.length <= 4096 &&
          !/[\x00-\x1f\x7f]/.test(value)),
      "INPUT_SCOPE_INVALID_TARGET",
    );
  return Object.freeze({
    register(target) {
      if (disposed) throw failure("INPUT_SCOPE_CLOSED");
      if (owners.size >= 16) throw failure("INPUT_SCOPE_OWNER_LIMIT");
      const checked = targetMetadata(target),
        owner = {};
      owners.set(owner, checked);
      revise();
      let released = false;
      return Object.freeze({
        update(next) {
          if (disposed || released) throw failure("INPUT_SCOPE_CLOSED");
          // Invalidate first, including when new metadata cannot be verified.
          owners.set(owner, null);
          revise();
          const checked = targetMetadata(next);
          owners.set(owner, checked);
          revise();
        },
        dispose() {
          if (disposed || released) return;
          released = true;
          owners.delete(owner);
          revise();
        },
      });
    },
    capture: () => (disposed ? null : token),
    isCurrent: (captured) =>
      !disposed && captured !== null && token !== null && captured === token,
    dispose() {
      if (!disposed) {
        disposed = true;
        owners.clear();
        revise();
      }
    },
  });
}
