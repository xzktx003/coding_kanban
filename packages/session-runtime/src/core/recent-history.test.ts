import test from "node:test";
import assert from "node:assert/strict";
import {
  historyBefore,
  historyCursor,
  recentHistoryOptions,
  historyDetailOptions,
  historyDetailText,
  historyTextParts,
} from "./recent-history.js";
test("recent cursors bind provider and exact session; unsafe page and detail requests are rejected", () => {
  const cursor = historyCursor("acp", "one", "acp-123-1");
  assert.equal(historyBefore("acp", "one", cursor), "acp-123-1");
  assert.throws(() => historyBefore("cc", "one", cursor), /does not belong/);
  assert.throws(() => historyBefore("acp", "two", cursor), /does not belong/);
  for (const value of [
    { limit: 257 },
    { limit: 0 },
    { limit: 1.5 },
    { cursor: {} },
    { metadataOnly: "yes" },
  ])
    assert.throws(() => recentHistoryOptions(value));
  for (const value of [
    { item_id: "", offset: 0 },
    { item_id: "one", limit: 65537 },
    { item_id: "one", offset: -1 },
  ])
    assert.throws(() => historyDetailOptions(value));
});
test("Unicode seams and escaped detail content stay bounded and reconstruct the original exactly", () => {
  const value = { text: "before🧪\n\u0000".repeat(15000) };
  const complete = JSON.stringify(value, null, 2);
  let offset = 0;
  let result = "";
  let revision: string | undefined;
  do {
    const page = historyDetailText(value, { offset, limit: 65536 });
    assert.ok(Buffer.byteLength(JSON.stringify(page)) < 65536);
    assert.ok(page.nextOffset === null || page.nextOffset > offset);
    assert.ok(!revision || revision === page.itemRevision);
    revision = page.itemRevision;
    result += page.text;
    if (page.nextOffset === null) break;
    offset = page.nextOffset;
  } while (true);
  assert.equal(result, complete);
  assert.equal(
    [...historyTextParts("🧪汉字".repeat(1000), 31)].join(""),
    "🧪汉字".repeat(1000),
  );
});
test("ordinary detail pages use their safe wire budget instead of requiring hundreds of tiny next-page clicks",()=>{
  const page=historyDetailText({text:"x".repeat(1024*1024)},{offset:0,limit:65536});
  assert.ok(page.text.length>50*1024);
  assert.ok(Buffer.byteLength(JSON.stringify(page))<65536);
});
