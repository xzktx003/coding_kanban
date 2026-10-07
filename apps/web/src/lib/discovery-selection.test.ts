import assert from "node:assert/strict";
import test from "node:test";
import {
  scanResultSelectionKey,
  tmuxSelectionKey,
  selectedDiscoveryItems,
} from "./discovery-selection.js";
test("app submission resolves original selected identity after displayed filters change", () => {
  const a = {
    agentKind: "codex",
    status: "running" as const,
    displayName: "A",
    workingDirectory: "/a",
    sessionId: "a",
  };
  const b = { ...a, displayName: "B", workingDirectory: "/b", sessionId: "b" };
  const selected = new Set([scanResultSelectionKey(a)]);
  const submitted: unknown[][] = [];
  const mockSubmit = (items: unknown[]) => submitted.push(items);
  mockSubmit(selectedDiscoveryItems([b, a], selected, scanResultSelectionKey));
  assert.deepEqual(submitted, [[a]]);
  assert.notEqual(
    scanResultSelectionKey(a),
    scanResultSelectionKey({ ...a, sshTarget: { host: "other-host" } }),
  );
});
test("tmux selection keeps host and pane identity and skips removed records", () => {
  const a = {
    id: "a",
    workspaceId: "default",
    sourceType: "local" as const,
    agentKind: "shell",
    displayName: "dev",
    connectionState: "online" as const,
    interactionState: "idle" as const,
    transportRef: { tmuxSession: "dev", tmuxPane: "%1" },
  };
  const b = {
    ...a,
    id: "b",
    transportRef: { tmuxSession: "dev", tmuxPane: "%2" },
  };
  const selected = new Set([tmuxSelectionKey(a)]);
  assert.deepEqual(selectedDiscoveryItems([b, a], selected, tmuxSelectionKey), [
    a,
  ]);
  assert.deepEqual(selectedDiscoveryItems([b], selected, tmuxSelectionKey), []);
  assert.notEqual(
    tmuxSelectionKey(a),
    tmuxSelectionKey({ ...a, hostId: "remote" }),
  );
});

test("legacy scan entries with no native identity still keep distinct named targets", () => {
  const a = {
    agentKind: "shell",
    status: "running" as const,
    displayName: "Alpha",
    workingDirectory: "/shared",
  };
  const b = { ...a, displayName: "Beta" };
  assert.notEqual(scanResultSelectionKey(a), scanResultSelectionKey(b));
  assert.equal(
    scanResultSelectionKey({ ...a, sessionId: "native" }),
    scanResultSelectionKey({ ...b, sessionId: "native" }),
  );
});
