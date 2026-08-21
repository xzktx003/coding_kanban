import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveTerminalReplayByteLimit,
  takeUtf8Tail,
} from "./terminal-replay-window.js";

test("terminal replay byte limit accepts only bounded positive integers", () => {
  assert.equal(resolveTerminalReplayByteLimit("262144", 4_194_304), 262_144);
  assert.equal(
    resolveTerminalReplayByteLimit("99999999", 4_194_304),
    4_194_304,
  );
  assert.equal(resolveTerminalReplayByteLimit("0", 4_194_304), 4_194_304);
  assert.equal(resolveTerminalReplayByteLimit("nope", 4_194_304), 4_194_304);
  assert.equal(resolveTerminalReplayByteLimit("1e3", 4_194_304), 4_194_304);
  assert.equal(resolveTerminalReplayByteLimit(undefined, 4_194_304), 4_194_304);
});

test("UTF-8 replay window keeps the newest complete characters within the byte cap", () => {
  const tail = takeUtf8Tail(`prefix-${"你".repeat(20)}-TAIL`, 20);
  assert.match(tail, /TAIL$/);
  assert.ok(Buffer.byteLength(tail, "utf8") <= 20);
  assert.doesNotMatch(tail, /�/);
});
