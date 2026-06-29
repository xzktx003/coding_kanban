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

describe("NewSessionDialog directory picker", () => {
  it("renders a directory browse control next to the working directory input", () => {
    const markup = renderToStaticMarkup(
      createElement(NewSessionDialog, {
        open: true,
        host: { type: "local" },
        sessions: [] as AgentSessionRecord[],
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
