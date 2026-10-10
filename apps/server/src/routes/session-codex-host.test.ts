import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { registerCodexHostRoutes } from "./session-codex-host.js";
import { CodexHostCompanionCredential } from "../services/codex-host-companion.js";
test("real gateway pairing validates origin, private auth, workspace and original session", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kanban-host-test-"));
  const cwd = join(directory, "project");
  await mkdir(cwd);
  const credential = new CodexHostCompanionCredential(directory);
  await credential.write("http://127.0.0.1:1");
  const token = JSON.parse(await readFile(credential.file, "utf8")).token;
  const editorKey = join(directory, "window-a.code-workspace");
  await writeFile(editorKey, JSON.stringify({ folders: [{ path: cwd }] }));
  const owner = { cwd, threadId: "thread-a", draftOwner: "draft-a" };
  const app = Fastify();
  registerCodexHostRoutes(app, {
    credential,
    resolveOwner: async (captured) => {
      assert.equal(captured.threadId, owner.threadId);
      return cwd;
    },
  });
  try {
    const badOrigin = await app.inject({
      method: "POST",
      url: "/api/session/codex-host/bind",
      headers: { origin: "https://evil.invalid", host: "localhost" },
      payload: { owner, nonce: "nonce-a", editorKey },
    });
    assert.equal(badOrigin.statusCode, 403);
    const badAuth = await app.inject({
      method: "POST",
      url: "/api/session/codex-host/companion/connect",
      payload: { cwd, instanceId: "instance-a", editorKey, capabilities: {} },
    });
    assert.equal(badAuth.statusCode, 401);
    const bind = await app.inject({
      method: "POST",
      url: "/api/session/codex-host/bind",
      payload: { owner, nonce: "nonce-a", editorKey },
    });
    assert.equal(bind.statusCode, 200);
    assert.equal(bind.json().available, false);
    const readWorkspace = await app.inject({
      method: "POST",
      url: "/api/session/codex-host/workspace",
      payload: { owner, nonce: "nonce-a", action: "read" },
    });
    assert.equal(
      readWorkspace.statusCode,
      200,
      "registered plain directories can read instructions",
    );
    assert.equal(readWorkspace.json().git.available, false);
    const saveInstructions = await app.inject({
      method: "POST",
      url: "/api/session/codex-host/workspace",
      payload: {
        owner,
        nonce: "nonce-a",
        action: "instructions",
        confirmed: true,
        revision: readWorkspace.json().agents.revision,
        text: "plain project instructions",
      },
    });
    assert.equal(saveInstructions.statusCode, 200);
    assert.equal(
      await readFile(join(cwd, "AGENTS.md"), "utf8"),
      "plain project instructions",
    );
    const headers = { authorization: "Bearer " + token };
    const companionBody = { cwd, instanceId: "instance-a", editorKey };
    const connect = await app.inject({
      method: "POST",
      url: "/api/session/codex-host/companion/connect",
      headers,
      payload: {
        ...companionBody,
        capabilities: {
          context: true,
          openLocation: true,
          showDiff: true,
          todoCodeLens: true,
          lsp: false,
        },
      },
    });
    assert.equal(connect.statusCode, 200);
    const pending = app.inject({
      method: "POST",
      url: "/api/session/codex-host/command",
      payload: { owner, nonce: "nonce-a", command: { type: "context" } },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const poll = await app.inject({
      method: "POST",
      url: "/api/session/codex-host/companion/poll",
      headers,
      payload: companionBody,
    });
    const requestId = poll.json().commands[0].id;
    const result = await app.inject({
      method: "POST",
      url: "/api/session/codex-host/companion/result",
      headers,
      payload: {
        ...companionBody,
        requestId,
        result: {
          path: join(cwd, "unsaved.ts"),
          text: "native unsaved buffer",
        },
      },
    });
    assert.equal(result.statusCode, 200);
    assert.equal((await pending).json().text, "native unsaved buffer");
    const escape = await app.inject({
      method: "POST",
      url: "/api/session/codex-host/command",
      payload: {
        owner,
        nonce: "nonce-a",
        command: { type: "openLocation", path: directory },
      },
    });
    assert.equal(escape.statusCode, 400);
    const script = await app.inject("/api/session/codex-host/relay.js");
    assert.equal(script.statusCode, 200);
    assert.equal(script.body.includes(token), false);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
