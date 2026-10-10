import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import Fastify from "fastify";
import { registerSessionGitReviewRoutes } from "../routes/session-git-review.js";

test("readonly review endpoint preserves index/worktree and distinguishes base, commit and uncommitted snapshots", async t => {
  const cwd = await mkdtemp(join(tmpdir(), "kanban-review-source-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  git("init", "-q"); git("config", "user.name", "Fixture"); git("config", "user.email", "fixture@example.invalid");
  await writeFile(join(cwd, "a.ts"), "base\n"); git("add", "--", "a.ts"); git("commit", "-qm", "base"); git("branch", "base");
  await writeFile(join(cwd, "a.ts"), "committed\n"); git("add", "--", "a.ts"); git("commit", "-qm", "change"); const sha = git("rev-parse", "HEAD");
  await writeFile(join(cwd, "a.ts"), "staged\n"); git("add", "--", "a.ts"); await writeFile(join(cwd, "a.ts"), "working\n");
  await writeFile(join(cwd, "中文 100%:12.ts"), "untracked\n");
  const index = await readFile(join(cwd, ".git/index")), status = git("status", "--porcelain=v1");
  const app = Fastify(); t.after(() => app.close()); registerSessionGitReviewRoutes(app);
  const read = async (target: unknown) => { const r = await app.inject({ method: "POST", url: "/api/session/git/review/read", payload: { cwd, target } }); assert.equal(r.statusCode, 200, r.body); return r.json(); };
  const uncommitted = await read({ type: "uncommittedChanges" });
  assert.match(uncommitted.unifiedDiff, /-committed\n\+working/); assert.match(uncommitted.unifiedDiff, /\+untracked/); assert.equal(uncommitted.cwd, cwd);
  const base = await read({ type: "baseBranch", branch: "base" }); assert.match(base.unifiedDiff, /-base\n\+committed/); assert.doesNotMatch(base.unifiedDiff, /working|untracked/);
  const commit = await read({ type: "commit", sha, title: "change" }); assert.equal(commit.unifiedDiff, base.unifiedDiff); assert.equal(commit.resolved.commit, sha);
  assert.notEqual(base.digest, uncommitted.digest);
  assert.deepEqual(await readFile(join(cwd, ".git/index")), index); assert.equal(git("status", "--porcelain=v1"), status); assert.equal(await readFile(join(cwd, "a.ts"), "utf8"), "working\n");
  for (const target of [{ type: "custom", instructions: "review all" }, { type: "baseBranch", branch: "--output=/tmp/no" }, { type: "commit", sha: "HEAD;touch nope", title: null }, { type: "uncommittedChanges", patch: "fake" }]) assert.equal((await app.inject({ method: "POST", url: "/api/session/git/review/read", payload: { cwd, target } })).statusCode, 400);
});
