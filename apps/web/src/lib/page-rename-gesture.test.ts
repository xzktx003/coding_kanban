import assert from "node:assert/strict";
import test from "node:test";

import {
  beginPageRename,
  markPageRenameCancelled,
  pageRenameKeyAction,
  shouldCommitPageRename,
} from "./page-rename-gesture.js";

test("Enter commits and a later blur still commits", () => {
  const gesture = beginPageRename();

  assert.equal(pageRenameKeyAction("Enter"), "commit");
  assert.equal(shouldCommitPageRename(gesture), true);
});

test("Escape cancels before the following blur commits", () => {
  let gesture = beginPageRename();

  assert.equal(pageRenameKeyAction("Escape"), "cancel");
  gesture = markPageRenameCancelled(gesture);
  assert.equal(shouldCommitPageRename(gesture), false);
});
