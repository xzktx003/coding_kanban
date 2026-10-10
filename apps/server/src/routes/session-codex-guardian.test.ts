import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify from "fastify";
import { registerSessionGuardianDenialRoutes } from "./session-codex-guardian.js";
const identity = {
  threadId: "thread-a",
  turnId: "turn-a",
  reviewId: "review-a",
  targetItemId: null,
  startedAtMs: 10,
  completedAtMs: 20,
};
test("guardian routes default to explicitly unavailable and cannot invent capability or raw event", async (t) => {
  const app = Fastify();
  t.after(() => app.close());
  registerSessionGuardianDenialRoutes(app);
  const snapshot = await app.inject({
    method: "POST",
    url: "/api/session/api/codex/guardian-denial/snapshot",
    payload: { identity },
  });
  assert.equal(snapshot.statusCode, 200);
  assert.equal(snapshot.json().state, "unavailable");
  assert.equal(snapshot.json().approvalToken, null);
  const approval = await app.inject({
    method: "POST",
    url: "/api/session/api/codex/guardian-denial/approve",
    payload: {
      identity,
      runtimeInstance: "runtime-a",
      approvalToken: "a".repeat(64),
      clientRequestId: "client-a",
    },
  });
  assert.equal(approval.statusCode, 409);
});
test("strict guardian routes reject raw event, fake decision/token, ambiguous identity and unexpected keys", async (t) => {
  const calls: unknown[] = [];
  const app = Fastify();
  t.after(() => app.close());
  registerSessionGuardianDenialRoutes(app, {
    service: {
      snapshot: async (input) => {
        calls.push(input);
        return {
          identity: input,
          state: "unavailable",
          runtimeInstance: null,
          approvalToken: null,
          canApprove: false,
          canAcceptDirectInput: null,
          review: null,
        };
      },
      approve: async (input) => {
        calls.push(input);
        return {
          identity: input.identity,
          runtimeInstance: input.runtimeInstance,
          clientRequestId: input.clientRequestId,
          state: "recorded",
        };
      },
    },
  });
  const valid = {
    identity,
    runtimeInstance: "runtime-a",
    approvalToken: "a".repeat(64),
    clientRequestId: "client-a",
  };
  for (const invalid of [
    { ...valid, event: { action: "untrusted" } },
    { ...valid, decision: "allow" },
    { ...valid, approvalToken: "fake" },
    { ...valid, identity: { ...identity, targetItemId: undefined } },
    { ...valid, identity: { ...identity, startedAtMs: -1 } },
    { ...valid, identity: { ...identity, completedAtMs: 9 } },
    { ...valid, identity: { ...identity, threadId: "bad\nthread" } },
    {
      ...valid,
      identity: { ...identity, requestId: "cannot-use-pending-approval-id" },
    },
  ]) {
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/session/api/codex/guardian-denial/approve",
          payload: invalid,
        })
      ).statusCode,
      400,
    );
  }
  assert.deepEqual(calls, []);
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/session/api/codex/guardian-denial/approve",
        payload: valid,
      })
    ).statusCode,
    200,
  );
  assert.deepEqual(calls, [valid]);
});
