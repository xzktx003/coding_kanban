import assert from "node:assert/strict";
import test from "node:test";

import { normalizeStdinPayload } from "./stdin-payload.js";

test("normalizeStdinPayload submits plain text for legacy process runtimes", () => {
  assert.equal(normalizeStdinPayload("hello codex"), "hello codex\n");
});

test("normalizeStdinPayload does not append enter to explicit submissions", () => {
  assert.equal(normalizeStdinPayload("hello codex\r"), "hello codex\r");
  assert.equal(normalizeStdinPayload("hello codex\n"), "hello codex\n");
  assert.equal(normalizeStdinPayload("line 1\nline 2"), "line 1\nline 2");
});

test("normalizeStdinPayload forwards mobile terminal controls without enter", () => {
  assert.equal(normalizeStdinPayload("\t"), "\t");
  assert.equal(normalizeStdinPayload("\x03"), "\x03");
  assert.equal(normalizeStdinPayload("\x1b"), "\x1b");
  assert.equal(normalizeStdinPayload("\x7f"), "\x7f");
  assert.equal(normalizeStdinPayload("\x1b[Z"), "\x1b[Z");
  assert.equal(normalizeStdinPayload("\x1b[13;2u"), "\x1b[13;2u");
  assert.equal(normalizeStdinPayload("\x1b[13;5u"), "\x1b[13;5u");
  assert.equal(normalizeStdinPayload("\x1b[A"), "\x1b[A");
  assert.equal(normalizeStdinPayload("\x0c"), "\x0c");
  assert.equal(normalizeStdinPayload("\x1a"), "\x1a");
  assert.equal(normalizeStdinPayload("\x0f"), "\x0f");
  assert.equal(normalizeStdinPayload("\x15"), "\x15");
  assert.equal(normalizeStdinPayload("\x17"), "\x17");
});
