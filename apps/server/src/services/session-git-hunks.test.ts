import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionGitHunks } from "./session-git-hunks.js";
const exec = promisify(execFile);
async function repository(t: { after: (fn: () => Promise<unknown>) => void }) {
  const cwd = await mkdtemp(join(tmpdir(), "kanban-git-hunks-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await exec("git", ["init", "-q"], { cwd });
  const filePath = "中文 100%:12.ts";
  const base = Array.from({ length: 30 }, (_, n) => `line ${n + 1}`).join("\n") + "\n";
  await writeFile(join(cwd, filePath), base);
  await exec("git", ["add", "--", filePath], { cwd });
  await exec("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture"], { cwd });
  const modified = base.replace("line 2\n", "first change\n").replace("line 28\n", "last change\n");
  await writeFile(join(cwd, filePath), modified);
  return { cwd, filePath, base, modified };
}
test("stages and unstages one authoritative hunk, preserving other worktree and index content", async t => {
  const { cwd, filePath, base, modified } = await repository(t), service = new SessionGitHunks();
  const before = await service.read({ cwd, filePath, staged: false });
  assert.equal(before.hunks.length, 2);
  await service.action({ cwd, filePath, staged: false, hunkIndex: 0, expectedDigest: before.digest, action: "stage" });
  assert.equal(await readFile(join(cwd, filePath), "utf8"), modified);
  assert.equal((await exec("git", ["show", `:${filePath}`], { cwd })).stdout, base.replace("line 2\n", "first change\n"));
  const staged = await service.read({ cwd, filePath, staged: true });
  assert.equal(staged.hunks.length, 1);
  await service.action({ cwd, filePath, staged: true, hunkIndex: 0, expectedDigest: staged.digest, action: "unstage" });
  assert.equal((await exec("git", ["show", `:${filePath}`], { cwd })).stdout, base);
  assert.equal(await readFile(join(cwd, filePath), "utf8"), modified);
});
test("revert requires captured scope confirmation and rejects stale patches without writes", async t => {
  const { cwd, filePath, modified } = await repository(t), service = new SessionGitHunks();
  const snapshot = await service.read({ cwd, filePath, staged: false });
  const action = { cwd, filePath, staged: false, hunkIndex: 1, expectedDigest: snapshot.digest, action: "revert" as const };
  await assert.rejects(service.action(action), /确认/);
  assert.equal(await readFile(join(cwd, filePath), "utf8"), modified);
  await service.action({ ...action, confirmRevert: true });
  assert.equal(await readFile(join(cwd, filePath), "utf8"), modified.replace("last change\n", "line 28\n"));
  await assert.rejects(service.action({ ...action, hunkIndex: 0, confirmRevert: true }), /改变|过期/);
});
test("concurrent duplicate operations cannot apply the same snapshot twice", async t => {
  const { cwd, filePath } = await repository(t);
  const first = new SessionGitHunks(), second = new SessionGitHunks();
  const snapshot = await first.read({ cwd, filePath, staged: false });
  const input = { cwd, filePath, staged: false, hunkIndex: 0, expectedDigest: snapshot.digest, action: "stage" as const };
  const results = await Promise.allSettled([first.action(input), second.action(input)]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
});
test("rejects traversal, symlinks and arbitrary client patches or arguments", async t => {
  const { cwd, filePath } = await repository(t), service = new SessionGitHunks();
  await symlink(join(cwd, filePath), join(cwd, "link.ts"));
  for (const path of ["../other", ".git/config", "link.ts", "-c"])
    await assert.rejects(service.read({ cwd, filePath: path, staged: false }));
});
test("handles a new text file and binary files without generating fake text hunks", async t => {
  const { cwd } = await repository(t), service = new SessionGitHunks();
  await writeFile(join(cwd, "new file.ts"), "const value = 1;\n");
  const snapshot = await service.read({ cwd, filePath: "new file.ts", staged: false });
  assert.equal(snapshot.hunks.length, 1);
  await service.action({ cwd, filePath: "new file.ts", staged: false, hunkIndex: 0, expectedDigest: snapshot.digest, action: "stage" });
  assert.equal((await exec("git", ["show", ":new file.ts"], { cwd })).stdout, "const value = 1;\n");
  await writeFile(join(cwd, "binary.bin"), Buffer.from([0,1,2,3]));
  const binary = await service.read({ cwd, filePath: "binary.bin", staged: false });
  assert.equal(binary.binary, true); assert.deepEqual(binary.hunks, []);
});
test("rejects invalid UTF-8 text rather than staging replacement bytes", async t => {
  const { cwd } = await repository(t), service = new SessionGitHunks();
  await writeFile(join(cwd, "invalid.txt"), Buffer.from([0xff,0xfe,0x61,0x0a]));
  const snapshot = await service.read({ cwd, filePath: "invalid.txt", staged: false });
  assert.equal(snapshot.binary, true); assert.deepEqual(snapshot.hunks, []);
  await assert.rejects(service.action({ cwd, filePath: "invalid.txt", staged: false, hunkIndex: 0, expectedDigest: snapshot.digest, action: "stage" }));
  assert.deepEqual(await readFile(join(cwd, "invalid.txt")), Buffer.from([0xff,0xfe,0x61,0x0a]));
});
test("unstaged revert preserves exact index bytes and unrelated edits", async t => {
  const { cwd, filePath, base, modified } = await repository(t), service = new SessionGitHunks();
  const index = await readFile(join(cwd, ".git/index"));
  const snapshot = await service.read({ cwd, filePath, staged: false });
  await service.action({ cwd, filePath, staged: false, hunkIndex: 0, expectedDigest: snapshot.digest, action: "revert", confirmRevert: true });
  assert.equal(await readFile(join(cwd, filePath), "utf8"), modified.replace("first change\n", "line 2\n"));
  assert.deepEqual(await readFile(join(cwd, ".git/index")), index);
  assert.equal((await exec("git", ["show", `:${filePath}`], { cwd })).stdout, base);
});
