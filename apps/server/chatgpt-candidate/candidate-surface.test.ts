import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test, { type TestContext } from "node:test";
import { createChatGptDesktopCandidate, parseChatGptDesktopCandidateSplitPane } from "./chatgpt-desktop-candidate.js";
import { createChatGptDesktopCandidate as createIsolatedCandidate } from "../src/chatgpt-desktop-candidate.js";

function archive() {
  const body = Buffer.from('<html><head><script type="module" crossorigin src="./assets/index-65a34a2d8bec.js"></script></head><body><div id="root"></div></body></html>');
  const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
  const json = Buffer.from(JSON.stringify({ files: { webview: { files: { "index.html": {
    size: body.length, offset: "0", integrity: { algorithm: "SHA256", hash: hash(body) },
  } } } } }));
  const headerBytes = 8 + Math.ceil(json.length / 4) * 4;
  const header = Buffer.alloc(8 + headerBytes);
  [4, headerBytes, headerBytes - 4, json.length].forEach((value, index) => header.writeUInt32LE(value, index * 4));
  json.copy(header, 16);
  const bytes = Buffer.concat([header, body]);
  return { bytes, sha256: hash(bytes) };
}

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(await realpath(tmpdir()), "chatgpt-candidate-surface-"));
  const privateDir = join(root, "private"), assetDir = join(root, "assets");
  await mkdir(privateDir, { mode: 0o700 }); await mkdir(assetDir, { mode: 0o755 });
  let nativeConnections = 0;
  const socket = createServer((connection) => { nativeConnections++; connection.destroy(); });
  const socketPath = join(privateDir, "control.sock");
  await new Promise<void>((resolve, reject) => { socket.once("error", reject); socket.listen(socketPath, resolve); });
  const { chmod } = await import("node:fs/promises"); await chmod(socketPath, 0o600);
  const packed = archive(), macAsarPath = join(assetDir, "mac.asar"), linuxAsarPath = join(assetDir, "linux.asar");
  await writeFile(macAsarPath, packed.bytes, { mode: 0o600 });
  await writeFile(linuxAsarPath, packed.bytes, { mode: 0o600 });
  const stat = await readFile(`/proc/${process.pid}/stat`, "utf8");
  const profile = { version: 1, id: randomUUID(), generation: randomUUID(), pid: process.pid,
    startTicks: stat.slice(stat.lastIndexOf(")") + 1).trim().split(/\s+/)[19], uid: process.getuid!(),
    macAsarPath, macAsarSha256: packed.sha256, linuxAsarPath, linuxAsarSha256: packed.sha256, controlSocketPath: socketPath };
  const profileFile = join(privateDir, "profile.json"); await writeFile(profileFile, JSON.stringify(profile), { mode: 0o600 });
  const token = randomBytes(32).toString("hex"), authTokenFile = join(privateDir, "token");
  await writeFile(authTokenFile, token + "\n", { mode: 0o600 });
  const apps: Awaited<ReturnType<typeof createChatGptDesktopCandidate>>[] = [];
  t.after(async () => {
    for (const app of apps) await app.close();
    await new Promise<void>((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
    assert.equal(nativeConnections, 0, "surface configuration must not open a native connection");
  });
  return { root, profileFile, profile, token, authTokenFile, apps,
    url: `/chatgpt-desktop/${profile.id}/${profile.generation}/webview/index.html` };
}

function manifest(body: string) {
  const match = /<script id="chatgpt-host-manifest" type="application\/json">([^<]+)<\/script>/.exec(body);
  assert.ok(match, "factory must serve an adapted document with its actual versioned manifest");
  return JSON.parse(match[1]!);
}

test("factory defaults to v2 and explicitly selects v4 only for splitPane true", async (t) => {
  const f = await fixture(t);
  for (const [option, expected] of [[{}, 2], [{ splitPane: false }, 2], [{ splitPane: true }, 4]] as const) {
    const app = await createChatGptDesktopCandidate({ profileFile: f.profileFile, ...option }); f.apps.push(app);
    const response = await app.inject({ method: "GET", url: f.url });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(manifest(response.body), { version: expected, profileId: f.profile.id, generation: f.profile.generation, entry: "./assets/index-65a34a2d8bec.js" });
  }
});

test("both constructor-only factories couple shared and split documents to versions 2 3 4 5", async (t) => {
  const f = await fixture(t);
  for (const factory of [createChatGptDesktopCandidate, createIsolatedCandidate]) {
    for (const [selection, version] of [[{}, 2], [{ sharedThread: false, splitPane: false }, 2], [{ splitPane: true }, 4], [{ sharedThread: true }, 3], [{ sharedThread: true, splitPane: true }, 5]] as const) {
      const app = await factory({ profileFile: f.profileFile, ...selection }); f.apps.push(app);
      const opposite = version === 5 ? 2 : 5;
      const response = await app.inject({ method: "GET", url: f.url + `?sharedThread=true&splitPane=true&version=${opposite}`, headers: { "x-chatgpt-desktop-shared-thread": "1", "x-chatgpt-desktop-version": String(opposite) } });
      assert.equal(response.statusCode, 200);
      assert.equal(manifest(response.body).version, version);
      assert.equal((await app.inject({ method: "POST", url: f.url, payload: { sharedThread: version !== 3 && version !== 5, splitPane: false, version: opposite } })).statusCode, 404);
      assert.equal(manifest((await app.inject(f.url)).body).version, version);
    }
  }
});

test("both factories reject provided nonboolean shared flags before opening any profile", async () => {
  for (const factory of [createChatGptDesktopCandidate, createIsolatedCandidate]) {
    for (const sharedThread of [undefined, null, "true", "false", "1", 0, 1, {}, [], new Boolean(true)])
      await assert.rejects(factory({ profileFile: join(tmpdir(), "not-opened-profile.json"), sharedThread } as any), /Invalid ChatGPT candidate surface configuration/);
  }
});

test("HTTP query headers and bodies cannot select another surface", async (t) => {
  const f = await fixture(t);
  for (const splitPane of [false, true]) {
    const app = await createChatGptDesktopCandidate({ profileFile: f.profileFile, ...{ splitPane } }); f.apps.push(app);
    for (const query of ["?splitPane=1&version=4&CHATGPT_DESKTOP_SPLIT_PANE=1", "?splitPane=0&version=2", "?splitPane=invalid"]) {
      const response = await app.inject({ method: "GET", url: f.url + query, headers: { "x-chatgpt-desktop-split-pane": splitPane ? "0" : "1" } });
      assert.equal(response.statusCode, 200); assert.equal(manifest(response.body).version, splitPane ? 4 : 2);
    }
    const post = await app.inject({ method: "POST", url: f.url, payload: { splitPane: !splitPane, version: splitPane ? 2 : 4 } });
    assert.equal(post.statusCode, 404);
    assert.equal(manifest((await app.inject(f.url)).body).version, splitPane ? 4 : 2);
  }
});

test("factory rejects every provided nonboolean splitPane before constructing a gateway", async () => {
  for (const splitPane of [undefined, null, "1", "0", "true", 0, 1, {}, [], new Boolean(true)]) {
    await assert.rejects(createChatGptDesktopCandidate({ profileFile: join(tmpdir(), "not-opened-profile.json"), splitPane } as any), /Invalid ChatGPT candidate surface configuration/);
  }
});

test("only the CLI parser reads strict zero or one environment values", async (t) => {
  for (const value of [undefined, "", "0"]) assert.equal(parseChatGptDesktopCandidateSplitPane(value), false);
  assert.equal(parseChatGptDesktopCandidateSplitPane("1"), true);
  for (const value of ["true", "false", "2", "01", " 1", "1 ", "\n1", "yes", 1, 0, true, null])
    assert.throws(() => parseChatGptDesktopCandidateSplitPane(value as any), /Invalid ChatGPT candidate surface configuration/);
  const f = await fixture(t), previous = process.env.CHATGPT_DESKTOP_SPLIT_PANE;
  process.env.CHATGPT_DESKTOP_SPLIT_PANE = "1";
  try {
    const app = await createChatGptDesktopCandidate({ profileFile: f.profileFile }); f.apps.push(app);
    assert.equal(manifest((await app.inject(f.url)).body).version, 2, "factory callers must opt in explicitly rather than inherit process env");
  } finally {
    if (previous === undefined) delete process.env.CHATGPT_DESKTOP_SPLIT_PANE;
    else process.env.CHATGPT_DESKTOP_SPLIT_PANE = previous;
  }
});

async function unusedPort() {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => { probe.once("error", reject); probe.listen({ host: "127.0.0.1", port: 0 }, resolve); });
  const address = probe.address(); assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

function http(port: number, path: string, options: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
  return new Promise<{ status: number; body: string; headers: import("node:http").IncomingHttpHeaders }>((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port, path, method: options.method ?? "GET", headers: options.headers }, (res) => {
      const chunks: Buffer[] = []; let size = 0;
      res.on("data", (chunk: Buffer) => { size += chunk.length; if (size > 512 * 1024) req.destroy(new Error("fixture response exceeded its budget")); else chunks.push(chunk); });
      res.on("end", () => resolve({ status: res.statusCode!, body: Buffer.concat(chunks).toString("utf8"), headers: res.headers }));
      res.on("error", reject);
    });
    req.on("error", reject); req.setTimeout(4000, () => req.destroy(new Error("fixture HTTP timed out")));
    req.end(options.body);
  });
}

test("CLI default and explicit one serve their authenticated fixed manifest over real HTTP", { timeout: 20000 }, async (t) => {
  const f = await fixture(t), cwd = fileURLToPath(new URL("..", import.meta.url));
  const script = fileURLToPath(new URL("./chatgpt-desktop-candidate.ts", import.meta.url));
  for (const [value, expected] of [[undefined, 2], ["1", 4]] as const) {
    const port = await unusedPort();
    const env: NodeJS.ProcessEnv = { ...process.env, CHATGPT_DESKTOP_CANDIDATE_PORT: String(port), CHATGPT_DESKTOP_PROFILE_FILE: f.profileFile, CHATGPT_DESKTOP_CANDIDATE_AUTH_TOKEN_FILE: f.authTokenFile };
    if (value === undefined) delete env.CHATGPT_DESKTOP_SPLIT_PANE;
    else env.CHATGPT_DESKTOP_SPLIT_PANE = value;
    const child = spawn(process.execPath, ["--import", "tsx", script], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("isolated candidate did not become ready")), 5000);
        const done = (error?: Error) => { clearTimeout(timer); error ? reject(error) : resolve(); };
        child.stdout.on("data", (chunk) => { stdout += chunk; if (stdout.includes("ChatGPT candidate gateway ready\n")) done(); });
        child.stderr.on("data", (chunk) => { stderr += chunk; });
        child.once("error", done); child.once("exit", () => done(new Error("isolated candidate exited before readiness")));
      });
      assert.equal((await http(port, f.url)).status, 401);
      const host = `127.0.0.1:${port}`;
      const login = await http(port, "/__chatgpt-candidate-login", { method: "POST", headers: { host, origin: `https://${host}`, "x-forwarded-proto": "https", "content-type": "application/json" }, body: JSON.stringify({ token: f.token }) });
      assert.equal(login.status, 303);
      const cookie = login.headers["set-cookie"]?.[0]?.split(";")[0]; assert.ok(cookie);
      const response = await http(port, f.url + `?splitPane=${expected === 4 ? 0 : 1}&version=${expected === 4 ? 2 : 4}`, { headers: { cookie, "x-chatgpt-desktop-split-pane": expected === 4 ? "0" : "1" } });
      assert.equal(response.status, 200); assert.equal(manifest(response.body).version, expected);
      assert.equal(stderr, ""); assert.equal(stdout, "ChatGPT candidate gateway ready\n");
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => child.kill("SIGKILL"), 2000);
          child.once("exit", () => { clearTimeout(timer); resolve(); }); child.kill("SIGTERM");
        });
      }
    }
  }
});

test("invalid CLI surface values fail before listening without echoing configuration", async (t) => {
  const f = await fixture(t), cwd = fileURLToPath(new URL("..", import.meta.url));
  const script = fileURLToPath(new URL("./chatgpt-desktop-candidate.ts", import.meta.url));
  for (const value of ["true", "false", "2", " 1", "1\n"]) {
    const result = spawnSync(process.execPath, ["--import", "tsx", script], { cwd, env: { ...process.env, CHATGPT_DESKTOP_CANDIDATE_PORT: String(await unusedPort()), CHATGPT_DESKTOP_PROFILE_FILE: f.profileFile, CHATGPT_DESKTOP_CANDIDATE_AUTH_TOKEN_FILE: f.authTokenFile, CHATGPT_DESKTOP_SPLIT_PANE: value }, encoding: "utf8", timeout: 3000 });
    assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.status, 1);
    assert.equal(result.stdout, ""); assert.equal(result.stderr, "ChatGPT candidate gateway unavailable\n");
  }
});
