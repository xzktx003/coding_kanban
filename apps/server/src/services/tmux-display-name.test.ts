import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalTmuxDisplayName,
  normalizeTmuxDisplayName,
} from "./tmux-display-name.js";

test("uses the real tmux session name for every new title", () => {
  assert.equal(canonicalTmuxDisplayName("dev"), "dev");
  assert.equal(canonicalTmuxDisplayName("a+b"), "a+b");
});

test("normalizes system-generated tmux titles to the real session name", () => {
  assert.equal(normalizeTmuxDisplayName("tmux:dev", "dev"), "dev");
  assert.equal(normalizeTmuxDisplayName("tmux:dev (bash)", "dev"), "dev");
  assert.equal(
    normalizeTmuxDisplayName("tmux:dev/bash (远程: repo)", "dev"),
    "dev",
  );
});

test("preserves custom, non-tmux, and lookalike titles", () => {
  assert.equal(normalizeTmuxDisplayName("Development", "dev"), "Development");
  assert.equal(normalizeTmuxDisplayName("tmux:other", "dev"), "tmux:other");
  assert.equal(
    normalizeTmuxDisplayName("tmux:dev custom", "dev"),
    "tmux:dev custom",
  );
  assert.equal(normalizeTmuxDisplayName("tmux:a+b", "a+b"), "a+b");
  assert.equal(normalizeTmuxDisplayName("plain", undefined), "plain");
});
