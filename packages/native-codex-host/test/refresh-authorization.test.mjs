import test from "node:test";
import assert from "node:assert/strict";
import {
  createNativeAuthorizationTracker,
  nativeAuthorizationIdentity,
  workspaceRoutingDiscoveryTimedOut,
} from "../refresh-prototype/authorization-boundary.mjs";
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

const domain = "11111111-1111-4111-8111-111111111111";
const generation = "22222222-2222-4222-8222-222222222222";

test("workspace routing discovery timeout leaves the tracker retryable", async () => {
  const tracker = createNativeAuthorizationTracker({ domain, generation });
  const timeouts = [];
  const failing = {
    async request(method, params, options) {
      timeouts.push(options.timeoutMs);
      assert.equal(method, "account/read");
      assert.deepEqual(params, { refreshToken: false });
      throw Object.assign(new Error("Native request failed"), {
        code: -32603,
        nativeMessage: "workspace routing discovery timed out",
      });
    },
  };
  await assert.rejects(tracker.bind(failing), (error) =>
    workspaceRoutingDiscoveryTimedOut(error),
  );
  assert.throws(() => tracker.binding(), /unavailable/);
  let reads = 0;
  const binding = await tracker.bind({
    async request(method, params, options) {
      reads += 1;
      assert.equal(method, "account/read");
      assert.deepEqual(params, { refreshToken: false });
      assert.equal(options.timeoutMs, 45000);
      return { account: null, requiresOpenaiAuth: false };
    },
  });
  assert.equal(binding.kind, "provider-without-openai-auth");
  assert.equal(reads, 2);
  assert.deepEqual(timeouts, [45000]);
});

test("a changed account fingerprint still revokes the initial binding", async () => {
  const tracker = createNativeAuthorizationTracker({ domain, generation });
  let reads = 0;
  await assert.rejects(
    tracker.bind(
      {
        async request() {
          reads += 1;
          if (reads === 1) {
            queueMicrotask(() =>
              tracker.observe({ method: "account/updated" }),
            );
          }
          return reads === 1
            ? account
            : {
                ...account,
                account: { ...account.account, email: "other@example.invalid" },
              };
        },
      },
      { timeoutMs: 1000 },
    ),
    /changed during initial binding/,
  );
  assert.throws(() => tracker.binding(), /native authorization unavailable/);
  await assert.rejects(
    tracker.bind({
      async request() {
        return { account: null, requiresOpenaiAuth: false };
      },
    }),
    /native authorization unavailable|bounded initial native authorization binding required/,
  );
});
