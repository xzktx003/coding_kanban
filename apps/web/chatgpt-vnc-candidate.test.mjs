import test from "node:test";
import assert from "node:assert/strict";
import {
  configureVncCandidate,
  readOwnedVncToken,
} from "./chatgpt-vnc-candidate.mjs";
const cfg = {
  origin: "https://fixture.example:8443",
  port: 8443,
  target: "http://127.0.0.1:20123",
  token: "fixture_private_token_00000000000000000000",
};
const prefix = "/chatgpt-remote-desktop";
const make = () =>
  configureVncCandidate(
    {
      plugins: [{ name: "http-fallback" }, { name: "keep" }],
      server: { proxy: { "/api": "http://127.0.0.1:12345" } },
    },
    cfg,
  );
function harness() {
  const config = make(),
    middleware = [],
    upgrades = [];
  const server = {
    middlewares: {
      use(fn) {
        middleware.push(fn);
      },
    },
    httpServer: {
      prependListener(name, fn) {
        upgrades.push(fn);
      },
    },
  };
  for (const p of config.plugins) p.configureServer?.(server);
  return { config, middleware, upgrades };
}
test("fixed TLS origin, upstream, token and independent port are required", () => {
  for (const bad of [
    { ...cfg, origin: "http://fixture.example:8443" },
    { ...cfg, target: "http://192.0.2.1:20123" },
    { ...cfg, token: "bad\r\nheader" },
    { ...cfg, port: 0 },
  ])
    assert.throws(
      () => configureVncCandidate({ plugins: [], server: {} }, bad),
      /Invalid remote desktop configuration/,
    );
});
test("keeps existing API proxy and removes adjacent HTTP fallback without carrying token to the browser", () => {
  const c = make();
  assert.equal(c.server.host, "0.0.0.0");
  assert.equal(c.server.port, 8443);
  assert.equal(c.server.strictPort, true);
  assert.deepEqual(
    c.plugins.filter((p) => p.name === "http-fallback"),
    [],
  );
  assert.equal(c.server.proxy["/api"], "http://127.0.0.1:12345");
  const p = c.server.proxy[prefix];
  assert.equal(p.target, cfg.target);
  assert.equal(p.headers["X-CG-GUI-Broker-Token"], cfg.token);
  assert.equal(p.rewrite(prefix + "/vnc.html"), "/vnc/vnc.html");
  assert.equal(p.rewrite(prefix + "/websockify"), "/vnc/websockify");
});
test("HTTP static paths cannot choose another host, socket or credentials and incoming broker tokens are replaced", () => {
  const { middleware } = harness();
  const run = (url, headers = {}, method = "GET") => {
    let passed = false,
      status = null;
    const req = {
      url,
      method,
      headers: { host: "fixture.example:8443", ...headers },
    };
    const res = {
      set statusCode(v) {
        status = v;
      },
      end() {},
    };
    middleware[0](req, res, () => {
      passed = true;
    });
    return { passed, status, req };
  };
  assert.equal(
    run(
      prefix +
        "/vnc.html?autoconnect=true&resize=off&path=chatgpt-remote-desktop%2Fwebsockify",
    ).passed,
    true,
  );
  for (const url of [
    prefix +
      "/vnc.html?autoconnect=true&resize=off&quality=9&compression=0&path=chatgpt-remote-desktop%2Fwebsockify",
    prefix +
      "/vnc.html?autoconnect=true&resize=off&logging=warn&path=chatgpt-remote-desktop%2Fwebsockify",
    prefix + "/vnc.html?password=secret",
    prefix + "/vnc.html?host=other",
    prefix + "/%2e%2e/secret",
    prefix + "/websockify",
  ])
    assert.equal(run(url).passed, false);
  assert.equal(
    run(prefix + "/app/ui.js", { origin: "https://evil.example" }).status,
    403,
  );
  assert.equal(
    run(prefix + "/app/ui.js", { host: "other.example" }).status,
    403,
  );
  assert.equal(run(prefix + "/app/ui.js", {}, "POST").status, 403);
  assert.equal(
    run(prefix + "/app/ui.js", { "x-cg-gui-broker-token": "attacker" }).req
      .headers["x-cg-gui-broker-token"],
    undefined,
  );
});
test("real HTTP/2 authority agrees with Host and rejects conflicts or the wrong target", () => {
  const { middleware, upgrades } = harness();
  const runHttp = (headers) => {
    let passed = false,
      status = null;
    const req = {
      url: prefix + "/app/ui.js",
      method: "GET",
      httpVersion: "2.0",
      headers,
    };
    const res = {
      set statusCode(v) {
        status = v;
      },
      end() {},
    };
    middleware[0](req, res, () => {
      passed = true;
    });
    return { passed, status };
  };
  const runWs = (headers, url = prefix + "/websockify") => {
    let destroyed = 0;
    const req = { url, method: "GET", httpVersion: "2.0", headers },
      socket = {
        write() {},
        destroy() {
          destroyed++;
        },
      };
    upgrades[0](req, socket);
    return destroyed;
  };
  const good = {
    ":authority": "fixture.example:8443",
    host: "fixture.example:8443",
    origin: cfg.origin,
  };
  assert.equal(runHttp(good).passed, true);
  assert.equal(runHttp({ ":authority": "fixture.example:8443" }).passed, true);
  assert.equal(
    runHttp({ ":authority": "evil.example:8443", host: "fixture.example:8443" })
      .status,
    403,
  );
  assert.equal(
    runHttp({ ":authority": "fixture.example", host: "fixture.example:8443" })
      .status,
    403,
  );
  assert.equal(runWs(good), 0);
  assert.equal(
    runWs({
      ":authority": "evil.example:8443",
      host: "fixture.example:8443",
      origin: cfg.origin,
    }),
    1,
  );
  assert.equal(
    runWs(
      { ":authority": "fixture.example:8443", origin: cfg.origin },
      prefix + "/websockify?target=other",
    ),
    1,
  );
});
test("WebSocket requires exact path and same origin while VNC authentication remains separate", () => {
  const { upgrades } = harness();
  const run = (url, origin) => {
    let destroyed = 0;
    const req = {
        url,
        method: "GET",
        headers: {
          host: "fixture.example:8443",
          origin,
          "x-cg-gui-broker-token": "attacker",
        },
      },
      socket = {
        write() {},
        destroy() {
          destroyed++;
        },
      };
    upgrades[0](req, socket);
    return { destroyed, req };
  };
  for (const origin of [undefined, "https://evil.example"])
    assert.equal(run(prefix + "/websockify", origin).destroyed, 1);
  assert.equal(
    run(prefix + "/websockify?target=other", cfg.origin).destroyed,
    1,
  );
  const ok = run(prefix + "/websockify", cfg.origin);
  assert.equal(ok.destroyed, 0);
  assert.equal(ok.req.headers["x-cg-gui-broker-token"], undefined);
});

import {
  mkdtempSync,
  writeFileSync,
  chmodSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
test("reads only an owned single-link 0600 broker token", () => {
  const dir = mkdtempSync(join(tmpdir(), "vnc-token-"));
  try {
    const file = join(dir, "token");
    writeFileSync(file, "fixture_private_token_00000000000000000000\n", {
      mode: 0o600,
    });
    assert.equal(
      readOwnedVncToken(file),
      "fixture_private_token_00000000000000000000",
    );
    chmodSync(file, 0o640);
    assert.throws(
      () => readOwnedVncToken(file),
      /Invalid remote desktop configuration/,
    );
    const link = join(dir, "link");
    symlinkSync(file, link);
    assert.throws(
      () => readOwnedVncToken(link),
      /Invalid remote desktop configuration/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

import { nativeDesktopEntryPlugin } from "./chatgpt-vnc-candidate.mjs";
import { fileURLToPath } from "node:url";
test("the opt-in entry replaces only the workbench fourth-mode import", () => {
  const p = nativeDesktopEntryPlugin(),
    owner = fileURLToPath(
      new URL("./src/components/WorkbenchShell.tsx", import.meta.url),
    ),
    target = fileURLToPath(
      new URL(
        "./src/chatgpt-mode/ChatgptNativeDesktopApp.tsx",
        import.meta.url,
      ),
    );
  assert.equal(p.enforce, "pre");
  assert.equal(p.resolveId("../chatgpt-mode/ChatgptModeApp", owner), target);
  assert.equal(
    p.resolveId("../chatgpt-mode/ChatgptModeApp", owner + "?v=fixture"),
    target,
  );
  for (const [source, importer] of [
    ["./ChatgptModeApp", owner],
    [
      "../chatgpt-mode/ChatgptModeApp",
      owner.replace("WorkbenchShell.tsx", "Other.tsx"),
    ],
    ["../session-mode/App", owner],
    ["../chatgpt-mode/ChatgptModeApp", undefined],
  ])
    assert.equal(p.resolveId(source, importer), null);
});

test("Vite resolves the opt-in workbench import without opening a listener", async () => {
  const { createServer } = await import("vite");
  const server = await createServer({
    configFile: false,
    root: fileURLToPath(new URL("./", import.meta.url)),
    plugins: [nativeDesktopEntryPlugin()],
    server: { middlewareMode: true, watch: null, hmr: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: "silent",
  });
  try {
    const importer = fileURLToPath(
      new URL("./src/components/WorkbenchShell.tsx", import.meta.url),
    );
    const result = await server.pluginContainer.resolveId(
      "../chatgpt-mode/ChatgptModeApp",
      importer,
    );
    assert.equal(
      result.id,
      fileURLToPath(
        new URL(
          "./src/chatgpt-mode/ChatgptNativeDesktopApp.tsx",
          import.meta.url,
        ),
      ),
    );
    const direct = await server.pluginContainer.resolveId(
      "./ChatgptModeApp",
      fileURLToPath(
        new URL("./src/chatgpt-mode/ChatgptModeApp.test.tsx", import.meta.url),
      ),
    );
    assert.equal(
      direct.id,
      fileURLToPath(
        new URL("./src/chatgpt-mode/ChatgptModeApp.tsx", import.meta.url),
      ),
    );
    assert.equal(server.httpServer, null);
  } finally {
    await server.close();
  }
});
