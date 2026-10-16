import { createHash } from "node:crypto";

// Pinned native authorization notifications. No account payloads enter the pool.
export const isAuthorizationBoundary = (method) =>
  method === "account/updated" ||
  method === "account/login/completed" ||
  method === "account/gatewayOAuth/changed";

export function validateAuthorizationBinding(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== "fingerprint,kind" ||
    !["chatgpt", "provider-without-openai-auth"].includes(value.kind) ||
    typeof value.fingerprint !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.fingerprint)
  )
    throw Error("native authorization binding unavailable");
  return Object.freeze({ kind: value.kind, fingerprint: value.fingerprint });
}

/** One connection's initial notice and two actual account reads; no thread state is used as authority. */
export function createNativeAuthorizationTracker({
  domain,
  generation,
  onInvalidated = () => {},
}) {
  const uuid = (value) =>
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      value,
    );
  if (!uuid(domain) || !uuid(generation) || typeof onInvalidated !== "function")
    throw Error("exact native authorization scope required");
  let valid = true,
    initial = true,
    notice = false,
    revision = 0,
    binding = null,
    started = false,
    wake;
  const assertValid = () => {
    if (!valid) throw Error("native authorization unavailable");
  };
  const invalidate = () => {
    if (!valid) return;
    valid = false;
    binding = null;
    wake?.();
    try {
      onInvalidated();
    } catch {
      /* A callback cannot undo revocation. */
    }
  };
  return {
    observe(event) {
      if (!valid || !isAuthorizationBoundary(event?.method)) return;
      revision++;
      if (initial && event.method === "account/updated" && !notice) {
        notice = true;
        wake?.();
        return;
      }
      invalidate();
    },
    assertValid,
    invalidate,
    binding() {
      assertValid();
      if (!binding) throw Error("native authorization binding unavailable");
      return binding;
    },
    async bind(client, { timeoutMs = 15000 } = {}) {
      if (
        started ||
        typeof client?.request !== "function" ||
        !Number.isSafeInteger(timeoutMs) ||
        timeoutMs < 1 ||
        timeoutMs > 60000
      )
        throw Error("bounded initial native authorization binding required");
      started = true;
      try {
        assertValid();
        const first = nativeAuthorizationIdentity(
          await client.request("account/read", { refreshToken: false }),
          { domain, generation },
        );
        assertValid();
        if (first.kind === "chatgpt" && !notice) {
          let timer;
          try {
            await Promise.race([
              new Promise((resolve) => (wake = resolve)),
              new Promise((_, reject) => {
                timer = setTimeout(
                  () =>
                    reject(
                      Error("initial native authorization notice unavailable"),
                    ),
                  timeoutMs,
                );
                timer.unref?.();
              }),
            ]);
          } finally {
            clearTimeout(timer);
            wake = undefined;
          }
        }
        assertValid();
        const before = revision;
        const confirmed = nativeAuthorizationIdentity(
          await client.request("account/read", { refreshToken: false }),
          { domain, generation },
        );
        assertValid();
        if (before !== revision || first.fingerprint !== confirmed.fingerprint)
          throw Error("native authorization changed during initial binding");
        initial = false;
        binding = validateAuthorizationBinding(confirmed);
        return binding;
      } catch (error) {
        invalidate();
        throw error;
      }
    },
  };
}

/** Hash native authority metadata only; never retain the response or credentials. */
export function nativeAuthorizationIdentity(value, { domain, generation }) {
  const text = (input, max) =>
    typeof input === "string" &&
    input.length > 0 &&
    input.length <= max &&
    !/[\x00-\x1f\x7f]/.test(input);
  let identity, kind;
  if (value?.requiresOpenaiAuth === false && value.account === null) {
    kind = "provider-without-openai-auth";
    identity = [kind];
  } else {
    const account = value?.account,
      routing = value?.workspaceRouting;
    if (
      value?.requiresOpenaiAuth !== true ||
      account?.type !== "chatgpt" ||
      !text(account.email, 320) ||
      !text(routing?.chatgptAccountId, 256) ||
      !text(routing?.backendOrigin, 2048) ||
      !["NO_CONSTRAINT", "us", "us_cr"].includes(
        routing?.accountRoutingOverride,
      )
    )
      throw Error("native authorization identity unavailable");
    let origin;
    try {
      origin = new URL(routing.backendOrigin);
    } catch {
      throw Error("native authorization origin unavailable");
    }
    if (
      origin.protocol !== "https:" ||
      origin.origin !== routing.backendOrigin ||
      origin.username ||
      origin.password
    )
      throw Error("native authorization origin unavailable");
    kind = "chatgpt";
    identity = [
      kind,
      account.email,
      routing.chatgptAccountId,
      routing.backendOrigin,
      routing.accountRoutingOverride,
    ];
  }
  return Object.freeze({
    kind,
    fingerprint: createHash("sha256")
      .update(JSON.stringify([domain, generation, ...identity]))
      .digest("hex"),
  });
}
