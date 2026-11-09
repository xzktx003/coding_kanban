import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { Script } from "node:vm";
import { createContext } from "node:vm";
const require = createRequire(import.meta.url);
const {
  adaptNativeSharedThreadChunk,
} = require("../src/native-shared-thread-policy.cjs");
const originalPath = process.env.CHATGPT_PICKER_NATIVE_CHUNK;
test("unknown native bytes cannot enable shared thread routing", () => {
  assert.throws(
    () => adaptNativeSharedThreadChunk({ body: Buffer.from("bad") }),
    { code: "NATIVE_APP_POLICY_DIGEST_MISMATCH" },
  );
});
test(
  "the original request id reaches the per-scope guard immediately before native dispatch",
  { skip: !originalPath },
  async () => {
    const original = await readFile(originalPath),
      result = adaptNativeSharedThreadChunk({ body: original });
    assert.equal(
      result.adaptedSha256,
      createHash("sha256").update(result.body).digest("hex"),
    );
    const source = result.body.toString("utf8"),
      start = source.indexOf("async send(e,t,r,n){this.assertCurrent();try{"),
      end = source.indexOf("async sendToConnection(e,t,r,n){", start);
    assert.ok(start >= 0 && end > start);
    assert.match(
      source.slice(start, end),
      /let __kanbanPrepared=globalThis\.__kanbanPrepareSharedThreadRequest\(this\.hostId,e\);if\(__kanbanPrepared&&typeof __kanbanPrepared\.then/ ,
    );
    assert.equal(
      (source.match(/case"kanban-shared-connect-lifecycle"/g) ?? []).length,
      1,
    );
    assert.equal(
      (source.match(/case"kanban-shared-connect-intent"/g) ?? []).length,
      1,
    );
    assert.match(source, /globalThis\.__kanbanSharedConnectLifecycle\(e,t\)/);
    assert.match(source, /globalThis\.__kanbanSharedConnectIntent\(e,t\)/);
    for (const action of ["Create", "Send"]) {
      assert.equal(source.split(`case"kanban-shared-${action.toLowerCase()}-intent"`).length - 1, 1);
      assert.ok(source.includes(`globalThis.__kanbanShared${action}Intent(e,t)`));
    }
    assert.equal(
      (source.match(/case"kanban-shared-approval-intent"/g) ?? []).length,
      1,
    );
    assert.match(source, /globalThis\.__kanbanSharedApprovalIntent\(e,t\)/);
    assert.equal(
      source.includes("globalThis.__kanbanRegisterSharedHostEvents(this,e,{"),
      true,
    );
    assert.equal(
      source.includes("globalThis.__kanbanIsSharedServerResponse(this,t)"),
      true,
    );
    new Script(source);
    assert.throws(() => adaptNativeSharedThreadChunk({ body: result.body }), {
      code: "NATIVE_APP_POLICY_DIGEST_MISMATCH",
    });
  },
);

test(
  "the fixed AppHost send uses the prepared shared response and never falls back on failure",
  { skip: !originalPath },
  async () => {
    const source = adaptNativeSharedThreadChunk({
      body: await readFile(originalPath),
    }).body.toString("utf8");
    const start = source.indexOf(
      "async send(e,t,r,n){this.assertCurrent();try{",
    );
    const end = source.indexOf("async sendToConnection(e,t,r,n){", start);
    const calls = [],
      failures = [];
    let failExchange = false;
    const context = createContext({
      el: { iwv: "local" },
      Rm: {
        send: () => {
          calls.push(["unverified-local-transport"]);
          throw Error("wrong connection");
        },
      },
      m6: { ee: Error },
      em: { UKQ: (_id, error) => ({ message: String(error) }) },
      __kanbanPrepareSharedThreadRequest: async (host, frame) => {
        calls.push(["guard", host, frame.id]);
        return { frame, shared: true };
      },
      __kanbanExchangeSharedThreadRequest: async (host, frame) => {
        calls.push(["exchange", host, frame.id]);
        if (failExchange)
          throw Object.assign(Error("unknown"), {
            code: "SHARED_DAEMON_OUTCOME_UNKNOWN",
          });
        return { id: frame.id, result: "actual-daemon-result" };
      },
    });
    const methods = new Script(`({${source.slice(start, end)}})`).runInContext(
      context,
    );
    const adapter = {
      ...methods,
      hostId: "local",
      assertCurrent() {},
      requestLifecycleListeners: [(value) => failures.push(value)],
      sendToConnection() {
        calls.push(["original"]);
        throw Error("wrong connection");
      },
    };
    const request = {
      id: "thread/resume:fixture",
      method: "thread/resume",
      params: { threadId: "fixture" },
    };
    assert.equal(await adapter.send(request), "actual-daemon-result");
    assert.deepEqual(calls, [
      ["guard", "local", request.id],
      ["exchange", "local", request.id],
    ]);
    failExchange = true;
    const outcomes = [];
    await assert.rejects(
      adapter.send(
        request,
        { onOutcomeUnknown: (value) => outcomes.push(value) },
        false,
        true,
      ),
    );
    assert.equal(calls.filter(([type]) => type === "original").length, 0);
    assert.equal(outcomes.length, 1);
    assert.deepEqual(
      failures.map((event) => event.type),
      ["outcome-unknown", "failed"],
    );
  },
);

test(
  "the fixed original manager receives scoped events while shared approval replies cannot reach the old connection",
  { skip: !originalPath },
  async () => {
    const source = adaptNativeSharedThreadChunk({
      body: await readFile(originalPath),
    }).body.toString("utf8");
    const begin = source.indexOf(
      "bind(e){if(this.assertCurrent(),this.disposed||0!==this.cleanup.length)",
    );
    const end = source.indexOf("async callInteractiveDynamicAppTool(", begin);
    const responseBegin = source.indexOf("async sendResponse(e,t){", end);
    const responseEnd = source.indexOf("dispose(){", responseBegin);
    assert.ok(
      begin >= 0 &&
        end > begin &&
        responseBegin > end &&
        responseEnd > responseBegin,
    );
    const notifications = [],
      requests = [];
    let handler,
      previousWrites = 0;
    const context = createContext({
      yc: { IB: () => true },
      el: { JXB: (value) => value },
      __kanbanRegisterSharedHostEvents: (owner, _manager, handlers) =>
        owner.connection.registerHostEventHandler(handlers),
      __kanbanIsSharedServerResponse: (_owner, frame) => frame.id === 71,
    });
    const methods = new Script(
      `({${source.slice(begin, end)},${source.slice(responseBegin, responseEnd)}})`,
    ).runInContext(context);
    const manager = {
      onNotification: (...args) => notifications.push(args),
      onRequest: (frame) => requests.push(frame),
      addThreadDeletedListener: () => () => {},
    };
    const owner = {
      ...methods,
      cleanup: [],
      disposed: false,
      requests: new Map(),
      assertCurrent() {},
      isCurrent: () => true,
      connection: {
        registerHostEventHandler: (value) => {
          handler = value;
          return () => {};
        },
        registerInternalConnectionStateHandler: () => () => {},
        handleClientResponse: async () => {
          previousWrites++;
        },
      },
    };
    owner.bind(manager);
    const approval = {
      id: 71,
      method: "item/commandExecution/requestApproval",
      params: { threadId: "fixture" },
    };
    assert.equal(handler.onRequest(approval), true);
    handler.onNotification(
      { method: "turn/completed", params: { threadId: "fixture" } },
      undefined,
    );
    assert.deepEqual(requests, [approval]);
    assert.equal(notifications[0][0], "turn/completed");
    await assert.rejects(
      owner.sendResponse(approval.method, {
        id: 71,
        result: { decision: "accept" },
      }),
      { code: "SHARED_APPROVAL_UNAVAILABLE" },
    );
    assert.equal(previousWrites, 0);
  },
);
