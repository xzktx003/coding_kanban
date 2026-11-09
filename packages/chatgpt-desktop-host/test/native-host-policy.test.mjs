import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Script, runInNewContext } from "node:vm";

const require = createRequire(import.meta.url);
const { adaptNativeHostChunk } = require("../src/native-host-policy.cjs");
const {
  adaptProjectConsentChunk,
} = require("../src/project-consent-routing.cjs");
const { adaptNativeSshBootstrap } = require("../src/ssh-bootstrap-policy.cjs");
const hash = (body) => createHash("sha256").update(body).digest("hex");
const path = process.env.CHATGPT_DESKTOP_TEST_NATIVE_CHUNK;
const supplied = {
  skip:
    !path && "Requires the explicitly supplied pinned original native member",
};
const originalHash =
  "c23f63f8ff156b2a92a81ee2870d80ab959ced6ce6232d6fe7e54bbefe11d333";

test("native host policy accepts no unpinned input or caller permission switch", () => {
  for (const body of [
    undefined,
    "text",
    Buffer.alloc(0),
    Buffer.from("other version"),
  ]) {
    assert.throws(
      () =>
        adaptNativeHostChunk({
          body,
          registered: true,
          skipVerification: true,
        }),
      { code: "NATIVE_HOST_POLICY_DIGEST_MISMATCH" },
    );
  }
});

function section(body) {
  const begin = body.indexOf(
    Buffer.from(
      'class eTi{options;kind="websocket";logger=(0,em.$Cz)("AppServerTransportSshWebsocket");',
    ),
  );
  const end = body.indexOf(Buffer.from("}function eTs("), begin) + 1;
  assert.ok(begin >= 0 && end > begin);
  return { begin, end, body: body.subarray(begin, end) };
}

test(
  "composition retains the exact Work and consent bytes and replaces only the reviewed SSH class",
  supplied,
  async () => {
    const original = await readFile(path);
    assert.equal(hash(original), originalHash);
    const before = Buffer.from(original),
      base = adaptProjectConsentChunk({ body: original }),
      ssh = adaptNativeSshBootstrap({ body: original });
    const result = adaptNativeHostChunk({ body: original });
    assert.equal(result.originalSha256, originalHash);
    assert.equal(
      result.adaptedSha256,
      "9714f7b4288b3f1df2654b5d215cbf026c05d7b7530bd86dd9f383f938e5422c",
    );
    assert.equal(result.adaptedSha256, hash(result.body));
    assert.equal(result.consentPolicySha256, base.adaptedSha256);
    assert.equal(result.sshPolicySha256, ssh.adaptedSha256);
    const old = section(base.body),
      combined = section(result.body),
      patched = section(ssh.body);
    assert.ok(
      base.body
        .subarray(0, old.begin)
        .equals(result.body.subarray(0, combined.begin)),
    );
    assert.ok(
      base.body.subarray(old.end).equals(result.body.subarray(combined.end)),
    );
    assert.ok(patched.body.equals(combined.body));
    assert.deepEqual(original, before);
    assert.throws(() => adaptNativeHostChunk({ body: result.body }), {
      code: "NATIVE_HOST_POLICY_DIGEST_MISMATCH",
    });
    new Script(result.body.toString("utf8"));
  },
);

test(
  "composed native SSH transport starts through an isolated socket path without killing remote tasks",
  supplied,
  async () => {
    const original = await readFile(path);
    assert.equal(hash(original), originalHash);
    const result = adaptNativeHostChunk({ body: original }),
      source = section(result.body).body.toString("utf8");
    const Transport = runInNewContext(
      source + ";eTi",
      {
        em: { $Cz: () => ({ info() {}, warning() {} }) },
        MS: { e2: () => "codex" },
        Mv: { hD: (value) => value },
        tb: {
          randomBytes: (size) => ({ toString: () => "b".repeat(size * 2) }),
          createHash: () => ({
            update() { return this; },
            digest() { return "b".repeat(64); },
          }),
        },
      },
      { timeout: 1000 },
    );
    const transport = new Transport({
      sshConnection: { alias: "fixture", host: "fixture", port: 22 },
    });
    const calls = [];
    transport.runRemoteLoginShellCommand = async (request) => {
      calls.push(request);
      return { code: 0, stdout: "", stderr: "" };
    };
    transport.getInstalledCodexVersion = async () => null;
    await transport.startRemoteAppServer({});
    assert.deepEqual(calls.map(({ operation }) => operation), [
      "codex_path_probe",
      "app_server_bootstrap",
    ]);
    assert.equal(/\b(?:pkill|killall)\b/.test(calls[1].command), false);
    assert.match(calls[1].command, /kanban-[a-f0-9]{32}\/app-server\.sock/);
    assert.match(calls[1].command, /kanban-[a-f0-9]{32}/);
    assert.match(calls[1].command, /app-server --listen "unix:\/\/\$socket"/);
    assert.equal(transport.kanbanSSHBootstrapCommand, null);
    assert.equal(source.includes("SSH_REMOTE_UNAVAILABLE"), false);
    assert.match(source, /SSH_REMOTE_RESTART_UNAVAILABLE/);
    assert.match(source, /app-server proxy/);
  },
);
