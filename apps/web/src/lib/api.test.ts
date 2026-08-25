import assert from "node:assert/strict";
import test from "node:test";

import { buildTerminalWebSocketUrl, focusAgentSession } from "./api.js";

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

test("focus requests stay ordered and use lightweight empty responses", async () => {
  const requestedSessionIds: string[] = [];
  let releaseFirstRequest!: () => void;
  const firstRequestBlocked = new Promise<void>((resolve) => {
    releaseFirstRequest = resolve;
  });

  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { agentSessionId: string };
      requestedSessionIds.push(body.agentSessionId);
      if (requestedSessionIds.length === 1) {
        await firstRequestBlocked;
      }
      return new Response(null, { status: 204 });
    },
  });

  const first = focusAgentSession({ agentSessionId: "agent-1" });
  const second = focusAgentSession({ agentSessionId: "agent-2" });
  const third = focusAgentSession({ agentSessionId: "agent-1" });

  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(requestedSessionIds, ["agent-1"]);

  releaseFirstRequest();
  await Promise.all([first, second, third]);
  assert.deepEqual(requestedSessionIds, ["agent-1", "agent-2", "agent-1"]);
});
