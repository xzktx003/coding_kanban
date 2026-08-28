import assert from "node:assert/strict";
import test from "node:test";

import Fastify from "fastify";

import { AgentSessionRegistry } from "../services/agent-session-registry.js";
import { registerCodexImageMessageRoutes } from "./codex-image-message.js";

function buildMultipartBody(input: {
  boundary: string;
  message: string;
  filename: string;
  contentType: string;
  file: Buffer;
}): Buffer {
  return Buffer.concat([
    Buffer.from(
      `--${input.boundary}\r\nContent-Disposition: form-data; name="message"\r\n\r\n${input.message}\r\n`,
    ),
    Buffer.from(
      `--${input.boundary}\r\nContent-Disposition: form-data; name="image"; filename="${input.filename}"\r\nContent-Type: ${input.contentType}\r\n\r\n`,
    ),
    input.file,
    Buffer.from(`\r\n--${input.boundary}--\r\n`),
  ]);
}

test("POST image-message resolves the active tmux Codex thread before queueing", async () => {
  const app = Fastify();
  const registry = new AgentSessionRegistry();
  const session = registry.register({
    workspaceId: "workspace-1",
    hostId: "local",
    sourceType: "local",
    agentKind: "node",
    displayName: "active tmux",
    workingDirectory: "/workspace/project",
    connectionState: "online",
    interactionState: "running",
    agentSessionId: "old-codex-session",
    transportRef: { tmuxSession: "work", tmuxPane: "%7" },
  });
  const queued: unknown[] = [];
  const activeThreadId = "019eeed3-69ee-7850-b89e-53c3d48db0e2";

  await registerCodexImageMessageRoutes(app, {
    registry,
    codexSessionLocator: {
      async resolve(input) {
        assert.equal(input.tmuxTarget, "%7");
        return activeThreadId;
      },
    },
    codexImageMessageService: {
      async send(input) {
        queued.push(input);
      },
    },
  });

  const boundary = "coding-kanban-image-boundary";
  const image = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from("preview"),
  ]);
  const response = await app.inject({
    method: "POST",
    url: `/api/agent-sessions/${session.id}/image-message`,
    headers: {
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    payload: buildMultipartBody({
      boundary,
      message: "请分析截图",
      filename: "screen.png",
      contentType: "image/png",
      file: image,
    }),
  });

  assert.equal(response.statusCode, 202);
  assert.deepEqual(response.json(), {
    ok: true,
    threadId: activeThreadId,
  });
  assert.deepEqual(queued, [
    {
      threadId: activeThreadId,
      message: "请分析截图",
      image,
      imageExtension: "png",
      workingDirectory: "/workspace/project",
    },
  ]);
  assert.equal(registry.get(session.id).agentSessionId, activeThreadId);
  await app.close();
});

test("POST image-message rejects a file whose bytes do not match an allowed image", async () => {
  const app = Fastify();
  const registry = new AgentSessionRegistry();
  const session = registry.register({
    workspaceId: "workspace-1",
    hostId: "local",
    sourceType: "local",
    agentKind: "codex",
    displayName: "codex",
    workingDirectory: "/workspace/project",
    connectionState: "online",
    interactionState: "running",
    agentSessionId: "019eeed3-69ee-7850-b89e-53c3d48db0e2",
  });
  let queued = false;

  await registerCodexImageMessageRoutes(app, {
    registry,
    codexSessionLocator: { resolve: async () => undefined },
    codexImageMessageService: {
      async send() {
        queued = true;
      },
    },
  });

  const boundary = "coding-kanban-invalid-image-boundary";
  const response = await app.inject({
    method: "POST",
    url: `/api/agent-sessions/${session.id}/image-message`,
    headers: {
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    payload: buildMultipartBody({
      boundary,
      message: "看看这个",
      filename: "fake.png",
      contentType: "image/png",
      file: Buffer.from("not-an-image"),
    }),
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.json().error, /PNG、JPEG 或 WebP/);
  assert.equal(queued, false);
  await app.close();
});
