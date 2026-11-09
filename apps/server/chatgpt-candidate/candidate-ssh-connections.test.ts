import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createChatGptDesktopCandidate,
  installChatGptDesktopCandidateShutdown,
  parseChatGptDesktopSshConnectionsEnvironment,
} from "./chatgpt-desktop-candidate.js";

test("candidate SIGINT and SIGTERM close its gateway once", () => {
  const signals = new EventEmitter();
  let closed = 0;
  installChatGptDesktopCandidateShutdown({ close: async () => { closed++; } }, signals);
  signals.emit("SIGTERM");
  signals.emit("SIGINT");
  assert.equal(closed, 1);
});

test("native SSH bridge is constructor-only and cannot be enabled without fixed alias discovery", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "kb-ssh-candidate-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(
    createChatGptDesktopCandidate({
      profileFile: join(root, "profile.json"),
      accessMode: "workbench",
      workbenchOrigin: "https://fixture.test",
      sshConnections: { runtimeRoot: join(root, "runtime") },
    }),
    /Invalid fixed SSH connection configuration/,
  );
  const app = await createChatGptDesktopCandidate({
    profileFile: join(root, "profile.json"),
    accessMode: "workbench",
    workbenchOrigin: "https://fixture.test",
  });
  t.after(() => app.close());
  const response = await app.inject({
    method: "POST",
    url: "/api/chatgpt-desktop/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/ssh/connect",
    headers: {
      origin: "https://fixture.test",
      host: "fixture.test",
      "x-forwarded-proto": "https",
      "sec-fetch-site": "same-origin",
    },
    payload: { alias: "fixture" },
  });
  assert.equal(response.statusCode, 404);
});

test('CLI enables the sole server owner without accepting a socket target',()=>{
  assert.equal(parseChatGptDesktopSshConnectionsEnvironment({}),undefined);
  assert.deepEqual(parseChatGptDesktopSshConnectionsEnvironment({CHATGPT_DESKTOP_SSH_RUNTIME_ROOT:'/private/runtime'}),{runtimeRoot:'/private/runtime'});
  assert.deepEqual(parseChatGptDesktopSshConnectionsEnvironment({CHATGPT_DESKTOP_SSH_RUNTIME_ROOT:'/private/runtime',CHATGPT_DESKTOP_SSH_BINARY:'/usr/bin/ssh'}),{runtimeRoot:'/private/runtime',sshBinary:'/usr/bin/ssh'});
  for(const env of [{CHATGPT_DESKTOP_SSH_BINARY:'/usr/bin/ssh'},{CHATGPT_DESKTOP_SSH_RUNTIME_ROOT:''},{CHATGPT_DESKTOP_SSH_RUNTIME_ROOT:'relative'},{CHATGPT_DESKTOP_SSH_RUNTIME_ROOT:'/private/runtime',CHATGPT_DESKTOP_SSH_CONTROL_SOCKET:'/private/server-ssh.sock'}])assert.throws(()=>parseChatGptDesktopSshConnectionsEnvironment(env),/Invalid fixed SSH/);
});
