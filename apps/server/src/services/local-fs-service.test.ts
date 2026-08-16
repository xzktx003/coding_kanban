import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { LocalFsService } from "./local-fs-service.js";

function createTempRoot(): string {
  return mkdtempSync(path.join(tmpdir(), "local-fs-service-"));
}

test("LocalFsService lists directories, filters hidden files, and previews text files", async () => {
  const rootDir = createTempRoot();
  const service = new LocalFsService();

  mkdirSync(path.join(rootDir, "folder"), { recursive: true });
  writeFileSync(path.join(rootDir, "visible.txt"), "hello from preview");
  writeFileSync(path.join(rootDir, ".secret"), "hidden");

  try {
    const hiddenOff = await service.list(rootDir, false);
    assert.equal(hiddenOff.path, rootDir);
    assert.equal(
      hiddenOff.entries.some((entry) => entry.name === ".secret"),
      false,
    );
    assert.equal(hiddenOff.entries[0]?.type, "directory");

    const hiddenOn = await service.list(rootDir, true);
    assert.equal(
      hiddenOn.entries.some((entry) => entry.name === ".secret"),
      true,
    );

    const preview = await service.preview(path.join(rootDir, "visible.txt"));
    assert.equal(preview.encoding, "utf8");
    assert.equal(preview.content, "hello from preview");
    assert.equal(preview.truncated, false);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("LocalFsService previews large UTF-8 files in bounded consecutive windows", async () => {
  const rootDir = createTempRoot();
  const service = new LocalFsService();
  const filePath = path.join(rootDir, "large.md");
  const prefix = "a".repeat(65_535);
  writeFileSync(filePath, `${prefix}你好\nnext window`);

  try {
    const first = await service.preview(filePath, 65_536, 0);
    assert.equal(first.offset, 0);
    assert.equal(first.bytesRead, 65_535);
    assert.equal(first.content, prefix);
    assert.equal(first.previousOffset, null);
    assert.equal(first.nextOffset, 65_535);
    assert.equal(first.content.includes("�"), false);

    const second = await service.preview(
      filePath,
      65_536,
      first.nextOffset ?? 0,
    );
    assert.equal(second.offset, 65_535);
    assert.equal(second.content, "你好\nnext window");
    assert.equal(second.previousOffset, 0);
    assert.equal(second.nextOffset, null);
    assert.equal(second.truncated, false);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("LocalFsService caps preview windows to protect server memory", async () => {
  const rootDir = createTempRoot();
  const service = new LocalFsService();
  const filePath = path.join(rootDir, "oversized.txt");
  writeFileSync(filePath, "x".repeat(300 * 1024));

  try {
    const preview = await service.preview(filePath, Number.MAX_SAFE_INTEGER, 0);
    assert.equal(preview.bytesRead, 256 * 1024);
    assert.equal(preview.content.length, 256 * 1024);
    assert.equal(preview.nextOffset, 256 * 1024);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("LocalFsService creates, renames, chmods, and removes files", async () => {
  const rootDir = createTempRoot();
  const service = new LocalFsService();
  const originalPath = path.join(rootDir, "draft.txt");
  const renamedPath = path.join(rootDir, "final.txt");

  writeFileSync(originalPath, "draft");

  try {
    const createdDir = await service.mkdir(path.join(rootDir, "nested/child"));
    assert.equal(createdDir.endsWith(path.join("nested", "child")), true);

    const nextPath = await service.rename(originalPath, renamedPath);
    assert.equal(nextPath, renamedPath);

    await service.chmod(renamedPath, "0640");
    const afterChmod = await service.list(rootDir, true);
    const entry = afterChmod.entries.find(
      (candidate) => candidate.name === "final.txt",
    );
    assert.ok(entry);
    assert.equal(typeof entry.owner, "string");
    assert.notEqual(entry.owner.length, 0);
    assert.equal(entry.permissions, "-rw-r-----");

    await service.remove(renamedPath);
    const afterDelete = await service.list(rootDir, true);
    assert.equal(
      afterDelete.entries.some((candidate) => candidate.name === "final.txt"),
      false,
    );
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});
