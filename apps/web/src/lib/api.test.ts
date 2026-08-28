import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTerminalWebSocketUrl,
  fetchMarkdownImage,
  focusAgentSession,
  sendCodexImageMessage,
} from "./api.js";

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

test("fetchMarkdownImage posts path context and returns an image Blob", async () => {
  let requestBody: unknown;
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (_input: string | URL | Request, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: { "Content-Type": "image/png" },
      });
    },
  });

  const blob = await fetchMarkdownImage({
    documentPath: "/workspace/docs/guide.md",
    rootPath: "/workspace",
    source: "../assets/diagram.png",
  });

  assert.equal(blob.type, "image/png");
  assert.equal(blob.size, 3);
  assert.deepEqual(requestBody, {
    documentPath: "/workspace/docs/guide.md",
    rootPath: "/workspace",
    source: "../assets/diagram.png",
  });
});

test("sendCodexImageMessage uploads the image and prompt to the selected Kanban session", async () => {
  let requestUrl = "";
  const captured: { requestBody: FormData | null } = { requestBody: null };
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (input: string | URL | Request, init?: RequestInit) => {
      requestUrl = String(input);
      captured.requestBody = init?.body as FormData;
      return Response.json(
        {
          ok: true,
          threadId: "019eeed3-69ee-7850-b89e-53c3d48db0e2",
        },
        { status: 202 },
      );
    },
  });
  const image = new File([new Uint8Array([1, 2, 3])], "screen.png", {
    type: "image/png",
  });

  const response = await sendCodexImageMessage({
    agentSessionId: "agent-1",
    image,
    message: "请查看截图",
  });

  assert.equal(requestUrl, "/api/agent-sessions/agent-1/image-message");
  assert.ok(captured.requestBody);
  assert.equal(captured.requestBody.get("message"), "请查看截图");
  assert.equal(captured.requestBody.get("image"), image);
  assert.deepEqual(response, {
    ok: true,
    threadId: "019eeed3-69ee-7850-b89e-53c3d48db0e2",
  });
});
