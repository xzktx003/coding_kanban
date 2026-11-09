import { it } from "node:test";
import assert from "node:assert/strict";
import { parseQuickLinks, createQuickLink } from "./quick-links.js";
it("accepts LAN HTTP links and rejects executable protocols and credentials", () => {
  assert.equal(
    createQuickLink("Harness", "http://10.30.0.28:3430/").url,
    "http://10.30.0.28:3430/",
  );
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,test",
    "https://user:secret@example.com",
  ])
    assert.throws(() => createQuickLink("test", url));
});
it("restores valid entries and rejects corrupt or oversized saved lists", () => {
  const link = createQuickLink("Docs", "https://example.com");
  assert.deepEqual(parseQuickLinks(JSON.stringify([link])), [link]);
  assert.deepEqual(parseQuickLinks("{broken"), []);
  assert.deepEqual(
    parseQuickLinks(JSON.stringify([{ title: "bad", url: "javascript:x" }])),
    [],
  );
});
