import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildServer } from "./app.js";

const materializeUrl = "/api/session/goal-attachments/materialize";
const readUrl = "/api/session/goal-attachments/read";
const cleanupUrl = "/api/session/goal-attachments/cleanup";

test("buildServer serves the complete Unicode Goal attachment lifecycle without an upstream runtime", { concurrency: false }, async () => {
  const home = await mkdtemp(join(tmpdir(), "kanban-app-goal-attachments-"));
  const dataHome = join(home, "session-data");
  const attachmentRoot = join(dataHome, "uploads");
  const goalRoot = join(dataHome, "goal-attachments");
  const environmentKeys = [
    "SESSION_DATA_HOME",
    "SESSION_MODE_ENABLED",
    "CODEX_HOME",
  ] as const;
  const previousEnvironment = environmentKeys.map(
    (key) => [key, process.env[key]] as const,
  );
  const originalFetch = globalThis.fetch;
  const upstreamRequests: string[] = [];
  let runtimeStarts = 0;
  let gitStarts = 0;
  let gitStops = 0;
  let gitOperations = 0;
  let ownedApp: ReturnType<typeof buildServer>["app"] | undefined;

  try {
    process.env.SESSION_DATA_HOME = dataHome;
    process.env.SESSION_MODE_ENABLED = "0";
    process.env.CODEX_HOME = join(home, "unused-native-codex");
    globalThis.fetch = async (input) => {
      upstreamRequests.push(String(input));
      throw new Error("Goal attachment routes must not delegate to an upstream");
    };
    const { app, registry } = buildServer({
      sessionAttachmentRoot: attachmentRoot,
      // No runtime origin is configured; the local routes must work independently.
      ensureSessionRuntime: async () => {
        runtimeStarts++;
        return undefined;
      },
      gitAutoUpdateService: {
        start() {
          gitStarts++;
        },
        stop() {
          gitStops++;
        },
        getStatus() {
          gitOperations++;
          throw new Error("Goal attachment routes must not read Git state");
        },
        async checkNow() {
          gitOperations++;
          throw new Error("Goal attachment routes must not check Git state");
        },
        async applyUpdate() {
          gitOperations++;
          throw new Error("Goal attachment routes must not update Git state");
        },
      },
    });
    ownedApp = app;
    const assertIsolated = () => {
      assert.equal(app.server.listening, false);
      assert.deepEqual(registry.list().items, []);
      assert.equal(registry.list().activeAgentSessionId, null);
      assert.equal(runtimeStarts, 0);
      assert.deepEqual(upstreamRequests, []);
      assert.equal(gitOperations, 0);
      assert.equal(gitStarts, 1);
    };
    assert.deepEqual(registry.list().items, []);
    assert.equal(app.server.listening, false);
    const objective = `${"😀目标".repeat(1400)}\n终点 café 🧭`;
    assert.ok(Array.from(objective).length > 4000);
    const made = await app.inject({
      method: "POST",
      url: materializeUrl,
      payload: { objective, images: [], mentions: [], pastedTexts: [] },
    });
    assert.equal(made.statusCode, 200, made.body);
    assertIsolated();
    const receipt: {
      objective: string;
      cleanup: { id: string; token: string };
    } = made.json();
    assert.equal(typeof receipt.objective, "string");
    assert.ok(receipt.cleanup);
    assert.match(
      receipt.cleanup.id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    assert.match(receipt.cleanup.token, /^[0-9a-f]{64}$/);
    assert.deepEqual(Object.keys(receipt.cleanup).sort(), ["id", "token"]);
    const directory = join(goalRoot, receipt.cleanup.id);
    const objectivePath = join(directory, "goal-objective.md");
    assert.equal(
      receipt.objective,
      `Read the Codex goal objective file at ${objectivePath} before continuing.`,
    );
    assert.ok(Array.from(receipt.objective).length <= 4000);
    assert.equal(await readFile(objectivePath, "utf8"), objective);
    assert.equal((await stat(directory)).isDirectory(), true);

    const read = await app.inject({
      method: "POST",
      url: readUrl,
      payload: { objective: receipt.objective },
    });
    assert.equal(read.statusCode, 200, read.body);
    assert.deepEqual(read.json(), { objective });
    assertIsolated();

    const cleanup = await app.inject({
      method: "POST",
      url: cleanupUrl,
      payload: receipt.cleanup,
    });
    assert.equal(cleanup.statusCode, 200, cleanup.body);
    assert.deepEqual(cleanup.json(), { ok: true });
    await assert.rejects(stat(objectivePath), { code: "ENOENT" });
    await assert.rejects(stat(directory), { code: "ENOENT" });
    assert.deepEqual(await readdir(goalRoot), []);
    assertIsolated();
    await app.close();
    ownedApp = undefined;
    assert.equal(gitStops, 1);
    assertIsolated();
  } finally {
    try {
      await ownedApp?.close();
    } finally {
      globalThis.fetch = originalFetch;
      for (const [key, value] of previousEnvironment) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await rm(home, { recursive: true, force: true });
    }
  }
});
