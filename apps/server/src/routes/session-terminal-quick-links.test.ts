import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { registerSessionTerminalQuickLinksRoutes } from "./session-terminal-quick-links.js";

test("terminal quick links persist in the session data directory across route instances", async () => {
  const root = await mkdtemp(join(tmpdir(), "terminal-links-"));
  const attachmentRoot = join(root, "uploads");
  let app = Fastify();
  registerSessionTerminalQuickLinksRoutes(app, { attachmentRoot });
  try {
    const payload = [{ title: "Harness", url: "http://10.30.0.28:3430/" }];
    assert.deepEqual((await app.inject({ method: "PUT", url: "/api/session/terminal-quick-links", payload })).json(), payload);
    assert.deepEqual(JSON.parse(await readFile(join(root, "terminal-quick-links.json"), "utf8")), payload);
    await app.close();
    app = Fastify();
    registerSessionTerminalQuickLinksRoutes(app, { attachmentRoot });
    assert.deepEqual((await app.inject("/api/session/terminal-quick-links")).json(), payload);
  } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
});

test("terminal quick links reject unsafe and duplicate entries", async () => {
  const app = Fastify();
  registerSessionTerminalQuickLinksRoutes(app, { attachmentRoot: "/tmp/terminal-links-test/uploads" });
  try {
    for (const links of [
      [{ title: "x", url: "javascript:alert(1)" }],
      [{ title: "x", url: "http://example.com" }, { title: "y", url: "http://example.com/" }],
    ]) assert.equal((await app.inject({ method: "PUT", url: "/api/session/terminal-quick-links", payload: links })).statusCode, 400);
  } finally { await app.close(); }
});
