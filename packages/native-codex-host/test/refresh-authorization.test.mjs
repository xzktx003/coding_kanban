import test from "node:test";
import assert from "node:assert/strict";
import { nativeAuthorizationIdentity } from "../refresh-prototype/authorization-boundary.mjs";
const scope = { domain: "domain-a", generation: "generation-a" };
const account = {
  account: {
    type: "chatgpt",
    email: "private@example.invalid",
    planType: "pro",
  },
  requiresOpenaiAuth: true,
  workspaceRouting: {
    chatgptAccountId: "workspace-a",
    backendOrigin: "https://chatgpt.com",
    accountRoutingOverride: "NO_CONSTRAINT",
  },
};
test("native authorization binds user, workspace, backend and generation without retaining account payloads", () => {
  const base = nativeAuthorizationIdentity(account, scope);
  assert.equal(base.kind, "chatgpt");
  assert.match(base.fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(base).includes("private@example"), false);
  assert.equal(JSON.stringify(base).includes("workspace-a"), false);
  for (const changed of [
    {
      ...account,
      account: { ...account.account, email: "other@example.invalid" },
    },
    {
      ...account,
      workspaceRouting: {
        ...account.workspaceRouting,
        chatgptAccountId: "workspace-b",
      },
    },
    {
      ...account,
      workspaceRouting: {
        ...account.workspaceRouting,
        backendOrigin: "https://other.invalid",
      },
    },
    {
      ...account,
      workspaceRouting: {
        ...account.workspaceRouting,
        accountRoutingOverride: "us",
      },
    },
  ])
    assert.notEqual(
      nativeAuthorizationIdentity(changed, scope).fingerprint,
      base.fingerprint,
    );
  assert.notEqual(
    nativeAuthorizationIdentity(account, {
      ...scope,
      generation: "generation-b",
    }).fingerprint,
    base.fingerprint,
  );
  assert.notEqual(
    nativeAuthorizationIdentity(account, { ...scope, domain: "domain-b" })
      .fingerprint,
    base.fingerprint,
  );
  assert.equal(
    nativeAuthorizationIdentity(
      { ...account, account: { ...account.account, planType: "plus" } },
      scope,
    ).fingerprint,
    base.fingerprint,
  );
});
test("missing, unsupported or unsafe native authorization stays unbound", () => {
  for (const value of [
    null,
    {},
    { account: null, requiresOpenaiAuth: true },
    { ...account, requiresOpenaiAuth: "true" },
    { ...account, account: { type: "apiKey" } },
    { ...account, workspaceRouting: null },
    { ...account, account: { ...account.account, email: "x\ny" } },
    {
      ...account,
      workspaceRouting: { ...account.workspaceRouting, chatgptAccountId: "" },
    },
    ...[
      "http://chatgpt.com",
      "https://chatgpt.com/",
      "https://u:p@chatgpt.com",
      "https://chatgpt.com/path",
    ].map((backendOrigin) => ({
      ...account,
      workspaceRouting: { ...account.workspaceRouting, backendOrigin },
    })),
  ])
    assert.throws(
      () => nativeAuthorizationIdentity(value, scope),
      /authorization/,
    );
  assert.equal(
    nativeAuthorizationIdentity(
      { account: null, requiresOpenaiAuth: false },
      scope,
    ).kind,
    "provider-without-openai-auth",
  );
});
