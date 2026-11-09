import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createBrowserDocument } from "../src/browser-document.mjs";

const profileId = "43e56e8a-de3f-40fb-8cf3-7177d17d24f1",
  generation = "b94128f4-288c-4c97-a5cb-891555dc8199";
const source =
  '<!DOCTYPE html><html><head><meta charset="UTF-8"><script type="module" crossorigin src="./assets/index-65a34a2d8bec.js"></script><link href="./assets/index-123.css" rel="stylesheet"></head><body><div id="root"></div></body></html>';
const digest = (text) => createHash("sha256").update(text).digest("hex");
test("replaces only the entry execution with the scoped host bootstrap and records both hashes", () => {
  const result = createBrowserDocument({
    body: Buffer.from(source),
    profileId,
    generation,
  });
  assert.equal(result.originalSha256, digest(source));
  assert.equal(result.adaptedSha256, digest(result.body));
  const text = result.body.toString();
  assert.ok(
    text.includes('<link href="./assets/index-123.css" rel="stylesheet">'),
  );
  assert.ok(text.includes('<div id="root"></div>'));
  assert.equal((text.match(/src="\.\/assets\/index-/g) ?? []).length, 0);
  assert.ok(text.includes('src="./__host/browser-entry.mjs"'));
  assert.ok(text.includes('"entry":"./assets/index-65a34a2d8bec.js"'));
  assert.ok(text.includes('"profileId":"' + profileId + '"'));
  assert.notEqual(result.originalSha256, result.adaptedSha256);
});
test("refuses unknown script topology, external paths and malformed identity", () => {
  for (const body of [
    source.replace('type="module"', 'type="text/javascript"'),
    source.replace("./assets/", "https://example.com/"),
    source.replace("./assets/", "../assets/"),
    source.replace("</head>", "<script>extra()</script></head>"),
    source.replace("<meta", '<base href="https://example.com"><meta'),
    source.replace('id="root"', 'id="other"'),
  ])
    assert.throws(() =>
      createBrowserDocument({ body: Buffer.from(body), profileId, generation }),
    );
  assert.throws(() =>
    createBrowserDocument({
      body: Buffer.from(source),
      profileId: "../x",
      generation,
    }),
  );
  assert.throws(() =>
    createBrowserDocument({
      body: Buffer.alloc(256 * 1024 + 1),
      profileId,
      generation,
    }),
  );
});
test("retains the original loading markup inside the root until the runtime is ready", () => {
  const withLoading = source.replace(
    '<div id="root"></div>',
    '<div id="root"><svg aria-label="Loading"></svg></div>',
  );
  assert.ok(
    createBrowserDocument({
      body: Buffer.from(withLoading),
      profileId,
      generation,
    })
      .body.toString()
      .includes('<div id="root"><svg aria-label="Loading"></svg></div>'),
  );
});

test("selects the full surface only through the server-owned version 2 document option", () => {
  const result = createBrowserDocument({
    body: Buffer.from(source),
    profileId,
    generation,
    version: 2,
  });
  const text = result.body.toString();
  assert.ok(text.includes('"version":2'));
  assert.ok(!text.includes('"version":1'));
  assert.ok(text.includes('src="./__host/browser-entry.mjs"'));
  for (const version of [0, 6, "2", null])
    assert.throws(() =>
      createBrowserDocument({
        body: Buffer.from(source),
        profileId,
        generation,
        version,
      }),
    );
});

test("version 3 is an explicit server-owned document recipe for shared navigation", () => {
  const body = Buffer.from(
    '<!doctype html><div id="root"></div><script type="module" crossorigin src="./assets/index-aabb.js"></script>',
  );
  const result = createBrowserDocument({
    body,
    profileId,
    generation,
    version: 3,
  });
  assert.match(result.body.toString(), /"version":3/);
});

test("version 4 is an explicit server-owned split document", () => {
  const result = createBrowserDocument({
    body: Buffer.from(source), profileId, generation, version: 4,
  });
  assert.match(result.body.toString(), /"version":4/);
});

test("version 5 is an explicit server-owned shared split document", () => {
  const result = createBrowserDocument({
    body: Buffer.from(source), profileId, generation, version: 5,
  });
  const text = result.body.toString();
  assert.ok(text.includes('"version":5'));
  assert.ok(text.includes('"profileId":"' + profileId + '"'));
  assert.ok(text.includes('"generation":"' + generation + '"'));
  assert.ok(text.includes('"entry":"./assets/index-65a34a2d8bec.js"'));
});
