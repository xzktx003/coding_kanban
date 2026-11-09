import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import original from "./vite.config.ts";
import candidate from "./vite.chatgpt-candidate.config.mjs";

// Vite supplies the config directory when bundling this TS config.
// The direct-factory fixture supplies the same directory without a listener.
globalThis.__dirname = fileURLToPath(new URL(".", import.meta.url));

const keys = ["^/__chatgpt-candidate-login(?:\\?|$)", "^/api/chatgpt-desktop(?:/|$)", "^/chatgpt-desktop(?:/|$)"];
async function withConfig(port, callback, { https = true } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "chatgpt-main-proxy-test-"));
  const values = { WEB_HOST: "0.0.0.0", WEB_PORT: "49121", WEB_BACKEND_HOST: "localhost", WEB_BACKEND_PORT: "49122", VITE_DEV_HTTPS: https ? "1" : "0", VITE_DEV_HTTPS_CERT: join(directory, "cert.pem"), VITE_DEV_HTTPS_KEY: join(directory, "key.pem"), VITE_DEV_HTTPS_CA_CERT: undefined, CHATGPT_DESKTOP_CANDIDATE_PORT: port };
  const previous = new Map(Object.keys(values).map(key => [key, process.env[key]]));
  await writeFile(values.VITE_DEV_HTTPS_CERT, "fixture-public-cert");
  await writeFile(values.VITE_DEV_HTTPS_KEY, "fixture-non-secret-key");
  try {
    for (const [key, value] of Object.entries(values)) value === undefined ? delete process.env[key] : process.env[key] = value;
    return await callback();
  } finally {
    for (const [key, value] of previous) value === undefined ? delete process.env[key] : process.env[key] = value;
    await rm(directory, { recursive: true, force: true });
  }
}
const environment = { command: "serve", mode: "chatgpt-main-proxy-fixture" };
const pluginNames = config => config.plugins.flat(Infinity).filter(Boolean).map(plugin => plugin.name);

test("main default and empty setting retain ordinary backend and continuity/fallback plugins", async () => {
  for (const port of [undefined, ""]) await withConfig(port, async () => {
    const config = await original(environment);
    assert.ok(keys.every(key => !Object.hasOwn(config.server.proxy, key)));
    assert.equal(config.server.proxy["/api"].target, "http://localhost:49122");
    assert.ok(pluginNames(config).includes("http-fallback"));
    assert.ok(pluginNames(config).includes("workbench-document-continuity"));
    assert.equal(config.server.strictPort, undefined);
  });
});

test("main opt-in adds only three priority namespaces and keeps server/plugins intact", async () => {
  const baseline = await withConfig(undefined, () => original(environment));
  await withConfig("49123", async () => {
    const config = await original(environment), entries = Object.entries(config.server.proxy);
    assert.deepEqual(entries.slice(0, 3).map(([key]) => key), keys);
    assert.deepEqual(Object.keys(config.server.proxy).slice(3), Object.keys(baseline.server.proxy));
    for (const [, route] of entries.slice(0, 3)) assert.equal(route.target, "http://127.0.0.1:49123");
    assert.equal(entries[0][1].ws, false);
    for (const [, route] of entries.slice(1, 3)) assert.equal(route.ws, true);
    for (const [key, route] of Object.entries(baseline.server.proxy)) assert.deepEqual(config.server.proxy[key], route);
    assert.deepEqual({ ...config.server, proxy: undefined }, { ...baseline.server, proxy: undefined });
    assert.deepEqual(pluginNames(config), pluginNames(baseline));
    assert.ok(pluginNames(config).includes("http-fallback"));
    assert.ok(pluginNames(config).includes("workbench-document-continuity"));
    const [login, api, resource] = keys.map(key => new RegExp(key));
    for (const path of ["/api/sessions", "/ws", "/chatgpt-desktop-other", "/api/chatgpt-desktop-other", "/__chatgpt-candidate-login-other"]) assert.equal(login.test(path) || api.test(path) || resource.test(path), false);
  });
});

test("main opt-in rejects invalid ports and insecure transport; production config stays untouched", async () => {
  for (const port of ["0", "65536", "0044", "1.5", "49123 ", "http://localhost:49123", "49123;echo bad"]) await withConfig(port, async () => {
    await assert.rejects(async () => original(environment), /Invalid ChatGPT candidate/);
  });
  await withConfig("49123", async () => { await assert.rejects(async () => original(environment), /Invalid ChatGPT candidate/); }, { https: false });
  await withConfig("49123", async () => {
    const config = await original({ ...environment, command: "build" });
    assert.ok(keys.every(key => !Object.hasOwn(config.server.proxy, key)));
  });
});

test("explicit candidate wrapper remains compatible with main opt-in and keeps its own strict policy", async () => {
  await withConfig("49123", async () => {
    const config = await candidate(environment);
    assert.deepEqual(Object.keys(config.server.proxy).slice(0, 3), keys);
    assert.equal(config.server.strictPort, true);
    assert.ok(!pluginNames(config).includes("http-fallback"));
    assert.ok(pluginNames(config).includes("workbench-document-continuity"));
    assert.equal(config.server.proxy["/api"].target, "http://localhost:49122");
  });
});
