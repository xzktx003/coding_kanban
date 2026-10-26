import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Fastify from "fastify";
import { CodexService, type CodexOptions } from "./client.js";
import { registerCodexRoutes } from "./routes.js";
import { EventHub } from "../core/events.js";
import { object, type Json } from "../core/json.js";
import type { Rpc } from "./ownership.js";

const endpoint = "/api/codex/feedback/preflight";
const baseURL = "https://feedback.fixture.invalid/backend-api";
const instance = "feedback-preflight-fixture";
const targetId = "fixture-account";
const privateMarker = "PRIVATE_FIXTURE_NEVER_PUBLIC";
const jwt = (id = targetId) =>
  [
    Buffer.from('{"alg":"fixture"}').toString("base64url"),
    Buffer.from(
      JSON.stringify({
        "https://api.openai.com/auth": {
          chatgpt_account_id: id,
          chatgpt_plan_type: "business",
        },
      }),
    ).toString("base64url"),
    "fixture-signature",
  ].join(".");
const member = (structure: string = "workspace", id = targetId) => ({
  accounts: {
    [id]: {
      account: {
        account_id: id,
        structure,
        account_user_id: privateMarker,
        plan_type: "business",
      },
    },
  },
  // Deliberately untrusted ordering: only the exact token target may win.
  account_ordering: ["wrong-first-account", id],
});
const deferred = <T = void>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

function fixture(t: TestContext, overrides: Record<string, unknown> = {}) {
  const state = {
    account: {
      account: { type: "apiKey" },
      requiresOpenaiAuth: false,
    } as Json | Error,
    auth: {
      authMethod: "chatgpt",
      authToken: jwt(),
      requiresOpenaiAuth: true,
    } as Json | Error,
    metadata: {
      thread: { id: "thread-a", cwd: "/fixture/project-a" },
    } as Json | Error,
    config: {
      config: {
        feedback: { enabled: true },
        model_provider: privateMarker,
        secret: privateMarker,
      },
      origins: { private: privateMarker },
      layers: [{ path: privateMarker }],
    } as Json | Error,
    requirements: { requirements: null } as Json | Error,
    membership: member() as Json,
    membershipStatus: 200,
    settings: {
      beta_settings: { enable_message_feedback: true },
      private: privateMarker,
    } as Json,
    settingsStatus: 200,
    fetchError: null as Error | null,
    rawHook: undefined as
      | ((method: string, params: Json) => void | Promise<void>)
      | undefined,
    fetchHook: undefined as
      | ((url: string, init: RequestInit) => Promise<Response | undefined>)
      | undefined,
  };
  const calls: { method: string; params: Json; beforeSend: boolean }[] = [];
  const http: { url: string; method: string; headers: Headers; redirect: string }[] = [];
  const native = (value: Json | Error): Json => {
    if (value instanceof Error) throw value;
    return structuredClone(value);
  };
  const fetchFixture: typeof fetch = async (input, init = {}) => {
    const url = String(input);
    http.push({
      url,
      method: init.method ?? "GET",
      headers: new Headers(init.headers),
      redirect: init.redirect ?? "follow",
    });
    const intercepted = await state.fetchHook?.(url, init);
    if (intercepted) return intercepted;
    if (state.fetchError) throw state.fetchError;
    if (url === baseURL + "/accounts/check/v4-2023-04-27")
      return new Response(JSON.stringify(state.membership), {
        status: state.membershipStatus,
      });
    if (url === baseURL + "/accounts/" + targetId + "/settings")
      return new Response(JSON.stringify(state.settings), {
        status: state.settingsStatus,
      });
    throw new Error("Unapproved fixture HTTP path");
  };
  const options = {
    hub: new EventHub(),
    instance,
    env: {},
    sweepIntervalMs: 0,
    feedbackPreflight: {
      fetch: fetchFixture,
      baseURL,
      timeoutMs: 250,
      maxResponseBytes: 16_384,
      maxCacheEntries: 4,
      ...overrides,
    },
  } as CodexOptions;
  const service = new CodexService(options);
  const raw: Rpc = async (method, params, requestOptions) => {
    requestOptions?.beforeSend?.();
    calls.push({ method, params, beforeSend: !!requestOptions?.beforeSend });
    await state.rawHook?.(method, params);
    if (method === "thread/read") return native(state.metadata);
    if (method === "account/read") return native(state.account);
    if (method === "getAuthStatus") return native(state.auth);
    if (method === "config/read") return native(state.config);
    if (method === "configRequirements/read") return native(state.requirements);
    throw new Error("Unapproved fixture RPC: " + method);
  };
  // The real routes and CodexService are used, but every native/HTTP operation
  // terminates in the two local functions above. No StdioRpc/native is started.
  Object.assign(service, { raw });
  const app = Fastify();
  registerCodexRoutes(app, service);
  t.after(async () => {
    await app.close();
    await service.close();
  });
  const post = (payload: object = { threadId: null, cwd: null }) =>
    app.inject({ method: "POST", url: endpoint, payload });
  const read = async (payload?: object) => {
    const response = await post(payload);
    assert.equal(response.statusCode, 200, response.body);
    return response.json();
  };
  const chatgpt = () => {
    state.account = {
      account: {
        type: "chatgpt",
        email: "private-fixture@example.invalid",
        planType: "business",
      },
      requiresOpenaiAuth: true,
      workspaceRouting: { chatgptAccountId: targetId },
    };
  };
  const notify = (method = "account/updated") => {
    const handler = Reflect.get(service, "onNotification") as (
      input: Json,
    ) => void;
    handler.call(service, { method, params: { authMode: "apikey" } });
  };
  return { app, service, state, calls, http, read, post, chatgpt, notify };
}

function projected(data: any, reason: string | null) {
  assert.deepEqual(Object.keys(data).sort(), [
    "provenance",
    "reason",
    "runtimeInstance",
  ]);
  assert.equal(data.reason, reason);
  assert.equal(data.runtimeInstance, instance);
  assert.deepEqual(Object.keys(data.provenance).sort(), [
    "account",
    "config",
    "requirements",
    "workspace",
  ]);
  const serialized = JSON.stringify(data);
  for (const forbidden of [privateMarker, "fixture-account", "/fixture/", jwt(), "email", "authToken"])
    assert.ok(!serialized.includes(forbidden), "Private value escaped projection");
  assert.ok(serialized.length < 512);
}

test("feedback preflight endpoint reads exact native scope and returns only its bounded projection", async (t) => {
  const f = fixture(t);
  f.state.config = { config: { feedback: { enabled: false }, secret: privateMarker } };
  const data = await f.read({ threadId: "thread-a", cwd: "/caller/cannot-override" });
  projected(data, "configuration");
  assert.deepEqual(data.provenance, {
    config: "fresh", requirements: "fresh", account: "native", workspace: "not-required",
  });
  assert.ok(f.calls.filter((c) => c.method === "thread/read").length >= 1);
  for (const c of f.calls.filter((c) => c.method === "thread/read"))
    assert.deepEqual(c.params, { threadId: "thread-a", includeTurns: false });
  for (const c of f.calls.filter((c) => c.method === "config/read"))
    assert.deepEqual(c.params, { cwd: "/fixture/project-a", includeLayers: false });
  assert.equal(f.http.length, 0);
  assert.deepEqual(f.service.ownership.ids(), []);
  assert.ok(f.calls.every((c) => ["thread/read", "account/read", "config/read", "configRequirements/read"].includes(c.method)));
});

test("feedback preflight distinguishes requirements policy from configuration and unavailable auth", async (t) => {
  const f = fixture(t);
  f.state.account = new Error("Private account unavailable: " + privateMarker);
  f.state.config = { config: { feedback: { enabled: false } } };
  f.state.requirements = { requirements: { feedback: { enabled: false } } };
  projected(await f.read(), "policy");
});

test("feedback preflight complete API-key defaults are allowed without reading any token or HTTP", async (t) => {
  const f = fixture(t);
  f.state.config = { config: {} };
  f.state.requirements = { requirements: {} };
  const data = await f.read();
  projected(data, null);
  assert.equal(data.provenance.workspace, "not-required");
  assert.equal(f.calls.some((c) => c.method === "getAuthStatus"), false);
  assert.equal(f.http.length, 0);
  assert.ok(f.calls.filter((c) => c.method === "account/read").length >= 2);
  assert.ok(f.calls.filter((c) => c.method === "account/read").every((c) => object(c.params).refreshToken === false));
});

for (const requiresOpenaiAuth of [false, true])
  test(`feedback preflight complete anonymous account preserves DP defaults (${requiresOpenaiAuth})`, async (t) => {
    const f = fixture(t);
    f.state.account = { account: null, requiresOpenaiAuth };
    f.state.config = { config: { feedback: null } };
    f.state.requirements = { requirements: null };
    projected(await f.read({ threadId: null, cwd: null }), null);
    assert.equal(f.calls.some((c) => c.method === "getAuthStatus"), false);
    assert.equal(f.http.length, 0);
  });

test("feedback preflight incomplete native account is unavailable, never guessed anonymous", async (t) => {
  const f = fixture(t);
  for (const account of [{}, { account: null }, { account: { type: "unknown" }, requiresOpenaiAuth: false }]) {
    f.state.account = account as Json;
    projected(await f.read(), "unavailable");
  }
  assert.equal(f.http.length, 0);
});

test("feedback preflight config failure uses only an exact cwd cache and otherwise the DP default", async (t) => {
  const f = fixture(t);
  f.state.config = { config: { feedback: { enabled: false } } };
  projected(await f.read({ threadId: null, cwd: "/fixture/a" }), "configuration");
  f.state.config = new Error(privateMarker);
  const cached = await f.read({ threadId: null, cwd: "/fixture/a" });
  projected(cached, "configuration");
  assert.equal(cached.provenance.config, "cache");
  const other = await f.read({ threadId: null, cwd: "/fixture/b" });
  projected(other, null);
  assert.equal(other.provenance.config, "default");
});

test("feedback preflight requirements failure retains its exact captured policy cache", async (t) => {
  const f = fixture(t);
  f.state.requirements = { requirements: { feedback: { enabled: false } } };
  projected(await f.read(), "policy");
  f.state.requirements = new Error(privateMarker);
  const data = await f.read();
  projected(data, "policy");
  assert.equal(data.provenance.requirements, "cache");
});

test("feedback preflight fresh reads fail without complete cache: config default and unavailable requirements do not blanket-deny anonymous", async (t) => {
  const f = fixture(t);
  f.state.config = new Error(privateMarker);
  f.state.requirements = new Error(privateMarker);
  const data = await f.read();
  projected(data, null);
  assert.equal(data.provenance.config, "default");
  assert.equal(data.provenance.requirements, "unavailable");
});

test("feedback preflight metadata failure or mismatched native ID never falls back to caller cwd/global", async (t) => {
  const f = fixture(t);
  for (const metadata of [new Error(privateMarker), { thread: { id: "another-thread", cwd: "/fixture/other" } }, { thread: { id: "thread-a", cwd: null } }]) {
    f.calls.length = 0;
    f.state.metadata = metadata;
    projected(await f.read({ threadId: "thread-a", cwd: "/fixture/caller" }), "unavailable");
    assert.equal(f.calls.some((c) => c.method === "config/read"), false);
  }
});

test("feedback preflight rejects arbitrary origins, credentials and invalid paths before any RPC", async (t) => {
  const f = fixture(t);
  for (const payload of [{}, { threadId: "" }, { threadId: 1 }, { threadId: null, cwd: "relative" }, { threadId: null, cwd: "/fixture/../other" }, { threadId: null, cwd: "/fixture/\u0000secret" }, { threadId: null, baseURL: "https://unapproved.invalid" }, { threadId: null, accountId: "foreign" }, { threadId: null, token: privateMarker }]) {
    const response = await f.post(payload);
    assert.equal(response.statusCode, 400, response.body);
  }
  assert.equal(f.calls.length, 0);
  assert.equal(f.http.length, 0);
});

test("feedback preflight verifies target membership, not plan or first account, before workspace settings", async (t) => {
  const f = fixture(t);
  f.chatgpt();
  const data = await f.read();
  projected(data, null);
  assert.equal(data.provenance.workspace, "fresh");
  assert.deepEqual(f.http.map((r) => r.url), [baseURL + "/accounts/check/v4-2023-04-27", baseURL + "/accounts/" + targetId + "/settings"]);
  assert.ok(f.http.every((r) => r.method === "GET" && r.redirect === "error"));
  assert.ok(f.http.every((r) => r.headers.get("Authorization") === "Bearer " + jwt() && r.headers.get("ChatGPT-Account-ID") === targetId));
  for (const c of f.calls.filter((c) => c.method === "getAuthStatus"))
    assert.deepEqual(c.params, { includeToken: true, refreshToken: false });
  assert.ok(f.calls.filter((c) => c.method === "getAuthStatus").length >= 2);
});

test("feedback preflight explicit workspace false outranks configuration", async (t) => {
  const f = fixture(t);
  f.chatgpt();
  f.state.settings = { beta_settings: { enable_message_feedback: false } };
  f.state.config = { config: { feedback: { enabled: false } } };
  projected(await f.read(), "policy");
});

test("feedback preflight personal membership skips workspace settings even on business plan", async (t) => {
  const f = fixture(t);
  f.chatgpt();
  f.state.membership = member("personal");
  projected(await f.read(), null);
  assert.equal(f.http.length, 1);
});

test("feedback preflight unknown membership, mismatched target, opaque token and native routing conflict are unavailable", async (t) => {
  const f = fixture(t);
  f.chatgpt();
  for (const membership of [member("unknown"), member("personal", "wrong-first-account"), { accounts: { [targetId]: { account: { account_id: "different-id", structure: "personal" } } } }]) {
    f.state.membership = membership;
    projected(await f.read(), "unavailable");
    f.notify();
  }
  f.state.auth = { authMethod: "chatgpt", authToken: "opaque-fixture", requiresOpenaiAuth: true };
  f.http.length = 0;
  projected(await f.read(), "unavailable");
  assert.equal(f.http.length, 0);
  f.state.auth = { authMethod: "apikey", authToken: jwt(), requiresOpenaiAuth: true };
  projected(await f.read(), "unavailable");
  f.state.auth = { authMethod: "chatgpt", authToken: jwt("different-account"), requiresOpenaiAuth: true };
  projected(await f.read(), "unavailable");
  assert.equal(f.http.length, 0);
});

test("feedback preflight malformed workspace payload is unavailable; complete beta defaults allow", async (t) => {
  const f = fixture(t);
  f.chatgpt();
  for (const settings of [{}, { beta_settings: null }, { beta_settings: { enable_message_feedback: "false" } }]) {
    f.state.settings = settings as Json;
    projected(await f.read(), "unavailable");
    f.notify();
  }
  for (const settings of [{ beta_settings: {} }, { beta_settings: { enable_message_feedback: null } }]) {
    f.state.settings = settings as Json;
    projected(await f.read(), null);
  }
});

test("feedback preflight workspace transient failure can use only same-account policy cache", async (t) => {
  const f = fixture(t);
  f.chatgpt();
  f.state.settings = { beta_settings: { enable_message_feedback: false } };
  projected(await f.read(), "policy");
  f.state.settingsStatus = 503;
  const data = await f.read();
  projected(data, "policy");
  assert.equal(data.provenance.workspace, "cache");
});

for (const status of [401, 403, 404])
  test(`feedback preflight workspace ${status} removes an old allow cache, including the next transient read`, async (t) => {
    const f = fixture(t);
    f.chatgpt();
    projected(await f.read(), null);
    f.state.settingsStatus = status;
    projected(await f.read(), "unavailable");
    f.state.settingsStatus = 503;
    const data = await f.read();
    projected(data, "unavailable");
    assert.equal(data.provenance.workspace, "unavailable");
  });

test("feedback preflight membership 401 discards cached structure and cannot turn the next 503 into personal", async (t) => {
  const f = fixture(t);
  f.chatgpt();
  f.state.membership = member("personal");
  projected(await f.read(), null);
  f.state.membershipStatus = 401;
  projected(await f.read(), "unavailable");
  f.state.membershipStatus = 503;
  projected(await f.read(), "unavailable");
});

test("feedback preflight same-value account notification invalidates pending results and complete caches", async (t) => {
  const f = fixture(t);
  f.state.config = { config: { feedback: { enabled: false } } };
  projected(await f.read(), "configuration");
  const reached = deferred(), release = deferred();
  f.state.rawHook = async (method) => {
    if (method === "config/read") { reached.resolve(); await release.promise; }
  };
  const pending = f.post();
  await reached.promise;
  f.notify();
  release.resolve();
  const response = await pending;
  assert.equal(response.statusCode, 200, response.body);
  projected(response.json(), "unavailable");
  f.state.rawHook = undefined;
  f.state.config = new Error(privateMarker);
  const next = await f.read();
  projected(next, null);
  assert.equal(next.provenance.config, "default");
});

test("feedback preflight A-B-A native account notifications cannot restore an old allow", async (t) => {
  const f = fixture(t);
  projected(await f.read(), null);
  const reached = deferred(), release = deferred();
  f.state.rawHook = async (method) => {
    if (method === "config/read") { reached.resolve(); await release.promise; }
  };
  const pending = f.post();
  await reached.promise;
  f.state.account = { account: null, requiresOpenaiAuth: false };
  f.notify();
  f.state.account = { account: { type: "apiKey" }, requiresOpenaiAuth: false };
  f.notify();
  release.resolve();
  const response = await pending;
  assert.equal(response.statusCode, 200, response.body);
  projected(response.json(), "unavailable");
});

test("feedback preflight checks native/auth identity again after HTTP, even without a notification", async (t) => {
  const f = fixture(t);
  f.chatgpt();
  f.state.fetchHook = async (url) => {
    if (url.endsWith("/settings"))
      f.state.auth = { authMethod: "chatgpt", authToken: jwt("changed-account"), requiresOpenaiAuth: true };
    return undefined;
  };
  projected(await f.read(), "unavailable");
});

test("feedback preflight transport close invalidates pending work without restarting any native process", async (t) => {
  const f = fixture(t);
  projected(await f.read(), null);
  const reached = deferred(), release = deferred();
  f.state.rawHook = async (method) => {
    if (method === "config/read") { reached.resolve(); await release.promise; }
  };
  const pending = f.post();
  await reached.promise;
  await f.service.close();
  release.resolve();
  const response = await pending;
  assert.equal(response.statusCode, 200, response.body);
  projected(response.json(), "unavailable");
  assert.deepEqual(f.service.ownership.ids(), []);
});

test("feedback preflight ignores oversized HTTP bodies and enforces its bounded deadline", async (t) => {
  const f = fixture(t, { maxResponseBytes: 1024, timeoutMs: 40 });
  f.chatgpt();
  f.state.fetchHook = async () => new Response("x".repeat(2048));
  projected(await f.read(), "unavailable");
  f.notify();
  let signal: AbortSignal | null | undefined;
  f.state.fetchHook = async (_url, init) => {
    signal = init.signal;
    return new Promise<Response>(() => {});
  };
  const start = performance.now();
  projected(await f.read(), "unavailable");
  assert.ok(performance.now() - start < 500);
  assert.equal(signal?.aborted, true);
});

test("feedback preflight complete policy caches are bounded and do not retain an evicted cwd", async (t) => {
  const f = fixture(t, { maxCacheEntries: 2 });
  f.state.config = { config: { feedback: { enabled: false } } };
  for (const cwd of ["/fixture/a", "/fixture/b", "/fixture/c"])
    projected(await f.read({ threadId: null, cwd }), "configuration");
  f.state.config = new Error(privateMarker);
  const data = await f.read({ threadId: null, cwd: "/fixture/a" });
  projected(data, null);
  assert.equal(data.provenance.config, "default");
});

test("feedback preflight preserves the existing config/read empty-body and redacted projection contract", async (t) => {
  const f = fixture(t);
  f.state.config = { config: { feedback: { enabled: false }, model: privateMarker, approval_policy: "never" } };
  const response = await f.app.inject({ method: "POST", url: "/api/codex/config/read", payload: {} });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.body.includes("feedback"), false);
  assert.equal(response.body.includes(privateMarker), false);
  assert.deepEqual(f.calls.find((c) => c.method === "config/read")?.params, { includeLayers: false });
  const rejected = await f.app.inject({ method: "POST", url: "/api/codex/config/read", payload: { cwd: "/fixture/a" } });
  assert.equal(rejected.statusCode, 400);
});

test("feedback preflight construction and route registration remain lazy and do not start native/HTTP", async (t) => {
  const f = fixture(t);
  await f.app.ready();
  assert.equal(f.calls.length, 0);
  assert.equal(f.http.length, 0);
  assert.deepEqual(f.service.ownership.ids(), []);
});

for (const origin of ["http://remote.fixture.invalid/backend-api", "http://127.0.0.1.remote.fixture.invalid/backend-api"])
  test(`feedback preflight transport safety rejects bearer transmission to ${origin}`, async (t) => {
    const f = fixture(t, { baseURL: origin });
    f.chatgpt();
    // A permissive fake peer makes attempted delivery observable without any
    // network call. An unavailable result alone would not detect transmission.
    f.state.fetchHook = async () => new Response(JSON.stringify(member("personal")));
    projected(await f.read(), "unavailable");
    assert.equal(f.http.length, 0);
  });

test("feedback preflight transport safety permits an explicitly injected loopback HTTP fixture", async (t) => {
  const origin = "http://127.0.0.1:14321/backend-api";
  const f = fixture(t, { baseURL: origin });
  f.chatgpt();
  f.state.fetchHook = async () => new Response(JSON.stringify(member("personal")));
  projected(await f.read(), null);
  assert.deepEqual(f.http.map((request) => request.url), [origin + "/accounts/check/v4-2023-04-27"]);
});

for (const kind of ["config", "requirements", "workspace"] as const)
  test(`feedback preflight active ${kind} fallback cache does not drop a known false at its original write-age`, async (t) => {
    let now = 0;
    const f = fixture(t, { cacheTtlMs: 50, now: () => now });
    if (kind === "config") f.state.config = { config: { feedback: { enabled: false } } };
    if (kind === "requirements") f.state.requirements = { requirements: { feedback: { enabled: false } } };
    if (kind === "workspace") {
      f.chatgpt();
      f.state.settings = { beta_settings: { enable_message_feedback: false } };
    }
    const reason = kind === "config" ? "configuration" : "policy";
    projected(await f.read(), reason);
    if (kind === "config") f.state.config = new Error(privateMarker);
    if (kind === "requirements") f.state.requirements = new Error(privateMarker);
    if (kind === "workspace") f.state.settingsStatus = 503;
    for (now of [40, 80, 120]) {
      const data = await f.read();
      projected(data, reason);
      assert.equal(data.provenance[kind], "cache");
    }
  });

test("feedback preflight inactive cache still has an explicit bounded idle lifetime", async (t) => {
  let now = 0;
  const f = fixture(t, { cacheTtlMs: 50, now: () => now });
  f.state.config = { config: { feedback: { enabled: false } } };
  projected(await f.read(), "configuration");
  now = 60;
  f.state.config = new Error(privateMarker);
  const data = await f.read();
  projected(data, null);
  assert.equal(data.provenance.config, "default");
});

test("feedback preflight runtime identity boundary uses at most 256 UTF8 bytes without echoing invalid IDs", async (t) => {
  for (const [runtimeInstance, valid] of [
    ["x".repeat(257), false], ["界".repeat(86), false], ["", false], ["bad\u007fidentity", false],
    ["x".repeat(256), true], ["界".repeat(85) + "a", true],
  ] as const) {
    let calls = 0;
    const app = Fastify(), service = new CodexService({ hub: new EventHub(), instance: runtimeInstance, env: {}, sweepIntervalMs: 0 });
    Object.assign(service, { raw: async (method: string) => {
      calls++;
      if (method === "account/read") return { account: { type: "apiKey" }, requiresOpenaiAuth: false };
      if (method === "config/read") return { config: {} };
      if (method === "configRequirements/read") return { requirements: null };
      throw new Error("Unapproved fixture RPC");
    } });
    registerCodexRoutes(app, service);
    t.after(async () => { await app.close(); await service.close(); });
    const response = await app.inject({ method: "POST", url: endpoint, payload: { threadId: null, cwd: null } });
    assert.equal(response.statusCode, valid ? 200 : 503, response.body);
    if (valid) {
      assert.equal(response.json().runtimeInstance, runtimeInstance);
      assert.equal(response.json().reason, null);
    } else {
      assert.equal(calls, 0);
      if (runtimeInstance) assert.equal(response.body.includes(runtimeInstance), false);
    }
  }
});

test("feedback preflight same native identity permits legitimate token bytes rotation without an account notification", async (t) => {
  const f = fixture(t);
  f.chatgpt();
  f.state.membership = member("personal");
  let authReads = 0;
  f.state.rawHook = (method) => {
    if (method === "getAuthStatus" && ++authReads > 1)
      f.state.auth = { authMethod: "chatgpt", authToken: jwt() + "-rotated", requiresOpenaiAuth: true };
  };
  projected(await f.read(), null);
  assert.equal(authReads, 2);
  assert.equal(f.http.length, 1);
  assert.equal(f.http[0].headers.get("Authorization"), "Bearer " + jwt());
});

test("feedback preflight post-review requirements false survives a cwd change when the authority read fails", async (t) => {
  const f = fixture(t);
  f.state.requirements = { requirements: { feedback: { enabled: false } } };
  projected(await f.read({ threadId: null, cwd: "/fixture/requirements-a" }), "policy");
  f.state.requirements = new Error(privateMarker);
  const next = await f.read({ threadId: null, cwd: "/fixture/requirements-b" });
  projected(next, "policy");
  assert.equal(next.provenance.requirements, "cache");
  assert.deepEqual(f.calls.filter((call) => call.method === "configRequirements/read").map((call) => call.params), [null, null]);
  assert.equal(f.http.length, 0);
});

for (const usesCodexManagedCredentials of [false, true])
  test(`feedback preflight post-review complete Bedrock account ${usesCodexManagedCredentials} uses native defaults without ChatGPT HTTP`, async (t) => {
    const f = fixture(t);
    f.state.account = { account: { type: "amazonBedrock", usesCodexManagedCredentials }, requiresOpenaiAuth: false };
    const value = await f.read();
    projected(value, null);
    assert.equal(value.provenance.account, "native");
    assert.equal(value.provenance.workspace, "not-required");
    assert.equal(f.calls.some((call) => call.method === "getAuthStatus"), false);
    assert.equal(f.http.length, 0);
  });

for (const account of [
  { type: "amazonBedrock" },
  { type: "amazonBedrock", usesCodexManagedCredentials: "true" },
  { type: "unrecognized-native-account", usesCodexManagedCredentials: false },
])
  test(`feedback preflight post-review malformed or unknown account remains unavailable ${JSON.stringify(account)}`, async (t) => {
    const f = fixture(t);
    f.state.account = { account, requiresOpenaiAuth: false } as Json;
    projected(await f.read(), "unavailable");
    assert.equal(f.calls.some((call) => call.method === "getAuthStatus"), false);
    assert.equal(f.http.length, 0);
  });

for (const policy of ["configuration", "requirements", "workspace"] as const)
  test(`feedback preflight post-review delayed old allow cannot overwrite a newer ${policy} false cache`, async (t) => {
    const f = fixture(t);
    f.chatgpt();
    f.state.membership = member(policy === "workspace" ? "workspace" : "personal");
    const reached = deferred(), release = deferred();
    let delayed = false;
    f.state.fetchHook = async (url) => {
      const target = policy === "workspace" ? "/settings" : "/accounts/check/v4-2023-04-27";
      if (!delayed && url.endsWith(target)) {
        delayed = true;
        const captured = structuredClone(policy === "workspace" ? f.state.settings : f.state.membership);
        reached.resolve();
        await release.promise;
        return new Response(JSON.stringify(captured));
      }
      return undefined;
    };
    const old = f.post();
    await reached.promise;
    // The old native reads have completed before changing the synthetic peer.
    await new Promise<void>((resolve) => setImmediate(resolve));
    if (policy === "configuration") f.state.config = { config: { feedback: { enabled: false } } };
    if (policy === "requirements") f.state.requirements = { requirements: { feedback: { enabled: false } } };
    if (policy === "workspace") f.state.settings = { beta_settings: { enable_message_feedback: false } };
    projected(await f.read(), policy === "configuration" ? "configuration" : "policy");
    release.resolve();
    assert.equal((await old).statusCode, 200);
    f.state.config = new Error(privateMarker);
    f.state.requirements = new Error(privateMarker);
    f.state.fetchError = new Error(privateMarker);
    const cached = await f.read();
    projected(cached, policy === "configuration" ? "configuration" : "policy");
    assert.equal(cached.provenance[policy === "configuration" ? "config" : policy], "cache");
  });

for (const status of [401, 403, 404])
  test(`feedback preflight post-review delayed old allow cannot resurrect a workspace cache cleared by ${status}`, async (t) => {
    const f = fixture(t);
    f.chatgpt();
    projected(await f.read(), null);
    const reached = deferred(), release = deferred();
    let delayed = false;
    f.state.fetchHook = async (url) => {
      if (!delayed && url.endsWith("/settings")) {
        delayed = true;
        const captured = structuredClone(f.state.settings);
        reached.resolve();
        await release.promise;
        return new Response(JSON.stringify(captured));
      }
      return undefined;
    };
    const old = f.post();
    await reached.promise;
    f.state.settingsStatus = status;
    projected(await f.read(), "unavailable");
    release.resolve();
    assert.equal((await old).statusCode, 200);
    f.state.membershipStatus = 503;
    f.state.settingsStatus = 503;
    const cached = await f.read();
    projected(cached, "unavailable");
    assert.equal(cached.provenance.workspace, "unavailable");
  });

for (const policy of ["configuration", "requirements", "workspace"] as const)
  test(`feedback preflight cache-order correction newer failed ${policy} attempt cannot retire an older valid false snapshot`, async (t) => {
    const f = fixture(t);
    f.chatgpt();
    f.state.membership = member(policy === "workspace" ? "workspace" : "personal");
    if (policy === "configuration") f.state.config = { config: { feedback: { enabled: false } } };
    if (policy === "requirements") f.state.requirements = { requirements: { feedback: { enabled: false } } };
    if (policy === "workspace") f.state.settings = { beta_settings: { enable_message_feedback: false } };
    const reached = deferred(), release = deferred();
    let delayed = false;
    f.state.fetchHook = async (url) => {
      const target = policy === "workspace" ? "/settings" : "/accounts/check/v4-2023-04-27";
      if (!delayed && url.endsWith(target)) {
        delayed = true;
        const captured = structuredClone(policy === "workspace" ? f.state.settings : f.state.membership);
        reached.resolve();
        await release.promise;
        return new Response(JSON.stringify(captured));
      }
      return undefined;
    };
    const old = f.post();
    await reached.promise;
    await new Promise<void>((resolve) => setImmediate(resolve));
    if (policy === "configuration") f.state.config = new Error(privateMarker);
    if (policy === "requirements") f.state.requirements = new Error(privateMarker);
    if (policy === "workspace") f.state.settingsStatus = 503;
    projected(await f.read(), policy === "workspace" ? "unavailable" : null);
    release.resolve();
    projected((await old).json(), policy === "configuration" ? "configuration" : "policy");
    const cached = await f.read();
    projected(cached, policy === "configuration" ? "configuration" : "policy");
    assert.equal(cached.provenance[policy === "configuration" ? "config" : policy], "cache");
  });

for (const status of [401, 403, 404])
  test(`feedback preflight cache-order correction newer failed settings attempt cannot retire an older ${status} revocation`, async (t) => {
    const f = fixture(t);
    f.chatgpt();
    projected(await f.read(), null);
    const reached = deferred(), release = deferred();
    let delayed = false;
    f.state.fetchHook = async (url) => {
      if (!delayed && url.endsWith("/settings")) {
        delayed = true;
        reached.resolve();
        await release.promise;
        return new Response("{}", { status });
      }
      return undefined;
    };
    const old = f.post();
    await reached.promise;
    f.state.settingsStatus = 503;
    projected(await f.read(), null);
    release.resolve();
    projected((await old).json(), "unavailable");
    const cached = await f.read();
    projected(cached, "unavailable");
    assert.equal(cached.provenance.workspace, "unavailable");
  });
