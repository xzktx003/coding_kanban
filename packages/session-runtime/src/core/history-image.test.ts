import test from "node:test";
import assert from "node:assert/strict";
import {
  historyImage,
  historyImageOptions,
  HISTORY_IMAGE_MAX_BYTES,
  HISTORY_IMAGE_MAX_PREVIEW_PIXELS,
} from "./history-image.js";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=",
  "base64",
);
test("history image decoder accepts only bounded actual image bytes and refuses injected paths/URLs or false MIME", () => {
  const image = historyImage({
    mimeType: "image/png",
    data: png.toString("base64"),
  });
  assert.equal(image.mimeType, "image/png");
  assert.equal(image.width, 1);
  assert.equal(image.height, 1);
  assert.deepEqual(image.bytes, png);
  assert.throws(
    () =>
      historyImage({ mimeType: "image/jpeg", data: png.toString("base64") }),
    /MIME/,
  );
  assert.throws(
    () =>
      historyImage({
        mimeType: "image/svg+xml",
        data: Buffer.from("<svg/>").toString("base64"),
      }),
    /supported/,
  );
  assert.throws(
    () =>
      historyImage({
        mimeType: "image/png",
        data: "http://external/image.png",
      }),
    /base64/,
  );
  assert.throws(
    () =>
      historyImage({
        mimeType: "image/png",
        data: Buffer.alloc(HISTORY_IMAGE_MAX_BYTES + 1).toString("base64"),
      }),
    /byte budget/,
  );
  for (const value of [
    { item_id: "one", image_index: -1 },
    { item_id: "one", image_index: 32 },
    { item_id: "one", image_index: 0, download: "yes" },
  ])
    assert.throws(() => historyImageOptions(value));
});
test("large decode dimensions block preview while an explicit byte-bounded download preserves the original", () => {
  const large = Buffer.from(png);
  large.writeUInt32BE(10000, 16);
  large.writeUInt32BE(5000, 20);
  assert.ok(50_000_000 > HISTORY_IMAGE_MAX_PREVIEW_PIXELS);
  assert.throws(
    () =>
      historyImage({ mimeType: "image/png", data: large.toString("base64") }),
    /pixel budget/,
  );
  const download = historyImage(
    { mimeType: "image/png", data: large.toString("base64") },
    true,
  );
  assert.deepEqual(download.bytes, large);
});
