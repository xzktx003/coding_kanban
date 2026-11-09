import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { createChatGptDesktopCandidate } from "./chatgpt-desktop-candidate.js";

const mac = process.env.CHATGPT_DESKTOP_SSH_MAC_ASAR, linux = process.env.CHATGPT_DESKTOP_SSH_LINUX_ASAR, native = process.env.CHATGPT_DESKTOP_SSH_ORIGINAL_CHUNK;
const configured = { skip: !(mac && linux && native) && "Set the fixed Mac/Linux ASAR and independently extracted original SSH chunk paths" };
const headers = { host: "workbench.invalid", "x-forwarded-proto": "https", origin: "https://workbench.invalid", "sec-fetch-site": "same-origin" };
async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "chatgpt-candidate-ssh-")), privateDir = join(root, "private"); await mkdir(privateDir, { mode: 0o700 });
  let nativeConnections = 0;
  const socket = createServer(connection => { nativeConnections++; connection.destroy(); }), socketPath = join(privateDir, "control.sock");
  await new Promise<void>((resolve, reject) => { socket.once("error", reject); socket.listen(socketPath, resolve); }); await chmod(socketPath, 0o600);
  const proc = await readFile(`/proc/${process.pid}/stat`, "utf8");
  const profile = { version: 1, id: randomUUID(), generation: randomUUID(), pid: process.pid, uid: process.getuid!(), startTicks: proc.slice(proc.lastIndexOf(")") + 1).trim().split(/\s+/)[19], macAsarPath: mac!, macAsarSha256: "bb88615052255e79b5977885f9a0cc212c268589587c79d4d3b7c4b46e881a95", linuxAsarPath: linux!, linuxAsarSha256: "1588e6a0e1dcfc615060152ef264d4adf2c3ff6bb7496986c72163b5853e2a2e", controlSocketPath: socketPath };
  const profileFile = join(privateDir, "profile.json"), configPath = join(root, "ssh_config");
  await writeFile(profileFile, JSON.stringify(profile), { mode: 0o600 });
  await writeFile(configPath, "Host serverAlias ignoredSecond\n IdentityFile DO_NOT_EXPOSE_KEY_PATH\n ProxyCommand DO_NOT_EXECUTE\nHost anotherAlias\n", { mode: 0o600 });
  const apps: Awaited<ReturnType<typeof createChatGptDesktopCandidate>>[] = [];
  t.after(async () => { for (const app of apps) await app.close(); await new Promise<void>((resolve, reject) => socket.close(error => error ? reject(error) : resolve())); await rm(root, { recursive: true, force: true }); assert.equal(nativeConnections, 0); });
  return { profileFile, profile, root, configPath, apps, prefix: `/chatgpt-desktop/${profile.id}/${profile.generation}/webview`, api: `/api/chatgpt-desktop/${profile.id}/${profile.generation}/ssh/discover` };
}

test("opt-in factory wires exact original SSH query to real server configuration while retaining password-free origin checks", configured, async t => {
  const f = await fixture(t), app = await createChatGptDesktopCandidate({ profileFile: f.profileFile, accessMode: "workbench", workbenchOrigin: "https://workbench.invalid", splitPane: true, sshDiscovery: { configPath: f.configPath, nativeMainChunkFile: native!, homeDirectory: f.root } }); f.apps.push(app);
  const login = await app.inject({ url: "/__chatgpt-candidate-login", headers }); assert.equal(login.statusCode, 303); assert.equal(login.body.includes('type="password"'), false);
  const response = await app.inject({ url: f.api, headers }); assert.equal(response.statusCode, 200); assert.deepEqual(response.json(), { sshAliases: ["anotherAlias", "serverAlias"] }); assert.equal(response.body.includes("DO_NOT_"), false);
  assert.equal((await app.inject({ url: f.api, headers: { ...headers, origin: "https://foreign.invalid" } })).statusCode, 403);
  const settings = await app.inject({ url: f.prefix + "/assets/remote-connections-settings-4dd0ca54883c.js", headers }); assert.equal(settings.statusCode, 200);
  assert.ok(settings.body.includes('function ys(){return __kanbanDiscoverServerSshAliases()}')); assert.equal(settings.body.includes('function ys(){return Kr().discover()}'), false);
  const own = await app.inject({ url: f.prefix + "/__host/browser-ssh-alias-discovery.mjs", headers }); assert.equal(own.statusCode, 200); assert.ok(own.body.includes('/ssh/discover')); assert.equal(own.body.includes(f.root), false);
  assert.equal((await app.inject({ url: f.api + "?configPath=/different", headers })).statusCode, 400);
});

test("default candidate keeps original native discovery and reports server configuration as unconfigured", configured, async t => {
  const f = await fixture(t), app = await createChatGptDesktopCandidate({ profileFile: f.profileFile, accessMode: "workbench", workbenchOrigin: "https://workbench.invalid", splitPane: true }); f.apps.push(app);
  const response = await app.inject({ url: f.api, headers }); assert.equal(response.statusCode, 503); assert.deepEqual(response.json(), { reasonCode: "SSH_DISCOVERY_UNCONFIGURED" });
  const settings = await app.inject({ url: f.prefix + "/assets/remote-connections-settings-4dd0ca54883c.js", headers }); assert.equal(settings.statusCode, 200); assert.ok(settings.body.includes('function ys(){return Kr().discover()}')); assert.equal(settings.body.includes('__kanbanDiscoverServerSshAliases'), false);
});
