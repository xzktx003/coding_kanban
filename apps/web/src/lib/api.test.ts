import assert from "node:assert/strict";
import test from "node:test";

import { buildTerminalWebSocketUrl } from "./api.js";

function setWindowLocation(protocol: "http:" | "https:", host: string): void {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: {
        protocol,
        host,
        origin: `${protocol}//${host}`,
      },
    },
  });
}

test("buildTerminalWebSocketUrl uses wss on the default HTTPS dev frontend", () => {
  setWindowLocation("https:", "10.30.0.24:3100");

  assert.equal(
    buildTerminalWebSocketUrl("agent-1"),
    "wss://10.30.0.24:3100/ws/agent-sessions/agent-1/terminal",
  );
});

test("buildTerminalWebSocketUrl keeps ws on an HTTP frontend", () => {
  setWindowLocation("http:", "127.0.0.1:3100");

  assert.equal(
    buildTerminalWebSocketUrl("agent-1"),
    "ws://127.0.0.1:3100/ws/agent-sessions/agent-1/terminal",
  );
});

test("buildTerminalWebSocketUrl requests a bounded replay for mobile terminals", () => {
  setWindowLocation("https:", "10.30.0.24:3100");

  assert.equal(
    buildTerminalWebSocketUrl("agent-1", { replayBytes: 256 * 1024 }),
    "wss://10.30.0.24:3100/ws/agent-sessions/agent-1/terminal?replayBytes=262144",
  );
});
