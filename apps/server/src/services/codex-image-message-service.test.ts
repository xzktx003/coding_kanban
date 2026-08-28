import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CodexImageMessageService,
  type CodexImageCommandRunner,
} from "./codex-image-message-service.js";

test("send queues a local image on the exact Codex thread and removes its temporary file", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "codex-image-service-test-"));
  const invocations: Array<{
    command: string;
    args: string[];
    cwd?: string;
    image: Buffer;
  }> = [];
  const runCommand: CodexImageCommandRunner = async (
    command,
    args,
    options,
  ) => {
    const imagePath = args.at(-1);
    assert.ok(imagePath);
    invocations.push({
      command,
      args,
      cwd: options.cwd,
      image: await readFile(imagePath),
    });
  };
  const service = new CodexImageMessageService({ runCommand, tempRoot });

  try {
    await service.send({
      threadId: "019eeed3-69ee-7850-b89e-53c3d48db0e2",
      message: "请看截图中的报错",
      image: Buffer.from("png-image"),
      imageExtension: "png",
      workingDirectory: "/workspace/project",
    });

    assert.deepEqual(invocations, [
      {
        command: "codex",
        args: [
          "queue",
          "--thread",
          "019eeed3-69ee-7850-b89e-53c3d48db0e2",
          "--message",
          "请看截图中的报错",
          "-i",
          invocations[0]!.args.at(-1)!,
        ],
        cwd: "/workspace/project",
        image: Buffer.from("png-image"),
      },
    ]);
    await assert.rejects(access(invocations[0]!.args.at(-1)!));
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }
});

test("send falls back to a queued local file reference when codex queue rejects image attachments", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "codex-image-fallback-test-"));
  const invocations: Array<{ args: string[]; imagePath: string }> = [];
  const scheduled: { cleanup: (() => Promise<void>) | null } = {
    cleanup: null,
  };
  const service = new CodexImageMessageService({
    tempRoot,
    scheduleCleanup(callback) {
      scheduled.cleanup = callback;
    },
    async runCommand(_command, args) {
      const imagePath =
        args[args.indexOf("-i") + 1] ?? invocations[0]?.imagePath ?? "";
      invocations.push({ args, imagePath });
      if (invocations.length === 1) {
        throw new Error("`codex queue` does not support image attachments");
      }
    },
  });

  try {
    await service.send({
      threadId: "019eeed3-69ee-7850-b89e-53c3d48db0e2",
      message: "请看截图中的报错",
      image: Buffer.from("png-image"),
      imageExtension: "png",
      workingDirectory: "/workspace/project",
    });

    assert.equal(invocations.length, 2);
    assert.ok(invocations[0]!.args.includes("-i"));
    assert.ok(!invocations[1]!.args.includes("-i"));
    const fallbackMessage =
      invocations[1]!.args[invocations[1]!.args.indexOf("--message") + 1]!;
    assert.match(fallbackMessage, /Kanban 图片附件/);
    assert.match(fallbackMessage, /请先使用.*图片查看工具/);
    assert.ok(fallbackMessage.includes(invocations[0]!.imagePath));
    await access(invocations[0]!.imagePath);
    assert.ok(scheduled.cleanup);
    await scheduled.cleanup();
    await assert.rejects(access(invocations[0]!.imagePath));
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }
});

test("send uploads an SSH image outside the workspace, quotes the queue command, and cleans up", async () => {
  const writes: Array<{ path: string; image: Buffer }> = [];
  const removed: string[] = [];
  const remoteCommands: string[] = [];
  const service = new CodexImageMessageService({
    createId: () => "attachment-id",
    remoteFileAccess: {
      async ensureDirectory(_target, path) {
        assert.equal(path, "~/.cache/coding-kanban/codex-images");
      },
      async resolveRemotePath(_target, path) {
        return path.replace("~", "/home/demo");
      },
      async writeFile(_target, path, image) {
        writes.push({ path, image });
      },
      async remove(_target, path) {
        removed.push(path);
      },
    },
    async runCommand(command, args) {
      assert.equal(command, "ssh");
      remoteCommands.push(args.at(-1)!);
    },
  });

  await service.send({
    threadId: "019eeed3-69ee-7850-b89e-53c3d48db0e2",
    message: "describe 'this' image",
    image: Buffer.from("jpeg-image"),
    imageExtension: "jpg",
    workingDirectory: "~/project with spaces",
    sshTarget: { host: "example.test", username: "demo" },
  });

  assert.deepEqual(writes, [
    {
      path: "/home/demo/.cache/coding-kanban/codex-images/attachment-id.jpg",
      image: Buffer.from("jpeg-image"),
    },
  ]);
  assert.deepEqual(removed, [
    "/home/demo/.cache/coding-kanban/codex-images/attachment-id.jpg",
  ]);
  assert.equal(remoteCommands.length, 1);
  assert.match(remoteCommands[0]!, /SHELL_BIN/);
  assert.match(remoteCommands[0]!, / -i -c /);
  assert.match(remoteCommands[0]!, /cd ~\//);
  assert.match(remoteCommands[0]!, /project with spaces/);
  assert.match(remoteCommands[0]!, /codex queue/);
  assert.match(remoteCommands[0]!, /019eeed3-69ee-7850-b89e-53c3d48db0e2/);
  assert.match(remoteCommands[0]!, /describe/);
  assert.match(remoteCommands[0]!, /this/);
  assert.match(
    remoteCommands[0]!,
    /home\/demo\/\.cache\/coding-kanban\/codex-images\/attachment-id\.jpg/,
  );
});

test("send preserves multiline prompts without placing line breaks in an SSH command", async () => {
  let remoteCommand = "";
  const service = new CodexImageMessageService({
    createId: () => "attachment-id",
    remoteFileAccess: {
      ensureDirectory: async () => {},
      resolveRemotePath: async () => "/tmp/attachment.png",
      writeFile: async () => {},
      remove: async () => {},
    },
    async runCommand(_command, args) {
      remoteCommand = args.at(-1) ?? "";
    },
  });

  await service.send({
    threadId: "019eeed3-69ee-7850-b89e-53c3d48db0e2",
    message: "第一行\n第二行 'quoted'",
    image: Buffer.from("png-image"),
    imageExtension: "png",
    sshTarget: { host: "example.test", username: "demo" },
  });

  assert.doesNotMatch(remoteCommand, /\r|\n/);
  assert.match(remoteCommand, /base64 -d/);
  assert.ok(
    remoteCommand.includes(
      Buffer.from("第一行\n第二行 'quoted'", "utf8").toString("base64"),
    ),
  );
  assert.doesNotMatch(remoteCommand, /第一行|第二行/);
});

test("send falls back to a queued remote file reference and delays SSH cleanup", async () => {
  const remoteCommands: string[] = [];
  const removed: string[] = [];
  const scheduled: { cleanup: (() => Promise<void>) | null } = {
    cleanup: null,
  };
  const service = new CodexImageMessageService({
    createId: () => "attachment-id",
    scheduleCleanup(callback) {
      scheduled.cleanup = callback;
    },
    remoteFileAccess: {
      ensureDirectory: async () => {},
      resolveRemotePath: async () => "/home/demo/attachment.png",
      writeFile: async () => {},
      async remove(_target, path) {
        removed.push(path);
      },
    },
    async runCommand(_command, args) {
      remoteCommands.push(args.at(-1) ?? "");
      if (remoteCommands.length === 1) {
        throw new Error(
          "Error: codex queue does not support image attachments",
        );
      }
    },
  });

  await service.send({
    threadId: "019eeed3-69ee-7850-b89e-53c3d48db0e2",
    message: "请分析图片",
    image: Buffer.from("png-image"),
    imageExtension: "png",
    sshTarget: { host: "example.test", username: "demo" },
  });

  assert.equal(remoteCommands.length, 2);
  assert.doesNotMatch(remoteCommands[0]!, /Kanban 图片附件/);
  const fallbackMessage = [
    "请分析图片",
    "",
    "[Kanban 图片附件]",
    "当前 Codex CLI 不支持通过 queue 直接附加图片。请先使用可用的图片查看工具读取以下本机文件，再结合图片回答：",
    "/home/demo/attachment.png",
  ].join("\n");
  assert.ok(
    remoteCommands[1]!.includes(
      Buffer.from(fallbackMessage, "utf8").toString("base64"),
    ),
  );
  assert.deepEqual(removed, []);
  assert.ok(scheduled.cleanup);
  await scheduled.cleanup();
  assert.deepEqual(removed, ["/home/demo/attachment.png"]);
});
