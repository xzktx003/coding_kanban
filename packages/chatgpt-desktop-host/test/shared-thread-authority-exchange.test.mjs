import test from "node:test";
import assert from "node:assert/strict";
import { createServer, createConnection } from "node:net";
import { mkdtemp, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createRequire } from "node:module";
import { createSharedDaemonRpcGate } from "../src/shared-daemon-rpc-gate.mjs";

const require = createRequire(import.meta.url);
const {
  createSharedThreadAuthorityServer,
  createSharedThreadAuthorityClient,
} = require("../src/shared-thread-authority-channel.cjs");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate) {
  const deadline = performance.now() + 3000;
  while (!predicate()) {
    if (performance.now() > deadline) throw Error("fixture deadline");
    await wait(5);
  }
}
async function fixture(t, { viewCount = 1, serverMemoryBudget, clientMemoryBudget } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "shared-exchange-"));
  await chmod(dir, 0o700);
  const path = join(dir, "authority.sock"),
    profileId = randomUUID(),
    generation = randomUUID();
  const viewId = randomUUID(),
    threadId = randomUUID(),
    daemonGeneration = randomUUID(),
    clientId = randomUUID();
  const writes = [],
    events = [],
    flags = { live: true };
  let authority;
  const binding = {
    hostId: "local",
    runtimeGeneration: generation,
    daemonGeneration,
    accountRevision: 1,
    projectId: "fixture",
    threadId,
    viewId,
    clientId,
  };
  const bindings = [binding];
  for (let i = 1; i < viewCount; i++)
    bindings.push({ ...binding, viewId: randomUUID(), clientId: randomUUID() });
  const server = createServer((socket) => {
    const valid = (value) =>
      flags.live && bindings.some((candidate) => JSON.stringify(value) === JSON.stringify(candidate));
    const gate = createSharedDaemonRpcGate({
      verifyReadSync: () => flags.live,
      verifyBindingSync: valid,
      verifyHistorySync: () => flags.live,
      write: (encoded) => writes.push(encoded),
    });
    authority = createSharedThreadAuthorityServer({
      socket,
      profileId,
      generation,
      gate,
      resolveBinding: async (request) => bindings.find((candidate) => candidate.viewId === request.viewId),
      verifyViewSync: (value) =>
        flags.live &&
        value.hostId === "local" &&
        value.threadId === threadId &&
        bindings.some((candidate) => candidate.viewId === value.viewId),
      verifyBindingSync: valid,
      verifyReadSync: () => flags.live,
      verifyHistorySync: () => flags.live,
      memoryBudget: serverMemoryBudget,
    });
  });
  server.listen(path);
  await once(server, "listening");
  const socket = createConnection(path);
  socket.on("error", () => {});
  await once(socket, "connect");
  const client = createSharedThreadAuthorityClient({
    socket,
    profileId,
    generation,
    memoryBudget: clientMemoryBudget,
    onEvent: (scope, attemptId, frame) =>
      events.push({ scope, attemptId, frame }),
  });
  await until(() => authority);
  t.after(async () => {
    client.close();
    authority.close();
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  });
  return {
    client,
    authority,
    writes,
    events,
    flags,
    binding,
    bindings,
    threadId,
    viewId,
  };
}

test('shared authority accounts actual retained bytes against the common budget and releases them',async t=>{
 const makeBudget=()=>{let used=0,peak=0;return {reserveBytes(n){used+=n;peak=Math.max(peak,used);return true},releaseBytes(n){used-=n},get used(){return used},get peak(){return peak}}};
 const serverMemoryBudget=makeBudget(),clientMemoryBudget=makeBudget();
 const f=await fixture(t,{serverMemoryBudget,clientMemoryBudget});
 const request={id:'read:budget',method:'thread/read',params:{threadId:f.threadId,includeTurns:false}};
 const pending=f.client.exchangeRequest(request);await until(()=>f.writes.length===1);
 const actual=JSON.stringify({id:request.id,result:{thread:{id:f.threadId,cwd:'/work',text:'x'.repeat(100000)}}});
 assert.equal(f.authority.receiveDaemon(actual),true);assert.equal(await pending,actual);
 assert.ok(serverMemoryBudget.peak>0);assert.ok(clientMemoryBudget.peak>0);
 await until(()=>serverMemoryBudget.used===0);
 assert.equal(serverMemoryBudget.used,0);assert.equal(clientMemoryBudget.used,0);
});

test(
  "each explicitly connected view receives live events, including events while its resume is pending",
  { timeout: 8000 },
  async (t) => {
    const f = await fixture(t, { viewCount: 2 });
    async function startFollow(binding, id) {
      const attemptId = randomUUID(), controller = new AbortController();
      const control = { attemptId, signal: controller.signal, deadline: performance.now() + 5000 };
      const resolved = await f.client.resolveBinding({ hostId: "local", threadId: f.threadId, viewId: binding.viewId });
      const request = { id, method: "thread/resume", params: { threadId: f.threadId, excludeTurns: true } };
      assert.equal(await f.client.authorizeRequest(resolved, request, control), true);
      const pending = f.client.exchangeRequest(request);
      await until(() => f.writes.some((value) => JSON.parse(value).id === id));
      return { binding: resolved, control, pending, id };
    }
    function complete(value) {
      assert.equal(f.authority.receiveDaemon(JSON.stringify({
        id: value.id,
        result: { thread: { id: f.threadId, historyMode: "paginated", turns: [] }, turnsBackwardsCursor: null, itemsBackwardsCursor: null },
      })), true);
    }
    const first = await startFollow(f.bindings[0], "resume:a");
    complete(first);
    await first.pending;
    assert.equal(await f.client.follow(first.binding, first.control), true);
    const second = await startFollow(f.bindings[1], "resume:b");
    const duringResume = { method: "item/agentMessage/delta", params: { threadId: f.threadId, turnId: "turn", itemId: "item", delta: "one" } };
    assert.equal(f.authority.receiveDaemon(JSON.stringify(duringResume)), true);
    await until(() => f.events.some((event) => event.attemptId === first.control.attemptId));
    complete(second);
    await second.pending;
    assert.equal(await f.client.follow(second.binding, second.control), true);
    await until(() => f.events.some((event) => event.attemptId === second.control.attemptId));
    const afterResume = { method: "item/agentMessage/delta", params: { threadId: f.threadId, turnId: "turn", itemId: "item", delta: "two" } };
    assert.equal(f.authority.receiveDaemon(JSON.stringify(afterResume)), true);
    await until(() => f.events.length === 4);
    for (const value of [first, second]) {
      const own = f.events.filter((event) => event.attemptId === value.control.attemptId);
      assert.deepEqual(own.map((event) => event.frame.params.delta), ["one", "two"]);
      assert.ok(own.every((event) => event.scope.viewId === value.binding.viewId));
    }
    assert.equal(f.writes.length, 2, "events must not write or resume again");
  },
);

test(
  "real private authority stream returns the actual daemon response with its exact RPC identity",
  { timeout: 8000 },
  async (t) => {
    const f = await fixture(t);
    const frame = {
      id: "read:1",
      method: "thread/read",
      params: { threadId: f.threadId, includeTurns: false },
    };
    const pending = f.client.exchangeRequest(frame);
    await until(() => f.writes.length === 1);
    assert.deepEqual(JSON.parse(f.writes[0]), frame);
    const native = JSON.stringify({
      id: frame.id,
      result: { thread: { id: f.threadId, status: { type: "active" } } },
    });
    assert.equal(f.authority.receiveDaemon(native), true);
    assert.equal(await pending, native);
    assert.equal(f.writes.length, 1);
  },
);

test(
  "only an exact one-use clicked intent can dispatch resume and receive its real paginated projection",
  { timeout: 8000 },
  async (t) => {
    const f = await fixture(t),
      attemptId = randomUUID(),
      controller = new AbortController();
    const request = {
      id: "resume:1",
      method: "thread/resume",
      params: { threadId: f.threadId, excludeTurns: true },
    };
    await assert.rejects(f.client.exchangeRequest(request));
    assert.equal(f.writes.length, 0);
    const binding = await f.client.resolveBinding({
      hostId: "local",
      threadId: f.threadId,
      viewId: f.viewId,
    });
    assert.equal(
      await f.client.authorizeRequest(binding, request, {
        attemptId,
        signal: controller.signal,
        deadline: performance.now() + 5000,
      }),
      true,
    );
    const pending = f.client.exchangeRequest(request);
    await until(() => f.writes.length === 1);
    const native = JSON.stringify({
      id: request.id,
      result: {
        thread: { id: f.threadId, historyMode: "paginated", turns: [] },
        turnsBackwardsCursor: null,
        itemsBackwardsCursor: null,
      },
    });
    assert.equal(f.authority.receiveDaemon(native), true);
    assert.equal(await pending, native);
    await assert.rejects(f.client.exchangeRequest(request));
    assert.equal(f.writes.length, 1);
  },
);

test(
  "real daemon response larger than one authority frame arrives without truncation or encoding changes",
  { timeout: 8000 },
  async (t) => {
    const f = await fixture(t),
      frame = {
        id: 2,
        method: "thread/read",
        params: { threadId: f.threadId, includeTurns: false },
      };
    const pending = f.client.exchangeRequest(frame);
    await until(() => f.writes.length === 1);
    const native = JSON.stringify({
      id: 2,
      result: { thread: { id: f.threadId, label: "数据🧪".repeat(40000) } },
    });
    assert.ok(Buffer.byteLength(native) > 64 * 1024);
    assert.equal(f.authority.receiveDaemon(native), true);
    assert.equal(await pending, native);
  },
);

test(
  "account or daemon identity change prevents late response delivery and never replays",
  { timeout: 8000 },
  async (t) => {
    const f = await fixture(t),
      frame = {
        id: 3,
        method: "thread/read",
        params: { threadId: f.threadId, includeTurns: false },
      };
    const pending = f.client.exchangeRequest(frame);
    void pending.catch(() => {});
    await until(() => f.writes.length === 1);
    f.flags.live = false;
    assert.equal(
      f.authority.receiveDaemon(
        JSON.stringify({ id: 3, result: { thread: { id: f.threadId } } }),
      ),
      false,
    );
    await assert.rejects(pending);
    assert.equal(f.writes.length, 1);
  },
);

test(
  "an identity revoked between response chunks cannot complete a stale result",
  { timeout: 8000 },
  async (t) => {
    const f = await fixture(t),
      frame = {
        id: 4,
        method: "thread/read",
        params: { threadId: f.threadId, includeTurns: false },
      };
    const pending = f.client.exchangeRequest(frame);
    void pending.catch(() => {});
    await until(() => f.writes.length === 1);
    const native = JSON.stringify({
      id: 4,
      result: { thread: { id: f.threadId, label: "中".repeat(30000) } },
    });
    assert.equal(f.authority.receiveDaemon(native), true);
    f.flags.live = false;
    await assert.rejects(pending);
    assert.equal(f.writes.length, 1);
  },
);

test(
  "cancelling a dispatched connect closes its channel without waiting or replaying",
  { timeout: 8000 },
  async (t) => {
    const f = await fixture(t),
      attemptId = randomUUID(),
      controller = new AbortController();
    const request = {
      id: "resume:cancel",
      method: "thread/resume",
      params: { threadId: f.threadId, excludeTurns: true },
    };
    const binding = await f.client.resolveBinding({
      hostId: "local",
      threadId: f.threadId,
      viewId: f.viewId,
    });
    assert.equal(
      await f.client.authorizeRequest(binding, request, {
        attemptId,
        signal: controller.signal,
        deadline: performance.now() + 5000,
      }),
      true,
    );
    const pending = f.client.exchangeRequest(request);
    void pending.catch(() => {});
    await until(() => f.writes.length === 1);
    controller.abort();
    const outcome = await Promise.race([
      pending.then(
        () => "resolved",
        (error) => error.code,
      ),
      wait(300).then(() => "timeout"),
    ]);
    assert.equal(outcome, "SHARED_DAEMON_OUTCOME_UNKNOWN");
    assert.equal(f.writes.length, 1);
  },
);

test(
  "identity revocation during a multi-chunk event cannot deliver partial or stale content",
  { timeout: 8000 },
  async (t) => {
    const f = await fixture(t),
      attemptId = randomUUID(),
      controller = new AbortController(),
      deadline = performance.now() + 5000;
    const request = {
      id: "follow:1",
      method: "thread/resume",
      params: { threadId: f.threadId, excludeTurns: true },
    };
    const binding = await f.client.resolveBinding({
      hostId: "local",
      threadId: f.threadId,
      viewId: f.viewId,
    });
    assert.equal(
      await f.client.authorizeRequest(binding, request, {
        attemptId,
        signal: controller.signal,
        deadline,
      }),
      true,
    );
    const pending = f.client.exchangeRequest(request);
    await until(() => f.writes.length === 1);
    assert.equal(
      f.authority.receiveDaemon(
        JSON.stringify({
          id: request.id,
          result: {
            thread: { id: f.threadId, historyMode: "paginated", turns: [] },
            turnsBackwardsCursor: null,
            itemsBackwardsCursor: null,
          },
        }),
      ),
      true,
    );
    await pending;
    assert.equal(
      await f.client.follow(binding, {
        attemptId,
        signal: controller.signal,
        deadline,
      }),
      true,
    );
    const event = {
      method: "item/started",
      params: { threadId: f.threadId, text: "中".repeat(30000) },
    };
    assert.equal(f.authority.receiveDaemon(JSON.stringify(event)), true);
    f.flags.live = false;
    await until(() => !f.client.active);
    assert.deepEqual(f.events, []);
    assert.equal(f.writes.length, 1);
  },
);

test(
  "an account notification retires a connected follow even when the reported value is unchanged",
  { timeout: 8000 },
  async (t) => {
    const f = await fixture(t),
      attemptId = randomUUID(),
      controller = new AbortController(),
      deadline = performance.now() + 5000;
    const request = {
      id: "follow:account",
      method: "thread/resume",
      params: { threadId: f.threadId, excludeTurns: true },
    };
    const binding = await f.client.resolveBinding({
      hostId: "local",
      threadId: f.threadId,
      viewId: f.viewId,
    });
    assert.equal(
      await f.client.authorizeRequest(binding, request, {
        attemptId,
        signal: controller.signal,
        deadline,
      }),
      true,
    );
    const pending = f.client.exchangeRequest(request);
    await until(() => f.writes.length === 1);
    assert.equal(
      f.authority.receiveDaemon(
        JSON.stringify({
          id: request.id,
          result: {
            thread: { id: f.threadId, historyMode: "paginated", turns: [] },
            turnsBackwardsCursor: null,
            itemsBackwardsCursor: null,
          },
        }),
      ),
      true,
    );
    await pending;
    assert.equal(
      await f.client.follow(binding, {
        attemptId,
        signal: controller.signal,
        deadline,
      }),
      true,
    );
    assert.equal(
      f.authority.receiveDaemon(
        JSON.stringify({
          method: "account/updated",
          params: { authMode: "same" },
        }),
      ),
      false,
    );
    await until(() => !f.client.active);
    assert.deepEqual(f.events, []);
    assert.equal(f.writes.length, 1);
  },
);

test(
  "active plus queued follow events never exceed 64 entries",
  { timeout: 8000 },
  async (t) => {
    const f = await fixture(t),
      attemptId = randomUUID(),
      controller = new AbortController(),
      deadline = performance.now() + 5000;
    const request = {
      id: "follow:budget",
      method: "thread/resume",
      params: { threadId: f.threadId, excludeTurns: true },
    };
    const binding = await f.client.resolveBinding({
      hostId: "local",
      threadId: f.threadId,
      viewId: f.viewId,
    });
    assert.equal(
      await f.client.authorizeRequest(binding, request, {
        attemptId,
        signal: controller.signal,
        deadline,
      }),
      true,
    );
    const pending = f.client.exchangeRequest(request);
    await until(() => f.writes.length === 1);
    assert.equal(
      f.authority.receiveDaemon(
        JSON.stringify({
          id: request.id,
          result: {
            thread: { id: f.threadId, historyMode: "paginated", turns: [] },
            turnsBackwardsCursor: null,
            itemsBackwardsCursor: null,
          },
        }),
      ),
      true,
    );
    await pending;
    assert.equal(
      await f.client.follow(binding, {
        attemptId,
        signal: controller.signal,
        deadline,
      }),
      true,
    );
    for (let i = 0; i < 64; i++)
      assert.equal(
        f.authority.receiveDaemon(
          JSON.stringify({
            method: "thread/queue/changed",
            params: { threadId: f.threadId },
          }),
        ),
        true,
      );
    assert.equal(
      f.authority.receiveDaemon(
        JSON.stringify({
          method: "thread/queue/changed",
          params: { threadId: f.threadId },
        }),
      ),
      false,
    );
  },
);

test(
  "a revoked follower closes instead of silently dropping its next event",
  { timeout: 8000 },
  async (t) => {
    const f = await fixture(t),
      attemptId = randomUUID(),
      controller = new AbortController(),
      deadline = performance.now() + 5000;
    const request = {
      id: "follow:revoked",
      method: "thread/resume",
      params: { threadId: f.threadId, excludeTurns: true },
    };
    const binding = await f.client.resolveBinding({
      hostId: "local",
      threadId: f.threadId,
      viewId: f.viewId,
    });
    assert.equal(
      await f.client.authorizeRequest(binding, request, {
        attemptId,
        signal: controller.signal,
        deadline,
      }),
      true,
    );
    const pending = f.client.exchangeRequest(request);
    await until(() => f.writes.length === 1);
    assert.equal(
      f.authority.receiveDaemon(
        JSON.stringify({
          id: request.id,
          result: {
            thread: { id: f.threadId, historyMode: "paginated", turns: [] },
            turnsBackwardsCursor: null,
            itemsBackwardsCursor: null,
          },
        }),
      ),
      true,
    );
    await pending;
    assert.equal(
      await f.client.follow(binding, {
        attemptId,
        signal: controller.signal,
        deadline,
      }),
      true,
    );
    f.flags.live = false;
    assert.equal(
      f.authority.receiveDaemon(
        JSON.stringify({
          method: "thread/queue/changed",
          params: { threadId: f.threadId },
        }),
      ),
      false,
    );
    await until(() => !f.client.active);
    assert.deepEqual(f.events, []);
  },
);


test('tools require an actually dispatched precise resume and lose authorization on a native refusal or account change',async t=>{
 const f=await fixture(t),attemptId=randomUUID(),controller=new AbortController();
 assert.equal(f.authority.verifyConnectedThreadSync(f.threadId),false);
 assert.equal(f.authority.verifyConnectedThreadSync('client-new-thread:'+f.threadId),false);
 const binding=await f.client.resolveBinding({hostId:'local',threadId:f.threadId,viewId:f.viewId});
 const request={id:'resume:tools',method:'thread/resume',params:{threadId:f.threadId,excludeTurns:true}};
 assert.equal(await f.client.authorizeRequest(binding,request,{attemptId,signal:controller.signal,deadline:performance.now()+5000}),true);
 assert.equal(f.authority.verifyConnectedThreadSync(f.threadId),false);
 const pending=f.client.exchangeRequest(request);await until(()=>f.writes.length===1);
 assert.equal(f.authority.verifyConnectedThreadSync(f.threadId),true);
 assert.equal(f.authority.verifyConnectedThreadSync(randomUUID()),false);
 f.flags.live=false;assert.equal(f.authority.verifyConnectedThreadSync(f.threadId),false);
 f.flags.live=true;assert.equal(f.authority.verifyConnectedThreadSync(f.threadId),true);
 const refused=JSON.stringify({id:request.id,error:{code:-32600,message:'native refusal'}});
 assert.equal(f.authority.receiveDaemon(refused),true);
 assert.equal(f.authority.verifyConnectedThreadSync(f.threadId),false);assert.equal(await pending,refused);
 f.authority.close();assert.equal(f.authority.verifyConnectedThreadSync(f.threadId),false);
});
