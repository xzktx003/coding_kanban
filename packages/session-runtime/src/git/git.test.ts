import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
  lstat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import Fastify from "fastify";
import { GitService, registerGitRoutes } from "./index.js";

async function fixture(
  t: { after(fn: () => Promise<void>): void },
  initial = true,
) {
  const dir = await mkdtemp(join(tmpdir(), "session-git-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const cwd = join(dir, "repo");
  await mkdir(cwd);
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  git("init", "-b", "main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  if (initial) {
    await writeFile(join(cwd, "a.txt"), "one\ntwo\n");
    git("add", ".");
    git("commit", "-m", "initial");
  }
  return {
    cwd,
    dir,
    git,
    service: new GitService({ dataHome: join(dir, "data") }),
  };
}

test("status and literal staging preserve spaces, newlines, wildcards and index layers", async (t) => {
  const { cwd, git, service } = await fixture(t);
  const special = " -:(glob)*\t文件\n.txt";
  await writeFile(join(cwd, special), "new\n");
  await writeFile(join(cwd, "a.txt"), "staged\n");
  await service.stageFiles(cwd, ["a.txt", special]);
  await writeFile(join(cwd, "a.txt"), "working\n");
  const status = await service.status(cwd);
  assert.ok(
    status.entries.some((e) => e.path === special && e.index_status === "A"),
  );
  assert.deepEqual(await service.fileDiff(cwd, "a.txt", true), {
    old_content: "one\ntwo\n",
    new_content: "staged\n",
    has_changes: true,
    is_binary: false,
  });
  assert.equal(
    (await service.fileDiff(cwd, "a.txt", false)).new_content,
    "working\n",
  );
  await service.reverseFiles(cwd, ["a.txt"], false);
  assert.equal(await readFile(join(cwd, "a.txt"), "utf8"), "staged\n");
  await service.unstageFiles(cwd, [special]);
  assert.ok(git("diff", "--cached", "--name-only").includes("a.txt"));
  assert.equal((await service.diffStats(cwd)).staged.deletions, 2);
  const files = await service.fileNumstat(cwd);
  assert.deepEqual(
    files.find((file) => file.path === "a.txt"),
    { path: "a.txt", additions: 1, deletions: 2 },
  );
  await service.reverseFiles(cwd, [special], false);
  await assert.rejects(lstat(join(cwd, special)));
});

test("unborn branch, binary/meta, symlink and input safety", async (t) => {
  const { cwd, service, dir } = await fixture(t, false);
  await writeFile(join(cwd, "b"), Buffer.from([0, 255, 1]));
  await service.stageFiles(cwd, ["b"]);
  assert.deepEqual(await service.fileDiffMeta(cwd, "b", true), {
    old_bytes: 0,
    new_bytes: 3,
    total_bytes: 3,
    is_binary: true,
  });
  assert.equal((await service.fileDiff(cwd, "b", true)).is_binary, true);
  await service.unstageFiles(cwd, ["b"]);
  assert.equal((await service.status(cwd)).entries[0]?.index_status, "?");
  await mkdir(join(dir, "outside"));
  await writeFile(join(dir, "outside", "secret"), "safe");
  await symlink(join(dir, "outside"), join(cwd, "escape"));
  for (const path of ["../outside/secret", ".git/config", "escape/secret", cwd])
    await assert.rejects(service.reverseFiles(cwd, [path], false));
  assert.equal(await readFile(join(dir, "outside", "secret"), "utf8"), "safe");
  await assert.rejects(service.createBranch(cwd, "--orphan"));
  await assert.rejects(service.push(cwd, "ext::sh -c anything", "main"));
});

test("worktree operations are serialized and preserve target index with unusual paths and symlinks", async (t) => {
  const { cwd, service, git } = await fixture(t);
  await writeFile(join(cwd, ".env"), "LOCAL=value");
  const created = await Promise.all([
    service.createWorktree(cwd, "agent"),
    service.createWorktree(cwd, "agent"),
  ]);
  assert.deepEqual(
    created.map((x) => x.existed),
    [false, true],
  );
  const wt = created[0]!.worktree_path;
  assert.deepEqual(created[0]!.copied_env_files, [".env"]);
  await rm(join(wt, ".env")); // copied, unignored env remains a genuine untracked change
  assert.equal(
    (await service.hasWorktreeChanges(cwd, "agent")).has_changes,
    false,
  );
  const odd = 'quote"\t\nfile.txt';
  await writeFile(join(wt, odd), "agent");
  await writeFile(join(wt, "a.txt"), "agent version\n");
  await symlink("a.txt", join(wt, "link"));
  await writeFile(join(cwd, "a.txt"), "staged local\n");
  git("add", "a.txt");
  const indexBefore = git("write-tree");
  assert.equal(
    (await service.applyWorktreeChanges(cwd, "agent")).changed_files,
    3,
  );
  assert.equal(git("write-tree"), indexBefore);
  assert.equal(await readFile(join(cwd, odd), "utf8"), "agent");
  assert.equal((await lstat(join(cwd, "link"))).isSymbolicLink(), true);
  await service.removeWorktree(cwd, "agent");
  assert.equal(
    (await service.hasWorktreeChanges(cwd, "agent")).has_changes,
    false,
  );
});

test("worktree committed renames/deletions, missing source, and stale unmanaged directories", async (t) => {
  const { cwd, service, git } = await fixture(t);
  const { worktree_path: wt } = await service.createWorktree(cwd, "move");
  execFileSync("git", ["mv", "a.txt", "renamed\nfile"], { cwd: wt });
  execFileSync("git", ["commit", "-m", "rename"], { cwd: wt });
  assert.equal(
    (await service.applyWorktreeChanges(cwd, "move")).changed_files,
    2,
  );
  await assert.rejects(lstat(join(cwd, "a.txt")));
  assert.equal(
    await readFile(join(cwd, "renamed\nfile"), "utf8"),
    "one\ntwo\n",
  );
  await service.removeWorktree(cwd, "move");
  await mkdir(wt);
  await writeFile(join(wt, "keep"), "do not delete");
  await assert.rejects(
    service.createWorktree(cwd, "move"),
    /unmanaged|unregistered/i,
  );
  assert.equal(await readFile(join(wt, "keep"), "utf8"), "do not delete");
  await assert.rejects(
    service.removeWorktree(cwd, "move"),
    /unmanaged|unregistered/i,
  );
  assert.ok(git("rev-parse", "HEAD"));
});

test("blame returns the commit that last touched one line", async (t) => {
  const { cwd, service } = await fixture(t);
  const blame = await service.blameLine(cwd, "a.txt", 1);
  assert.equal(blame.present, true);
  if (!blame.present) return;
  assert.equal(blame.author, "Test");
  assert.equal(blame.summary, "initial");
  assert.match(blame.shortHash, /^[0-9a-f]{7}$/);
  assert.equal((await service.blameLine(cwd, "missing.txt", 1)).present, false);
  await assert.rejects(service.blameLine(cwd, "a.txt", 0));
});

test("branches and commits reject conflicts; push supports configured local remote and reports failure", async (t) => {
  const { cwd, service, git, dir } = await fixture(t);
  await service.createBranch(cwd, "feature");
  assert.equal((await service.branchInfo(cwd)).branch, "feature");
  await writeFile(join(cwd, "a.txt"), "feature\n");
  await service.stageFiles(cwd, ["a.txt"]);
  const sha = await service.commit(cwd, "message\n\nbody");
  assert.match(sha, /^[0-9a-f]{40,64}$/);
  await service.checkoutBranch(cwd, "main");
  await writeFile(join(cwd, "a.txt"), "local\n");
  await assert.rejects(service.checkoutBranch(cwd, "feature"));
  assert.equal(await readFile(join(cwd, "a.txt"), "utf8"), "local\n");
  assert.deepEqual((await service.listBranches(cwd)).branches, [
    "feature",
    "main",
  ]);
  const bare = join(dir, "remote.git");
  execFileSync("git", ["init", "--bare", bare], { stdio: "pipe" });
  git("remote", "add", "origin", bare);
  assert.equal(typeof (await service.push(cwd)), "string");
  git("remote", "set-url", "origin", join(dir, "nonexistent"));
  await assert.rejects(service.push(cwd));
});

test("HTTP routes use legacy paths/body aliases and empty success responses", async (t) => {
  const { cwd, service } = await fixture(t);
  const app = Fastify();
  registerGitRoutes(app, service);
  t.after(() => app.close());
  const response = await app.inject({
    method: "POST",
    url: "/api/git/file-diff",
    payload: { cwd, file_path: "a.txt", staged: false },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().has_changes, false);
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/git/stage-files",
        payload: { cwd, filePaths: [] },
      })
    ).body,
    "",
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/git/file-diff",
        payload: { cwd, filePath: "../bad", staged: false },
      })
    ).statusCode,
    400,
  );
});

test("conflicts and failing worktree creation preserve user files and staging", async (t) => {
  const { cwd, service, git } = await fixture(t);
  git("checkout", "-b", "conflict");
  await writeFile(join(cwd, "a.txt"), "branch\n");
  git("commit", "-am", "branch");
  git("checkout", "main");
  await writeFile(join(cwd, "a.txt"), "main\n");
  git("commit", "-am", "main");
  try {
    git("merge", "conflict");
  } catch {
    /* expected conflict */
  }
  const before = git("ls-files", "-u");
  assert.ok(before);
  await assert.rejects(service.commit(cwd, "invalid conflict"));
  await assert.rejects(service.reverseFiles(cwd, ["a.txt"], false));
  assert.equal(git("ls-files", "-u"), before);
  const { cwd: empty, service: fresh } = await fixture(t, false);
  await assert.rejects(fresh.createWorktree(empty, "failed"));
  assert.equal(
    (await fresh.hasWorktreeChanges(empty, "failed")).has_changes,
    false,
  );
});

test("file metadata remains available for large files without retaining full bodies", async (t) => {
  const { cwd, service, git } = await fixture(t);
  const limited = new GitService({ ...service.options, maxOutputBytes: 16384 });
  const data = Buffer.alloc(65536, "x");
  await writeFile(join(cwd, "large"), data);
  git("add", "large");
  assert.deepEqual(await limited.fileDiffMeta(cwd, "large", false), {
    old_bytes: data.length,
    new_bytes: data.length,
    total_bytes: data.length * 2,
    is_binary: false,
  });
  await assert.rejects(limited.fileDiff(cwd, "large", false), /limit/);
});

test("unstaging an edited newborn index does not discard either working copy", async (t) => {
  const { cwd, service } = await fixture(t, false);
  await writeFile(join(cwd, "new"), "stage");
  await service.stageFiles(cwd, ["new"]);
  await writeFile(join(cwd, "new"), "working");
  await service.unstageFiles(cwd, ["new"]);
  assert.equal(await readFile(join(cwd, "new"), "utf8"), "working");
  assert.equal((await service.status(cwd)).entries[0]?.index_status, "?");
});

test("stale registered missing worktree is recreated without pruning other worktrees", async (t) => {
  const { cwd, service } = await fixture(t);
  const broken = await service.createWorktree(cwd, "broken");
  const live = await service.createWorktree(cwd, "live");
  await rm(broken.worktree_path, { recursive: true, force: true });
  assert.equal((await service.createWorktree(cwd, "broken")).existed, false);
  assert.equal(
    await readFile(join(live.worktree_path, "a.txt"), "utf8"),
    "one\ntwo\n",
  );
  const wt = await service.createWorktree(cwd, "preflight");
  await writeFile(join(wt.worktree_path, "a.txt"), "changed");
  await mkdir(join(wt.worktree_path, "z"));
  await writeFile(join(wt.worktree_path, "z", "nested"), "new");
  await writeFile(join(cwd, "z"), "obstructed");
  await assert.rejects(service.applyWorktreeChanges(cwd, "preflight"));
  assert.equal(await readFile(join(cwd, "a.txt"), "utf8"), "one\ntwo\n");
});

test("worktree inventory never removes dirty, stale, unknown or linked directories", async (t) => {
  const { cwd, service, dir } = await fixture(t);
  const live = await service.createWorktree(cwd, "live");
  await writeFile(join(live.worktree_path, "uncommitted"), "recover me");
  const sibling = join(live.worktree_path, "..", "unknown");
  await mkdir(sibling);
  await writeFile(join(sibling, "keep"), "unknown owner");
  const link = join(live.worktree_path, "..", "linked");
  await symlink(join(dir, "repo"), link);
  const inventory = await service.scanWorktrees();
  assert.ok(
    inventory.some(
      (item) => item.path === live.worktree_path && item.state === "dirty",
    ),
  );
  assert.ok(
    inventory.some(
      (item) =>
        item.path === sibling.replace("/live/..", "") &&
        item.state === "unknown",
    ),
  );
  assert.equal(await readFile(join(sibling, "keep"), "utf8"), "unknown owner");
  assert.equal(
    await readFile(join(live.worktree_path, "uncommitted"), "utf8"),
    "recover me",
  );
  assert.ok((await lstat(link)).isSymbolicLink());
});

test("shared clone preserves existing destinations and rejects unsafe transport input", async (t) => {
  const { cwd, service, dir } = await fixture(t);
  const dest = join(dir, "clone");
  assert.equal(await service.cloneRepository(cwd, dest), dest);
  assert.equal(await service.cloneRepository(cwd, dest), dest);
  const unknown = join(dir, "unknown");
  await mkdir(unknown);
  await writeFile(join(unknown, "keep"), "safe");
  await assert.rejects(service.cloneRepository(cwd, unknown), /not empty/i);
  await assert.rejects(
    service.cloneRepository("ext::sh -c nope", join(dir, "unsafe")),
    /url|transport/i,
  );
  assert.equal(await readFile(join(unknown, "keep"), "utf8"), "safe");
});
