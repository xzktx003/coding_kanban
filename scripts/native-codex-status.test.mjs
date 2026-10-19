import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdtempSync,
  mkdirSync,
  cpSync,
  writeFileSync,
  readFileSync,
  chmodSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  nativeCodexStatus,
  printNativeCodexStatus,
} from "./native-codex-status.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "codex-status-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, "packages/native-codex-host/companion");
  mkdirSync(source, { recursive: true });
  const manifest = {
    publisher: "fixture",
    name: "companion",
    version: "0.1.0",
  };
  writeFileSync(join(source, "package.json"), JSON.stringify(manifest));
  for (const name of ["extension.cjs", "control.cjs", "appserver-send.cjs"])
    writeFileSync(join(source, name), `// ${name}\n`);
  const extensionsDir = join(root, "extensions");
  const installed = join(extensionsDir, "fixture.companion-0.1.0");
  cpSync(source, installed, { recursive: true });
  writeFileSync(
    join(installed, "package.json"),
    JSON.stringify(
      { ...manifest, __metadata: { installedTimestamp: 1 } },
      null,
      2,
    ),
  );
  const recordPath = join(root, "record.json"),
    authPath = join(root, "auth.json");
  const record = {
    protocol: "http",
    port: 45678,
    brokerPort: 45679,
    brokerAuthFile: authPath,
    extensionsDir,
    projectDir: root,
    newChatWindowIds: ["00000000-0000-4000-8000-000000000002"],
  };
  writeFileSync(recordPath, JSON.stringify(record), { mode: 0o600 });
  const secret = "a".repeat(64);
  writeFileSync(
    authPath,
    JSON.stringify({ port: record.brokerPort, token: secret }),
    { mode: 0o600 },
  );
  const env = {
    NATIVE_CODEX_UPSTREAM_URL: "http://127.0.0.1:45678",
    NATIVE_CODEX_RUNTIME_RECORD: recordPath,
    PORT: "45677",
  };
  const requests = [];
  let broker = {
    companionActive: true,
    officialActive: true,
    broker: { enabled: true },
    instanceBroker: {
      enabled: true,
      instanceId: "00000000-0000-4000-8000-000000000001",
    },
    sendAvailable: false,
  };
  const fetcher = async (url, options) => {
    url = String(url);
    requests.push({ url, options });
    if (url === "http://127.0.0.1:45678/healthz") return new Response("OK");
    if (url === "http://127.0.0.1:45677/api/native-codex/status")
      return Response.json({
        available: true,
        resumeAvailable: true,
        sendAvailable: false,
        iframeUrl: `/native-codex/?folder=${encodeURIComponent(root)}`,
        newChatWindowIds: record.newChatWindowIds,
      });
    assert.equal(url, "http://127.0.0.1:45679/status");
    assert.equal(options.headers.authorization, `Bearer ${secret}`);
    return Response.json(broker);
  };
  return {
    root,
    env,
    fetcher,
    installed,
    record,
    recordPath,
    authPath,
    secret,
    requests,
    setBroker(value) {
      broker = value;
    },
  };
}

test("matching installed companion ignores installer metadata and distinguishes broker readiness from chat", async (t) => {
  const f = fixture(t);
  const result = await nativeCodexStatus(f);
  assert.equal(result.state, "broker-ready");
  assert.equal(result.companion, "current");
  assert.equal(result.sendAvailable, false);
  assert.equal(result.gateway, "available");
  assert.equal(f.requests.length, 3);
  for (const { options } of f.requests) assert.equal(options.method, "GET");
  const lines = [];
  printNativeCodexStatus(result, (line) => lines.push(line));
  assert.match(lines.join("\n"), /不代表.*对话/);
  assert.match(lines.join("\n"), /独立模式不依赖/);
  assert.ok(!JSON.stringify(result).includes(f.secret));
  assert.ok(!lines.join("\n").includes(f.secret));
});

test("same-version changed companion is stale even when all HTTP endpoints return 200", async (t) => {
  const f = fixture(t);
  writeFileSync(
    join(f.installed, "extension.cjs"),
    "// old deployed implementation\n",
  );
  const result = await nativeCodexStatus(f);
  assert.equal(result.state, "stale");
  assert.deepEqual(result.changedFiles, ["extension.cjs"]);
});

test("HTTP host can be ready before any browser extension host activates", async (t) => {
  const f = fixture(t),
    fetcher = f.fetcher;
  f.fetcher = (url, options) =>
    String(url).endsWith(":45679/status")
      ? Promise.reject(new Error(`private ${f.secret}`))
      : fetcher(url, options);
  assert.equal(
    (await nativeCodexStatus(f)).state,
    "host-ready-awaiting-browser",
  );
});

test("legacy shared broker does not prove current browser instance readiness", async (t) => {
  const f = fixture(t);
  f.setBroker({
    companionActive: true,
    officialActive: true,
    broker: { enabled: true },
  });
  assert.equal(
    (await nativeCodexStatus(f)).state,
    "host-ready-awaiting-browser",
  );
});

test("unreachable host is distinct from browser activation and never emits raw errors", async (t) => {
  const f = fixture(t);
  f.fetcher = async () => {
    throw new Error(f.secret);
  };
  const result = await nativeCodexStatus(f);
  assert.equal(result.state, "unreachable");
  assert.ok(!JSON.stringify(result).includes(f.secret));
});

test("gateway failure remains visible even while the private broker is ready", async (t) => {
  const f = fixture(t),
    fetcher = f.fetcher;
  f.fetcher = (url, options) =>
    String(url).endsWith("/api/native-codex/status")
      ? Promise.resolve(new Response("no", { status: 503 }))
      : fetcher(url, options);
  const result = await nativeCodexStatus(f);
  assert.equal(result.state, "unreachable");
  assert.equal(result.gateway, "unavailable");
});

test("unconfigured, remote, credentialed and mismatched upstreams never issue requests", async (t) => {
  for (const upstream of [
    undefined,
    "http://example.com:45678",
    "http://user:secret@127.0.0.1:45678",
    "http://127.0.0.1:45670",
  ]) {
    const f = fixture(t);
    f.env.NATIVE_CODEX_UPSTREAM_URL = upstream;
    const result = await nativeCodexStatus(f);
    assert.equal(result.state, "unconfigured");
    assert.equal(f.requests.length, 0);
  }
});

test("runtime and broker identity must be owned private regular files", async (t) => {
  for (const target of ["recordPath", "authPath"]) {
    const f = fixture(t);
    chmodSync(f[target], 0o644);
    assert.equal((await nativeCodexStatus(f)).state, "unconfigured");
    assert.equal(f.requests.length, 0);
  }
  const f = fixture(t),
    link = join(f.root, "linked-record.json");
  symlinkSync(f.recordPath, link);
  f.env.NATIVE_CODEX_RUNTIME_RECORD = link;
  assert.equal((await nativeCodexStatus(f)).state, "unconfigured");
  assert.equal(f.requests.length, 0);
});

test("status does not alter records or installed files", async (t) => {
  const f = fixture(t),
    record = readFileSync(f.recordPath),
    auth = readFileSync(f.authPath);
  await nativeCodexStatus(f);
  assert.deepEqual(readFileSync(f.recordPath), record);
  assert.deepEqual(readFileSync(f.authPath), auth);
});

test("reachable old gateway cannot masquerade as the newly configured host", async (t) => {
  for (const old of [
    { iframeUrl: "/native-codex/?folder=%2Fother-project" },
    { newChatWindowIds: ["00000000-0000-4000-8000-000000000099"] },
    { newChatWindowIds: undefined },
  ]) {
    const f = fixture(t),
      fetcher = f.fetcher;
    f.fetcher = async (url, options) => {
      const response = await fetcher(url, options);
      if (!String(url).endsWith("/api/native-codex/status")) return response;
      return Response.json({ ...(await response.json()), ...old });
    };
    assert.equal((await nativeCodexStatus(f)).state, "gateway-mismatch");
  }
});
