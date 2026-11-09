// Local editing activation only. Neither these tokens nor a visible mode grant
// thread, native RPC, tool or approval authority.
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const failure = (code) =>
  Object.assign(new Error("Desktop surface activation unavailable"), { code });
const exact = (value, keys) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));

/**
 * The parent owns confirmActive/close. Only a validated child bootstrap may
 * supply scope; isCurrentDocument must compare actual iframe/document objects.
 * The child receives the read-only lease, never these owner methods.
 */
export function createDesktopSurfaceActivation({
  profileId,
  generation,
  onSubscriberError = () => {},
} = {}) {
  if (
    !UUID.test(profileId ?? "") ||
    !UUID.test(generation ?? "") ||
    typeof onSubscriberError !== "function"
  )
    throw failure("SURFACE_ACTIVATION_INVALID_CONFIG");
  let current = null,
    active = false,
    closed = false,
    epoch = 0;
  function notify(record) {
    for (const listener of [...record.listeners])
      try {
        listener();
      } catch {
        try {
          onSubscriberError();
        } catch {
          /* Revocation still reaches every subscriber. */
        }
      }
  }
  function retire(record) {
    if (!record || record.retired) return;
    record.token = null;
    record.retired = true;
    if (current === record) current = null;
    notify(record);
    record.listeners.clear();
  }
  function valid(record) {
    if (closed || record.retired || current !== record) return false;
    let matches = false;
    try {
      matches = record.isCurrentDocument(record.document) === true;
    } catch {
      /* fail closed */
    }
    if (!matches) {
      retire(record);
      return false;
    }
    return true;
  }
  return Object.freeze({
    confirmActive(value) {
      if (closed) throw failure("SURFACE_ACTIVATION_CLOSED");
      const revision = ++epoch,
        record = current;
      active = false;
      if (record) {
        record.token = null;
        notify(record);
      }
      if (typeof value !== "boolean")
        throw failure("SURFACE_ACTIVATION_INVALID_ACTIVE");
      // A subscriber may synchronously retire the document or close the owner.
      if (closed || revision !== epoch) return;
      active = value;
      if (value && record && valid(record)) {
        record.token = Object.freeze({});
        notify(record);
      }
    },
    bind({ scope, document, isCurrentDocument } = {}) {
      if (closed) throw failure("SURFACE_ACTIVATION_CLOSED");
      if (
        !exact(scope, ["profileId", "generation", "viewId"]) ||
        scope.profileId !== profileId ||
        scope.generation !== generation ||
        !UUID.test(scope.viewId ?? "") ||
        !document ||
        typeof document !== "object" ||
        typeof isCurrentDocument !== "function"
      )
        throw failure("SURFACE_ACTIVATION_INVALID_SCOPE");
      const revision = ++epoch;
      retire(current);
      const record = {
        document,
        isCurrentDocument,
        token: null,
        listeners: new Set(),
        retired: false,
      };
      if (closed || revision !== epoch) {
        record.retired = true;
      } else {
        current = record;
        if (active && valid(record)) record.token = Object.freeze({});
      }
      const lease = Object.freeze({
        getSnapshot() {
          return active && valid(record) ? record.token : null;
        },
        isCurrent(token) {
          return (
            token !== null && token === record.token && active && valid(record)
          );
        },
        subscribe(listener) {
          if (typeof listener !== "function")
            throw failure("SURFACE_ACTIVATION_INVALID_SUBSCRIBER");
          if (record.retired || closed) return () => {};
          const callback = () => listener();
          record.listeners.add(callback);
          return () => {
            record.listeners.delete(callback);
          };
        },
        dispose() {
          retire(record);
        },
      });
      return lease;
    },
    checkDocument() {
      if (current) valid(current);
    },
    close() {
      if (closed) return;
      closed = true;
      active = false;
      ++epoch;
      retire(current);
    },
  });
}
