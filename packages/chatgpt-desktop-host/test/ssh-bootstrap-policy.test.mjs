import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { Script, runInNewContext } from "node:vm";

const require = createRequire(import.meta.url);
const { adaptNativeSshBootstrap } = require("../src/ssh-bootstrap-policy.cjs");
const originalPath = process.env.CHATGPT_DESKTOP_SSH_ORIGINAL_CHUNK;
const originalSha =
  "c23f63f8ff156b2a92a81ee2870d80ab959ced6ce6232d6fe7e54bbefe11d333";
const digest = (value) => createHash("sha256").update(value).digest("hex");
const capability = {
  skip:
    !originalPath &&
    "Set CHATGPT_DESKTOP_SSH_ORIGINAL_CHUNK to the fixed, independently extracted original member",
};

function loadOriginalClass(body, remoteEnvironment = {}) {
  const source = body.toString("utf8");
  const start = source.indexOf("class eTi{");
  const end = source.indexOf("}function eTs(", start) + 1;
  assert.ok(start >= 0 && end > start);
  const logger = { info() {}, warning() {} };
  return runInNewContext(
    source.slice(start, end) + ";eTi",
    {
      em: { $Cz: () => logger },
      MS: { e2: () => "codex" },
      Mv: { hD: (value) => value },
      tb: { createHash, randomBytes },
      ex7: "PRIVATE_FIXTURE_SOCKET",
      ex8: "PRIVATE_FIXTURE_LOG",
      ex9: "PRIVATE_FIXTURE_AGENT",
      process: { env: remoteEnvironment },
    },
    { timeout: 1000 },
  );
}

async function originalMember() {
  const body = await readFile(originalPath);
  assert.equal(
    digest(body),
    originalSha,
    "the fixture must be the exact reviewed native member",
  );
  return body;
}

test("unknown or corrupted native source cannot opt into the SSH policy", () => {
  for (const body of [
    undefined,
    "text",
    Buffer.alloc(0),
    Buffer.from("class eTi{}"),
  ])
    assert.throws(() => adaptNativeSshBootstrap({ body }), {
      code: "SSH_POLICY_DIGEST_MISMATCH",
    });
});

test(
  "the exact original SSH method builds destructive commands and trusts reconnect state (recording fixture only)",
  capability,
  async () => {
    const Transport = loadOriginalClass(await originalMember());
    const transport = new Transport({
      sshConnection: { alias: "fixture", host: "fixture", port: 22 },
    });
    const recorded = [];
    transport.runRemoteLoginShellCommand = async (request) => {
      recorded.push(request);
      return { code: 0, stdout: "", stderr: "" };
    };
    transport.getInstalledCodexVersion = async () => null;
    await transport.startRemoteAppServer({});
    await transport.killCodexProcess();
    assert.deepEqual(
      recorded.map(({ operation }) => operation),
      ["codex_path_probe", "app_server_bootstrap", "remote_codex_kill"],
    );
    assert.match(recorded[1].command, /pkill -9 -U/);
    assert.match(recorded[1].command, /\[d\]esktop-ssh-websocket-v0\.sock/);
    assert.match(recorded[2].command, /pkill -9 -U/);
    assert.match(recorded[2].command, /app-server\.\* --listen/);

    const reconnect = new Transport({
      sshConnection: { alias: "fixture", host: "fixture", port: 22 },
    });
    reconnect.hasConnected = true;
    reconnect.startShellEnvLoadForSsh = () => ({
      promise: Promise.resolve({}),
      getState: () => ({}),
    });
    reconnect.waitForShellEnvIfProxyCommandNeedsPath = async () => {};
    reconnect.connectWithDesktopMcpFallback = async () =>
      "UNVERIFIED_FIXTURE_RECONNECTED";
    assert.equal(await reconnect.connect(), "UNVERIFIED_FIXTURE_RECONNECTED");
  },
);

test(
  "the adapted SSH transport bootstraps without a broad kill and refuses remote restart",
  capability,
  async () => {
    const body = await originalMember();
    const adapted = adaptNativeSshBootstrap({ body });
    assert.equal(adapted.originalSha256, originalSha);
    assert.equal(adapted.adaptedSha256, digest(adapted.body));
    const classStart = Buffer.from("class eTi{");
    const classEnd = Buffer.from("}function eTs(");
    const beforeStart = body.indexOf(classStart);
    const afterStart = adapted.body.indexOf(classStart);
    const beforeEnd = body.indexOf(classEnd, beforeStart);
    const afterEnd = adapted.body.indexOf(classEnd, afterStart);
    assert.ok(
      beforeStart >= 0 &&
        beforeEnd > beforeStart &&
        afterStart >= 0 &&
        afterEnd > afterStart,
    );
    assert.ok(
      body
        .subarray(0, beforeStart)
        .equals(adapted.body.subarray(0, afterStart)),
    );
    assert.ok(
      body.subarray(beforeEnd + 1).equals(adapted.body.subarray(afterEnd + 1)),
    );
    new Script(adapted.body.toString("utf8"), {
      filename: "reviewed-native-chunk.js",
    });
    const Transport = loadOriginalClass(adapted.body);
    const transport = new Transport({
      sshConnection: { alias: "fixture", host: "fixture", port: 22 },
    });
    const recorded = [];
    transport.runRemoteLoginShellCommand = async (request) => {
      recorded.push(request);
      return { code: 0, stdout: "", stderr: "" };
    };
    transport.getInstalledCodexVersion = async () => null;
    await transport.startRemoteAppServer({});
    assert.deepEqual(
      recorded.map(({ operation }) => operation),
      ["codex_path_probe", "app_server_bootstrap"],
    );
    const bootstrap = recorded[1].command;
    assert.equal(/\b(?:pkill|killall)\b/.test(bootstrap), false);
    assert.match(bootstrap, /kanban-[a-f0-9]{32}\/app-server\.sock/);
    assert.match(bootstrap, /app-server --listen "unix:\/\/\$socket"/);
    assert.doesNotThrow(() =>
      execFileSync("/bin/sh", ["-n", "-c", bootstrap], { stdio: "pipe" }),
    );
    assert.equal(transport.kanbanSSHBootstrapCommand, null);
    const source = adapted.body.toString("utf8");
    const patchedStart = source.indexOf("class eTi{");
    const patchedEnd = source.indexOf("}function eTs(", patchedStart);
    const patchedClass = source.slice(patchedStart, patchedEnd);
    assert.equal(patchedClass.includes("pkill -9 -U"), false);
    assert.match(patchedClass, /app-server proxy --sock/);
    assert.match(patchedClass, /forwarded-ssh-agent\.sock/);
    await assert.rejects(transport.killCodexProcess(), {
      code: "SSH_REMOTE_RESTART_UNAVAILABLE",
    });

    const guarded = new Transport({});
    const command = {
      command: "rm -rf /",
      context: {},
      operation: "fixture",
      timeoutMessage: "fixture",
    };
    await assert.rejects(guarded.runRemoteLoginShellCommand(command), {
      code: "SSH_REMOTE_COMMAND_UNAVAILABLE",
    });
    await assert.rejects(
      guarded.runRemoteLoginShellCommandWithoutGate(command),
      { code: "SSH_REMOTE_COMMAND_UNAVAILABLE" },
    );
    assert.equal(
      guarded.kanbanIsSafeRemoteCommand("app_server_bootstrap", "pkill -9 -U user"),
      false,
    );
    assert.notEqual(adapted.adaptedSha256, originalSha);
  },
);

// This executes only the pinned transport class with command recording. It does
// not connect SSH, open a remote socket, or read any real SSH configuration.
test("same-target transports have independent immutable remote instance identities", capability, async () => {
  const Transport = loadOriginalClass(adaptNativeSshBootstrap({ body: await originalMember() }).body);
  const options = Object.freeze({ sshConnection: Object.freeze({ alias: "fixture", host: "fixture", port: 22 }) });
  const first = new Transport(options), second = new Transport(options);
  const firstId = first.kanbanRemoteInstanceId, secondId = second.kanbanRemoteInstanceId;
  assert.match(firstId, /^[a-f0-9]{32}$/);
  assert.match(secondId, /^[a-f0-9]{32}$/);
  assert.notEqual(firstId, secondId, "same-target profiles must not share the remote app-server namespace");
  assert.throws(() => { first.kanbanRemoteInstanceId = secondId; }, TypeError);
  const calls = [];
  for (const transport of [first, second]) {
    transport.runRemoteLoginShellCommand = async (request) => {
      calls.push(request);
      return { code: 0, stdout: "", stderr: "" };
    };
    transport.getInstalledCodexVersion = async () => null;
  }
  await first.startRemoteAppServer({});
  await second.startRemoteAppServer({});
  await first.startRemoteAppServer({});
  const boots = calls.filter(({ operation }) => operation === "app_server_bootstrap");
  assert.equal(boots.length, 3);
  assert.ok(boots[0].command.includes(`kanban-${firstId}/app-server.sock`));
  assert.ok(boots[1].command.includes(`kanban-${secondId}/app-server.sock`));
  assert.equal(boots[2].command, boots[0].command, "one transport reconnects only to its own instance");
  assert.equal(first.kanbanRemoteInstanceId, firstId);
  assert.equal(second.kanbanRemoteInstanceId, secondId);
  for (const { command } of boots) assert.doesNotMatch(command, /\b(?:pkill|killall)\b/);
});
