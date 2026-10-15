import { createHash } from "node:crypto";

// Pinned native authorization notifications. No account payloads enter the pool.
export const isAuthorizationBoundary = (method) =>
  method === "account/updated" ||
  method === "account/login/completed" ||
  method === "account/gatewayOAuth/changed";

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
