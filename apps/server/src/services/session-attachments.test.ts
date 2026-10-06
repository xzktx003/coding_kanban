import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveSessionAttachment } from "./session-attachments.js";

test("uploaded attachment bytes persist inside the application data directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "session-attachment-"));
  try {
    const data = Buffer.from("a,b\n1,2\n");
    const path = await saveSessionAttachment(root, {
      name: "table.csv",
      data: data.toString("base64"),
    });
    assert.ok(path.startsWith(root + "/"));
    assert.deepEqual(await readFile(path), data);
    assert.equal(
      await saveSessionAttachment(root, {
        name: "table.csv",
        data: data.toString("base64"),
      }),
      path,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("attachment path injection, invalid encoding and excessive data are rejected", async () => {
  const root = await mkdtemp(join(tmpdir(), "session-attachment-"));
  try {
    for (const input of [
      { name: "../../file", data: "YQ==" },
      { name: "bad\u0000.txt", data: "YQ==" },
      { name: "file.txt", data: "not-base64!" },
      {
        name: "big.txt",
        data: Buffer.alloc(10 * 1024 * 1024 + 1).toString("base64"),
      },
    ]) {
      await assert.rejects(saveSessionAttachment(root, input));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
