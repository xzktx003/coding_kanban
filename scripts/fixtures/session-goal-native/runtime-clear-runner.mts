import assert from "node:assert/strict";
import {
  Ownership,
  type Rpc,
} from "../../../packages/session-runtime/src/codex/ownership.ts";
import { StdioRpc } from "../../../packages/session-runtime/src/transport/rpc.ts";
import {
  object,
  type JsonObject,
} from "../../../packages/session-runtime/src/core/json.ts";

const records: JsonObject[] = [];
function record(kind: string, value: JsonObject) {
  const entry = { order: records.length + 1, kind, ...value };
  records.push(entry);
  process.stdout.write(JSON.stringify(entry) + "\n");
  return entry;
}
let owner: Ownership;
let complete!: (value: JsonObject) => void;
const completed = new Promise<JsonObject>((resolve) => {
  complete = resolve;
});
const native = new StdioRpc({
  command: process.env.GOAL_PYTHON!,
  args: [
    process.env.GOAL_NATIVE_LAUNCHER!,
    process.env.GOAL_CONTROL_SOCKET!,
    process.env.GOAL_NATIVE_CLI!,
    process.env.GOAL_NETWORK_TRACE!,
  ],
  env: process.env,
  onDiagnostic: (message) => record("native.diagnostic", { message }),
  onNotification: (event) => {
    record("native.notification", { message: event });
    owner.observe(String(event.method), event.params ?? null);
    if (
      event.method === "thread/goal/updated" &&
      object(object(event.params).goal).status === "complete"
    )
      complete(object(event.params));
  },
  onRequest: async (request) => {
    await native.respondError(
      request.id,
      -32601,
      "No interactive tools in this private fixture",
    );
  },
  onExit: () => {
    owner?.invalidate();
  },
});
const raw: Rpc = async (method, params, options) => {
  const result = await native.request(method, params, {
    ...options,
    beforeSend: () => {
      options?.beforeSend?.();
      record("native.send", { method, params });
    },
  });
  record("native.ack", { method, result });
  return result;
};
owner = new Ownership(raw);
let passed = false;
let completionTimer: ReturnType<typeof setTimeout> | undefined;
try {
  const initialize = await raw("initialize", {
    clientInfo: { name: "goal_runtime_clear_acceptance", version: "1" },
    capabilities: { experimentalApi: true },
  });
  await native.notify("initialized");
  owner.queueUpdate(1n, false, []);
  const start = object(
    await owner.call("thread/start", {
      cwd: process.env.GOAL_PROJECT!,
      approvalPolicy: "never",
      sandbox: "read-only",
    }),
  );
  const id = String(object(start.thread).id);
  const objective = "GOAL_NATIVE_NEW prove local guarded completion clear";
  await owner.call("turn/start", {
    threadId: id,
    input: [{ type: "text", text: "/goal " + objective, text_elements: [] }],
  });
  await owner.call("thread/goal/set", {
    threadId: id,
    objective,
    status: "active",
    tokenBudget: 100,
  });
  record("fixture.release-first-response", { threadId: id });
  const completion = await Promise.race([
    completed,
    new Promise<never>((_, reject) => {
      completionTimer = setTimeout(
        () => reject(new Error("No real native completion event")),
        12000,
      );
    }),
  ]);
  clearTimeout(completionTimer);
  const expectedGoal = object(completion.goal),
    expectedAccessGeneration = (await owner.access(id)).generation;
  record("runtime.clear.request", {
    threadId: id,
    expectedGoal,
    expectedAccessGeneration,
  });
  const result = await owner.clearCompletedGoal({
    threadId: id,
    expectedGoal,
    expectedAccessGeneration,
  });
  record("runtime.clear.result", { result });
  assert.deepEqual(result, { cleared: true });
  assert.deepEqual(await raw("thread/goal/get", { threadId: id }), {
    goal: null,
  });
  const clear = records.find(
    (entry) =>
      entry.kind === "native.send" && entry.method === "thread/goal/clear",
  )!;
  const end = records.find(
    (entry) =>
      entry.kind === "native.notification" &&
      object(entry.message).method === "turn/completed" &&
      object(object(object(entry.message).params).turn).id ===
        completion.turnId,
  )!;
  assert(
    end && end.order < clear.order,
    "The completed Goal's exact turn must drain before native clear is dispatched",
  );
  assert.deepEqual(clear.params, { threadId: id });
  assert.equal(
    records.filter(
      (entry) =>
        entry.kind === "native.send" && entry.method === "thread/goal/clear",
    ).length,
    1,
  );
  assert(
    !records.some(
      (entry) =>
        entry.kind === "native.send" &&
        (entry.method === "thread/resume" ||
          /thread\/(?:turns|items)\/list/.test(String(entry.method)) ||
          (entry.method === "thread/read" &&
            object(entry.params).includeTurns !== false)),
    ),
  );
  // The same writer can replace a completed goal. A stale full capture must
  // preserve the replacement, including when native second timestamps match.
  const a = object(
    object(
      await owner.call("thread/goal/set", {
        threadId: id,
        objective: "Captured A",
        status: "complete",
      }),
    ).goal,
  );
  const generation = (await owner.access(id)).generation;
  const b = object(
    object(
      await owner.call("thread/goal/set", {
        threadId: id,
        objective: "Replacement B",
        status: "complete",
      }),
    ).goal,
  );
  const stale = await owner.clearCompletedGoal({
    threadId: id,
    expectedGoal: a,
    expectedAccessGeneration: generation,
  });
  assert.equal(stale.cleared, false);
  assert.deepEqual(
    object(await raw("thread/goal/get", { threadId: id })).goal,
    b,
  );
  record("runtime.stale-owner-preserves-replacement", {
    result: stale,
    captured: a,
    replacement: b,
  });
  const currentGeneration = (await owner.access(id)).generation;
  const changedGoal = await owner.clearCompletedGoal({
    threadId: id,
    expectedGoal: a,
    expectedAccessGeneration: currentGeneration,
  });
  assert.deepEqual(changedGoal, { cleared: false, reason: "goalChanged" });
  assert.deepEqual(
    object(await raw("thread/goal/get", { threadId: id })).goal,
    b,
  );
  record("runtime.full-goal-preserves-replacement", { result: changedGoal });
  passed = true;
  record("result", {
    passed,
    initialize,
    clearedTurnId: completion.turnId,
    exactTurnCompletedOrder: end.order,
    nativeClearSendOrder: clear.order,
  });
} catch (error) {
  record("result", {
    passed: false,
    error:
      error instanceof Error ? (error.stack ?? error.message) : String(error),
  });
  process.exitCode = 1;
} finally {
  clearTimeout(completionTimer);
  await native.close();
  if (!passed) process.exitCode = 1;
}
