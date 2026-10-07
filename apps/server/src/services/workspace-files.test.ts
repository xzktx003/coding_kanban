import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
  chmod,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { WorkspaceFiles } from "./workspace-files.js";
async function fixture() {
  const base = await mkdtemp(join(tmpdir(), "kanban-workspace-files-"));
  const root = join(base, "project");
  await mkdir(root);
  return {
    base,
    root,
    files: new WorkspaceFiles(join(base, "trash"), async () => [root]),
  };
}
test("version checked saves are atomic and never overwrite concurrent edits", async () => {
  const { base, root, files } = await fixture();
  try {
    await writeFile(join(root, "a.txt"), "original");
    const first = await files.read(root, "a.txt");
    await writeFile(join(root, "a.txt"), "agent change");
    await assert.rejects(
      files.save(root, "a.txt", "my draft", first.version),
      /已更新/,
    );
    assert.equal(await readFile(join(root, "a.txt"), "utf8"), "agent change");
    const fresh = await files.read(root, "a.txt");
    await chmod(join(root, "a.txt"), 0o755);
    await files.save(root, "a.txt", "saved", fresh.version);
    assert.equal((await files.read(root, "a.txt")).content, "saved");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
test("create and move reject existing destinations and cannot move a folder into itself", async () => {
  const { base, root, files } = await fixture();
  try {
    await files.create(root, "folder", "directory");
    await files.create(root, "folder/a.txt", "file");
    await assert.rejects(files.create(root, "folder/a.txt", "file"), /已存在/);
    await files.create(root, "other.txt", "file");
    await assert.rejects(
      files.move(root, "folder/a.txt", "other.txt"),
      /已存在/,
    );
    await assert.rejects(files.move(root, "folder", "folder/nested"), /自身/);
    await files.move(root, "folder/a.txt", "b.txt");
    assert.equal((await files.read(root, "b.txt")).content, "");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
test("trash survives service recreation, restores safely and separately supports permanent deletion", async () => {
  const { base, root, files } = await fixture();
  try {
    await files.create(root, "a.txt", "file");
    const item = await files.trash(root, "a.txt");
    const restored = new WorkspaceFiles(join(base, "trash"), async () => [
      root,
    ]);
    assert.equal((await restored.listTrash(root)).length, 1);
    await files.create(root, "a.txt", "file");
    await assert.rejects(restored.restore(root, item.id), /已存在/);
    await rm(join(root, "a.txt"));
    await restored.restore(root, item.id);
    assert.equal((await restored.read(root, "a.txt")).content, "");
    const again = await restored.trash(root, "a.txt");
    await restored.purge(root, again.id);
    assert.deepEqual(await restored.listTrash(root), []);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
test("path traversal, unknown roots, symlinks, project root deletion and git metadata mutations are rejected", async () => {
  const { base, root, files } = await fixture();
  try {
    await writeFile(join(base, "outside.txt"), "outside");
    await symlink(base, join(root, "link"));
    for (const p of [
      "../outside.txt",
      join(base, "outside.txt"),
      "link/outside.txt",
    ])
      await assert.rejects(files.read(root, p));
    await assert.rejects(files.read(base, "outside.txt"));
    await assert.rejects(files.trash(root, root));
    await mkdir(join(root, ".git"));
    await assert.rejects(files.create(root, ".git/config", "file"));
    assert.equal(await readFile(join(base, "outside.txt"), "utf8"), "outside");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
test("binary text and oversized files cannot be edited; uploads never overwrite without a current version", async () => {
  const { base, root, files } = await fixture();
  try {
    await writeFile(join(root, "binary"), Buffer.from([0, 255]));
    await assert.rejects(files.read(root, "binary"), /文本/);
    await files.upload(root, "image.bin", Buffer.from([1, 2, 3]), null);
    await assert.rejects(
      files.upload(root, "image.bin", Buffer.from([9]), null),
      /已存在/,
    );
    await assert.rejects(
      files.upload(root, "../escape", Buffer.from([9]), null),
    );
    await assert.rejects(
      files.save(root, "large.txt", "x".repeat(4 * 1024 * 1024 + 1), null),
      /过大/,
    );
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
