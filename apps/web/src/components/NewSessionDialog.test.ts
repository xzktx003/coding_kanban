import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { AgentSessionRecord } from "@agent-orchestrator/shared";

import {
  buildManualSshTarget,
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

describe("NewSessionDialog managed session default", () => {
  it("selects tmux by default so new sessions survive application restarts", () => {
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

    assert.match(
      markup,
      /<button(?=[^>]*data-testid="new-session-mode-tmux")(?=[^>]*aria-pressed="true")[^>]*>/,
    );
    assert.match(markup, /受管 tmux/);
  });
});

describe("NewSessionDialog manual SSH connection", () => {
  it("renders direct SSH connection fields without asking for a password", () => {
    const markup = renderToStaticMarkup(
      createElement(NewSessionDialog, {
        open: true,
        host: { type: "ssh-manual" },
        sessions: [] as AgentSessionRecord[],
        sessionGroups: { groups: [], assignments: {}, collapsedGroupIds: [] },
        onClose: () => {},
        onLaunched: () => {},
      }),
    );

    assert.match(markup, /data-testid="new-session-ssh-host"/);
    assert.match(markup, /data-testid="new-session-ssh-port"/);
    assert.match(markup, /data-testid="new-session-ssh-username"/);
    assert.match(markup, /data-testid="new-session-ssh-identity-file"/);
    assert.match(markup, /ssh-agent/);
    assert.doesNotMatch(markup, /type="password"/);
  });

  it("normalizes manual SSH fields and defaults the port to 22", () => {
    assert.deepEqual(
      buildManualSshTarget({
        host: " 10.30.0.24 ",
        port: "",
        username: " xuzk ",
        identityFile: " /data01/home/xuzk/.ssh/id_ed25519 ",
      }),
      {
        host: "10.30.0.24",
        port: 22,
        username: "xuzk",
        identityFile: "/data01/home/xuzk/.ssh/id_ed25519",
      },
    );
  });

  it("rejects missing hosts and ports outside the SSH range", () => {
    assert.throws(
      () =>
        buildManualSshTarget({
          host: " ",
          port: "22",
          username: "",
          identityFile: "",
        }),
      /SSH 主机/,
    );
    assert.throws(
      () =>
        buildManualSshTarget({
          host: "server.example.test",
          port: "65536",
          username: "",
          identityFile: "",
        }),
      /端口/,
    );
  });
});
