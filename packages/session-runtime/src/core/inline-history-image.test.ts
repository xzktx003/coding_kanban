import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ccRecentPage } from "../claude/recent-history.js";
import { SessionDatabase } from "../storage/database.js";
import { projectAuxiliaryChatEnvelope } from "@agent-orchestrator/shared";
const gif = (width: number, height: number) => {
  const b = Buffer.from(
    "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
    "base64",
  );
  b.writeUInt16LE(width, 6);
  b.writeUInt16LE(height, 8);
  return b.toString("base64");
};
const row = (data: string) => ({
  type: "user",
  uuid: "image-item",
  session_id: "one",
  message: {
    role: "user",
    content: [
      { type: "text", text: "keep the question" },
      {
        type: "image",
        source: { type: "base64", media_type: "image/gif", data },
      },
    ],
  },
});
test("small compressed image cannot bypass CC recent and live pixel guards; ordinary text, identity and safe images survive", () => {
  const giant = gif(10000, 5000),
    original = row(giant),
    page = ccRecentPage("one", [original], "v");
  assert.equal(JSON.stringify(page).includes(giant), false);
  assert.equal(page.data[0].uuid, "image-item");
  assert.match(JSON.stringify(page), /keep the question/);
  assert.deepEqual(page.data[0].historyImages, [
    { index: 0, mimeType: "image/gif" },
  ]);
  const projected = projectAuxiliaryChatEnvelope({
    event: "cc-message",
    seq: 7,
    payload: original,
  }) as any;
  assert.equal(projected.seq, 7);
  assert.equal(projected.payload.uuid, "image-item");
  assert.equal(JSON.stringify(projected).includes(giant), false);
  assert.deepEqual(projected.payload.historyDetail, { itemId: "image-item" });
  const safe = row(gif(1, 1));
  assert.equal(ccRecentPage("one", [safe], "v").data[0].message, safe.message);
  const event = { event: "cc-message", seq: 8, payload: safe };
  assert.equal(projectAuxiliaryChatEnvelope(event), event);
});
test("ACP recent and live compressed image are lazy before browser decode with exact readonly source identity", async () => {
  const home = await mkdtemp(join(tmpdir(), "inline-pixel-")),
    db = new SessionDatabase(home);
  try {
    db.upsertSession({ sessionId: "one", agentId: "fixture", cwd: home });
    const content = {
        type: "image",
        mimeType: "image/gif",
        data: gif(10000, 5000),
      },
      update = { sessionUpdate: "user_message_chunk", content };
    const id = db.appendUpdate("one", update),
      page = await db.getRecentUpdates("one");
    assert.equal(page.data[0].images, undefined);
    assert.deepEqual(page.data[0].historyImages, [
      { index: 0, mimeType: "image/gif" },
    ]);
    assert.deepEqual(page.data[0].historyDetail, { itemId: `source-${id}` });
    // A previous deployment may already have put an unsafe inline image in v1.
    db.db
      .prepare("UPDATE acp_chat_projection_v1 SET payload=? WHERE session_id=?")
      .run(
        JSON.stringify({
          ...page.data[0],
          images: [`data:image/gif;base64,${content.data}`],
        }),
        "one",
      );
    const cached = await db.getRecentUpdates("one");
    assert.equal(cached.data[0].images, undefined);
    assert.deepEqual(cached.data[0].historyImages, [
      { index: 0, mimeType: "image/gif" },
    ]);
    const projected = projectAuxiliaryChatEnvelope({
      event: "acp-message",
      seq: 9,
      payload: {
        kind: "update",
        historySourceId: id,
        sessionId: "one",
        update,
      },
    }) as any;
    assert.equal(projected.seq, 9);
    assert.equal(projected.payload.historySourceId, id);
    assert.equal(JSON.stringify(projected).includes(content.data), false);
    assert.deepEqual(projected.payload.update.historyDetail, {
      itemId: `source-${id}`,
    });
  } finally {
    db.close();
    await rm(home, { recursive: true, force: true });
  }
});
