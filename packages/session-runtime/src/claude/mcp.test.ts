import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { mkdtemp, writeFile, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaudeConfig } from "./config.js";
import { registerUnifiedMcpRoutes } from "./mcp.js";
import { getTomlStore } from "../config/toml-store.js";

test("unified MCP accepts aliases, native HTTP config, concurrent writes, preserves unknown TOML and backup", async () => {
  const home = await mkdtemp(join(tmpdir(), "cc-mcp-"));
  const config = new ClaudeConfig({ HOME: home });
  const app = Fastify();
  registerUnifiedMcpRoutes(app, config);
  const file = join(home, ".codex", "config.toml");
  try {
    await mkdir(join(home, ".codex"));
    await writeFile(
      file,
      '# original\nmodel = "keep"\n[mcp_servers.native]\nurl = "https://example.test/mcp"\n',
    );
    let result = await app.inject({
      method: "POST",
      url: "/api/codex/mcp/read",
      payload: { client_name: "codex" },
    });
    assert.equal(result.json().mcpServers.native.type, "http");
    await Promise.all(
      ["a", "b"].map((serverName) =>
        app
          .inject({
            method: "POST",
            url: "/api/codex/mcp/add",
            payload: {
              clientName: "codex",
              serverName,
              serverConfig: { command: "node", args: ["--version"] },
            },
          })
          .then((r) => assert.equal(r.statusCode, 200)),
      ),
    );
    assert.equal((await getTomlStore(file).read()).model, "keep");
    assert.ok(
      (await readFile(file + ".bak", "utf8")).includes('model = "keep"'),
    );
    result = await app.inject({
      method: "POST",
      url: "/api/codex/mcp/disable",
      payload: { clientName: "codex", serverName: "a" },
    });
    assert.equal(result.statusCode, 200);
    result = await app.inject({
      method: "POST",
      url: "/api/codex/mcp/read",
      payload: { clientName: "codex" },
    });
    assert.equal(result.json().mcpServers.a.enabled, false);
    assert.ok(result.json().mcpServers.b);
    result = await app.inject({
      method: "POST",
      url: "/api/codex/mcp/add",
      payload: {
        clientName: "cc",
        serverName: "global",
        scope: "global",
        serverConfig: { type: "http", url: "https://example.test" },
      },
    });
    assert.equal(result.statusCode, 200);
    await writeFile(file, "not valid toml !!!");
    result = await app.inject({
      method: "POST",
      url: "/api/codex/mcp/remove",
      payload: { clientName: "codex", serverName: "a" },
    });
    assert.equal(result.statusCode, 500);
    assert.equal(await readFile(file, "utf8"), "not valid toml !!!");
  } finally {
    await app.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("shared TOML lock serializes native writer with read-modify-write mutations", async () => {
  const home = await mkdtemp(join(tmpdir(), "toml-native-lock-"));
  const file = join(home, "config.toml");
  const store = getTomlStore(file);
  try {
    await writeFile(file, "first = true\n");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const native = store.exclusive(async () => {
      await gate;
      await writeFile(file, "first = true\nfrom_native = true\n");
    });
    const mutation = store.update((value) => ({
      ...value,
      from_typescript: true,
    }));
    release();
    await Promise.all([native, mutation]);
    assert.deepEqual(await store.read(), {
      first: true,
      from_native: true,
      from_typescript: true,
    });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
