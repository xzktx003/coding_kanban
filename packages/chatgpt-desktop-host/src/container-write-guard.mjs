const failure = (code) =>
  Object.assign(new Error("Private container unavailable"), { code });

export function createInitialGrantAttempt() {
  let outcome = "not_attempted";
  return Object.freeze({
    get outcome() {
      return outcome;
    },
    async send(write) {
      if (outcome !== "not_attempted")
        throw failure("CONTAINER_GRANT_ALREADY_ATTEMPTED");
      if (typeof write !== "function")
        throw failure("CONTAINER_PROTOCOL_ERROR");
      // Once the attempt begins, failure cannot prove that the peer saw no bytes.
      outcome = "unknown";
      await write();
      outcome = "written";
    },
  });
}

/** deadline is the caller's absolute performance.now() deadline, never renewed. */
export function assertContainerWriteAuthority(control) {
  if (
    !control ||
    !(control.signal instanceof AbortSignal) ||
    !Number.isFinite(control.deadline) ||
    typeof control.onDispatch !== "function" ||
    control.signal.aborted ||
    performance.now() >= control.deadline
  )
    throw failure("CONTAINER_WRITE_ABORTED");
}

/** prepare synchronously checks transport/protocol state and returns the actual write. */
export async function runAuthorizedContainerWrite(control, verify, prepare) {
  assertContainerWriteAuthority(control);
  if ((await verify()) !== true) throw failure("CONTAINER_IDENTITY_CHANGED");
  assertContainerWriteAuthority(control);
  const write = prepare();
  if (typeof write !== "function") throw failure("CONTAINER_PROTOCOL_ERROR");
  assertContainerWriteAuthority(control);
  control.onDispatch();
  return write();
}

/** Trusted server-only, fixed-membership batch. No cross-request identity cache. */
export function snapshotContainerWriteBatch(entries) {
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > 8)
    throw failure("CONTAINER_PROTOCOL_ERROR");
  return Object.freeze(
    entries.map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry))
        throw failure("CONTAINER_PROTOCOL_ERROR");
      const descriptors = Object.getOwnPropertyDescriptors(entry);
      const value = {};
      for (const name of ["encoded", "signal", "deadline", "onDispatch"]) {
        if (!Object.hasOwn(descriptors[name] ?? {}, "value"))
          throw failure("CONTAINER_PROTOCOL_ERROR");
        value[name] = descriptors[name].value;
      }
      if (typeof value.encoded !== "string")
        throw failure("CONTAINER_PROTOCOL_ERROR");
      assertContainerWriteAuthority(value);
      return Object.freeze(value);
    }),
  );
}

/** One fresh verification, then at most eight synchronous write attempts. */
export async function runAuthorizedContainerBatch(entries, verify, prepare) {
  const fixed = snapshotContainerWriteBatch(entries);
  if ((await verify()) !== true) throw failure("CONTAINER_IDENTITY_CHANGED");
  for (const entry of fixed) assertContainerWriteAuthority(entry);
  const writes = prepare(fixed);
  if (
    !Array.isArray(writes) ||
    writes.length !== fixed.length ||
    writes.some((write) => typeof write !== "function")
  )
    throw failure("CONTAINER_PROTOCOL_ERROR");
  for (const entry of fixed) assertContainerWriteAuthority(entry);
  const pending = [];
  for (let index = 0; index < fixed.length; index++) {
    const entry = fixed[index];
    assertContainerWriteAuthority(entry);
    entry.onDispatch();
    assertContainerWriteAuthority(entry);
    // No await between the fixed batch verification and these actual writes.
    // A thrown prefix consumes its dispatched receipts; no suffix is retried.
    const result = Promise.resolve(writes[index]());
    void result.catch(() => {});
    pending.push(result);
  }
  await Promise.all(pending);
}
