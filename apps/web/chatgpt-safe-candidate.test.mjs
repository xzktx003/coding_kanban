import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { enableChatgptDocumentGuard } from "./chatgpt-safe-candidate.mjs";

test("the isolated candidate replaces exactly one continuity plugin without changing routing", () => {
  const keep = { name: "another-plugin" };
  const old = { name: "workbench-document-continuity" };
  const server = { https: { cert: "certificate" }, host: "0.0.0.0", proxy: { "/api": { target: "http://localhost" } } };
  const original = { plugins: [keep, [false, old]], server };
  const result = enableChatgptDocumentGuard(original);

  assert.equal(result.server, server);
  assert.equal(result.plugins[0], keep);
  assert.equal(result.plugins[1][0], false);
  assert.equal(result.plugins[1][1].name, "workbench-chatgpt-document-continuity");
  assert.equal(original.plugins[1][1], old);
});

test("a missing, duplicate or already-installed continuity guard fails closed", () => {
  assert.throws(() => enableChatgptDocumentGuard({ plugins: [] }), /continuity/i);
  assert.throws(() => enableChatgptDocumentGuard({ plugins: [{ name: "workbench-document-continuity" }, [{ name: "workbench-document-continuity" }]] }), /continuity/i);
  assert.throws(() => enableChatgptDocumentGuard({ plugins: [{ name: "workbench-document-continuity" }, { name: "workbench-chatgpt-document-continuity" }] }), /continuity/i);
  assert.throws(() => enableChatgptDocumentGuard({ plugins: [Promise.resolve({})] }), /continuity/i);
});

test("the actual isolated Vite candidate config installs the guard and retains its fixed gateway", () => {
  const temp = mkdtempSync(join(tmpdir(), "chatgpt-safe-config-"));
  try {
    const cert = join(temp, "cert.pem"), key = join(temp, "key.pem");
    writeFileSync(cert, "test certificate");
    writeFileSync(key, "test key");
    // resolveConfig does not open a listener or parse the fixture PEMs.
    const script = `import { resolveConfig } from 'vite';
const result = await resolveConfig({ configFile: './vite.chatgpt-safe-candidate.config.mjs', logLevel: 'silent' }, 'serve');
const names = result.plugins.map(plugin => plugin.name);
if (names.filter(name => name === 'workbench-chatgpt-document-continuity').length !== 1 || names.includes('workbench-document-continuity')) throw Error('guard mismatch');
if (result.server.host !== '0.0.0.0' || !result.server.https || result.server.proxy['^/api/chatgpt-desktop(?:/|$)'].target !== 'http://127.0.0.1:49120') throw Error('candidate routing mismatch');`;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      cwd: fileURLToPath(new URL(".", import.meta.url)),
      env: { ...process.env, CHATGPT_DESKTOP_CANDIDATE_PORT: "49120", VITE_DEV_HTTPS: "1", VITE_DEV_HTTPS_CERT: cert, VITE_DEV_HTTPS_KEY: key },
      encoding: "utf8", timeout: 15_000,
    });
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
