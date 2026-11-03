import assert from "node:assert/strict";
import {
  link,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { WorkspaceFiles } from "./workspace-files.js";

test("local files resolve outside the project and retain version-checked writes", async () => {
  const base = await mkdtemp(join(tmpdir(), "kanban-local-files-"));
  const project = join(base, "project"),
    other = join(base, "other");
  await mkdir(project);
  await mkdir(other);
  const target = join(other, "source.txt");
  await writeFile(target, "before");
  await symlink(other, join(project, "alias"));
  const local = new WorkspaceFiles(join(base, "trash"), async () => [project], {
    local: true,
  });
  const projectOnly = new WorkspaceFiles(join(base, "trash"), async () => [
    project,
  ]);
  try {
    await assert.rejects(projectOnly.resolveReference(project, target), /超出/);
    assert.deepEqual(await local.resolveReference(project, target), {
      root: "/",
      path: target,
    });
    assert.deepEqual(
      await local.resolveReference(join(base, "missing-project"), target),
      { root: "/", path: target },
    );
    assert.deepEqual(
      await local.resolveReference(project, join(project, "alias/source.txt")),
      { root: "/", path: target },
    );
    const snapshot = await local.read("/", target);
    assert.equal(snapshot.content, "before");
    await local.save("/", target, "after", snapshot.version);
    assert.equal(await readFile(target, "utf8"), "after");
    await assert.rejects(
      local.save("/", target, "stale", snapshot.version),
      /更新/,
    );
    assert.equal(await readFile(target, "utf8"), "after");
    const listed = await local.list("/", other);
    assert.equal(
      listed.entries.some((entry) => entry.name === "source.txt"),
      true,
    );
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("local file operations preserve trash, conflict, symlink and git protections", async () => {
  const base = await mkdtemp(join(tmpdir(), "kanban-local-operations-"));
  const dir = join(base, "other");
  await mkdir(dir);
  const local = new WorkspaceFiles(join(base, "trash"), async () => [], {
    local: true,
  });
  try {
    await local.create("/", join(dir, "new.txt"), "file");
    await assert.rejects(
      local.create("/", join(dir, "new.txt"), "file"),
      /已存在/,
    );
    await local.upload(
      "/",
      join(dir, "upload.txt"),
      Buffer.from("uploaded"),
      null,
    );
    await local.move("/", join(dir, "new.txt"), join(dir, "renamed.txt"));
    const item = await local.trash("/", join(dir, "renamed.txt"));
    assert.equal(
      (await local.listTrash("/")).some((entry) => entry.id === item.id),
      true,
    );
    await local.restore("/", item.id);
    assert.equal(await readFile(join(dir, "renamed.txt"), "utf8"), "");
    await mkdir(join(dir, ".git"));
    await writeFile(join(dir, ".git", "config"), "protected");
    const git = await local.read("/", join(dir, ".git", "config"));
    await assert.rejects(
      local.save("/", git.path, "changed", git.version),
      /Git/,
    );
    await link(join(dir, "upload.txt"), join(dir, "hardlink.txt"));
    const hard = await local.read("/", join(dir, "hardlink.txt"));
    await assert.rejects(
      local.save("/", hard.path, "changed", hard.version),
      /硬链接/,
    );
    await symlink(join(dir, "upload.txt"), join(dir, "symlink.txt"));
    await assert.rejects(
      local.trash("/", join(dir, "symlink.txt")),
      /符号链接/,
    );
    await assert.rejects(local.trash("/", "/"), /回收站|根目录/);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test(
  "local reads enforce their byte limit when a regular file reports size zero",
  { skip: process.platform !== "linux" },
  async () => {
    const base = await mkdtemp(join(tmpdir(), "kanban-local-proc-"));
    const local = new WorkspaceFiles(join(base, "trash"), async () => [], {
      local: true,
    });
    try {
      await assert.rejects(
        local.read("/", `/proc/${process.pid}/cmdline`, 1),
        /过大/,
      );
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  },
);
