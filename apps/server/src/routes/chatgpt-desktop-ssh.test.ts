import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import Fastify from "fastify";
import { registerChatGptDesktopSshRoutes } from "./chatgpt-desktop-ssh.js";

const profile = () => ({ version: 1 as const, id: randomUUID(), generation: randomUUID(), pid: 12345, uid: 1000, startTicks: "1234", macAsarPath: "/private/mac.asar", macAsarSha256: "bb88615052255e79b5977885f9a0cc212c268589587c79d4d3b7c4b46e881a95", linuxAsarPath: "/private/linux.asar", linuxAsarSha256: "1588e6a0e1dcfc615060152ef264d4adf2c3ff6bb7496986c72163b5853e2a2e", controlSocketPath: "/private/control.sock" });
const ready = (p: ReturnType<typeof profile>) => ({ status: { state: "ready" as const, reasonCode: "identity_ready" as const, profileId: p.id, generation: p.generation }, profile: p });
const route = (p: ReturnType<typeof profile>) => `/api/chatgpt-desktop/${p.id}/${p.generation}/ssh/discover`;

test("returns only original aliases and distinguishes missing through bounded metadata", async (t) => {
  const p = profile(), app = Fastify(); let state: "ready" | "missing" = "ready";
  await app.register(registerChatGptDesktopSshRoutes, { profileService: { readValidated: async () => ready(p) }, discovery: { discover: () => ({ sshAliases: state === "ready" ? ["server-alias", "未知项"] : [], configState: state }) } }); t.after(() => app.close());
  const first = await app.inject(route(p)); assert.equal(first.statusCode, 200); assert.deepEqual(first.json(), { sshAliases: ["server-alias", "未知项"] });
  assert.equal(first.headers["cache-control"], "no-store"); assert.equal(first.headers["x-chatgpt-ssh-config-state"], "ready"); assert.equal(first.body.includes("/private"), false);
  state = "missing"; const missing = await app.inject(route(p)); assert.equal(missing.statusCode, 200); assert.deepEqual(missing.json(), { sshAliases: [] }); assert.equal(missing.headers["x-chatgpt-ssh-config-state"], "missing");
});

test("host/path/command queries, other profiles and non-GET cannot reach configuration discovery", async (t) => {
  const p = profile(), app = Fastify(); let calls = 0;
  await app.register(registerChatGptDesktopSshRoutes, { profileService: { readValidated: async () => ready(p) }, discovery: { discover() { calls++; return { sshAliases: [], configState: "ready" }; } } }); t.after(() => app.close());
  for (const query of ["?host=arbitrary", "?path=/etc/passwd", "?command=ssh", "?configPath=/elsewhere"])
    assert.equal((await app.inject(route(p) + query)).statusCode, 400, query);
  assert.equal((await app.inject(route({ ...p, id: randomUUID() }))).statusCode, 409);
  for (const method of ["POST", "PUT", "HEAD"] as const) assert.equal((await app.inject({ method, url: route(p), ...(method === "HEAD" ? {} : { payload: { host: "arbitrary" } }) })).statusCode, 404);
  assert.equal(calls, 0);
});

test("profile or full native identity changes discard the result without a fallback", async (t) => {
  const p = profile(), app = Fastify(); let current = p, calls = 0;
  await app.register(registerChatGptDesktopSshRoutes, { profileService: { readValidated: async () => ready(current) }, discovery: { discover() { calls++; current = { ...p, startTicks: "5678" }; return { sshAliases: ["must-not-publish"], configState: "ready" }; } } }); t.after(() => app.close());
  const response = await app.inject(route(p)); assert.equal(response.statusCode, 409); assert.equal(response.body.includes("must-not-publish"), false); assert.equal(calls, 1);
});

test("another artifact version cannot use the old SSH parser even with a valid live profile", async t => {
  const p = { ...profile(), linuxAsarSha256: "a".repeat(64) }, app = Fastify(); let calls = 0;
  await app.register(registerChatGptDesktopSshRoutes, { profileService: { readValidated: async () => ready(p) }, discovery: { discover() { calls++; return { sshAliases: ["must-not-publish"], configState: "ready" }; } } }); t.after(() => app.close());
  const response = await app.inject(route(p)); assert.equal(response.statusCode, 503); assert.deepEqual(response.json(), { reasonCode: "SSH_DISCOVERY_VERSION_UNAVAILABLE" }); assert.equal(calls, 0);
});

test("unconfigured, parser errors and unknown error values stay explicit and sanitized", async (t) => {
  const p = profile(), missing = Fastify(); await missing.register(registerChatGptDesktopSshRoutes, { profileService: { readValidated: async () => ready(p) } }); t.after(() => missing.close());
  assert.deepEqual((await missing.inject(route(p))).json(), { reasonCode: "SSH_DISCOVERY_UNCONFIGURED" });
  const app = Fastify(); let code = "SSH_CONFIG_LIMIT";
  await app.register(registerChatGptDesktopSshRoutes, { profileService: { readValidated: async () => ready(p) }, discovery: { discover() { throw Object.assign(new Error("PRIVATE CONFIG BODY AND PATH"), { code }); } } }); t.after(() => app.close());
  for (const value of ["SSH_CONFIG_LIMIT", "PRIVATE ERROR BODY"]) { code = value; const response = await app.inject(route(p)); assert.equal(response.statusCode, 503); assert.deepEqual(response.json(), { reasonCode: value === "SSH_CONFIG_LIMIT" ? value : "SSH_DISCOVERY_FAILED" }); assert.equal(response.body.includes("PRIVATE"), false); }
});
