import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveSessionGroupSelection } from "./SessionGroupControls.js";

describe("resolveSessionGroupSelection", () => {
  it("moves cards to a selected group", () => {
    assert.deepEqual(resolveSessionGroupSelection("group-backend"), {
      type: "move",
      groupId: "group-backend",
    });
  });

  it("moves cards back to the automatic ungrouped section", () => {
    assert.deepEqual(resolveSessionGroupSelection("__ungrouped__"), {
      type: "move",
      groupId: null,
    });
  });

  it("starts group creation without emitting a move target", () => {
    assert.deepEqual(resolveSessionGroupSelection("__create__"), {
      type: "create",
    });
  });
});
