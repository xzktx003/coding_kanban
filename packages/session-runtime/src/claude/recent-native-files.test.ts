import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaudeHistory } from "./history.js";
test("installed official Claude SDK reads bounded recent/cursor/image history from private native files without modifying them", async () => {
  const home = await mkdtemp(join(tmpdir(), "cc-recent-native-files-")),
    cwd = join(home, "project"),
    id = randomUUID();
  const folder = join(
    home,
    ".claude/projects",
    cwd.replace(/[^a-zA-Z0-9]/g, "-"),
  );
  await mkdir(folder, { recursive: true });
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=",
    "base64",
  );
  const image = Buffer.concat([png, Buffer.alloc(180000)]);
  let parent: string | null = null;
  const rows = Array.from({ length: 30 }, (_, index) => {
    const uuid = randomUUID(),
      type = index % 2 ? "assistant" : "user";
    const row = {
      type,
      uuid,
      parentUuid: parent,
      sessionId: id,
      cwd,
      timestamp: new Date(1700000000000 + index * 1000).toISOString(),
      message: {
        role: type,
        content: [
          { type: "text", text: `message-${index} ` + "x".repeat(40000) },
        ],
      },
    };
    parent = uuid;
    return row;
  });
  const imageId = randomUUID();
  const imageRow = {
    type: "user",
    uuid: imageId,
    parentUuid: parent,
    sessionId: id,
    cwd,
    timestamp: new Date().toISOString(),
    message: {
      role: "user",
      content: [
        {
          type: "image",
          source: {
            type: "base64",
            media_type: "image/png",
            data: image.toString("base64"),
          },
        },
      ],
    },
  };
  const original =
      [...rows, imageRow].map((row) => JSON.stringify(row)).join("\n") + "\n",
    path = join(folder, id + ".jsonl");
  await writeFile(path, original);
  const history = new ClaudeHistory(home, {
    HOME: home,
    CLAUDE_CONFIG_DIR: join(home, ".claude"),
    PATH: process.env.PATH,
  });
  try {
    const page = await history.recentMessages(id, { limit: 4 });
    assert.equal(page.data.length, 4);
    assert.equal(page.data.at(-1)!.uuid, imageId);
    assert.ok(page.nextCursor);
    assert.deepEqual(page.data.at(-1)!.historyImages, [
      { index: 0, mimeType: "image/png" },
    ]);
    const older = await history.recentMessages(id, {
      limit: 4,
      cursor: page.nextCursor!,
    });
    assert.equal(older.data.length, 4);
    assert.equal(older.data.at(-1)!.uuid, rows[26].uuid);
    const binary = await history.messageImage(id, imageId, 0);
    assert.deepEqual(binary.bytes, image);
    const metadata = await history.recentMessages(id, { metadataOnly: true });
    assert.deepEqual(metadata.data, []);
    assert.equal(await readFile(path, "utf8"), original);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
