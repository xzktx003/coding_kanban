import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { UNGROUPED_SESSION_GROUP_ID } from "../lib/session-groups.js";
import {
  resolveSessionGroupSelection,
  resolveSessionGroupTone,
  SessionGroupHeader,
} from "./SessionGroupControls.js";

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

describe("SessionGroupHeader appearance", () => {
  it("keeps ungrouped sessions neutral", () => {
    assert.equal(
      resolveSessionGroupTone(UNGROUPED_SESSION_GROUP_ID),
      "neutral",
    );
  });

  it("assigns stable categorical tones to user-created groups", () => {
    const groupIds = ["group-compression", "group-platform", "group-patent"];
    const tones = groupIds.map(resolveSessionGroupTone);

    assert.equal(new Set(tones).size, groupIds.length);
    assert.deepEqual(groupIds.map(resolveSessionGroupTone), tones);
  });

  it("exposes the resolved tone on the shared group header", () => {
    const tone = resolveSessionGroupTone("group-compression");
    const markup = renderToStaticMarkup(
      createElement(SessionGroupHeader, {
        groupId: "group-compression",
        name: "模型压缩研究",
        count: 4,
      }),
    );

    assert.match(markup, new RegExp(`data-group-tone="${tone}"`));
    assert.match(markup, />模型压缩研究</);
  });
});
