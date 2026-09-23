import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildClaudeResumeArgs,
  ClaudeImageMessageService,
  ClaudeImageMessageUnavailableError,
  type ClaudeImageCommandRunner,
} from "./claude-image-message-service.js";

const SESSION_ID = "ca0048f4-ef6d-4a5b-9c8c-0477a9b9b1be";
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test("send resumes the exact Claude session with the image inline and deletes the temp file", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "claude-image-service-"));
  const invocations: Array<{ command: string; args: string[]; stdin: string }> =
    [];
  const runCommand: ClaudeImageCommandRunner = async (command, args, options) => {
    invocations.push({ command, args, stdin: options.stdin ?? "" });
    await options.onStdout?.(
      `${JSON.stringify({ type: "result", subtype: "success", is_error: false })}\n`,
    );
    return 0;
  };
  const service = new ClaudeImageMessageService({
    runCommand,
    tempRoot,
    createId: () => "fixed-id",
  });

  try {
    await service.send({
      sessionId: SESSION_ID,
      message: "请看这张截图",
      image: PNG,
      imageExtension: "png",
      workingDirectory: "/workspace/project",
    });

    assert.equal(invocations.length, 1);
    assert.equal(invocations[0]?.command, "claude");
    assert.deepEqual(
      invocations[0]?.args,
      buildClaudeResumeArgs({ sessionId: SESSION_ID, message: "请看这张截图" }),
    );
    const payload = JSON.parse(invocations[0]?.stdin ?? "{}") as {
      message: { content: Array<{ type: string; source?: { media_type: string } }> };
    };
    assert.equal(payload.message.content[0]?.type, "image");
    assert.equal(payload.message.content[0]?.source?.media_type, "image/png");
    assert.equal(payload.message.content[1]?.type, "text");
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }
});

test("send reports a model-side image error and removes the temp file", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "claude-image-error-"));
  const runCommand: ClaudeImageCommandRunner = async (_command, _args, options) => {
    await options.onStdout?.(
      `${JSON.stringify({
        type: "result",
        is_error: true,
        result: "Image dimensions 1x1 are too small",
      })}\n`,
    );
    return 1;
  };
  const service = new ClaudeImageMessageService({ runCommand, tempRoot });

  try {
    await assert.rejects(
      () =>
        service.send({
          sessionId: SESSION_ID,
          message: "看看",
          image: PNG,
          imageExtension: "png",
        }),
      (error: unknown) =>
        error instanceof ClaudeImageMessageUnavailableError &&
        /尺寸太小/.test(error.message),
    );
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }
});
