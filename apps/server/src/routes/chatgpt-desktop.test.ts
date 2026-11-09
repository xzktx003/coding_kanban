import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, stat, utimes, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import Fastify from "fastify";
import { registerChatGptDesktopRoutes } from "./chatgpt-desktop.js";
import type { ChatGptDesktopProfile } from "../services/chatgpt-desktop-profile.js";
import { createBrowserDocument } from "@agent-orchestrator/chatgpt-desktop-host/browser-document";
import { createChatGptDesktopSurfaceOptions } from "./chatgpt-desktop-surface-config.js";
import { createDesktopSurfaceAssetAdapter } from "@agent-orchestrator/chatgpt-desktop-host/desktop-surface-assets";

function profile(
  overrides: Partial<ChatGptDesktopProfile> = {},
): ChatGptDesktopProfile {
  return {
    version: 1,
    id: randomUUID(),
    generation: randomUUID(),
    pid: 12345,
    startTicks: "1234",
    uid: 1234,
    macAsarPath: "/private/mac.asar",
    macAsarSha256: "a".repeat(64),
    linuxAsarPath: "/private/linux.asar",
    linuxAsarSha256: "b".repeat(64),
    controlSocketPath: "/private/control.sock",
    ...overrides,
  };
}
function ready(value: ChatGptDesktopProfile) {
  return {
    status: {
      state: "ready" as const,
      reasonCode: "identity_ready" as const,
      profileId: value.id,
      generation: value.generation,
    },
    profile: value,
  };
}
function url(value: ChatGptDesktopProfile, member = "index.html") {
  return `/chatgpt-desktop/${value.id}/${value.generation}/webview/${member}`;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function withTimeout<T>(
  promise: Promise<T>,
  message: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), 2000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
function fakeArchive(body = "fixture") {
  const state = { acquired: [] as string[], released: 0, closed: 0 };
  return {
    state,
    async acquireAsset(member: string, _options?: { signal?: AbortSignal }) {
      state.acquired.push(member);
      let released = false;
      return {
        body: Buffer.from(body),
        contentType: "text/html; charset=utf-8",
        etag: `"${"a".repeat(64)}"`,
        release() {
          if (!released) {
            released = true;
            state.released++;
          }
        },
      };
    },
    async close() {
      state.closed++;
    },
  };
}
async function setup(t: TestContext, overrides: Record<string, unknown> = {}) {
  const app = Fastify();
  await app.register(registerChatGptDesktopRoutes, overrides);
  await app.ready();
  t.after(() => app.close());
  return app;
}

test("status returns only current scoped project-persistence metadata and sanitizes failures", async (t) => {
  const p = profile(); let value: unknown = "waiting";
  const app = await setup(t, {
    profileService: { readValidated: async () => ready(p) },
    projectPersistenceReader: async () => value,
  });
  for (const [input, expected] of [["waiting", "waiting"], ["active", "active"], ["unsupported", "unsupported"], ["error", "error"], ["/private/secret", "unknown"]]) {
    value = input;
    const response = await app.inject("/api/chatgpt-desktop/status");
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { ...ready(p).status, projectPersistence: { state: expected } });
    assert.equal(response.body.includes("/private"), false);
  }
});

test("status never reports an old generation's project state after the profile changes", async (t) => {
  const first = profile(), second = profile(); let current = ready(first);
  const app = await setup(t, {
    profileService: { readValidated: async () => current },
    projectPersistenceReader: async () => { current = ready(second); return "active"; },
  });
  const response = await app.inject("/api/chatgpt-desktop/status");
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), { state: "unavailable", reasonCode: "profile_unavailable" });
});

test("concurrent status requests share one bounded broker metadata query", async (t) => {
  const p = profile(), gate = deferred<unknown>(); let calls = 0;
  const app = await setup(t, {
    profileService: { readValidated: async () => ready(p) },
    projectPersistenceReader: async () => { calls++; return gate.promise; },
  });
  const requests = Array.from({ length: 8 }, () => app.inject("/api/chatgpt-desktop/status"));
  await new Promise((done) => setTimeout(done, 10));
  assert.equal(calls, 1);
  gate.resolve("unsupported");
  for (const response of await Promise.all(requests))
    assert.deepEqual(response.json().projectPersistence, { state: "unsupported" });
});

test("only the fixed nine-member manifest admits the extra project hint", async (t) => {
  const fixed = createDesktopSurfaceAssetAdapter({archiveSha256:"bb88615052255e79b5977885f9a0cc212c268589587c79d4d3b7c4b46e881a95",sharedThread:true});
  assert.equal(fixed.members.length,11);
  const p=profile(),archive=fakeArchive("fixture");
  let calls=0;
  const adapt=({body}:{body:Buffer})=>{calls++;return {body,originalSha256:createHash("sha256").update(body).digest("hex"),adaptedSha256:createHash("sha256").update(body).digest("hex")}};
  const app=await setup(t,{profileService:{readValidated:async()=>ready(p)},archiveOpener:async()=>archive,assetAdapter:{members:fixed.members,adapt}});
  const extra="webview/assets/create-project-dialog-5d973a8dd7a1.js";
  assert.equal((await app.inject(url(p,extra.replace(/^webview\//,"")))).statusCode,200);
  assert.equal(calls,1);assert.equal(archive.state.released,1);
  for(const members of [[...fixed.members,"webview/assets/extra.js"],[...fixed.members.slice(0,8),"webview/assets/unknown.js"]]){
    const invalid=Fastify();
    try {await assert.rejects(async () => { await invalid.register(registerChatGptDesktopRoutes,{assetAdapter:{members,adapt}}); await invalid.ready(); },/Invalid desktop asset adapter manifest/);}
    finally {await invalid.close();}
  }
});

test("accepts only the exact SSH discovery manifest for the shared split surface", async () => {
  const fixed = createChatGptDesktopSurfaceOptions({
    splitPane: true,
    sharedThread: true,
    sshDiscovery: true,
  }).assetAdapter;
  assert.equal(fixed.members.length, 11);

  const app = Fastify();
  try {
    await app.register(registerChatGptDesktopRoutes, { assetAdapter: fixed });
    await app.ready();
  } finally {
    await app.close();
  }

  const invalid = Fastify();
  const members = [...fixed.members];
  members[members.length - 1] = "webview/assets/unreviewed-asset.js";
  try {
    await assert.rejects(async () => {
      await invalid.register(registerChatGptDesktopRoutes, {
        assetAdapter: { ...fixed, members },
      });
      await invalid.ready();
    }, /Invalid desktop asset adapter manifest/);
  } finally {
    await invalid.close();
  }
});

test("the project hint keeps its 64 KiB limit and releases denied resource leases", async (t) => {
  const fixed=createDesktopSurfaceAssetAdapter({archiveSha256:"bb88615052255e79b5977885f9a0cc212c268589587c79d4d3b7c4b46e881a95",sharedThread:true});
  const p=profile(),member="webview/assets/create-project-dialog-5d973a8dd7a1.js";
  for (const oversized of ["source","output"]) {
    const archive=fakeArchive(oversized==="source"?"x".repeat(64*1024+1):"ok");let calls=0;
    const app=await setup(t,{profileService:{readValidated:async()=>ready(p)},archiveOpener:async()=>archive,assetAdapter:{members:fixed.members,adapt:({body}:{body:Buffer})=>{calls++;const output=Buffer.alloc(64*1024+1);return {body:output,originalSha256:createHash("sha256").update(body).digest("hex"),adaptedSha256:createHash("sha256").update(output).digest("hex")}}}});
    assert.equal((await app.inject(url(p,member.replace(/^webview\//,"")))).statusCode,503);
    assert.equal(calls,oversized==="source"?0:1);assert.equal(archive.state.released,1);
  }
});

test("adapts only the original entry document and caches with its new digest", async (t) => {
  const p = profile();
  const html =
    '<html><head><script type="module" crossorigin src="./assets/index-65a34a2d8bec.js"></script></head><body><div id="root"></div></body></html>';
  const archive = fakeArchive(html);
  const app = await setup(t, {
    profileService: { readValidated: async () => ready(p) },
    archiveOpener: async () => archive,
    entryAdapter: createBrowserDocument,
  });
  const url = `/chatgpt-desktop/${p.id}/${p.generation}/webview/index.html`;
  const result = await app.inject(url);
  assert.equal(result.statusCode, 200);
  assert.ok(result.body.includes("./__host/browser-entry.mjs"));
  assert.equal(
    result.headers["x-original-content-sha256"],
    createHash("sha256").update(html).digest("hex"),
  );
  assert.equal(
    result.headers.etag,
    '"' + createHash("sha256").update(result.body).digest("hex") + '"',
  );
  assert.equal(
    (
      await app.inject({
        url,
        headers: { "if-none-match": result.headers.etag! },
      })
    ).statusCode,
    304,
  );
  const script = await app.inject(
    `/chatgpt-desktop/${p.id}/${p.generation}/webview/assets/index-65a34a2d8bec.js`,
  );
  assert.equal(script.body, html);
  assert.equal(script.headers.etag, '"' + "a".repeat(64) + '"');
});

test("full document mode is server selected and cannot be changed by a request", async (t) => {
  const p = profile(),
    html =
      '<html><head><script type="module" crossorigin src="./assets/index-65a34a2d8bec.js"></script></head><body><div id="root"></div></body></html>',
    archive = fakeArchive(html);
  const app = await setup(t, {
    profileService: { readValidated: async () => ready(p) },
    archiveOpener: async () => archive,
    ...createChatGptDesktopSurfaceOptions(),
  });
  for (const suffix of ["", "?version=1", "?mode=legacy&version=1"]) {
    const response = await app.inject(url(p) + suffix);
    assert.equal(response.statusCode, 200);
    assert.match(response.body, /"version":2/);
    assert.doesNotMatch(response.body, /"version":1/);
  }
});

test("adapts only declared script members and uses verified adapted bytes for conditional responses", async (t) => {
  const p = profile(),
    archive = fakeArchive("original-script"),
    calls: string[] = [];
  const originalSha256 = createHash("sha256")
    .update("original-script")
    .digest("hex");
  const body = Buffer.from("adapted-script");
  const adaptedSha256 = createHash("sha256").update(body).digest("hex");
  const app = await setup(t, {
    profileService: { readValidated: async () => ready(p) },
    archiveOpener: async () => archive,
    assetAdapter: {
      members: ["webview/assets/runtime.js"],
      adapt({ member }: { member: string }) {
        calls.push(member);
        return { body, originalSha256, adaptedSha256 };
      },
    },
  });
  const target = url(p, "assets/runtime.js");
  const result = await app.inject({
    url: target,
    headers: { "if-none-match": '"' + "a".repeat(64) + '"' },
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body, "adapted-script");
  assert.equal(result.headers.etag, '"' + adaptedSha256 + '"');
  assert.equal(result.headers["x-original-content-sha256"], originalSha256);
  assert.equal(
    (
      await app.inject({
        url: target,
        headers: { "if-none-match": '"' + adaptedSha256 + '"' },
      })
    ).statusCode,
    304,
  );
  assert.equal(
    (await app.inject(url(p, "assets/other.js"))).body,
    "original-script",
  );
  assert.equal((await app.inject(url(p))).body, "original-script");
  assert.deepEqual(calls, [
    "webview/assets/runtime.js",
    "webview/assets/runtime.js",
  ]);
  assert.equal(archive.state.released, 4);
});

test("rejects oversized adapter input before conversion and invalid adapted digests without exposing original code", async (t) => {
  const p = profile();
  for (const variant of [
    "input",
    "output",
    "original-digest",
    "adapted-digest",
  ]) {
    const archive = fakeArchive(
      variant === "input" ? "x".repeat(512 * 1024 + 1) : "original-script",
    );
    let calls = 0;
    const app = await setup(t, {
      profileService: { readValidated: async () => ready(p) },
      archiveOpener: async () => archive,
      assetAdapter: {
        members: ["webview/assets/runtime.js"],
        adapt({ body: original }: { body: Buffer }) {
          calls++;
          const body = Buffer.from(
            variant === "output"
              ? "y".repeat(512 * 1024 + 1)
              : "adapted-script",
          );
          return {
            body,
            originalSha256:
              variant === "original-digest"
                ? "a".repeat(64)
                : createHash("sha256").update(original).digest("hex"),
            adaptedSha256:
              variant === "adapted-digest"
                ? "b".repeat(64)
                : createHash("sha256").update(body).digest("hex"),
          };
        },
      },
    });
    const result = await app.inject(url(p, "assets/runtime.js"));
    assert.equal(result.statusCode, 503, variant);
    assert.equal(result.headers.etag, undefined, variant);
    assert.equal(
      result.headers["x-original-content-sha256"],
      undefined,
      variant,
    );
    assert.equal(result.body.includes("original-script"), false, variant);
    assert.equal(calls, variant === "input" ? 0 : 1, variant);
    assert.equal(archive.state.released, 1, variant);
  }
});

test("bounds adapted response leases while prior replies wait and admits again after they finish", async (t) => {
  const p = profile(),
    archive = fakeArchive("original-script"),
    gate = deferred<void>(),
    admitted = deferred<void>();
  const body = Buffer.from("adapted-script");
  let waiting = 0,
    calls = 0;
  const app = Fastify();
  app.addHook("onSend", async (_request, reply, payload) => {
    if (
      reply.statusCode === 200 &&
      reply.getHeader("x-original-content-sha256")
    ) {
      if (++waiting === 8) admitted.resolve();
      await gate.promise;
    }
    return payload;
  });
  await app.register(registerChatGptDesktopRoutes, {
    profileService: { readValidated: async () => ready(p) },
    archiveOpener: async () => archive,
    ...{
      assetAdapter: {
        members: ["webview/assets/runtime.js"],
        adapt() {
          calls++;
          return {
            body,
            originalSha256: createHash("sha256")
              .update("original-script")
              .digest("hex"),
            adaptedSha256: createHash("sha256").update(body).digest("hex"),
          };
        },
      },
    },
  });
  await app.ready();
  t.after(() => app.close());
  const pending = Array.from({ length: 8 }, () =>
    app.inject(url(p, "assets/runtime.js")).then((result) => result.statusCode),
  );
  try {
    await withTimeout(
      admitted.promise,
      "adapter responses did not enter onSend",
    );
    const excess = await withTimeout(
      app.inject(url(p, "assets/runtime.js")),
      "adapter response budget did not reject",
    );
    assert.equal(excess.statusCode, 503);
    assert.equal(calls, 8);
  } finally {
    gate.resolve();
  }
  assert.deepEqual(await Promise.all(pending), Array(8).fill(200));
  assert.equal((await app.inject(url(p, "assets/runtime.js"))).statusCode, 200);
  assert.equal(calls, 9);
  assert.equal(archive.state.released, 10);
});

test("status returns only public metadata, no-store and explicit offline statuses", async (t) => {
  const first = profile();
  let current: any = {
    ...ready(first),
    status: {
      ...ready(first).status,
      pid: first.pid,
      controlSocketPath: first.controlSocketPath,
    },
    extra: "/private/secret",
  };
  const app = await setup(t, {
    profileService: { readValidated: async () => current },
  });
  let response = await app.inject({
    url: "/api/chatgpt-desktop/status?pid=1&path=/evil",
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { ...ready(first).status, projectPersistence: { state: "unknown" } });
  assert.match(response.headers["cache-control"]!, /no-store/);
  assert.equal(response.body.includes("/private"), false);
  current = { status: { state: "unconfigured", reasonCode: "not_configured" } };
  response = await app.inject("/api/chatgpt-desktop/status");
  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.json(), current.status);
  current = {
    status: {
      state: "unavailable",
      reasonCode: "process_identity_unavailable",
    },
  };
  response = await app.inject("/api/chatgpt-desktop/status");
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), current.status);
  current = { status: { state: "unavailable", reasonCode: "/private/secret" } };
  response = await app.inject("/api/chatgpt-desktop/status");
  assert.deepEqual(response.json(), {
    state: "unavailable",
    reasonCode: "profile_unavailable",
  });
  assert.equal(
    (await app.inject({ method: "POST", url: "/api/chatgpt-desktop/status" }))
      .statusCode,
    404,
  );
});

test("GET, HEAD and 304 verify the asset and release the response lease", async (t) => {
  const first = profile();
  const store = fakeArchive("<html>original</html>");
  let opens = 0;
  const app = await setup(t, {
    profileService: { readValidated: async () => ready(first) },
    archiveOpener: async ({
      asarPath,
      sha256,
    }: {
      asarPath: string;
      sha256: string;
    }) => {
      opens++;
      assert.equal(asarPath, first.macAsarPath);
      assert.equal(sha256, first.macAsarSha256);
      return store;
    },
  });
  const resource = url(first);
  let response = await app.inject(`${resource}?asarPath=/evil&pid=1`);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body, "<html>original</html>");
  assert.equal(response.headers["content-type"], "text/html; charset=utf-8");
  assert.equal(store.state.released, 1);
  response = await app.inject({ method: "HEAD", url: resource });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body, "");
  assert.equal(store.state.released, 2);
  response = await app.inject({
    url: resource,
    headers: { "if-none-match": `W/"${"a".repeat(64)}"` },
  });
  assert.equal(response.statusCode, 304);
  assert.equal(response.body, "");
  assert.equal(store.state.released, 3);
  assert.deepEqual(store.state.acquired, [
    "webview/index.html",
    "webview/index.html",
    "webview/index.html",
  ]);
  assert.equal(opens, 1);
  assert.equal(
    (await app.inject({ method: "POST", url: resource })).statusCode,
    404,
  );
});

test("rejects path traversal, ambiguous decoding and every non-webview member", async (t) => {
  const first = profile(),
    store = fakeArchive();
  const app = await setup(t, {
    profileService: { readValidated: async () => ready(first) },
    archiveOpener: async () => store,
  });
  const bad = [
    "../secret.json",
    "%2e%2e/secret.json",
    "%252e%252e/secret.json",
    "a%2fb.js",
    "a%252fb.js",
    "%5csecret",
    "a//b",
    "a/%00b",
    "a/%zz",
  ];
  for (const member of bad) {
    const response = await app.inject(url(first, member));
    assert.ok(
      [400, 404].includes(response.statusCode),
      `${member}: ${response.statusCode}`,
    );
  }
  const outside = `/chatgpt-desktop/${first.id}/${first.generation}/secret.json`;
  assert.equal((await app.inject(outside)).statusCode, 404);
  assert.equal(store.state.acquired.length, 0);
  assert.equal(
    (await app.inject(url(first, "assets/a%20b.js"))).statusCode,
    200,
  );
  assert.deepEqual(store.state.acquired, ["webview/assets/a b.js"]);
});

test("rejects raw dot segments on a real HTTP connection", async (t) => {
  const first = profile(),
    store = fakeArchive();
  const app = await setup(t, {
    profileService: { readValidated: async () => ready(first) },
    archiveOpener: async () => store,
  });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  assert.ok(address && typeof address !== "string");
  const status = await new Promise<number>((resolve, reject) => {
    const req = httpRequest(
      { host: "127.0.0.1", port: address.port, path: url(first, "a/./b") },
      (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode!));
      },
    );
    req.on("error", reject);
    req.end();
  });
  assert.equal(status, 400);
  assert.equal(store.state.acquired.length, 0);
});

test("wrong identity, missing profile and offline runtime cannot read an archive", async (t) => {
  const first = profile();
  let result: any = ready(first),
    opens = 0;
  const app = await setup(t, {
    profileService: { readValidated: async () => result },
    archiveOpener: async () => {
      opens++;
      return fakeArchive();
    },
  });
  assert.equal(
    (await app.inject(url({ ...first, id: randomUUID() }))).statusCode,
    404,
  );
  assert.equal(
    (await app.inject(url({ ...first, generation: randomUUID() }))).statusCode,
    404,
  );
  result = { status: { state: "unconfigured", reasonCode: "not_configured" } };
  assert.equal((await app.inject(url(first))).statusCode, 404);
  result = {
    status: {
      state: "unavailable",
      reasonCode: "process_identity_unavailable",
    },
  };
  assert.equal((await app.inject(url(first))).statusCode, 503);
  assert.equal(opens, 0);
});

test("onSend identity change rejects and releases a verified asset without leaking metadata", async (t) => {
  const first = profile(),
    changed = { ...first, startTicks: "9999" },
    store = fakeArchive("must-not-send");
  let reads = 0;
  const app = await setup(t, {
    profileService: {
      readValidated: async () => ready(++reads < 3 ? first : changed),
    },
    archiveOpener: async () => store,
  });
  const response = await app.inject(url(first));
  assert.equal(response.statusCode, 503);
  assert.equal(response.body.includes("must-not-send"), false);
  assert.equal(response.body.includes("/private"), false);
  assert.equal(response.headers.etag, undefined);
  assert.equal(store.state.released, 1);
});

test("onSend compares every profile identity field, including for a 304", async () => {
  const first = profile();
  const patches: Partial<ChatGptDesktopProfile>[] = [
    { id: randomUUID() },
    { generation: randomUUID() },
    { pid: first.pid + 1 },
    { startTicks: "9001" },
    { uid: first.uid + 1 },
    { macAsarPath: "/private/other.asar" },
    { macAsarSha256: "c".repeat(64) },
    { linuxAsarPath: "/private/other-linux.asar" },
    { linuxAsarSha256: "d".repeat(64) },
    { controlSocketPath: "/private/other.sock" },
    { serverSshSocketPath: "/private/bridge/server-ssh.sock" },
  ];
  for (const patch of patches) {
    const store = fakeArchive("must-not-send");
    let reads = 0;
    const app = Fastify();
    await app.register(registerChatGptDesktopRoutes, {
      profileService: {
        readValidated: async () =>
          ready(++reads < 3 ? first : { ...first, ...patch }),
      },
      archiveOpener: async () => store,
    });
    try {
      const response = await app.inject({
        url: url(first),
        headers: { "if-none-match": `"${"a".repeat(64)}"` },
      });
      assert.equal(
        response.statusCode,
        503,
        JSON.stringify(Object.keys(patch)),
      );
      assert.equal(response.headers.etag, undefined);
      assert.equal(store.state.released, 1);
    } finally {
      await app.close();
    }
  }
});

test("concurrent first opens merge and profile replacement closes the old archive", async (t) => {
  const first = profile(),
    second = profile();
  let current = first;
  const firstStore = fakeArchive("first"),
    secondStore = fakeArchive("second"),
    gate = deferred<void>();
  let opens = 0;
  const app = await setup(t, {
    profileService: { readValidated: async () => ready(current) },
    archiveOpener: async () => {
      opens++;
      if (opens === 1) {
        await gate.promise;
        return firstStore;
      }
      return secondStore;
    },
  });
  const a = app.inject(url(first)),
    b = app.inject(url(first));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(opens, 1);
  gate.resolve();
  assert.equal((await a).body, "first");
  assert.equal((await b).body, "first");
  current = second;
  assert.equal((await app.inject(url(second))).body, "second");
  assert.equal(opens, 2);
  assert.equal(firstStore.state.closed, 1);
});

test("replacement waits for the old opened archive to close", async (t) => {
  const first = profile(),
    second = profile();
  let current = first;
  const firstStore = fakeArchive("first"),
    secondStore = fakeArchive("second");
  const closing = deferred<void>(),
    finishClose = deferred<void>();
  firstStore.close = async () => {
    firstStore.state.closed++;
    closing.resolve();
    await finishClose.promise;
  };
  let opens = 0;
  const app = await setup(t, {
    profileService: { readValidated: async () => ready(current) },
    archiveOpener: async () => (++opens === 1 ? firstStore : secondStore),
  });
  assert.equal((await app.inject(url(first))).body, "first");
  current = second;
  const replacement = app.inject(url(second));
  try {
    await closing.promise;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(opens, 1);
  } finally {
    finishClose.resolve();
  }
  assert.equal((await replacement).body, "second");
  assert.equal(opens, 2);
});

test("archive close failure prevents opening a replacement and remains private", async (t) => {
  const first = profile(),
    second = profile();
  let current = first;
  const firstStore = fakeArchive("first");
  firstStore.close = async () => {
    throw new Error("private path /private/secret");
  };
  let opens = 0;
  const app = await setup(t, {
    profileService: { readValidated: async () => ready(current) },
    archiveOpener: async () => {
      opens++;
      return firstStore;
    },
  });
  assert.equal((await app.inject(url(first))).statusCode, 200);
  current = second;
  const response = await app.inject(url(second));
  assert.equal(response.statusCode, 503);
  assert.equal(response.body.includes("/private/secret"), false);
  assert.equal(opens, 1);
  assert.equal((await app.inject(url(second))).statusCode, 503);
  assert.equal(opens, 1);
  assert.equal(
    (await app.inject("/api/chatgpt-desktop/status")).json().state,
    "ready",
  );
});

test("an obsolete pending open cannot replace the current archive", async (t) => {
  const first = profile(),
    second = profile();
  let current = first;
  const firstStore = fakeArchive("first"),
    secondStore = fakeArchive("second"),
    gate = deferred<void>(),
    started = deferred<void>();
  let opens = 0;
  const app = await setup(t, {
    profileService: { readValidated: async () => ready(current) },
    archiveOpener: async ({ asarPath }: { asarPath: string }) => {
      opens++;
      if (asarPath === first.macAsarPath) {
        started.resolve();
        await gate.promise;
        return firstStore;
      }
      return secondStore;
    },
  });
  // Distinct immutable archive identities.
  second.macAsarPath = "/private/other.asar";
  const pending = app.inject(url(first));
  await started.promise;
  current = second;
  assert.equal((await app.inject(url(second))).body, "second");
  gate.resolve();
  assert.equal((await pending).statusCode, 503);
  assert.equal(firstStore.state.closed, 1);
  assert.equal((await app.inject(url(second))).body, "second");
  assert.equal(opens, 2);
});

test("client abort cancels a waiting acquisition", async (t) => {
  const first = profile(),
    waiting = deferred<void>(),
    cancelled = deferred<void>();
  const app = await setup(t, {
    profileService: { readValidated: async () => ready(first) },
    archiveOpener: async () => ({
      acquireAsset: async (
        _member: string,
        { signal }: { signal: AbortSignal },
      ) => {
        waiting.resolve();
        await new Promise<void>((_resolve, reject) =>
          signal.addEventListener(
            "abort",
            () => {
              cancelled.resolve();
              reject(new Error("cancelled"));
            },
            { once: true },
          ),
        );
        throw new Error("unreachable");
      },
      close: async () => {},
    }),
  });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  assert.ok(address && typeof address !== "string");
  const req = httpRequest({
    host: "127.0.0.1",
    port: address.port,
    path: url(first),
  });
  req.on("error", () => {});
  req.end();
  await waiting.promise;
  req.destroy();
  await withTimeout(cancelled.promise, "abort was not propagated");
});

test("client abort during onSend releases an already acquired asset", async (t) => {
  const first = profile(),
    waiting = deferred<void>(),
    released = deferred<void>(),
    gate = deferred<void>();
  let reads = 0;
  const store = fakeArchive();
  const app = await setup(t, {
    profileService: {
      readValidated: async () => {
        if (++reads === 3) {
          waiting.resolve();
          await gate.promise;
        }
        return ready(first);
      },
    },
    archiveOpener: async () => ({
      ...store,
      acquireAsset: async (member: string) => {
        const asset = await store.acquireAsset(member);
        return {
          ...asset,
          release: () => {
            asset.release();
            released.resolve();
          },
        };
      },
    }),
  });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  assert.ok(address && typeof address !== "string");
  const req = httpRequest({
    host: "127.0.0.1",
    port: address.port,
    path: url(first),
  });
  req.on("error", () => {});
  req.end();
  try {
    await waiting.promise;
    req.destroy();
    await withTimeout(released.promise, "lease was not released");
    assert.equal(store.state.released, 1);
  } finally {
    gate.resolve();
  }
});

function createAsar(entries: Record<string, string>) {
  const hash = (value: Buffer) =>
    createHash("sha256").update(value).digest("hex");
  const root: any = { files: {} };
  const bodies: Buffer[] = [];
  let offset = 0;
  for (const [name, value] of Object.entries(entries)) {
    const parts = name.split("/"),
      body = Buffer.from(value);
    let parent = root;
    for (const part of parts.slice(0, -1))
      parent = parent.files[part] ??= { files: {} };
    parent.files[parts.at(-1)!] = {
      size: body.length,
      offset: String(offset),
      integrity: { algorithm: "SHA256", hash: hash(body) },
    };
    offset += body.length;
    bodies.push(body);
  }
  const json = Buffer.from(JSON.stringify(root)),
    headerBytes = 8 + Math.ceil(json.length / 4) * 4;
  const header = Buffer.alloc(8 + headerBytes);
  [4, headerBytes, headerBytes - 4, json.length].forEach((value, i) =>
    header.writeUInt32LE(value, i * 4),
  );
  json.copy(header, 16);
  const bytes = Buffer.concat([header, ...bodies]);
  return { bytes, sha256: hash(bytes) };
}

test("real packed ASAR preserves original bytes and rejects HTTP traversal", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "chatgpt-http-asar-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const archive = createAsar({
    "webview/index.html": "<main>original</main>",
    "private.txt": "secret",
  });
  const asarPath = join(root, "app.asar");
  await writeFile(asarPath, archive.bytes);
  const first = profile({
    macAsarPath: asarPath,
    macAsarSha256: archive.sha256,
  });
  const { openWebviewArchive } =
    await import("@agent-orchestrator/chatgpt-desktop-host/assets");
  const app = await setup(t, {
    profileService: { readValidated: async () => ready(first) },
    // One response occupies the complete real reader budget: the next request
    // can complete only if the HTTP layer releases the first lease.
    archiveOpener: (options: { asarPath: string; sha256: string }) =>
      openWebviewArchive({
        ...options,
        maxInFlightBytes: Buffer.byteLength("<main>original</main>"),
        maxQueue: 1,
      }),
  });
  const response = await app.inject(url(first));
  assert.equal(response.statusCode, 200);
  assert.equal(response.body, "<main>original</main>");
  assert.equal(
    (
      await withTimeout(
        app.inject({ method: "HEAD", url: url(first) }),
        "real HEAD lease leaked",
      )
    ).statusCode,
    200,
  );
  const defaultApp = await setup(t, {
    profileService: { readValidated: async () => ready(first) },
  });
  assert.equal(
    (await defaultApp.inject(url(first))).body,
    "<main>original</main>",
  );
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  assert.ok(address && typeof address !== "string");
  const rawTraversal = await new Promise<{ status: number; body: string }>(
    (resolve, reject) => {
      const req = httpRequest(
        {
          host: "127.0.0.1",
          port: address.port,
          path: url(first, "%252e%252e/private.txt"),
        },
        (incoming) => {
          const chunks: Buffer[] = [];
          incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
          incoming.on("end", () =>
            resolve({
              status: incoming.statusCode!,
              body: Buffer.concat(chunks).toString("utf8"),
            }),
          );
        },
      );
      req.on("error", reject);
      req.end();
    },
  );
  assert.ok([400, 404].includes(rawTraversal.status));
  assert.equal(rawTraversal.body.includes("secret"), false);
  assert.equal(
    (await app.inject(url(first, "%252e%252e/private.txt"))).statusCode,
    400,
  );
  const notModified = await withTimeout(
    app.inject({
      url: url(first),
      headers: { "if-none-match": response.headers.etag! },
    }),
    "real 304 lease leaked",
  );
  assert.equal(notModified.statusCode, 304);
  const before = await stat(asarPath);
  const changed = Buffer.from(archive.bytes);
  changed[changed.length - 1] ^= 1;
  await writeFile(asarPath, changed);
  await utimes(asarPath, before.atime, new Date(before.mtimeMs + 2000));
  const tampered = await app.inject({
    url: url(first),
    headers: { "if-none-match": response.headers.etag! },
  });
  assert.equal(tampered.statusCode, 503);
  assert.equal(tampered.body.includes("<main>"), false);
});

test('private SSH endpoint stays internal in status, HTML and static asset responses',async t=>{
  const p=profile({serverSshSocketPath:'/private/native-bridge/server-ssh.sock'}),archive=fakeArchive('fixture');
  const app=await setup(t,{profileService:{readValidated:async()=>ready(p)},archiveOpener:async()=>archive,projectPersistenceReader:async()=> 'disabled'});
  for(const endpoint of ['/api/chatgpt-desktop/status',url(p),url(p,'assets/runtime.js')]){
    const response=await app.inject(endpoint);assert.equal(response.statusCode,200);assert.doesNotMatch(response.body+JSON.stringify(response.headers),/serverSshSocketPath|server-ssh\.sock|native-bridge/);
  }
});
test('a private SSH endpoint change is a same-generation identity change before an asset publishes',async t=>{
  const p=profile({serverSshSocketPath:'/private/first/server-ssh.sock'});let current=ready(p);const archive=fakeArchive('must-not-publish');
  const app=await setup(t,{profileService:{readValidated:async()=>current},archiveOpener:async()=>{current=ready({...p,serverSshSocketPath:'/private/second/server-ssh.sock'});return archive}});
  const response=await app.inject(url(p));assert.equal(response.statusCode,503);assert.doesNotMatch(response.body,/must-not-publish|serverSshSocketPath|server-ssh/);
});
