import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import WebSocket from "ws";
import { createChatGptDesktopCandidate } from "./chatgpt-desktop-candidate.js";

const origin = "https://workbench.invalid:8484";
const host = new URL(origin).host;
const headers = { host, "x-forwarded-proto": "https" };
const login = "/__chatgpt-candidate-login";
const bridge = "/chatgpt-desktop/00000000-0000-4000-8000-000000000000/00000000-0000-4000-8000-000000000000/bridge";

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "chatgpt-workbench-access-"));
  const profileFile = join(root, "absent-profile.json");
  const app = await createChatGptDesktopCandidate({ profileFile, accessMode: "workbench", workbenchOrigin: origin });
  t.after(async () => { await app.close(); await rm(root, { recursive: true, force: true }); });
  return { app, profileFile };
}

test("explicit workbench access needs no password or cookie, and old login links return to the mode", async t => {
  const { app } = await fixture(t);
  const status = await app.inject({ method: "GET", url: "/api/chatgpt-desktop/status", headers });
  assert.equal(status.statusCode, 503, "missing native profile stays a truthful service error, not a login challenge");
  assert.equal(status.headers["set-cookie"], undefined);
  const response = await app.inject({ method: "GET", url: login, headers });
  assert.equal(response.statusCode, 303);
  assert.equal(response.headers.location, "/?mode=chatgpt&view=agent");
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(response.headers["set-cookie"], undefined);
  assert.ok(!response.body.includes("password"));
  assert.equal((await app.inject({ method: "GET", url: login + "?next=https://foreign.invalid", headers })).statusCode, 403);
  assert.equal((await app.inject({ method: "POST", url: login, headers: { ...headers, origin } })).statusCode, 405);
});

test("password-free access still rejects foreign hosts, insecure forwarding and cross-site requests", async t => {
  const { app } = await fixture(t);
  for (const requestHeaders of [
    {}, { ...headers, host: "foreign.invalid" }, { ...headers, "x-forwarded-proto": "http" },
    { ...headers, origin: "https://foreign.invalid" }, { ...headers, origin: "null" },
    { ...headers, "sec-fetch-site": "cross-site" }, { ...headers, "sec-fetch-site": "same-site" },
  ]) {
    const response = await app.inject({ method: "GET", url: "/api/chatgpt-desktop/status", headers: requestHeaders });
    assert.equal(response.statusCode, 403);
  }
  for (const site of ["same-origin", "none"]) {
    assert.equal((await app.inject({ method: "GET", url: "/api/chatgpt-desktop/status", headers: { ...headers, "sec-fetch-site": site } })).statusCode, 503);
  }
});

test("password-free WSS requires the fixed HTTPS origin before profile access", async t => {
  const { app } = await fixture(t);
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const upgrade = (requestHeaders: Record<string, string>) => new Promise<number | undefined>((resolve, reject) => {
    const ws = new WebSocket(address.replace(/^http/, "ws") + bridge, { headers: requestHeaders });
    ws.on("error", () => {});
    ws.once("unexpected-response", (_request, response) => { response.resume(); ws.terminate(); resolve(response.statusCode); });
    ws.once("open", () => { ws.terminate(); reject(Error("unexpected native connection")); });
  });
  assert.equal(await upgrade(headers), 403);
  assert.equal(await upgrade({ ...headers, origin: "https://foreign.invalid" }), 403);
  assert.equal(await upgrade({ ...headers, origin }), 503);
});

test("password-free access is explicit and cannot silently replace a configured token gate", async t => {
  const { profileFile } = await fixture(t);
  for (const options of [
    { accessMode: "workbench" },
    { accessMode: "workbench", workbenchOrigin: "http://workbench.invalid:8484" },
    { accessMode: "workbench", workbenchOrigin: origin + "/" },
    { accessMode: "workbench", workbenchOrigin: origin, authTokenFile: "/absent-token" },
    { accessMode: "invalid", workbenchOrigin: origin },
    { workbenchOrigin: origin },
  ]) {
    await assert.rejects(createChatGptDesktopCandidate({ profileFile, ...options } as Parameters<typeof createChatGptDesktopCandidate>[0]), /Invalid ChatGPT candidate/);
  }
});
