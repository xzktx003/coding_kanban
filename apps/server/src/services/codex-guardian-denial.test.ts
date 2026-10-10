import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CodexGuardianDenial,
  type GuardianNativeSnapshot,
} from "./codex-guardian-denial.js";

const identity = {
  threadId: "thread-a",
  turnId: "turn-a",
  reviewId: "review-a",
  targetItemId: "item-a",
  startedAtMs: 10,
  completedAtMs: 20,
};
const review = {
  ...identity,
  decisionSource: "agent",
  review: {
    status: "denied",
    riskLevel: "high",
    userAuthorization: "low",
    rationale: "Needs explicit consent",
  },
  action: {
    type: "command",
    source: "shell",
    command: "echo fixture",
    cwd: "/fixture",
  },
};
const raw = {
  id: identity.reviewId,
  turn_id: identity.turnId,
  target_item_id: identity.targetItemId,
  started_at_ms: 10,
  completed_at_ms: 20,
  status: "denied",
  decision_source: "agent",
  risk_level: "high",
  user_authorization: "low",
  rationale: "Needs explicit consent",
  review_reason: "policy",
  action: review.action,
};
function fixture() {
  let native: GuardianNativeSnapshot = {
    runtimeInstance: "runtime-a",
    instanceMarker: "instance-a",
    threadId: identity.threadId,
    latestTurnId: identity.turnId,
    featureEnabled: true,
    canAcceptDirectInput: true,
    recorded: false,
    review,
    event: raw,
  };
  const sends: unknown[] = [];
  const service = new CodexGuardianDenial({
    read: async () => structuredClone(native),
    send: async (...args) => {
      sends.push(args);
      return "recorded";
    },
  });
  return {
    service,
    sends,
    set: (patch: Partial<GuardianNativeSnapshot>) => {
      native = { ...native, ...patch };
    },
  };
}
const request = async (service: CodexGuardianDenial) => {
  const snapshot = await service.snapshot(identity);
  return {
    identity,
    runtimeInstance: snapshot.runtimeInstance!,
    approvalToken: snapshot.approvalToken!,
    clientRequestId: "client-a",
  };
};
test("missing gate, raw event, exact identity, or direct input never produces an approval capability", async () => {
  assert.equal(
    (await new CodexGuardianDenial().snapshot(identity)).state,
    "unavailable",
  );
  for (const patch of [
    { featureEnabled: false },
    { featureEnabled: null },
    { event: null },
    { canAcceptDirectInput: false },
    { canAcceptDirectInput: null },
    { latestTurnId: "turn-b" },
    { threadId: "thread-b" },
    { review: { ...review, reviewId: "reused-review" } },
    { event: { ...raw, turn_id: "turn-b" } },
    { event: { ...raw, status: "approved" } },
  ]) {
    const f = fixture();
    f.set(patch);
    const s = await f.service.snapshot(identity);
    assert.equal(s.canApprove, false);
    assert.equal(s.approvalToken, null);
    await assert.rejects(
      f.service.approve({
        identity,
        runtimeInstance: "runtime-a",
        approvalToken: "forged",
        clientRequestId: "client-a",
      }),
    );
    assert.deepEqual(f.sends, []);
  }
});
test("approval rechecks full snapshot and sends only original trusted opaque event, never starts a turn", async () => {
  const f = fixture();
  const input = await request(f.service);
  const result = await f.service.approve(input);
  assert.equal(result.state, "recorded");
  assert.deepEqual(f.sends, [
    [
      "thread/approveGuardianDeniedAction",
      { threadId: "thread-a", event: raw },
      "runtime-a",
    ],
  ]);
  assert.equal((await f.service.snapshot(identity)).state, "recorded");
  assert.equal(
    (await f.service.approve({ ...input, clientRequestId: "client-b" })).state,
    "recorded",
  );
  assert.equal(f.sends.length, 1);
});
test("same review id with a changed runtime, action, lifecycle or instance cannot reuse old token", async () => {
  for (const patch of [
    { runtimeInstance: "runtime-b" },
    { instanceMarker: "instance-b" },
    { review: { ...review, action: { ...review.action, command: "changed" } } },
    { event: { ...raw, plugin_id: "different-attribution" } },
    { canAcceptDirectInput: false },
    { featureEnabled: false },
  ]) {
    const f = fixture();
    const input = await request(f.service);
    f.set(patch);
    await assert.rejects(f.service.approve(input));
    assert.equal(f.sends.length, 0);
  }
});
test("in-flight and uncertain delivery cannot resend, read-only receipt can settle recorded", async () => {
  let release!: () => void;
  let sends = 0;
  let recorded = false;
  const f = fixture();
  const source = await f.service.snapshot(identity);
  const service = new CodexGuardianDenial({
    read: async () => ({
      runtimeInstance: "runtime-a",
      instanceMarker: "instance-a",
      threadId: "thread-a",
      latestTurnId: "turn-a",
      featureEnabled: true,
      canAcceptDirectInput: true,
      recorded,
      review,
      event: raw,
    }),
    send: async () => {
      sends++;
      await new Promise<void>((r) => (release = r));
      throw new Error("transport lost after send");
    },
  });
  assert.equal(source.canApprove, true);
  const input = await request(service);
  const pending = service.approve(input);
  await new Promise((r) => setTimeout(r, 5));
  const second = await service.approve({
    ...input,
    clientRequestId: "client-b",
  });
  assert.equal(second.state, "uncertain");
  assert.equal(sends, 1);
  release();
  assert.equal((await pending).state, "uncertain");
  assert.equal((await service.snapshot(identity)).state, "uncertain");
  assert.equal((await service.approve(input)).state, "uncertain");
  assert.equal(sends, 1);
  recorded = true;
  assert.equal((await service.snapshot(identity)).state, "recorded");
});
test("durable uncertain receipt survives a new gateway instance and rotated approval token", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "kanban-guardian-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const f = fixture();
  const native = {
    runtimeInstance: "runtime-a",
    instanceMarker: "instance-a",
    threadId: "thread-a",
    latestTurnId: "turn-a",
    featureEnabled: true,
    canAcceptDirectInput: true,
    recorded: false,
    review,
    event: raw,
  };
  let sends = 0;
  const deps = {
    read: async () => native,
    send: async () => {
      sends++;
      throw new Error("lost");
    },
  };
  const file = join(home, "journal.json");
  const first = new CodexGuardianDenial(deps, file);
  assert.equal((await first.approve(await request(first))).state, "uncertain");
  const restarted = new CodexGuardianDenial(deps, file);
  assert.equal((await restarted.snapshot(identity)).state, "uncertain");
  assert.equal(
    (
      await restarted.approve({
        ...(await request(f.service)),
        clientRequestId: "client-new",
      })
    ).state,
    "uncertain",
  );
  assert.equal(sends, 1);
});
test("a late lost RPC response cannot replace a confirmed original recorded receipt", async () => {
  let release!: () => void;
  let started!: () => void;
  const sending = new Promise<void>((resolve) => {
    started = resolve;
  });
  let recorded = false;
  const service = new CodexGuardianDenial({
    read: async () => ({
      runtimeInstance: "runtime-a",
      instanceMarker: "instance-a",
      threadId: "thread-a",
      latestTurnId: "turn-a",
      featureEnabled: true,
      canAcceptDirectInput: true,
      recorded,
      review,
      event: raw,
    }),
    send: async () => {
      started();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      throw new Error("late lost reply");
    },
  });
  const pending = service.approve(await request(service));
  await sending;
  recorded = true;
  assert.equal((await service.snapshot(identity)).state, "recorded");
  release();
  assert.equal((await pending).state, "recorded");
  assert.equal((await service.snapshot(identity)).state, "recorded");
});
