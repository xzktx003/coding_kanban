import assert from "node:assert/strict";
import test from "node:test";
import { createChatGptDesktopSurfaceOptions } from "./chatgpt-desktop-surface-config.js";

test("server pins the v2 document and exact five adapted members independently of requests", () => {
  const options = createChatGptDesktopSurfaceOptions();
  assert.deepEqual(options.assetAdapter.members, [
    "webview/assets/app-runtime-b179428fcc1e.js",
    "webview/assets/local-conversation-page-50ae20551907.js",
    "webview/assets/local-conversation-thread-2f594f841b07.js",
    "webview/assets/codex-composer-adapter-d1ca952732ea.js",
    "webview/assets/create-project-dialog-5d973a8dd7a1.js",
  ]);
  const body = Buffer.from(
    '<html><head><script type="module" crossorigin src="./assets/index-65a34a2d8bec.js"></script></head><body><div id="root"></div></body></html>',
  );
  const adapted = options.entryAdapter({
    body,
    profileId: "11111111-1111-4111-8111-111111111111",
    generation: "22222222-2222-4222-8222-222222222222",
  });
  assert.ok(adapted.body.toString().includes('"version":2'));
  assert.equal(
    options.assetAdapter.adapt({
      member: "webview/assets/unrelated.js",
      body: Buffer.from("fixture"),
    }),
    null,
  );
  assert.throws(() =>
    options.assetAdapter.adapt({
      member: options.assetAdapter.members[0]!,
      body: Buffer.from("unknown version"),
    }),
  );
});

test("only an explicit server-fixed split option selects v4 without changing the default", () => {
  const body = Buffer.from('<html><head><script type="module" crossorigin src="./assets/index-65a34a2d8bec.js"></script></head><body><div id="root"></div></body></html>');
  const binding = { body, profileId: "11111111-1111-4111-8111-111111111111", generation: "22222222-2222-4222-8222-222222222222" };
  assert.match(createChatGptDesktopSurfaceOptions().entryAdapter(binding).body.toString(), /"version":2/);
  assert.match(createChatGptDesktopSurfaceOptions({ splitPane: false }).entryAdapter(binding).body.toString(), /"version":2/);
  assert.match(createChatGptDesktopSurfaceOptions({ splitPane: true }).entryAdapter(binding).body.toString(), /"version":4/);
  const picker = "webview/assets/use-file-picker-ed94b8e7bfdc.js";
  assert.ok(createChatGptDesktopSurfaceOptions({ splitPane: true }).assetAdapter.members.includes(picker));
  assert.ok(!createChatGptDesktopSurfaceOptions().assetAdapter.members.includes(picker));
  assert.throws(() => createChatGptDesktopSurfaceOptions({ splitPane: "true" } as never));
});

test("shared documents select the exact matching asset recipe without changing defaults", () => {
  const body = Buffer.from('<html><head><script type="module" crossorigin src="./assets/index-65a34a2d8bec.js"></script></head><body><div id="root"></div></body></html>');
  const binding = { body, profileId: "11111111-1111-4111-8111-111111111111", generation: "22222222-2222-4222-8222-222222222222" };
  const sharedMembers = ["app-main-efa2926f393b.js", "initialize-app-host-services-a3479e215e83.js", "use-resume-conversation-if-needed-2ee16336bda8.js", "pending-request-item-panel-cef204561ca3.js"].map(name => "webview/assets/" + name);
  for (const [sharedThread, splitPane, version] of [[false, false, 2], [true, false, 3], [false, true, 4], [true, true, 5]] as const) {
    const surface = createChatGptDesktopSurfaceOptions({ sharedThread, splitPane });
    assert.match(surface.entryAdapter(binding).body.toString(), new RegExp(`"version":${version}`));
    for (const member of sharedMembers) assert.equal(surface.assetAdapter.members.includes(member), sharedThread, member);
    assert.equal(surface.assetAdapter.members.includes("webview/assets/use-file-picker-ed94b8e7bfdc.js"), splitPane && !sharedThread);
    assert.equal(surface.assetAdapter.members.includes("webview/assets/create-project-dialog-5d973a8dd7a1.js"), !(sharedThread && splitPane));
  }
  for (const sharedThread of [undefined, null, "true", 0, 1, {}, []])
    assert.throws(() => createChatGptDesktopSurfaceOptions({ sharedThread } as never));
});

test("shared constructor recipes serve every pinned adapted member through the fixed route allowlist", {
  skip: !process.env.CHATGPT_DESKTOP_TEST_MAC_ASAR && "Requires the explicitly supplied pinned Mac archive",
}, async () => {
  const { default: Fastify } = await import("fastify");
  const { createHash } = await import("node:crypto");
  const { registerChatGptDesktopRoutes } = await import("./chatgpt-desktop.js");
  const id = "11111111-1111-4111-8111-111111111111", generation = "22222222-2222-4222-8222-222222222222";
  const profile = { version: 1 as const, id, generation, pid: 1, startTicks: "1", uid: 1,
    macAsarPath: process.env.CHATGPT_DESKTOP_TEST_MAC_ASAR!, macAsarSha256: "bb88615052255e79b5977885f9a0cc212c268589587c79d4d3b7c4b46e881a95",
    linuxAsarPath: "/private/unused-linux.asar", linuxAsarSha256: "b".repeat(64), controlSocketPath: "/private/unused.sock" };
  const profileService = { readValidated: async () => ({ status: { state: "ready" as const, reasonCode: "identity_ready" as const, profileId: id, generation }, profile }) };
  for (const splitPane of [false, true]) {
    const surface = createChatGptDesktopSurfaceOptions({ sharedThread: true, splitPane });
    const app = Fastify();
    try {
      await app.register(registerChatGptDesktopRoutes, { profileService, ...surface });
      const prefix = `/chatgpt-desktop/${id}/${generation}/`;
      const document = await app.inject(prefix + "webview/index.html");
      assert.equal(document.statusCode, 200);
      assert.match(document.body, new RegExp(`"version":${splitPane ? 5 : 3}`));
      for (const member of surface.assetAdapter.members) {
        const response = await app.inject(prefix + member);
        assert.equal(response.statusCode, 200, member);
        assert.match(String(response.headers["x-original-content-sha256"]), /^[a-f0-9]{64}$/);
        assert.equal(response.headers.etag, '"' + createHash("sha256").update(response.rawPayload).digest("hex") + '"');
      }
      assert.equal(surface.assetAdapter.members.length, splitPane ? 10 : 11);
    } finally { await app.close(); }
  }
});

test("document and fixed host modules coexist behind the same profile binding", async (t) => {
  const { default: Fastify } = await import("fastify");
  const { default: websocket } = await import("@fastify/websocket");
  const { randomUUID } = await import("node:crypto");
  const { registerChatGptDesktopRoutes } = await import("./chatgpt-desktop.js");
  const { registerChatGptDesktopBridgeRoutes } =
    await import("./chatgpt-desktop-bridge.js");
  const app = Fastify(),
    id = randomUUID(),
    generation = randomUUID();
  await app.register(websocket);
  const profile = {
    version: 1 as const,
    id,
    generation,
    pid: 1,
    startTicks: "1",
    uid: 1,
    macAsarPath: "/private/mac.asar",
    macAsarSha256: "a".repeat(64),
    linuxAsarPath: "/private/linux.asar",
    linuxAsarSha256: "b".repeat(64),
    controlSocketPath: "/private/control.sock",
  };
  const profileService = {
    readValidated: async () => ({
      status: {
        state: "ready" as const,
        reasonCode: "identity_ready" as const,
        profileId: id,
        generation,
      },
      profile,
    }),
  };
  const html =
    '<html><head><script type="module" crossorigin src="./assets/index-65a34a2d8bec.js"></script></head><body><div id="root"></div></body></html>';
  const archiveOpener = async () => ({
    async acquireAsset() {
      return {
        body: Buffer.from(html),
        contentType: "text/html; charset=utf-8",
        etag: '"' + "a".repeat(64) + '"',
        release() {},
      };
    },
    async close() {},
  });
  await app.register(registerChatGptDesktopRoutes, {
    profileService,
    archiveOpener,
    ...createChatGptDesktopSurfaceOptions(),
  });
  await app.register(registerChatGptDesktopBridgeRoutes, { profileService });
  await app.ready();
  t.after(() => app.close());
  const prefix = `/chatgpt-desktop/${id}/${generation}/webview/`;
  const doc = await app.inject(prefix + "index.html");
  assert.equal(doc.statusCode, 200);
  assert.match(doc.body, /"version":2/);
  const untrustedOption = await app.inject(prefix + "index.html?splitPane=true");
  assert.equal(untrustedOption.statusCode, 200);
  assert.match(untrustedOption.body, /"version":2/);
  const sidecars = [
    "browser-entry.mjs",
    "browser-bridge.mjs",
    "wire-value.mjs",
    "surface-host-bridge.mjs",
    "surface-activation.mjs",
    "browser-surface-controller.mjs",
    "browser-image-file-picker.mjs",
    "browser-project-folder-picker.mjs",
    "browser-isolated-pane-navigation.mjs",
    "browser-shared-thread-navigation.mjs",
    "browser-shared-thread-submission.mjs",
    "browser-shared-project-selection.mjs",
    "browser-shared-catalog.mjs",
    "browser-shared-thread-directory.mjs",
    "browser-sidebar-navigation-probe.mjs",
    "browser-react-root-probe.mjs",
    "browser-context-menu.mjs",
    "browser-rich-editor.mjs",
    "browser-composer-capability-entry.mjs",
    "browser-composer-capability.mjs",
    "desktop-selected-pane-browser.mjs",
    "desktop-selected-pane-core.mjs",
    "desktop-split-pane-core.mjs",
    "desktop-split-pane-browser.mjs",
    "desktop-home-registrar.mjs",
    "desktop-layout-browser.mjs",
    "desktop-layout-core.mjs",
    "desktop-pane-layout.mjs",
  ];
  const bodies = new Map<string, string>();
  for (const name of sidecars) {
    const response = await app.inject(prefix + "__host/" + name);
    assert.equal(response.statusCode, 200, name);
    assert.match(response.headers["content-type"] ?? "", /javascript/);
    bodies.set(name, response.body);
  }
  for (const [name, body] of bodies) {
    const imports = body.matchAll(
      /(?:\bfrom\s*|\bimport\s*\(\s*)["']\.\/([a-z0-9-]+\.mjs)["']/g,
    );
    for (const match of imports) {
      assert.ok(
        bodies.has(match[1]!),
        `${name} imports missing sidecar ${match[1]}`,
      );
    }
  }
});
