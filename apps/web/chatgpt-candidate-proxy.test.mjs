import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as candidateProxy from "./chatgpt-candidate-proxy.mjs";
const { configureChatGptCandidate } = candidateProxy;

test("the candidate routes use only the fixed loopback backend and precede the existing proxy", () => {
  const original = { target: "http://127.0.0.1:4000", ws: true };
  const config = configureChatGptCandidate({
    plugins: [{ name: "react" }, { name: "http-fallback" }],
    server: { https: { cert: "test", key: "test" }, proxy: { "/api": original, "/ws": original } },
  }, 49120);
  const entries = Object.entries(config.server.proxy);
  assert.deepEqual(entries.map(([key]) => key), ["^/__chatgpt-candidate-login(?:\\?|$)", "^/api/chatgpt-desktop(?:/|$)", "^/chatgpt-desktop(?:/|$)", "/api", "/ws"]);
  for (const [, proxy] of entries.slice(1, 3)) {
    assert.deepEqual(proxy, { target: "http://127.0.0.1:49120", changeOrigin: false, xfwd: true, ws: true });
  }
  assert.equal(entries[0][1].ws, false);
  assert.equal(entries[3][1], original);
  assert.equal(entries[4][1], original);
  assert.deepEqual(config.plugins.map((item) => item.name), ["react"]);
  assert.equal(config.server.host, "0.0.0.0");
  assert.equal(config.server.strictPort, true);
});

test("HTTPS and a fixed valid port are required, and candidate routes cannot be overridden", () => {
  const https = { server: { https: { cert: "test", key: "test" }, proxy: {} } };
  for (const value of [0, -1, 65536, "49120", "http://127.0.0.1:49120", NaN]) {
    assert.throws(() => configureChatGptCandidate(https, value));
  }
  assert.throws(() => configureChatGptCandidate({ server: { proxy: {} } }, 49120));
  assert.throws(() => configureChatGptCandidate({ server: { https: {}, proxy: { "^/chatgpt-desktop(?:/|$)": {} } } }, 49120));
});

test("only the two exact fourth-mode namespaces select the candidate", () => {
  const config = configureChatGptCandidate({ server: { https: {}, proxy: { "/api": {} } } }, 49120);
  const [api, resource] = Object.keys(config.server.proxy).slice(1, 3).map((key) => new RegExp(key));
  assert.equal(api.test("/api/chatgpt-desktop/status"), true);
  assert.equal(resource.test("/chatgpt-desktop/profile/generation/bridge"), true);
  for (const path of ["/api/chatgpt-desktop-other", "/chatgpt-desktop-other", "/api/sessions", "/ws"]) {
    assert.equal(api.test(path) || resource.test(path), false);
  }
});

test("real Vite can initialize the fixed proxy configuration", () => {
  // Isolate Vite's watcher in a child so failed initialization cannot hang the suite.
  const script = `import { createServer } from 'vite';
import { configureChatGptCandidate } from './chatgpt-candidate-proxy.mjs';
try {
  const base = { configFile: false, logLevel: 'silent', server: { https: {}, proxy: {}, middlewareMode: true } };
  const app = await createServer(configureChatGptCandidate(base, 49120));
  await app.close();
  process.exit(0);
} catch (error) { process.stderr.write(String(error)); process.exit(1); }`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: fileURLToPath(new URL(".", import.meta.url)), encoding: "utf8", timeout: 10000,
  });
  assert.equal(result.status, 0, result.stderr);
});


test('only the exact login path is proxied to the candidate',()=>{
  const config=configureChatGptCandidate({server:{https:{},proxy:{}}},49120);
  const key='^/__chatgpt-candidate-login(?:\\?|$)',login=config.server.proxy[key],pattern=new RegExp(key);
  assert.ok(login);assert.equal(login.target,'http://127.0.0.1:49120');assert.equal(login.ws,false);
  assert.ok(pattern.test('/__chatgpt-candidate-login'));
  assert.ok(pattern.test('/__chatgpt-candidate-login?bad=1'));
  assert.ok(!pattern.test('/__chatgpt-candidate-login-extra'));
  assert.throws(()=>configureChatGptCandidate({server:{https:{},proxy:{[key]:{}}}},49120));
});

const oldProfile = "abcdefab-1111-4111-8111-111111111111";
const oldGeneration = "22222222-2222-4222-8222-222222222222";
const oldTuple = () => ({ profileId: oldProfile, generation: oldGeneration, loopbackPort: 49124 });
const candidateBase = () => ({
  plugins: [{ name: "react" }, { name: "workbench-document-continuity" }],
  server: { https: {}, proxy: { "/api": { target: "http://127.0.0.1:4000" } } },
});
const routeFor = (config, path) => Object.entries(config.server.proxy).find(([context]) =>
  context.startsWith("^") ? new RegExp(context).test(path) : path.startsWith(context))?.[1];

test("fixed legacy profile and generation routes precede primary HTTP and WSS namespaces", () => {
  const config = configureChatGptCandidate(candidateBase(), 49123, [oldTuple()]);
  for (const prefix of ["/api/chatgpt-desktop", "/chatgpt-desktop"]) {
    for (const suffix of ["", "?port=1&target=http://example.invalid", "/webview/index.html", "/bridge?target=other"]) {
      const route = routeFor(config, `${prefix}/${oldProfile}/${oldGeneration}${suffix}`);
      assert.equal(route.target, "http://127.0.0.1:49124");
      assert.equal(route.ws, true);
      assert.equal(route.changeOrigin, false);
      assert.equal(route.xfwd, true);
      assert.equal(route.rewrite, undefined);
      assert.equal(route.router, undefined);
    }
    for (const path of [
      `${prefix}/${oldProfile}/${oldGeneration}-other/bridge`,
      `${prefix}/${oldProfile}/33333333-3333-4333-8333-333333333333/bridge`,
      `${prefix}/33333333-3333-4333-8333-333333333333/${oldGeneration}/bridge`,
      `${prefix}/${oldProfile.toUpperCase()}/${oldGeneration}/bridge`,
      `${prefix}/status?profileId=${oldProfile}&generation=${oldGeneration}&port=49124`,
    ]) assert.equal(routeFor(config, path).target, "http://127.0.0.1:49123");
  }
  assert.equal(routeFor(config, "/__chatgpt-candidate-login?port=49124").target, "http://127.0.0.1:49123");
  assert.equal(routeFor(config, "/api/sessions").target, "http://127.0.0.1:4000");
  assert.deepEqual(config.plugins.map(p => p.name), ["react", "workbench-document-continuity"]);
});

test("private legacy JSON is bounded, strictly validated and independent of later input mutations", () => {
  assert.equal(typeof candidateProxy.parseChatGptCandidateLegacyRoutes, "function");
  const parse = candidateProxy.parseChatGptCandidateLegacyRoutes;
  for (const raw of [undefined, "", "[]"]) assert.deepEqual(parse(raw), []);
  const parsed = parse(JSON.stringify([oldTuple()]));
  assert.ok(Object.isFrozen(parsed)); assert.ok(Object.isFrozen(parsed[0]));
  assert.deepEqual(parsed, [oldTuple()]);
  const input = [oldTuple()], config = configureChatGptCandidate(candidateBase(), 49123, input);
  input[0].loopbackPort = 49125; input.push({ ...oldTuple(), generation: "44444444-4444-4444-8444-444444444444" });
  assert.equal(routeFor(config, `/chatgpt-desktop/${oldProfile}/${oldGeneration}/bridge`).target, "http://127.0.0.1:49124");
});

test("legacy mappings reject malformed, excessive, ambiguous and conflicting server configuration", () => {
  assert.equal(typeof candidateProxy.parseChatGptCandidateLegacyRoutes, "function");
  const parse = candidateProxy.parseChatGptCandidateLegacyRoutes;
  for (const value of [" ", "null", "{}", "true", "[", " ".repeat(4097), JSON.stringify([oldTuple(), oldTuple()]),
    JSON.stringify(Array.from({ length: 5 }, (_, i) => ({ ...oldTuple(), generation: `${String(i).repeat(8)}-2222-4222-8222-222222222222` })))]) {
    assert.throws(() => parse(value), /Invalid ChatGPT candidate legacy/);
  }
  for (const tuple of [null, [], { ...oldTuple(), port: 1 }, { ...oldTuple(), profileId: oldProfile + "/../status" },
    { ...oldTuple(), generation: oldGeneration + "?target=x" }, { ...oldTuple(), profileId: "not-a-uuid" },
    { ...oldTuple(), loopbackPort: "49124" }, { ...oldTuple(), loopbackPort: 0 }, { ...oldTuple(), loopbackPort: 65536 },
    { ...oldTuple(), loopbackPort: NaN }, { ...oldTuple(), loopbackPort: 1.5 },
    Object.defineProperty({ ...oldTuple() }, "loopbackPort", { get() { throw Error("MUST_NOT_READ_GETTER"); }, enumerable: true })]) {
    assert.throws(() => configureChatGptCandidate(candidateBase(), 49123, [tuple]), /Invalid ChatGPT candidate legacy/);
  }
  assert.throws(() => configureChatGptCandidate(candidateBase(), 49123, [{ ...oldTuple(), loopbackPort: 49123 }]), /Invalid ChatGPT candidate legacy/);
  assert.throws(() => configureChatGptCandidate(candidateBase(), 49123, [oldTuple(), { ...oldTuple(), loopbackPort: 49125 }]), /Invalid ChatGPT candidate legacy/);
  const base = candidateBase(), key = `^/chatgpt-desktop/${oldProfile}/${oldGeneration}(?:/|\\?|$)`;
  base.server.proxy[key] = { target: "http://127.0.0.1:49125" };
  assert.throws(() => configureChatGptCandidate(base, 49123, [oldTuple()]), /already configured/);
});


test("main and explicit Vite factories preserve exact legacy priority and document continuity", () => {
  const script = `
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import original from './vite.config.ts';
import standalone from './vite.chatgpt-candidate.config.mjs';
globalThis.__dirname = fileURLToPath(new URL('.', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'chatgpt-legacy-config-'));
try {
  writeFileSync(join(dir, 'cert.pem'), 'fixture-public-cert');
  writeFileSync(join(dir, 'key.pem'), 'fixture-non-secret-key');
  Object.assign(process.env, {
    WEB_HOST:'0.0.0.0', WEB_PORT:'49121', WEB_BACKEND_HOST:'localhost', WEB_BACKEND_PORT:'49122',
    VITE_DEV_HTTPS:'1', VITE_DEV_HTTPS_CERT:join(dir,'cert.pem'), VITE_DEV_HTTPS_KEY:join(dir,'key.pem'),
    VITE_DEV_HTTPS_CA_CERT:'', CHATGPT_DESKTOP_CANDIDATE_PORT:'49123', CHATGPT_DESKTOP_CANDIDATE_LEGACY_ROUTES:''
  });
  const environment = {command:'serve', mode:'chatgpt-legacy-config-fixture'};
  const baseline = await original(environment);
  const pluginNames = config => config.plugins.flat(Infinity).filter(Boolean).map(plugin=>plugin.name);
  const tuple = ${JSON.stringify(oldTuple())};
  process.env.CHATGPT_DESKTOP_CANDIDATE_LEGACY_ROUTES = JSON.stringify([tuple]);
  for (const factory of [original, standalone]) {
    const config = await factory(environment);
    const first = Object.entries(config.server.proxy).slice(0,2);
    for (const [context, route] of first) {
      assert.ok(new RegExp(context).test((context.includes('/api/')?'/api':'')+'/chatgpt-desktop/'+tuple.profileId+'/'+tuple.generation+'/bridge'));
      assert.equal(route.target, 'http://127.0.0.1:49124'); assert.equal(route.ws,true);
    }
    assert.ok(Object.keys(config.server.proxy)[2].startsWith('^/__chatgpt-candidate-login'));
    assert.ok(pluginNames(config).includes('workbench-document-continuity'));
    assert.equal(config.server.host,'0.0.0.0');
    assert.equal(config.server.proxy['/api'].target,'http://localhost:49122');
  }
  const main = await original(environment);
  assert.deepEqual({...main.server,proxy:undefined},{...baseline.server,proxy:undefined});
  assert.deepEqual(pluginNames(main),pluginNames(baseline));
  process.env.CHATGPT_DESKTOP_CANDIDATE_LEGACY_ROUTES = '[invalid]';
  await assert.rejects(async()=>original(environment), /Invalid ChatGPT candidate legacy/);
  const build = await original({...environment,command:'build'});
  assert.equal(Object.hasOwn(build.server.proxy,'^/chatgpt-desktop(?:/|$)'),false);
  process.env.CHATGPT_DESKTOP_CANDIDATE_LEGACY_ROUTES = JSON.stringify([tuple]);
  process.env.CHATGPT_DESKTOP_CANDIDATE_PORT = '';
  await assert.rejects(async()=>original(environment), /require a primary candidate port/);
} finally { rmSync(dir,{recursive:true,force:true}); }
`;
  const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
    cwd: fileURLToPath(new URL(".", import.meta.url)), encoding: "utf8", timeout: 10000,
  });
  assert.equal(result.status, 0, result.stderr);
});
