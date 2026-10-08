import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AgentSessionRecord } from "@agent-orchestrator/shared";

import {
  buildTmuxDiscoveryHostKey,
  buildTmuxDiscoveryItems,
  isCurrentTmuxDiscoveryRequest,
} from "./tmux-discovery-state.js";

function makeSession(partial: Partial<AgentSessionRecord>): AgentSessionRecord {
  return {
    id: "session-1",
    workspaceId: "default",
    sourceType: "remote-tmux-discovered",
    agentKind: "shell",
    displayName: "tmux:dev",
    connectionState: "online",
    interactionState: "detached",
    ...partial,
  };
}

describe("buildTmuxDiscoveryHostKey", () => {
  it("returns a stable key for the same selected SSH host", () => {
    const first = buildTmuxDiscoveryHostKey({
      type: "ssh",
      preset: {
        name: "devbox",
        host: "10.30.0.21",
        port: 2222,
        username: "zukang.xu",
        identityFile: "~/.ssh/id_ed25519",
      },
    });
    const second = buildTmuxDiscoveryHostKey({
      type: "ssh",
      preset: {
        name: "devbox",
        host: "10.30.0.21",
        port: 2222,
        username: "zukang.xu",
        identityFile: "~/.ssh/id_ed25519",
      },
    });

    assert.equal(first, second);
  });

  it("separates local and remote tmux scans", () => {
    assert.notEqual(
      buildTmuxDiscoveryHostKey({ type: "local" }),
      buildTmuxDiscoveryHostKey({
        type: "ssh",
        preset: {
          name: "localhost-alias",
          host: "localhost",
          port: 22,
        },
      }),
    );
  });
});

describe("buildTmuxDiscoveryItems", () => {
  it("recomputes existing markers from sessions without changing scan results", () => {
    const discovered = [
      makeSession({
        id: "preview:tmux:dev",
        hostId: "remote-a",
        sshTarget: { host: "remote-a", port: 22 },
        transportRef: { tmuxSession: "dev" },
      }),
    ];

    assert.equal(
      buildTmuxDiscoveryItems(discovered, [])[0]?.existingId,
      undefined,
    );

    const items = buildTmuxDiscoveryItems(discovered, [
      makeSession({
        id: "grid-session",
        hostId: "remote-a",
        transportRef: { tmuxSession: "dev" },
      }),
    ]);

    assert.equal(items[0]?.session.id, "preview:tmux:dev");
    assert.equal(items[0]?.existingId, "grid-session");
  });
});

describe("isCurrentTmuxDiscoveryRequest", () => {
  it("accepts only the latest request for the current host key", () => {
    assert.equal(
      isCurrentTmuxDiscoveryRequest({
        currentHostKey: "ssh\u0000devbox",
        latestRequestId: 2,
        requestHostKey: "ssh\u0000devbox",
        requestId: 2,
      }),
      true,
    );

    assert.equal(
      isCurrentTmuxDiscoveryRequest({
        currentHostKey: "ssh\u0000devbox",
        latestRequestId: 2,
        requestHostKey: "ssh\u0000devbox",
        requestId: 1,
      }),
      false,
    );

    assert.equal(
      isCurrentTmuxDiscoveryRequest({
        currentHostKey: "ssh\u0000other",
        latestRequestId: 2,
        requestHostKey: "ssh\u0000devbox",
        requestId: 2,
      }),
      false,
    );
  });
});
