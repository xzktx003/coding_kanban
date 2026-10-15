import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
const domain = randomUUID(),
  generation = randomUUID(),
  sha = "73b73b048546993298234a295de01ef2424e7a8b29def9d0ecb1ca7cb77500d4";
async function fixture(t) {
  const cwd = await mkdtemp(join(tmpdir(), "ck-manager-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const threads = new Map(),
    requests = [];
  let observer,
    closed = 0,
    rss = 100,
    accountRead = () => ({ account: null, requiresOpenaiAuth: false });
  const client = {
    revision: 0,
    async close() {
      closed++;
    },
    async request(method, params, options) {
      options?.beforeSend?.();
      requests.push({ method, params });
      if (method === "account/read") return accountRead();
      if (method === "thread/loaded/list")
        return {
          data: [...threads].filter(([, v]) => v.loaded).map(([id]) => id),
          nextCursor: null,
        };
      const thread = threads.get(params.threadId);
      if (!thread) throw Error("Missing thread");
      if (method === "thread/read")
        return {
          thread: {
            id: params.threadId,
            cwd,
            source: "vscode",
            status: {
              type: thread.loaded ? thread.status : "notLoaded",
              activeFlags: thread.flags ?? [],
            },
          },
        };
      if (method === "thread/resume") {
        thread.loaded = true;
        return {
          thread: {
            id: params.threadId,
            cwd,
            source: "vscode",
            status: { type: thread.status, activeFlags: thread.flags ?? [] },
          },
        };
      }
      if (method === "thread/backgroundTerminals/list")
        return { data: [], nextCursor: null };
      if (method === "thread/goal/get") return { goal: null };
      if (method === "thread/unsubscribe") {
        thread.loaded = false;
        return { status: "unsubscribed" };
      }
      throw Error("Unexpected method");
    },
  };
  const service = {
    record: { domain, generation, cliSha256: sha },
    readRss: async () => rss,
    async connect(options) {
      observer = options.onLifecycle;
      return client;
    },
  };
  return {
    cwd,
    client,
    threads,
    requests,
    service,
    resourceMonitor: {
      async read() {
        return {
          domain,
          generation,
          complete: true,
          accounting: "process-rss-sum",
          rssBytes: await service.readRss(),
          processCount: 1,
          taskCount: 1,
          measuredAt: performance.now(),
        };
      },
    },
    key: (id) => ({ domain, generation, threadId: id, cwd }),
    setRss: (value) => {
      rss = value;
    },
    setAccountRead: (read) => {
      accountRead = read;
    },
    closed: () => closed,
    emitMetadata(method) {
      client.revision++;
      observer({ method, threadId: null });
    },
    notify(id, status, flags = []) {
      threads.get(id).status = status;
      threads.get(id).flags = flags;
      client.revision++;
      observer({ method: "thread/status/changed", threadId: id, status });
    },
  };
}
const nativeAccount = (accountId) => ({
  account: {
    type: "chatgpt",
    email: "private-fixture@example.invalid",
    planType: "pro",
  },
  requiresOpenaiAuth: true,
  workspaceRouting: {
    chatgptAccountId: accountId,
    backendOrigin: "https://chatgpt.com",
    accountRoutingOverride: "NO_CONSTRAINT",
  },
});

test("opening an already retained visible target protects it before resource-pressure trimming", async (t) => {
  const { createRefreshManager } = await import("../refresh-prototype/lifecycle-manager.mjs");
  const f=await fixture(t), id=randomUUID();
  f.threads.set(id,{status:"idle",loaded:true});
  const manager=await createRefreshManager({service:f.service,resourceMonitor:f.resourceMonitor,memoryBudgetBytes:1000});
  t.after(()=>manager.close());
  f.requests.length=0;
  f.setRss(2000);
  await manager.open(f.key(id),{consumerId:randomUUID()});
  assert.equal(f.requests.some(r=>r.method==="thread/unsubscribe"),false);
  assert.equal(f.requests.filter(r=>r.method==="thread/resume").length,1);
  assert.equal(f.threads.get(id).loaded,true);
  assert.equal(manager.snapshot().warmAdmission,false);
});

test("visibility intent vetoes an already queued eviction while native metadata is in flight",async t=>{
  const {createRefreshManager}=await import("../refresh-prototype/lifecycle-manager.mjs");
  const f=await fixture(t),id=randomUUID();f.threads.set(id,{status:"idle",loaded:true});
  const manager=await createRefreshManager({service:f.service,resourceMonitor:f.resourceMonitor,memoryBudgetBytes:1000});t.after(()=>manager.close());
  let release,entered;const held=new Promise(resolve=>release=resolve),started=new Promise(resolve=>entered=resolve);
  const request=f.client.request.bind(f.client);let blocked=false;
  f.client.request=async(method,...args)=>{if(method==="thread/read"&&!blocked){blocked=true;entered();await held}return request(method,...args)};
  f.requests.length=0;f.setRss(2000);const trimming=manager.disconnect(randomUUID());await started;
  const opening=manager.open(f.key(id),{consumerId:randomUUID()});release();await trimming;await opening;
  assert.equal(f.requests.some(r=>r.method==="thread/unsubscribe"),false);
  assert.equal(manager.snapshot().entries[0].visibleConsumers,1);
});

test("manager invalidation notifies every bounded observer once and observers cannot prevent revocation",async t=>{
  const {createRefreshManager}=await import("../refresh-prototype/lifecycle-manager.mjs");
  const f=await fixture(t),manager=await createRefreshManager({service:f.service,resourceMonitor:f.resourceMonitor,memoryBudgetBytes:1000});t.after(()=>manager.close());
  let notified=0,removed=0;
  manager.onInvalidated(()=>{throw Error("observer failure")});
  manager.onInvalidated(()=>notified++);
  const dispose=manager.onInvalidated(()=>removed++);dispose();
  f.emitMetadata("account/updated");assert.equal(manager.snapshot().ready,false);assert.equal(notified,1);assert.equal(removed,0);
  await manager.close();assert.equal(notified,1);
});

test("resolves visibility scope only from bounded exact native metadata without resume or body retention", async(t)=>{
  const { createRefreshManager }=await import("../refresh-prototype/lifecycle-manager.mjs");
  const f=await fixture(t), id=randomUUID();
  f.threads.set(id,{status:"idle",loaded:false});
  const manager=await createRefreshManager({service:f.service,resourceMonitor:f.resourceMonitor,memoryBudgetBytes:1000});
  t.after(()=>manager.close());
  f.requests.length=0;
  assert.deepEqual(await manager.scopeForThread(id),f.key(id));
  assert.deepEqual(f.requests,[{method:"thread/read",params:{threadId:id,includeTurns:false}}]);
  await assert.rejects(manager.scopeForThread("invalid"),/UUID/);
  assert.equal(f.threads.get(id).loaded,false);
  assert.equal(manager.snapshot().entries.length,0);
});
test("initial native account snapshot is bound before any thread RPC, while subsequent account updates still revoke it", async (t) => {
  const { createRefreshManager } =
    await import("../refresh-prototype/lifecycle-manager.mjs");
  const f = await fixture(t),
    connect = f.service.connect;
  f.setAccountRead(() => nativeAccount("workspace-a"));
  f.service.connect = async (options) => {
    const client = await connect(options);
    f.emitMetadata("account/updated");
    return client;
  };
  const manager = await createRefreshManager({
    service: f.service,
    resourceMonitor: f.resourceMonitor,
    memoryBudgetBytes: 1000,
  });
  t.after(() => manager.close());
  assert.equal(manager.snapshot().ready, true);
  assert.equal(manager.snapshot().authorizationBound, true);
  assert.deepEqual(
    f.requests.slice(0, 2).map((value) => value.method),
    ["account/read", "account/read"],
  );
  assert.equal(
    JSON.stringify(manager.snapshot()).includes("private-fixture"),
    false,
  );
  assert.equal(
    JSON.stringify(manager.snapshot()).includes("workspace-a"),
    false,
  );
  f.emitMetadata("account/updated");
  assert.equal(manager.snapshot().ready, false);
});
test("changing native account identity during initial binding fails without adopting threads", async (t) => {
  const { createRefreshManager } =
    await import("../refresh-prototype/lifecycle-manager.mjs");
  const f = await fixture(t),
    connect = f.service.connect;
  let reads = 0;
  f.setAccountRead(() =>
    nativeAccount(++reads === 1 ? "workspace-a" : "workspace-b"),
  );
  f.service.connect = async (options) => {
    const c = await connect(options);
    f.emitMetadata("account/updated");
    return c;
  };
  await assert.rejects(
    createRefreshManager({
      service: f.service,
      resourceMonitor: f.resourceMonitor,
      memoryBudgetBytes: 1000,
    }),
    /authorization/,
  );
  assert.equal(
    f.requests.some((value) => value.method.startsWith("thread/")),
    false,
  );
  assert.equal(f.closed(), 1);
});
test("missing native workspace identity cannot be used as authenticated admission", async (t) => {
  const { createRefreshManager } =
    await import("../refresh-prototype/lifecycle-manager.mjs");
  const f = await fixture(t);
  f.setAccountRead(() => ({
    ...nativeAccount("workspace-a"),
    workspaceRouting: null,
  }));
  await assert.rejects(
    createRefreshManager({
      service: f.service,
      resourceMonitor: f.resourceMonitor,
      memoryBudgetBytes: 1000,
    }),
    /authorization/,
  );
  assert.equal(
    f.requests.some((value) => value.method.startsWith("thread/")),
    false,
  );
});
test("authenticated binding without its initial native notice times out without thread operations", async (t) => {
  const { createRefreshManager } =
    await import("../refresh-prototype/lifecycle-manager.mjs");
  const f = await fixture(t);
  f.setAccountRead(() => nativeAccount("workspace-a"));
  await assert.rejects(
    createRefreshManager({
      service: f.service,
      resourceMonitor: f.resourceMonitor,
      memoryBudgetBytes: 1000,
      authorizationTimeoutMs: 20,
    }),
    /authorization notice unavailable/,
  );
  assert.equal(
    f.requests.some((value) => value.method.startsWith("thread/")),
    false,
  );
  assert.equal(f.closed(), 1);
});
test("an account boundary without a thread ID invalidates warm admission without unsubscribing or stopping native tasks", async (t) => {
  const { createRefreshManager } =
    await import("../refresh-prototype/lifecycle-manager.mjs");
  const f = await fixture(t),
    id = randomUUID();
  f.threads.set(id, { status: "active", loaded: true });
  const manager = await createRefreshManager({
    service: f.service,
    resourceMonitor: f.resourceMonitor,
    memoryBudgetBytes: 1000,
  });
  t.after(() => manager.close());
  const count = f.requests.length;
  f.emitMetadata("account/updated");
  assert.equal(manager.snapshot().ready, false);
  assert.equal(manager.snapshot().warmAdmission, false);
  assert.equal(manager.snapshot().unavailableReason, "authorization-changed");
  await assert.rejects(
    manager.open(f.key(id), { warmOnly: true }),
    /generation unavailable/,
  );
  await manager.close();
  assert.equal(f.closed(), 1);
  assert.equal(f.requests.length, count);
  assert.equal(f.threads.get(id).loaded, true);
  assert.equal(f.threads.get(id).status, "active");
});
test("an account boundary during initialization fails closed before loaded metadata is adopted", async (t) => {
  const { createRefreshManager } =
    await import("../refresh-prototype/lifecycle-manager.mjs");
  const f = await fixture(t);
  const connect = f.service.connect;
  f.service.connect = async (options) => {
    const client = await connect(options);
    f.emitMetadata("account/login/completed");
    return client;
  };
  await assert.rejects(
    createRefreshManager({
      service: f.service,
      resourceMonitor: f.resourceMonitor,
      memoryBudgetBytes: 1000,
    }),
    /generation unavailable/,
  );
  assert.equal(f.closed(), 1);
  assert.equal(f.requests.length, 0);
});
test("a normal rate-limit notification keeps the current authorization domain available", async (t) => {
  const { createRefreshManager } =
    await import("../refresh-prototype/lifecycle-manager.mjs");
  const f = await fixture(t);
  const manager = await createRefreshManager({
    service: f.service,
    resourceMonitor: f.resourceMonitor,
    memoryBudgetBytes: 1000,
  });
  t.after(() => manager.close());
  f.emitMetadata("account/rateLimits/updated");
  assert.equal(manager.snapshot().ready, true);
  assert.equal(f.closed(), 0);
});
test("an authorization change while an RPC waits vetoes the actual native write", async (t) => {
  const { createRefreshManager } =
    await import("../refresh-prototype/lifecycle-manager.mjs");
  const f = await fixture(t),
    id = randomUUID();
  const manager = await createRefreshManager({
    service: f.service,
    resourceMonitor: f.resourceMonitor,
    memoryBudgetBytes: 1000,
  });
  t.after(() => manager.close());
  f.threads.set(id, { status: "idle", loaded: true });
  const request = f.client.request.bind(f.client);
  let release, entered;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  f.client.request = async (...args) => {
    if (args[0] === "thread/read") {
      entered();
      await held;
    }
    return request(...args);
  };
  const count = f.requests.length;
  const opening = manager.open(f.key(id), { warmOnly: true });
  await started;
  const rejected = assert.rejects(opening, /generation unavailable/);
  f.emitMetadata("account/gatewayOAuth/changed");
  release();
  await rejected;
  assert.equal(f.requests.length, count);
  assert.equal(f.threads.get(id).loaded, true);
  assert.equal(manager.snapshot().ready, false);
});
test(
  "an account boundary during the final resource read cannot return a warm success",
  { timeout: 2000 },
  async (t) => {
    const { createRefreshManager } =
      await import("../refresh-prototype/lifecycle-manager.mjs");
    const f = await fixture(t),
      id = randomUUID();
    const manager = await createRefreshManager({
      service: f.service,
      resourceMonitor: f.resourceMonitor,
      memoryBudgetBytes: 1000,
    });
    t.after(() => manager.close());
    f.threads.set(id, { status: "idle", loaded: true });
    await manager.open(f.key(id), { warmOnly: true });
    let reads = 0,
      release,
      entered;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    const started = new Promise((resolve) => {
      entered = resolve;
    });
    f.service.readRss = async () => {
      if (++reads === 3) {
        entered();
        await held;
      }
      return 100;
    };
    const opening = manager.open(f.key(id), { warmOnly: true });
    await started;
    const rejected = assert.rejects(opening, /generation unavailable/);
    f.emitMetadata("account/updated");
    release();
    await rejected;
    assert.equal(f.threads.get(id).loaded, true);
  },
);
test("manager holds one native context per thread across consumers and releases only its own connection on close", async (t) => {
  const { createRefreshManager } =
    await import("../refresh-prototype/lifecycle-manager.mjs");
  const f = await fixture(t);
  const manager = await createRefreshManager({
    service: f.service,
    resourceMonitor: f.resourceMonitor,
    idleLimit: 1,
    memoryBudgetBytes: 1000,
  });
  t.after(() => manager.close());
  const a = randomUUID(),
    b = randomUUID(),
    id = randomUUID();
  f.threads.set(id, { status: "idle", loaded: true });
  await manager.open(f.key(id), { consumerId: a });
  await manager.open(f.key(id), { consumerId: b });
  assert.equal(manager.snapshot().entries.length, 1);
  assert.equal(manager.snapshot().entries[0].visibleConsumers, 2);
  await manager.disconnect(a);
  assert.equal(manager.snapshot().entries[0].visibleConsumers, 1);
  assert.equal(f.threads.get(id).loaded, true);
  await manager.disconnect(b);
  assert.equal(manager.snapshot().entries.length, 1);
  assert.equal(
    f.requests.some((r) => r.method === "thread/unsubscribe"),
    false,
  );
  const count = f.requests.length;
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(f.requests.length, count);
  assert.ok(f.requests.every((r) => r.params?.includeTurns !== true));
  await manager.close();
  assert.equal(f.closed(), 1);
  assert.equal(manager.snapshot().ready, false);
  assert.equal(f.threads.get(id).loaded, true);
});
test("native events protect active contexts before eviction and permit an idle LRU after completion", async (t) => {
  const { createRefreshManager } =
    await import("../refresh-prototype/lifecycle-manager.mjs");
  const f = await fixture(t);
  const manager = await createRefreshManager({
    service: f.service,
    resourceMonitor: f.resourceMonitor,
    idleLimit: 1,
    memoryBudgetBytes: 1000,
  });
  t.after(() => manager.close());
  const first = randomUUID(),
    second = randomUUID();
  f.threads.set(first, { status: "idle", loaded: true });
  await manager.open(f.key(first), { warmOnly: true });
  f.notify(first, "active", ["waitingOnApproval"]);
  f.threads.set(second, { status: "idle", loaded: true });
  await manager.open(f.key(second), { warmOnly: true });
  await manager.settle();
  assert.equal(f.threads.get(first).loaded, true);
  assert.equal(
    manager.snapshot().entries.find((e) => e.threadId === first).status,
    "waitingApproval",
  );
  f.notify(first, "idle");
  await manager.settle();
  assert.equal(manager.snapshot().entries.length, 1);
  assert.equal(f.threads.get(first).loaded, false);
  assert.equal(f.threads.get(second).loaded, true);
});
test("resource pressure refuses extra warm admission and stale generations without changing native state", async (t) => {
  const { createRefreshManager } =
    await import("../refresh-prototype/lifecycle-manager.mjs");
  const f = await fixture(t);
  f.setRss(2000);
  const manager = await createRefreshManager({
    service: f.service,
    resourceMonitor: f.resourceMonitor,
    idleLimit: 1,
    memoryBudgetBytes: 1000,
  });
  t.after(() => manager.close());
  const id = randomUUID();
  f.threads.set(id, { status: "idle", loaded: false });
  const result = await manager.open(f.key(id), { warmOnly: true });
  assert.equal(result.status, "admission-deferred");
  assert.equal(
    f.requests.some((r) => r.method === "thread/resume"),
    false,
  );
  await assert.rejects(
    manager.open(
      { ...f.key(id), generation: randomUUID() },
      { warmOnly: true },
    ),
    /generation|scope/,
  );
  assert.equal(f.threads.get(id).loaded, false);
});

test("host RSS and failed total resource reads stop new warm admission even when native RSS stays low", async (t) => {
  const { createRefreshManager } =
    await import("../refresh-prototype/lifecycle-manager.mjs");
  for (const missing of [false, true]) {
    const f = await fixture(t),
      id = randomUUID();
    const resourceMonitor = {
      async read() {
        if (missing) throw Error("owned host measurement unavailable");
        return {
          domain,
          generation,
          complete: true,
          accounting: "process-rss-sum",
          rssBytes: 2000,
          processCount: 5,
          taskCount: 7,
          measuredAt: performance.now(),
          roots: [],
        };
      },
    };
    const manager = await createRefreshManager({
      service: f.service,
      resourceMonitor,
      memoryBudgetBytes: 1000,
    });
    t.after(() => manager.close());
    f.threads.set(id, { status: "idle", loaded: false });
    assert.equal(
      (await manager.open(f.key(id), { warmOnly: true })).status,
      "admission-deferred",
    );
    assert.equal(f.threads.get(id).loaded, false);
    assert.equal(manager.snapshot().warmAdmission, false);
    assert.equal(
      f.requests.some((r) => r.method === "thread/resume"),
      false,
    );
    assert.equal(manager.snapshot().resources.available, !missing);
    assert.equal(manager.snapshot().resources.rssBytes, missing ? null : 2000);
  }
});

test("a resource monitor is required and stale or foreign-domain measurements cannot admit a cold idle thread", async (t) => {
  const { createRefreshManager } =
    await import("../refresh-prototype/lifecycle-manager.mjs");
  const f = await fixture(t);
  await assert.rejects(
    createRefreshManager({ service: f.service, memoryBudgetBytes: 1000 }),
    /resource monitor required/,
  );
  assert.equal(f.requests.length, 0);
  for (const changes of [
    { generation: randomUUID() },
    { domain: randomUUID() },
    { measuredAt: -1 },
    { measuredAt: performance.now() - 10000 },
    { complete: false },
    { processCount: 257 },
    { taskCount: 4097 },
  ]) {
    const id = randomUUID();
    const manager = await createRefreshManager({
      service: f.service,
      memoryBudgetBytes: 1000,
      resourceMonitor: {
        async read() {
          return { ...(await f.resourceMonitor.read()), ...changes };
        },
      },
    });
    f.threads.set(id, { status: "idle", loaded: false });
    assert.equal(
      (await manager.open(f.key(id), { warmOnly: true })).status,
      "admission-deferred",
    );
    assert.equal(f.threads.get(id).loaded, false);
    assert.equal(manager.snapshot().resources.available, false);
    await manager.close();
  }
});

test("resource status stops advertising admission when its last sample expires without polling native history", async (t) => {
  const { createRefreshManager } =
    await import("../refresh-prototype/lifecycle-manager.mjs");
  const f = await fixture(t);
  const manager = await createRefreshManager({
    service: f.service,
    resourceMonitor: f.resourceMonitor,
    memoryBudgetBytes: 1000,
  });
  t.after(() => manager.close());
  assert.equal(manager.snapshot().warmAdmission, true);
  const count = f.requests.length,
    expired = performance.now() + 6000;
  t.mock.method(performance, "now", () => expired);
  assert.equal(manager.snapshot().resources.available, false);
  assert.equal(manager.snapshot().warmAdmission, false);
  assert.equal(f.requests.length, count);
});

test(
  "a full operation queue lets native I/O complete before retrying lifecycle reconciliation",
  { timeout: 3000 },
  async (t) => {
    const { createRefreshManager } =
      await import("../refresh-prototype/lifecycle-manager.mjs");
    const f = await fixture(t);
    const manager = await createRefreshManager({
      service: f.service,
      resourceMonitor: f.resourceMonitor,
      idleLimit: 10,
      memoryBudgetBytes: 1000,
    });
    t.after(() => manager.close());
    const id = randomUUID();
    f.threads.set(id, { status: "idle", loaded: true });
    await manager.open(f.key(id), { warmOnly: true });
    let release, entered;
    const held = new Promise((done) => {
        release = done;
      }),
      started = new Promise((done) => {
        entered = done;
      });
    const original = f.client.request.bind(f.client);
    let block = true;
    f.client.request = async (...args) => {
      if (block && args[0] === "thread/read") {
        block = false;
        entered();
        await held;
      }
      return original(...args);
    };
    const requests = Array.from({ length: 64 }, () =>
      manager.open(f.key(id), { warmOnly: true }),
    );
    await started;
    setTimeout(release, 1);
    f.notify(id, "active", ["waitingOnApproval"]);
    await assert.rejects(
      manager.open(f.key(id), { warmOnly: true }),
      /pending operation limit/,
    );
    await Promise.all(requests);
    await manager.settle();
    assert.equal(manager.snapshot().entries[0].status, "waitingApproval");
  },
);
