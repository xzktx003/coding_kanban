import { randomUUID } from "node:crypto";
import { isSharedTurnItemsParams, isSharedTurnItemsPage } from "./shared-thread-history.mjs";

// This is an unconnected server-only policy primitive. The caller must bind its
// registry to an actual authenticated user gesture and its dispatch function to
// a transport that writes synchronously when called. Neither binding exists yet.
const fail = (code) =>
  Object.assign(new Error("Shared thread policy denied"), { code });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BINDING_KEYS = [
  "hostId",
  "runtimeGeneration",
  "daemonGeneration",
  "accountRevision",
  "projectId",
  "threadId",
  "viewId",
  "clientId",
];
const registries = new WeakMap();
const MAX_FRAME = 64 * 1024;
const MAX_TEXT = 32 * 1024;
const MAX_READ_RESULT = 16 * 1024 * 1024;
const MAX_DEADLINE = 120_000;
const INTENT_LIFETIME = 30_000;

function plain(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function keys(value, allowed, required = allowed) {
  return (
    plain(value) &&
    Object.keys(value).every((key) => allowed.includes(key)) &&
    required.every((key) => Object.hasOwn(value, key))
  );
}
function safeAtom(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 256 &&
    !/[\x00-\x1f\x7f]/.test(value)
  );
}
function bindingCopy(value) {
  if (
    !keys(value, BINDING_KEYS) ||
    !safeAtom(value.hostId) ||
    !safeAtom(value.projectId) ||
    ![
      value.runtimeGeneration,
      value.daemonGeneration,
      value.threadId,
      value.viewId,
      value.clientId,
    ].every((part) => UUID.test(part ?? "")) ||
    !Number.isSafeInteger(value.accountRevision) ||
    value.accountRevision < 0
  )
    throw fail("SHARED_POLICY_INVALID_BINDING");
  return Object.freeze(
    Object.fromEntries(BINDING_KEYS.map((key) => [key, value[key]])),
  );
}
function sameBinding(a, b) {
  return BINDING_KEYS.every((key) => a[key] === b[key]);
}
function validId(value) {
  return (
    (Number.isSafeInteger(value) && value >= 0) ||
    (safeAtom(value) &&
      !value.startsWith("shared-send:") &&
      !value.startsWith("shared-connect:"))
  );
}
function parseFrame(encoded) {
  if (typeof encoded !== "string" || Buffer.byteLength(encoded) > MAX_FRAME)
    throw fail("SHARED_POLICY_DENIED");
  let frame;
  try {
    frame = JSON.parse(encoded);
  } catch {
    throw fail("SHARED_POLICY_DENIED");
  }
  if (
    !keys(
      frame,
      ["id", "method", "params", "jsonrpc"],
      ["id", "method", "params"],
    ) ||
    !validId(frame.id) ||
    typeof frame.method !== "string" ||
    !plain(frame.params) ||
    (Object.hasOwn(frame, "jsonrpc") && frame.jsonrpc !== "2.0")
  )
    throw fail("SHARED_POLICY_DENIED");
  return frame;
}
function parseRead(encoded, binding) {
  const frame = parseFrame(encoded),
    params = frame.params;
  if (params.threadId !== binding.threadId) throw fail("SHARED_POLICY_DENIED");
  if (
    frame.method === "thread/read" &&
    keys(params, ["threadId", "includeTurns"]) &&
    params.includeTurns === false
  )
    return frame;
  if (
    frame.method === "thread/turns/list" &&
    keys(
      params,
      ["threadId", "limit", "cursor", "sortDirection", "itemsView"],
      ["threadId", "limit", "itemsView"],
    ) &&
    Number.isSafeInteger(params.limit) &&
    params.limit >= 1 &&
    params.limit <= 100 &&
    ["summary", "notLoaded"].includes(params.itemsView) &&
    (params.sortDirection === undefined ||
      params.sortDirection === null ||
      ["asc", "desc"].includes(params.sortDirection)) &&
    (params.cursor === undefined ||
      params.cursor === null ||
      (typeof params.cursor === "string" && params.cursor.length <= 4096))
  )
    return frame;
  if (frame.method === "thread/items/list" && isSharedTurnItemsParams(params))
    return frame;
  throw fail("SHARED_POLICY_DENIED");
}
function parseTurn(encoded, binding) {
  const frame = parseFrame(encoded),
    params = frame.params;
  if (
    frame.method !== "turn/start" ||
    !keys(params, ["threadId", "input"]) ||
    params.threadId !== binding.threadId ||
    !Array.isArray(params.input) ||
    params.input.length !== 1
  )
    throw fail("SHARED_INTENT_DENIED");
  const input = params.input[0];
  if (
    !keys(input, ["type", "text", "text_elements"], ["type", "text"]) ||
    input.type !== "text" ||
    typeof input.text !== "string" ||
    !input.text.length ||
    Buffer.byteLength(input.text) > MAX_TEXT ||
    (input.text_elements !== undefined &&
      (!Array.isArray(input.text_elements) || input.text_elements.length))
  )
    throw fail("SHARED_INTENT_DENIED");
  return frame;
}

/** Server-owned, unforgeable process-local receipts; this does not itself prove a browser gesture. */
export function createTrustedSendIntentRegistry() {
  const records = new WeakMap();
  const registry = Object.freeze({
    captureUserSend(binding, encoded) {
      const captured = bindingCopy(binding),
        frame = parseTurn(encoded, captured),
        receipt = Object.freeze({});
      records.set(receipt, {
        action: "send",
        binding: captured,
        encoded: JSON.stringify(frame),
        expires: performance.now() + INTENT_LIFETIME,
      });
      return receipt;
    },
    captureUserConnect(binding) {
      const captured = bindingCopy(binding),
        receipt = Object.freeze({});
      records.set(receipt, {
        action: "connect",
        binding: captured,
        expires: performance.now() + INTENT_LIFETIME,
      });
      return receipt;
    },
  });
  registries.set(registry, (receipt, binding, action) => {
    if (!plain(receipt)) return null;
    const record = records.get(receipt);
    records.delete(receipt);
    return record &&
      record.action === action &&
      performance.now() < record.expires &&
      sameBinding(record.binding, binding)
      ? record
      : null;
  });
  return registry;
}

/**
 * Trusted server-only policy; not a complete daemon proxy or browser authorization.
 * verifyIdentity must independently check the full native/account/project binding.
 * dispatch must synchronously write its canonical frame before returning a response
 * promise; a deferred write would require a separate final synchronous guard.
 */
export function createSharedThreadPolicy({
  binding,
  intents,
  verifyIdentity,
  dispatch,
  inspectAttachment,
  inspectHistory,
} = {}) {
  const fixed = bindingCopy(binding),
    consume = registries.get(intents);
  if (
    !consume ||
    typeof verifyIdentity !== "function" ||
    typeof dispatch !== "function" ||
    (inspectAttachment !== undefined &&
      typeof inspectAttachment !== "function") ||
    (inspectHistory !== undefined && typeof inspectHistory !== "function")
  )
    throw fail("SHARED_POLICY_INVALID_CONFIG");
  let revoked = false;
  const cancellation = new AbortController();
  const usedRequestIds = new Set();
  function claimRequestId(id) {
    const key = `${typeof id}:${id}`;
    if (usedRequestIds.has(key) || usedRequestIds.size >= 8192)
      throw fail("SHARED_REQUEST_ID_USED");
    usedRequestIds.add(key);
  }
  function revoke() {
    if (!revoked) {
      revoked = true;
      cancellation.abort();
    }
  }
  function assertLive(control) {
    if (revoked) throw fail("SHARED_SCOPE_REVOKED");
    if (
      !control ||
      !(control.signal instanceof AbortSignal) ||
      !Number.isFinite(control.deadline) ||
      control.deadline - performance.now() > MAX_DEADLINE ||
      control.signal.aborted ||
      performance.now() >= control.deadline
    )
      throw fail("SHARED_REQUEST_CANCELED");
  }
  function bounded(promise, control) {
    // A dispatch may fail after writing while scope revocation happens in the
    // same call stack; its late rejection must still be observed.
    Promise.resolve(promise).catch(() => {});
    assertLive(control);
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        control.signal.removeEventListener("abort", onAbort);
        cancellation.signal.removeEventListener("abort", onRevoke);
        if (error) reject(error);
        else {
          try {
            assertLive(control);
            resolve(value);
          } catch (cause) {
            reject(cause);
          }
        }
      };
      const onAbort = () => finish(fail("SHARED_REQUEST_CANCELED"));
      const onRevoke = () => finish(fail("SHARED_SCOPE_REVOKED"));
      const timer = setTimeout(
        onAbort,
        Math.max(1, Math.ceil(control.deadline - performance.now())),
      );
      control.signal.addEventListener("abort", onAbort, { once: true });
      cancellation.signal.addEventListener("abort", onRevoke, { once: true });
      if (revoked) return onRevoke();
      if (control.signal.aborted) return onAbort();
      Promise.resolve(promise).then(
        (value) => finish(null, value),
        (error) => finish(error),
      );
    });
  }
  async function verify(control) {
    assertLive(control);
    let valid;
    try {
      valid = await bounded(
        Promise.resolve().then(() => verifyIdentity(fixed)),
        control,
      );
    } catch (error) {
      if (
        error?.code === "SHARED_REQUEST_CANCELED" ||
        error?.code === "SHARED_SCOPE_REVOKED"
      )
        throw error;
      revoke();
      throw fail("SHARED_SCOPE_REVOKED");
    }
    if (valid !== true) {
      revoke();
      throw fail("SHARED_SCOPE_REVOKED");
    }
    assertLive(control);
  }
  async function write(frame, control, mutating) {
    await verify(control);
    assertLive(control);
    let pending;
    try {
      pending = dispatch(JSON.stringify(frame));
    } catch {
      throw fail(
        mutating ? "SHARED_OUTCOME_UNKNOWN" : "SHARED_UPSTREAM_UNAVAILABLE",
      );
    }
    let result;
    try {
      result = await bounded(pending, control);
    } catch (error) {
      if (mutating) throw fail("SHARED_OUTCOME_UNKNOWN");
      throw error;
    }
    if (
      !plain(result) ||
      result.id !== frame.id ||
      Object.hasOwn(result, "result") === Object.hasOwn(result, "error")
    )
      throw fail(
        mutating ? "SHARED_OUTCOME_UNKNOWN" : "SHARED_UPSTREAM_UNAVAILABLE",
      );
    let size;
    try {
      size = Buffer.byteLength(JSON.stringify(result));
    } catch {
      throw fail(
        mutating ? "SHARED_OUTCOME_UNKNOWN" : "SHARED_UPSTREAM_UNAVAILABLE",
      );
    }
    if (size > MAX_READ_RESULT)
      throw fail(
        mutating ? "SHARED_OUTCOME_UNKNOWN" : "SHARED_READ_BUDGET_EXCEEDED",
      );
    try {
      await verify(control);
    } catch (error) {
      if (mutating) throw fail("SHARED_OUTCOME_UNKNOWN");
      throw error;
    }
    return result;
  }
  async function requireBoundedHistory(control) {
    if (!inspectHistory) throw fail("SHARED_HISTORY_UNSUPPORTED");
    const history = await bounded(
      Promise.resolve().then(() => inspectHistory(fixed)),
      control,
    );
    if (
      !keys(history, [
        "threadId",
        "historyMode",
        "turnsListAvailable",
        "appHostTailHydration",
        "experimentalEnabled",
      ]) ||
      history.threadId !== fixed.threadId ||
      history.historyMode !== "paginated" ||
      history.turnsListAvailable !== true ||
      history.appHostTailHydration !== true ||
      history.experimentalEnabled !== true
    )
      throw fail("SHARED_HISTORY_UNSUPPORTED");
  }
  function assertBoundedResume(response) {
    const thread = response.result?.thread;
    const cursorValid = (name) =>
      Object.hasOwn(response.result, name) &&
      (response.result[name] === null ||
        (typeof response.result[name] === "string" &&
          response.result[name].length <= 4096));
    if (
      !plain(thread) ||
      thread.id !== fixed.threadId ||
      thread.historyMode !== "paginated" ||
      !Array.isArray(thread.turns) ||
      thread.turns.length !== 0 ||
      !cursorValid("turnsBackwardsCursor") ||
      !cursorValid("itemsBackwardsCursor")
    ) {
      revoke();
      throw fail("SHARED_OUTCOME_UNKNOWN");
    }
  }
  return Object.freeze({
    async read(encoded, control) {
      const frame = parseRead(encoded, fixed);
      claimRequestId(frame.id);
      const response = await write(frame, control, false);
      if (frame.method === "thread/items/list" && Object.hasOwn(response, "result") && !isSharedTurnItemsPage(response.result, frame.params))
        throw fail("SHARED_UPSTREAM_UNAVAILABLE");
      return response;
    },
    async connect(receipt, control) {
      const captured = consume(receipt, fixed, "connect");
      if (!captured) throw fail("SHARED_INTENT_DENIED");
      await verify(control);
      await requireBoundedHistory(control);
      const frame = {
        id: `shared-connect:${randomUUID()}`,
        method: "thread/resume",
        params: { threadId: fixed.threadId, excludeTurns: true },
      };
      claimRequestId(frame.id);
      const response = await write(frame, control, true);
      if (Object.hasOwn(response, "error"))
        throw fail("SHARED_CONNECT_REJECTED");
      assertBoundedResume(response);
      return response;
    },
    async send(receipt, control) {
      const captured = consume(receipt, fixed, "send");
      if (!captured) throw fail("SHARED_INTENT_DENIED");
      const turn = parseTurn(captured.encoded, fixed);
      claimRequestId(turn.id);
      await verify(control);
      if (!inspectAttachment) throw fail("SHARED_ATTACHMENT_UNAVAILABLE");
      const mode = await bounded(
        Promise.resolve().then(() => inspectAttachment(fixed)),
        control,
      );
      if (mode === "must-resume") {
        await requireBoundedHistory(control);
        const response = await write(
          {
            id: `shared-send:${randomUUID()}`,
            method: "thread/resume",
            params: { threadId: fixed.threadId, excludeTurns: true },
          },
          control,
          true,
        );
        if (Object.hasOwn(response, "error"))
          throw fail("SHARED_RESUME_REJECTED");
        assertBoundedResume(response);
      } else if (mode !== "attached")
        throw fail("SHARED_ATTACHMENT_UNAVAILABLE");
      return await write(turn, control, true);
    },
    // Every notification, including an equal account value, invalidates this binding.
    accountChanged: revoke,
    revoke,
  });
}
