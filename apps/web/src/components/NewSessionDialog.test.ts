import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { AgentSessionRecord } from "@agent-orchestrator/shared";

import {
  getParentDirectoryPath,
  joinDirectoryPath,
  NewSessionDialog,
} from "./NewSessionDialog.js";
import type { SessionGroupState } from "../lib/session-groups.js";

describe("NewSessionDialog directory picker", () => {
  it("renders a directory browse control next to the working directory input", () => {
    const markup = renderToStaticMarkup(
      createElement(NewSessionDialog, {
        open: true,
        host: { type: "local" },
        sessions: [] as AgentSessionRecord[],
        sessionGroups: { groups: [], assignments: {}, collapsedGroupIds: [] },
        onClose: () => {},
        onLaunched: () => {},
      }),
    );

    assert.match(markup, /data-testid="new-session-dir"/);
    assert.match(markup, /data-testid="new-session-browse-dir"/);
    assert.match(markup, />选择<\/button>/);
  });

  it("builds created folder paths relative to the current directory", () => {
    assert.equal(joinDirectoryPath("/", "work"), "/work");
    assert.equal(
      joinDirectoryPath("/data01/home/houmo", "work"),
      "/data01/home/houmo/work",
    );
    assert.equal(
      joinDirectoryPath("/data01/home/houmo/", "/work/"),
      "/data01/home/houmo/work",
    );
  });

  it("returns stable parent paths for root, home, and nested directories", () => {
    assert.equal(getParentDirectoryPath("/"), "/");
    assert.equal(getParentDirectoryPath("~"), "~");
    assert.equal(getParentDirectoryPath("/data01/home/houmo"), "/data01/home");
    assert.equal(getParentDirectoryPath("workspace/project"), "workspace");
  });
});

describe("NewSessionDialog session groups", () => {
  it("renders ungrouped and configured group choices", () => {
    const sessionGroups: SessionGroupState = {
      groups: [
        { id: "group-backend", name: "后端项目" },
        { id: "group-docs", name: "文档" },
      ],
      assignments: {},
      collapsedGroupIds: [],
    };

    const markup = renderToStaticMarkup(
      createElement(NewSessionDialog, {
        open: true,
        host: { type: "local" },
        sessions: [] as AgentSessionRecord[],
        sessionGroups,
        onClose: () => {},
        onLaunched: () => {},
      }),
    );

    assert.match(markup, /data-testid="new-session-group"/);
    assert.match(markup, />未分组<\/option>/);
    assert.match(markup, /value="group-backend">后端项目<\/option>/);
    assert.match(markup, /value="group-docs">文档<\/option>/);
  });
});
