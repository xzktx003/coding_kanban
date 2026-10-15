import test from "node:test";
import assert from "node:assert/strict";
import { createNativePoolAdapter } from "../refresh-prototype/native-pool-adapter.mjs";
const generation = "019aabcd-1234-7890-abcd-000000000001";
const domain = "019aabcd-1234-7890-abcd-000000000002";
const threadId = "019aabcd-1234-7890-abcd-000000000003";
const key = { domain, generation, threadId, cwd: "/private/project" };
const proof = {
  cliVersion: "0.162.0-alpha.17.2",
  cliSha256: "73b73b048546993298234a295de01ef2424e7a8b29def9d0ecb1ca7cb77500d4",
};
function fixture(handler, resources = {}) {
  const requests = [];
  const adapter = createNativePoolAdapter({
    ...proof,
    domain,
    generation,
    readRss: async () => 100,
    canonicalize: async (path) => path,
    unloadTimeoutMs: 50,
    pollMs: 1,
    client: {
      async request(method, params, options) {
        options?.beforeSend?.();
        requests.push({ method, params });
        if (method === "thread/backgroundTerminals/list")
          return resources.terminals ?? { data: [], nextCursor: null };
        if (method === "thread/goal/get")
          return Object.hasOwn(resources, "goal")
            ? { goal: resources.goal }
            : { goal: null };
        const result = handler(method, params);
        if (method === "thread/loaded/list" && !Array.isArray(result?.data))
          return { data: [], nextCursor: null };
        return result;
      },
    },
  });
  return { adapter, requests };
}
test("native retention validates actual cwd and resumes without model, reasoning or permission overrides", async () => {
  const f = fixture((method) => ({
    thread: {
      id: threadId,
      cwd: key.cwd,
      source: "vscode",
      status: { type: "idle" },
    },
    ...(method === "thread/resume" ? { cwd: key.cwd } : {}),
  }));
  const state = await f.adapter.retain(key);
  assert.equal(state.threadId, threadId);
  assert.equal(state.status, "idle");
  assert.deepEqual(f.requests.slice(0, 5), [
    { method: "thread/read", params: { threadId, includeTurns: false } },
    {
      method: "thread/backgroundTerminals/list",
      params: { threadId, limit: 1 },
    },
    { method: "thread/goal/get", params: { threadId } },
    { method: "thread/loaded/list", params: { limit: 100 } },
    { method: "thread/resume", params: { threadId, excludeTurns: true } },
  ]);
  await assert.rejects(
    f.adapter.probe({ ...key, generation: domain }),
    /scope/,
  );
  const bad = fixture(() => ({
    thread: { id: threadId, cwd: "/other/project", status: { type: "idle" } },
  }));
  await assert.rejects(bad.adapter.retain(key), /cwd/);
  assert.equal(
    bad.requests.some((request) => request.method === "thread/resume"),
    false,
  );
});

test("the pool consumer guard reaches the actual native unsubscribe write", async () => {
  let sent = false;
  const f = fixture((method) => {
    if (method === "thread/read") return {thread:{id:threadId,cwd:key.cwd,source:"vscode",status:{type:"idle"}}};
    if (method === "thread/loaded/list") return {data:[threadId],nextCursor:null};
    if (method === "thread/unsubscribe") {sent=true;return {status:"unsubscribed"};}
    throw Error("unexpected native operation");
  });
  const result = await f.adapter.unsubscribe(key,{beforeSend(){throw Object.assign(Error("consumer became visible"),{code:"NATIVE_NOT_SENT"});}});
  assert.equal(sent,false);
  assert.equal(result.protected,true);
  assert.equal(result.retained,true);
});
test("rechecks active and approval flags without unsubscribing protected native contexts", async () => {
  const f = fixture(() => ({
    thread: {
      id: threadId,
      cwd: key.cwd,
      source: "vscode",
      status: { type: "active", activeFlags: ["waitingOnApproval"] },
    },
  }));
  const result = await f.adapter.unsubscribe(key);
  assert.equal(result.protected, true);
  assert.equal(result.retained, true);
  assert.equal(result.state.status, "waitingApproval");
  assert.equal(
    f.requests.some((request) => request.method === "thread/unsubscribe"),
    false,
  );
});
test("unsubscribes only its own native connection and confirms unload using bounded metadata", async () => {
  let loaded = true;
  const f = fixture((method) => {
    if (method === "thread/read")
      return {
        thread: {
          id: threadId,
          cwd: key.cwd,
          source: "vscode",
          status: { type: "idle" },
        },
      };
    if (method === "thread/unsubscribe") {
      loaded = false;
      return { status: "unsubscribed" };
    }
    if (method === "thread/loaded/list")
      return { data: loaded ? [threadId] : [], nextCursor: null };
    throw Error("Unexpected native method");
  });
  assert.deepEqual(await f.adapter.unsubscribe(key), { released: true });
  assert.ok(
    f.requests.every((request) =>
      [
        "thread/read",
        "thread/backgroundTerminals/list",
        "thread/goal/get",
        "thread/unsubscribe",
        "thread/loaded/list",
      ].includes(request.method),
    ),
  );
});
test("unknown unsubscribe receipt cannot trigger automatic retry or a false release", async () => {
  const f = fixture((method) =>
    method === "thread/read"
      ? {
          thread: {
            id: threadId,
            cwd: key.cwd,
            source: "vscode",
            status: { type: "idle" },
          },
        }
      : { status: "unexpected" },
  );
  await assert.rejects(f.adapter.unsubscribe(key), /unsubscribe receipt/);
  assert.equal(
    f.requests.filter((request) => request.method === "thread/unsubscribe")
      .length,
    1,
  );
});

test("a context unloading between metadata reads is never accidentally cold-resumed by eviction", async () => {
  let unsubscribed = false,
    unloaded = false;
  const f = fixture((method) => {
    if (method === "thread/read")
      return {
        thread: {
          id: threadId,
          cwd: key.cwd,
          source: "vscode",
          status: { type: unloaded ? "notLoaded" : "idle" },
        },
      };
    if (method === "thread/unsubscribe") {
      unsubscribed = true;
      return { status: "unsubscribed" };
    }
    if (method === "thread/loaded/list") {
      if (unloaded) return { data: [], nextCursor: null };
      if (!unsubscribed) return { data: [threadId], nextCursor: null };
      unloaded = true;
      return { data: [threadId], nextCursor: null };
    }
    throw Error("Eviction must not cold-resume the evicted context");
  });
  assert.deepEqual(await f.adapter.unsubscribe(key), { released: true });
  assert.equal(
    f.requests.some((request) => request.method === "thread/resume"),
    false,
  );
});

for (const resources of [
  {
    terminals: {
      data: [{ processId: "still-running", command: "PRIVATE_COMMAND" }],
      nextCursor: null,
    },
  },
  { goal: { status: "active", objective: "PRIVATE_GOAL" } },
  { goal: { status: "unrecognized" } },
])
  test("idle native status cannot hide active or unknown background resources", async () => {
    const f = fixture(
      () => ({
        thread: {
          id: threadId,
          cwd: key.cwd,
          source: "vscode",
          status: { type: "idle" },
        },
      }),
      resources,
    );
    const result = await f.adapter.unsubscribe(key);
    assert.equal(result.protected, true);
    assert.notEqual(result.state.status, "idle");
    assert.equal(
      f.requests.some((request) => request.method === "thread/unsubscribe"),
      false,
    );
    assert.equal(JSON.stringify(result).includes("PRIVATE_"), false);
  });

for (const childStatus of ["active", "idle"])
  test(`parent eviction inspects native descendants (${childStatus}) and never unsubscribes a child`, async () => {
    const childId = "019aabcd-1234-7890-abcd-000000000004";
    let loaded = true;
    const requests = [];
    const client = {
      async request(method, params) {
        requests.push({ method, params });
        if (method === "thread/loaded/list")
          return {
            data: loaded ? [threadId, childId] : [childId],
            nextCursor: null,
          };
        if (method === "thread/read")
          return {
            thread: {
              id: params.threadId,
              cwd: key.cwd,
              source:
                params.threadId === childId
                  ? {
                      subAgent: {
                        thread_spawn: { parent_thread_id: threadId },
                      },
                    }
                  : "vscode",
              status: {
                type: params.threadId === childId ? childStatus : "idle",
              },
            },
          };
        if (method === "thread/backgroundTerminals/list")
          return { data: [], nextCursor: null };
        if (method === "thread/goal/get") return { goal: null };
        if (method === "thread/unsubscribe") {
          assert.equal(params.threadId, threadId);
          loaded = false;
          return { status: "unsubscribed" };
        }
        throw Error("Unexpected method");
      },
    };
    const adapter = createNativePoolAdapter({
      ...proof,
      domain,
      generation,
      client,
      readRss: async () => 100,
      canonicalize: async (p) => p,
      unloadTimeoutMs: 50,
      pollMs: 1,
    });
    const result = await adapter.unsubscribe(key);
    if (childStatus === "active") {
      assert.equal(result.protected, true);
      assert.equal(result.state.resourceHold, "descendant");
      assert.equal(
        requests.some((x) => x.method === "thread/unsubscribe"),
        false,
      );
    } else assert.equal(result.released, true);
    assert.equal(
      requests.some(
        (x) =>
          x.method === "thread/unsubscribe" && x.params.threadId === childId,
      ),
      false,
    );
  });

test("lifecycle changes at the actual native write boundary veto parent release", async () => {
  let sent = false;
  const client = {
    revision: 0,
    async request(method, params, options) {
      if (method === "thread/read")
        return {
          thread: {
            id: threadId,
            cwd: key.cwd,
            source: "vscode",
            status: { type: "idle" },
          },
        };
      if (method === "thread/backgroundTerminals/list")
        return { data: [], nextCursor: null };
      if (method === "thread/goal/get") return { goal: null };
      if (method === "thread/loaded/list")
        return { data: [threadId], nextCursor: null };
      if (method === "thread/unsubscribe") {
        client.revision++;
        options?.beforeSend?.();
        sent = true;
        return { status: "unsubscribed" };
      }
      throw Error("Unexpected method");
    },
  };
  const adapter = createNativePoolAdapter({
    ...proof,
    domain,
    generation,
    client,
    readRss: async () => 100,
    canonicalize: async (p) => p,
    unloadTimeoutMs: 10,
    pollMs: 1,
  });
  const result = await adapter.unsubscribe(key);
  assert.equal(sent, false);
  assert.equal(result.protected, true);
  assert.equal(result.state.resourceHold, "lifecycle-changed");
});
