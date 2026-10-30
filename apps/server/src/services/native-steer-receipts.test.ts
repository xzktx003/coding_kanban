import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NativeSteerReceipts } from "./native-steer-receipts.js";

const row = (id: string, createdAt: number, namespace = "account-a") => ({
  sourceId: id,
  operationId: id,
  clientId: id,
  threadId: "thread",
  turnId: "turn",
  scope: "original-scope",
  namespace,
  createdAt,
  text: `saved ${id}`,
  images: ["/image.png"],
});

test("steer display separates unknown intent, native acceptance, exact provenance and stable pagination", async () => {
  const log = new NativeSteerReceipts(() => null);
  await log.prepare(row("unknown", 0));
  for (const id of ["a", "b", "c"]) {
    await log.prepare(row(id, 1));
    await log.accept("thread", id);
  }
  await log.prepare(row("other-account", 2, "account-b"));
  await log.accept("thread", "other-account");
  const first = await log.page("thread", "account-a", null, 1);
  assert.equal(first.data[0].sourceId, "c");
  assert.ok(first.nextCursor);
  await log.acknowledge("thread", "wrong-turn", "a", "account-a");
  assert.equal((await log.page("thread", "account-a")).data.length, 3);
  await log.acknowledge("thread", "turn", "a", "account-a");
  assert.deepEqual(
    (await log.page("thread", "account-a", first.nextCursor)).data.map(
      (item) => item.sourceId,
    ),
    ["b"],
  );
  assert.deepEqual(
    (await log.page("thread", "account-b")).data.map((item) => item.sourceId),
    ["other-account"],
  );
  assert.equal(
    (
      await log.page(
        "thread",
        "account-a",
        null,
        30,
        async (saved) => saved.operationId === "unknown",
      )
    ).data[0].sourceId,
    "unknown",
  );
  await assert.rejects(log.page("thread", "account-a", "bad cursor"), /分页/);
});

test("steer display rolls full segments into cold history instead of imposing a lifetime send limit", async () => {
  const log = new NativeSteerReceipts(() => null);
  await assert.rejects(
    log.prepare({ ...row("too-big", 1), text: "x".repeat(1024 * 1024) }),
    /尚未发送/,
  );
  for (let n = 0; n < 512; n++) await log.prepare(row(`source-${n}`, n));
  await log.prepare(row("source-513", 513));
  await log.accept("thread", "source-513");
  await log.accept("thread", "source-0");
  assert.equal(
    (await log.page("thread", "account-a")).data[0].text,
    "saved source-513",
  );
  const first = await log.page("thread", "account-a");
  assert.ok(first.nextCursor);
  assert.equal(
    (await log.page("thread", "account-a", first.nextCursor)).data[0].text,
    "saved source-0",
  );
});

test("cold durable steer segments page from newest without a whole-history response and duplicate native identities never erase both sources", async () => {
  const dir = await mkdtemp(join(tmpdir(), "steer-cold-segments-"));
  try {
    const log = new NativeSteerReceipts(() => dir),
      text = "保".repeat(260_000);
    for (let n = 0; n < 12; n++) {
      await log.prepare({ ...row(`cold-${n}`, n), text });
      await log.accept("thread", `cold-${n}`);
    }
    const reopened = new NativeSteerReceipts(() => dir),
      ids: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await reopened.page("thread", "account-a", cursor);
      assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 1024 * 1024);
      ids.push(...page.data.map((item) => item.sourceId));
      cursor = page.nextCursor;
    } while (cursor);
    assert.deepEqual(
      ids,
      Array.from({ length: 12 }, (_, n) => `cold-${11 - n}`),
    );
    const first = { ...row("same-source-a", 20), clientId: "shared-client" };
    await reopened.prepare(first);
    await reopened.accept("thread", first.operationId);
    await reopened.prepare({
      ...first,
      sourceId: "same-source-b",
      operationId: "same-source-b",
    });
    await reopened.accept("thread", "same-source-b");
    await reopened.acknowledge("thread", "turn", "shared-client", "account-a");
    const page = await reopened.page("thread", "account-a", null, 2);
    assert.equal(page.data.length, 2);
    assert.ok(page.data.every((item) => item.nativeIdentityUnique === false));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a corrupt persisted steer journal is never overwritten or treated as an empty history", async () => {
  const dir = await mkdtemp(join(tmpdir(), "steer-journal-corrupt-"));
  try {
    await mkdir(join(dir, "steer-display"));
    await writeFile(
      join(dir, "steer-display", "meta.json"),
      JSON.stringify({ version: 1, current: -1 }),
    );
    const log = new NativeSteerReceipts(() => dir);
    await assert.rejects(log.prepare(row("new", 2)), /损坏/);
    await assert.rejects(log.page("thread", "account-a"), /损坏/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
