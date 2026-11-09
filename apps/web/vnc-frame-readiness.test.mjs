import test from "node:test";
import assert from "node:assert/strict";
import { inspectNativeCanvas } from "./vnc-frame-readiness.mjs";
const canvas = (color) => ({
  width: 128,
  height: 128,
  getContext() {
    return {
      getImageData() {
        const data = new Uint8ClampedArray(128 * 128 * 4);
        for (let i = 0; i < data.length; i += 4) data.set(color(i / 4), i);
        return { data };
      },
    };
  },
});
test("a connected sized canvas without pixels is not a native frame", () => {
  assert.equal(
    inspectNativeCanvas(canvas(() => [0, 0, 0, 0])).state,
    "waiting",
  );
});
test("a uniform initial fill is not mistaken for the application frame", () => {
  assert.equal(
    inspectNativeCanvas(canvas(() => [0, 0, 0, 255])).state,
    "waiting",
  );
});
test("a varied opaque native framebuffer is usable without exposing pixel values", () => {
  const s = inspectNativeCanvas(
    canvas((i) => [i % 251, (i * 3) % 251, (i * 7) % 251, 255]),
  );
  assert.equal(s.state, "ready");
  assert.ok(s.colors >= 4);
  assert.ok(!Object.hasOwn(s, "pixels"));
  assert.ok(!Object.hasOwn(s, "data"));
});
test("an oversized or missing canvas cannot pass and is not read", () => {
  let reads = 0;
  for (const c of [
    null,
    {
      width: 8192,
      height: 8192,
      getContext() {
        reads++;
      },
    },
  ])
    assert.equal(inspectNativeCanvas(c).state, "invalid");
  assert.equal(reads, 0);
});
test("a pixel read failure is explicit and emits no native error detail", () => {
  const s = inspectNativeCanvas({
    width: 128,
    height: 128,
    getContext() {
      throw Error("private pixels");
    },
  });
  assert.equal(s.state, "unreadable");
  assert.ok(!JSON.stringify(s).includes("private"));
});
