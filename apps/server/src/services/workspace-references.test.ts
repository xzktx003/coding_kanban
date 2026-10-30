import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { WorkspaceFiles } from "./workspace-files.js";

test("project references snapshot one bounded directory level and ordinary UTF-8 files", async () => {
  const base = await mkdtemp(join(tmpdir(), "kanban-project-reference-"));
  const root = join(base, "project");
  await mkdir(join(root, "nested"), { recursive: true });
  await writeFile(join(root, "a.txt"), "captured content");
  await writeFile(join(root, "nested", "private.txt"), "nested content must not be loaded");
  const files = new WorkspaceFiles(join(base, "trash"), async () => [root]) as any;
  try {
    const file = await files.reference(root, "a.txt");
    assert.equal(file.kind, "file");
    assert.equal(file.content, "captured content");
    assert.equal(file.root, root);
    assert.equal(file.path, join(root, "a.txt"));
    assert.match(file.version, /^[a-f0-9]{64}$/);
    const dir = await files.reference(root, ".");
    assert.equal(dir.kind, "directory");
    assert.match(dir.content, /nested\//);
    assert.doesNotMatch(dir.content, /private.txt|nested content/);
    const listing = await files.list(root, ".");
    assert.deepEqual(listing.entries.map((entry: any) => [entry.name, entry.kind]), [["nested", "directory"], ["a.txt", "file"]]);
    await writeFile(join(root, "big.txt"), "x".repeat(180_001));
    await assert.rejects(files.reference(root, "big.txt"), /过大/);
    await writeFile(join(root, "binary.txt"), Buffer.from([0, 1, 2]));
    await assert.rejects(files.reference(root, "binary.txt"), /UTF-8/);
  } finally { await rm(base, { recursive: true, force: true }); }
});
test("reference and listing retain registered root and symlink boundaries, including bounded huge folders", async () => {
  const base = await mkdtemp(join(tmpdir(), "kanban-project-reference-"));
  const root = join(base, "project");
  await mkdir(root);
  await symlink(base, join(root, "outside"));
  await Promise.all(Array.from({ length: 205 }, (_, i) => writeFile(join(root, `file-${i}.txt`), "x")));
  const files = new WorkspaceFiles(join(base, "trash"), async () => [root]) as any;
  try {
    await assert.rejects(files.reference(root, "outside"), /符号链接/);
    await assert.rejects(files.list(root, "../"));
    await assert.rejects(files.list(base, "."), /未注册/);
    const snapshot = await files.reference(root, ".");
    assert.equal(snapshot.truncated, true);
    assert.ok(snapshot.content.length < 32_768);
    assert.ok(snapshot.content.split("\n").length <= 202);
    assert.doesNotMatch(snapshot.content, /outside/);
  } finally { await rm(base, { recursive: true, force: true }); }
});
