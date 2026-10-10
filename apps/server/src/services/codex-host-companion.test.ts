import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexHostCompanionCredential } from "./codex-host-companion.js";
test("reused companion credentials enforce private permissions and malformed multibyte authorization returns false", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "kanban-host-credential-test-"),
  );
  try {
    const credential = new CodexHostCompanionCredential(directory);
    await writeFile(
      credential.file,
      JSON.stringify({
        version: 1,
        token: "a".repeat(64),
        origin: "http://127.0.0.1:1",
      }),
      { mode: 0o644 },
    );
    await credential.write("http://127.0.0.1:12345");
    assert.equal((await stat(credential.file)).mode & 0o777, 0o600);
    const stored = JSON.parse(await readFile(credential.file, "utf8"));
    assert.equal(credential.valid("Bearer " + stored.token), true);
    assert.equal(credential.valid("Bearer " + "é".repeat(64)), false);
    assert.equal(credential.valid("bearer " + stored.token), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
