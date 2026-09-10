import assert from "node:assert/strict";
import {
  chmodSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import type { AgentSessionRecord } from "@agent-orchestrator/shared";

import { FeishuWorkspaceFiles } from "./feishu-workspace-files.js";

function makeRoot(): string {
  return mkdtempSync(path.join(tmpdir(), "kanban-feishu-workspace-"));
}

function makeSession(
  workingDirectory: string | undefined,
  overrides: Partial<AgentSessionRecord> = {},
): AgentSessionRecord {
  return {
    id: "session-1",
    workspaceId: "default",
    hostId: "local",
    sourceType: "local",
    agentKind: "codex",
    displayName: "codex",
    workingDirectory,
    connectionState: "online",
    interactionState: "idle",
    controlMode: "control",
    ...overrides,
  };
}

function cleanup(root: string): void {
  rmSync(root, { recursive: true, force: true });
}

test("lists non-hidden project entries without walking recursively", async () => {
  const root = makeRoot();
  try {
    mkdirSync(path.join(root, "src"));
    writeFileSync(path.join(root, "README.md"), "hello");
    writeFileSync(path.join(root, ".env"), "TOKEN=secret");
    writeFileSync(path.join(root, "server.pem"), "secret");

    const service = new FeishuWorkspaceFiles();
    const result = await service.list(makeSession(root), ".");

    assert.equal(result.truncated, false);
    assert.deepEqual(result.entries, [
      { name: "src", path: "src", type: "directory", size: 0 },
      { name: "README.md", path: "README.md", type: "file", size: 5 },
    ]);
  } finally {
    cleanup(root);
  }
});

test("truncates directory listings at the configured maximum", async () => {
  const root = makeRoot();
  try {
    for (let index = 0; index < 205; index += 1) {
      writeFileSync(
        path.join(root, `file-${String(index).padStart(3, "0")}`),
        "",
      );
    }

    const service = new FeishuWorkspaceFiles();
    const result = await service.list(makeSession(root), ".");

    assert.equal(result.entries.length, 200);
    assert.equal(result.truncated, true);
  } finally {
    cleanup(root);
  }
});

test("bounds directory scans even when entries are hidden", async () => {
  const root = makeRoot();
  try {
    for (let index = 0; index < 2005; index += 1) {
      writeFileSync(path.join(root, `.hidden-${index}`), "");
    }

    const service = new FeishuWorkspaceFiles();
    const result = await service.list(makeSession(root), ".");

    assert.deepEqual(result.entries, []);
    assert.equal(result.truncated, true);
  } finally {
    cleanup(root);
  }
});

test("rejects unsafe roots and relative or traversal paths", async () => {
  const root = makeRoot();
  try {
    const service = new FeishuWorkspaceFiles();

    await assert.rejects(
      () => service.list(makeSession(undefined), "."),
      /root/i,
    );
    await assert.rejects(() => service.list(makeSession("/"), "."), /root/i);
    await assert.rejects(
      () => service.list(makeSession("relative"), "."),
      /root/i,
    );
    await assert.rejects(
      () => service.read(makeSession(root), "../secret"),
      /invalid path/i,
    );
    await assert.rejects(
      () => service.read(makeSession(root), "dir/../secret"),
      /invalid path/i,
    );
    await assert.rejects(
      () => service.read(makeSession(root), "/etc/passwd"),
      /invalid path/i,
    );
    await assert.rejects(
      () => service.read(makeSession(root), "a\\b"),
      /invalid path/i,
    );
    await assert.rejects(
      () => service.read(makeSession(root), "bad\u0000name"),
      /invalid path/i,
    );
  } finally {
    cleanup(root);
  }
});

test("rejects symlink roots, intermediate symlinks, and symlink targets", async () => {
  const root = makeRoot();
  const outside = makeRoot();
  const rootLink = `${root}-link`;
  try {
    mkdirSync(path.join(outside, "child"));
    mkdirSync(path.join(root, "real"));
    writeFileSync(path.join(root, "real", "file.txt"), "ok");
    symlinkSync(outside, rootLink);
    symlinkSync(outside, path.join(root, "link-dir"));
    symlinkSync(
      path.join(root, "real", "file.txt"),
      path.join(root, "link-file"),
    );

    const service = new FeishuWorkspaceFiles();

    await assert.rejects(
      () => service.list(makeSession(rootLink), "."),
      /symlink/i,
    );
    await assert.rejects(
      () => service.list(makeSession(path.join(rootLink, "child")), "."),
      /symlink/i,
    );
    await assert.rejects(
      () => service.read(makeSession(root), "link-dir/file.txt"),
      /symlink/i,
    );
    await assert.rejects(
      () => service.write(makeSession(root), "link-dir/file.txt", "bad", null),
      /symlink/i,
    );
    await assert.rejects(
      () => service.read(makeSession(root), "link-file"),
      /symlink/i,
    );
    await assert.rejects(
      () => service.write(makeSession(root), "link-file", "bad", null),
      /symlink/i,
    );
  } finally {
    cleanup(root);
    cleanup(outside);
    rmSync(rootLink, { force: true });
  }
});

test("denies hidden paths and sensitive credential filenames", async () => {
  const root = makeRoot();
  try {
    mkdirSync(path.join(root, "config"));
    writeFileSync(path.join(root, ".hidden.txt"), "secret");
    writeFileSync(path.join(root, "config", "id_rsa"), "secret");
    writeFileSync(path.join(root, "server.pem"), "secret");

    const service = new FeishuWorkspaceFiles();

    await assert.rejects(
      () => service.read(makeSession(root), ".hidden.txt"),
      /denied/i,
    );
    await assert.rejects(
      () => service.read(makeSession(root), "config/id_rsa"),
      /denied/i,
    );
    await assert.rejects(
      () => service.download(makeSession(root), "server.pem"),
      /denied/i,
    );
    await assert.rejects(
      () => service.write(makeSession(root), ".env", "TOKEN=secret", null),
      /denied/i,
    );
  } finally {
    cleanup(root);
  }
});

test("reads UTF-8 files with revisions and editability flag", async () => {
  const root = makeRoot();
  try {
    writeFileSync(path.join(root, "note.md"), "你好");
    writeFileSync(path.join(root, "long.md"), "x".repeat(1001));

    const service = new FeishuWorkspaceFiles();
    const note = await service.read(makeSession(root), "note.md");
    const long = await service.read(makeSession(root), "long.md");

    assert.equal(note.content, "你好");
    assert.match(note.revision, /^[a-f0-9]{64}$/);
    assert.equal(note.editable, true);
    assert.equal(long.editable, false);
  } finally {
    cleanup(root);
  }
});

test("rejects oversized reads and invalid UTF-8", async () => {
  const root = makeRoot();
  try {
    writeFileSync(
      path.join(root, "large.txt"),
      Buffer.alloc(128 * 1024 + 1, "x"),
    );
    writeFileSync(path.join(root, "binary.txt"), Buffer.from([0xc3, 0x28]));

    const service = new FeishuWorkspaceFiles();

    await assert.rejects(
      () => service.read(makeSession(root), "large.txt"),
      /too large/i,
    );
    await assert.rejects(
      () => service.read(makeSession(root), "binary.txt"),
      /utf-8/i,
    );
  } finally {
    cleanup(root);
  }
});

test("rejects unsafe write content and oversized existing write targets", async () => {
  const root = makeRoot();
  try {
    writeFileSync(
      path.join(root, "large.txt"),
      Buffer.alloc(128 * 1024 + 1, "x"),
    );

    const service = new FeishuWorkspaceFiles();
    const session = makeSession(root);

    await assert.rejects(
      () => service.write(session, "too-long.txt", "x".repeat(1001), null),
      /too large/i,
    );
    await assert.rejects(
      () => service.write(session, "nul.txt", "bad\u0000value", null),
      /control/i,
    );
    await assert.rejects(
      () => service.write(session, "replacement.txt", "bad\ufffdvalue", null),
      /utf-8/i,
    );
    await assert.rejects(
      () => service.write(session, "large.txt", "small", "0".repeat(64)),
      /too large/i,
    );
  } finally {
    cleanup(root);
  }
});

test("downloads regular files within the size limit", async () => {
  const root = makeRoot();
  try {
    writeFileSync(path.join(root, "archive.txt"), "download");

    const service = new FeishuWorkspaceFiles();
    const result = await service.download(makeSession(root), "archive.txt");

    assert.equal(result.name, "archive.txt");
    assert.equal(result.data.toString("utf8"), "download");
  } finally {
    cleanup(root);
  }
});

test("creates new files with expectedRevision null and refuses overwrite creates", async () => {
  const root = makeRoot();
  try {
    const service = new FeishuWorkspaceFiles();
    const session = makeSession(root);

    await service.write(session, "new.txt", "created", null);
    assert.equal(readFileSync(path.join(root, "new.txt"), "utf8"), "created");
    await assert.rejects(
      () => service.write(session, "new.txt", "again", null),
      /exists/i,
    );
  } finally {
    cleanup(root);
  }
});

test("replaces files atomically when the revision matches and preserves mode", async () => {
  const root = makeRoot();
  try {
    const file = path.join(root, "note.txt");
    writeFileSync(file, "old");
    chmodSync(file, 0o640);

    const service = new FeishuWorkspaceFiles();
    const session = makeSession(root);
    const { revision } = await service.read(session, "note.txt");

    await service.write(session, "note.txt", "new", revision);

    assert.equal(readFileSync(file, "utf8"), "new");
    assert.equal(readFileSync(file).byteLength, 3);
    assert.equal(statSync(file).mode & 0o777, 0o640);
  } finally {
    cleanup(root);
  }
});

test("rejects stale revisions and hardlinked targets on write", async () => {
  const root = makeRoot();
  try {
    const stale = path.join(root, "stale.txt");
    const original = path.join(root, "original.txt");
    const hardlink = path.join(root, "hardlink.txt");
    writeFileSync(stale, "old");
    writeFileSync(original, "old");
    linkSync(original, hardlink);

    const service = new FeishuWorkspaceFiles();
    const session = makeSession(root);

    await assert.rejects(
      () => service.write(session, "stale.txt", "new", "0".repeat(64)),
      /changed/i,
    );
    await assert.rejects(
      () => service.write(session, "hardlink.txt", "new", null),
      /exists/i,
    );
    await assert.rejects(async () => {
      const { revision } = await service.read(session, "hardlink.txt");
      await service.write(session, "hardlink.txt", "new", revision);
    }, /hardlink/i);
  } finally {
    cleanup(root);
  }
});

test("rechecks the target revision immediately before replacing", async () => {
  const root = makeRoot();
  try {
    const file = path.join(root, "note.txt");
    const replacement = path.join(root, "replacement.txt");
    writeFileSync(file, "old");
    writeFileSync(replacement, "old");

    let changed = false;
    const service = new FeishuWorkspaceFiles({
      beforeExistingReplace: () => {
        if (!changed) {
          changed = true;
          rmSync(file);
          writeFileSync(replacement, "old");
          renameSync(replacement, file);
        }
      },
    });
    const session = makeSession(root);
    const { revision } = await service.read(session, "note.txt");

    await assert.rejects(
      () => service.write(session, "note.txt", "new", revision),
      /changed/i,
    );
    assert.equal(readFileSync(file, "utf8"), "old");
  } finally {
    cleanup(root);
  }
});

test("serializes concurrent writes for the same file", async () => {
  const root = makeRoot();
  try {
    writeFileSync(path.join(root, "note.txt"), "old");

    const service = new FeishuWorkspaceFiles();
    const session = makeSession(root);
    const { revision } = await service.read(session, "note.txt");
    const writes = await Promise.allSettled([
      service.write(session, "note.txt", "first", revision),
      service.write(session, "note.txt", "second", revision),
    ]);

    assert.equal(
      writes.filter((item) => item.status === "fulfilled").length,
      1,
    );
    assert.equal(writes.filter((item) => item.status === "rejected").length, 1);
    assert.match(
      readFileSync(path.join(root, "note.txt"), "utf8"),
      /^(first|second)$/,
    );
  } finally {
    cleanup(root);
  }
});

test("cleans write locks after successful and failed writes", async () => {
  const root = makeRoot();
  try {
    writeFileSync(path.join(root, "note.txt"), "old");

    const service = new FeishuWorkspaceFiles();
    const session = makeSession(root);
    const internals = service as unknown as {
      writeLocks: Map<string, Promise<void>>;
    };

    await service.write(session, "new.txt", "created", null);
    assert.equal(internals.writeLocks.size, 0);
    await assert.rejects(
      () => service.write(session, "note.txt", "stale", "0".repeat(64)),
      /changed/i,
    );
    assert.equal(internals.writeLocks.size, 0);
  } finally {
    cleanup(root);
  }
});

test("rejects remote SSH sessions until a safe SFTP implementation is available", async () => {
  const service = new FeishuWorkspaceFiles();
  const session = makeSession("/workspace", {
    hostId: "remote",
    sshTarget: { host: "example.com" },
    sourceType: "remote-connect",
  });

  await assert.rejects(
    () => service.list(session, "."),
    /remote workspace files/i,
  );
  await assert.rejects(
    () => service.write(session, "note.txt", "x", null),
    /remote workspace files/i,
  );
});
