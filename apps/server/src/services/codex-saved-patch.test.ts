import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdtemp,
  readFile,
  writeFile,
  rm,
  chmod,
  lstat,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import type {
  SavedPatchBatch,
  SavedPatchRequest,
} from "@agent-orchestrator/shared";
import { CodexSavedPatch } from "./codex-saved-patch.js";

const exec = promisify(execFile);
const patch = "@@ -1,3 +1,3 @@\n header\n-before\n+after\n tail\n";
async function fixture(t: test.TestContext) {
  const cwd = await mkdtemp(join(tmpdir(), "kanban-saved-patch-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await exec("git", ["init", "-q"], { cwd });
  await writeFile(join(cwd, "test.txt"), "header\nbefore\ntail\n");
  await exec("git", ["add", "test.txt"], { cwd });
  const expectedChanges: SavedPatchBatch[] = [
    {
      id: "patch-1",
      changes: [
        {
          path: join(cwd, "test.txt"),
          kind: { type: "update", move_path: null },
          diff: patch,
        },
      ],
    },
  ];
  const thread = {
    id: "thread-1",
    cwd,
    status: { type: "idle" },
    turns: [
      {
        id: "turn-1",
        status: "completed",
        items: expectedChanges.map((b) => ({
          ...b,
          type: "fileChange",
          status: "completed",
        })),
      },
    ],
  };
  const calls: string[] = [];
  const service = new CodexSavedPatch(
    async (id) => {
      calls.push(id);
      return { thread };
    },
    join(cwd, "journal.json"),
  );
  const request: SavedPatchRequest = {
    requestId: "operation-1",
    threadId: "thread-1",
    turnId: "turn-1",
    action: "undo",
    expectedChanges,
  };
  return { cwd, expectedChanges, thread, service, request, calls };
}

test("saved undo preserves subsequent unrelated edits and index; reapply and duplicate receipts are real", async (t) => {
  const f = await fixture(t);
  await writeFile(
    join(f.cwd, "test.txt"),
    "header\nafter\ntail\nmy later change\n",
  );
  await writeFile(join(f.cwd, "other.txt"), "unrelated work");
  const index = await readFile(join(f.cwd, ".git/index"));
  const first = await f.service.apply(f.request);
  assert.equal(first.status, "success");
  assert.equal(first.changedFiles, 1);
  assert.equal(
    await readFile(join(f.cwd, "test.txt"), "utf8"),
    "header\nbefore\ntail\nmy later change\n",
  );
  assert.equal(
    await readFile(join(f.cwd, "other.txt"), "utf8"),
    "unrelated work",
  );
  assert.deepEqual(await readFile(join(f.cwd, ".git/index")), index);
  assert.deepEqual(await f.service.apply(f.request), first);
  const restarted = new CodexSavedPatch(
    async () => ({ thread: f.thread }),
    join(f.cwd, "journal.json"),
  );
  assert.deepEqual(await restarted.apply(f.request), first);
  assert.equal(
    (
      await f.service.apply({
        ...f.request,
        requestId: "operation-2",
        action: "reapply",
      })
    ).status,
    "success",
  );
  assert.equal(
    await readFile(join(f.cwd, "test.txt"), "utf8"),
    "header\nafter\ntail\nmy later change\n",
  );
});

test("conflicting saved edits leave every file unchanged, never whole-file revert", async (t) => {
  const f = await fixture(t);
  f.expectedChanges[0].changes.push({
    path: join(f.cwd, "other.txt"),
    kind: { type: "update" },
    diff: "@@ -1 +1 @@\n-old\n+new\n",
  });
  await writeFile(join(f.cwd, "test.txt"), "header\nafter\ntail\n");
  await writeFile(join(f.cwd, "other.txt"), "another agent's later change\n");
  const result = await f.service.apply(f.request);
  assert.equal(result.status, "conflict");
  assert.match(result.error!, /other.txt/);
  assert.equal(
    await readFile(join(f.cwd, "test.txt"), "utf8"),
    "header\nafter\ntail\n",
  );
  assert.equal(
    await readFile(join(f.cwd, "other.txt"), "utf8"),
    "another agent's later change\n",
  );
});

test("multiple saved changes of one file reverse in item order and can reapply", async (t) => {
  const f = await fixture(t);
  const second: SavedPatchBatch = {
    id: "patch-2",
    changes: [
      {
        path: join(f.cwd, "test.txt"),
        kind: { type: "update" },
        diff: "@@ -1,3 +1,3 @@\n header\n-after\n+last\n tail\n",
      },
    ],
  };
  f.expectedChanges.push(second);
  f.thread.turns[0].items.push({
    ...second,
    type: "fileChange",
    status: "completed",
  });
  await writeFile(join(f.cwd, "test.txt"), "header\nlast\ntail\n");
  assert.equal((await f.service.apply(f.request)).status, "success");
  assert.equal(
    await readFile(join(f.cwd, "test.txt"), "utf8"),
    "header\nbefore\ntail\n",
  );
  assert.equal(
    (
      await f.service.apply({
        ...f.request,
        requestId: "operation-2",
        action: "reapply",
      })
    ).status,
    "success",
  );
  assert.equal(
    await readFile(join(f.cwd, "test.txt"), "utf8"),
    "header\nlast\ntail\n",
  );
});

test("native ownership, saved receipt identity and active turns are verified before mutation", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.cwd, "test.txt"), "header\nafter\ntail\n");
  await assert.rejects(
    f.service.apply({ ...f.request, threadId: "foreign" }),
    /会话/,
  );
  await assert.rejects(
    f.service.apply({ ...f.request, turnId: "foreign" }),
    /轮次/,
  );
  await assert.rejects(
    f.service.apply({ ...f.request, expectedChanges: [] }),
    /变更/,
  );
  f.thread.status.type = "active";
  await assert.rejects(f.service.apply(f.request), /运行/);
  assert.equal(
    await readFile(join(f.cwd, "test.txt"), "utf8"),
    "header\nafter\ntail\n",
  );
  assert.ok(f.calls.every((id) => id === "thread-1" || id === "foreign"));
});

test("create/delete and rename use actual saved content, preserving later edits as conflicts", async (t) => {
  const f = await fixture(t);
  f.expectedChanges[0].changes = [
    { path: join(f.cwd, "added.txt"), kind: { type: "add" }, diff: "added\n" },
    {
      path: join(f.cwd, "deleted.txt"),
      kind: { type: "delete" },
      diff: "deleted\n",
    },
    {
      path: join(f.cwd, "test.txt"),
      kind: { type: "update", move_path: join(f.cwd, "renamed.txt") },
      diff: patch,
    },
  ];
  f.thread.turns[0].items[0].changes = f.expectedChanges[0].changes;
  await rm(join(f.cwd, "test.txt"));
  await writeFile(join(f.cwd, "added.txt"), "added\n");
  await writeFile(join(f.cwd, "renamed.txt"), "header\nafter\ntail\n");
  assert.equal((await f.service.apply(f.request)).status, "success");
  assert.equal(await readFile(join(f.cwd, "deleted.txt"), "utf8"), "deleted\n");
  assert.equal(
    await readFile(join(f.cwd, "test.txt"), "utf8"),
    "header\nbefore\ntail\n",
  );
  await assert.rejects(readFile(join(f.cwd, "added.txt")), { code: "ENOENT" });
  await assert.rejects(readFile(join(f.cwd, "renamed.txt")), {
    code: "ENOENT",
  });
  assert.equal(
    (
      await f.service.apply({
        ...f.request,
        requestId: "operation-2",
        action: "reapply",
      })
    ).status,
    "success",
  );
  await writeFile(join(f.cwd, "added.txt"), "added\nlater work\n");
  assert.equal(
    (await f.service.apply({ ...f.request, requestId: "operation-3" })).status,
    "conflict",
  );
  assert.equal(
    await readFile(join(f.cwd, "renamed.txt"), "utf8"),
    "header\nafter\ntail\n",
  );
});

test("outside paths, .git and symlink traversals cannot be touched by saved patches", async (t) => {
  const f = await fixture(t);
  const external = await mkdtemp(join(tmpdir(), "kanban-patch-outside-"));
  t.after(() => rm(external, { recursive: true, force: true }));
  await writeFile(join(external, "secret.txt"), "header\nafter\ntail\n");
  await symlink(external, join(f.cwd, "linked"));
  for (const path of [
    join(external, "secret.txt"),
    ".git/config",
    "linked/secret.txt",
    "../escape",
    "-option",
  ]) {
    f.expectedChanges[0].changes[0].path = path;
    await assert.rejects(f.service.apply(f.request), /路径|链接/);
  }
  assert.equal(
    await readFile(join(external, "secret.txt"), "utf8"),
    "header\nafter\ntail\n",
  );
});

test("unfinished persisted operation is uncertain after reload and cannot execute again", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.cwd, "test.txt"), "header\nafter\ntail\n");
  const uncertain = {
    requestId: f.request.requestId,
    status: "uncertain",
    action: "undo",
    changedFiles: 0,
    error: "执行结果待核对",
  };
  await writeFile(
    join(f.cwd, "journal.json"),
    JSON.stringify({
      version: 1,
      operations: [{ request: f.request, result: uncertain }],
    }),
  );
  assert.equal((await f.service.apply(f.request)).status, "uncertain");
  assert.equal(
    (await f.service.status("thread-1", "operation-1"))?.status,
    "uncertain",
  );
  await assert.rejects(
    f.service.apply({ ...f.request, turnId: "other" }),
    /请求/,
  );
  assert.equal(
    await readFile(join(f.cwd, "test.txt"), "utf8"),
    "header\nafter\ntail\n",
  );
});

test("overlapping gateways share the durable receipt and execute the same request once", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.cwd, "test.txt"), "header\nafter\ntail\n");
  const second = new CodexSavedPatch(
    async () => ({ thread: f.thread }),
    join(f.cwd, "journal.json"),
  );
  const results = await Promise.all([
    f.service.apply(f.request),
    second.apply(f.request),
  ]);
  assert.equal(results[0].status, "success");
  assert.deepEqual(results[0], results[1]);
  assert.equal(
    await readFile(join(f.cwd, "test.txt"), "utf8"),
    "header\nbefore\ntail\n",
  );
});

test("a Git write failure after a partial write stays uncertain and blocks another request", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.cwd, "test.txt"), "header\nafter\ntail\n");
  (f.service as any).gitApply = async (
    _cwd: string,
    _patch: string,
    check: boolean,
  ) => {
    if (check) return null;
    await writeFile(join(f.cwd, "test.txt"), "partial filesystem write\n");
    return "disk write failed";
  };
  const result = await f.service.apply(f.request);
  assert.equal(result.status, "uncertain");
  assert.match(result.error!, /核对/);
  await assert.rejects(
    f.service.apply({ ...f.request, requestId: "new-operation" }),
    /未确认|核对/,
  );
  assert.equal(
    await readFile(join(f.cwd, "test.txt"), "utf8"),
    "partial filesystem write\n",
  );
});

test("saved rename preserves executable mode and quoted UTF-8 paths", async (t) => {
  const f = await fixture(t);
  const path = join(f.cwd, '代码 "before".sh'),
    destination = join(f.cwd, '代码 "after".sh');
  f.expectedChanges[0].changes = [
    { path, kind: { type: "update", move_path: destination }, diff: patch },
  ];
  f.thread.turns[0].items[0].changes = f.expectedChanges[0].changes;
  await writeFile(destination, "header\nafter\ntail\n");
  await chmod(destination, 0o755);
  assert.equal((await f.service.apply(f.request)).status, "success");
  assert.equal((await lstat(path)).mode & 0o111, 0o111);
  assert.equal(await readFile(path, "utf8"), "header\nbefore\ntail\n");
  assert.equal(
    (
      await f.service.apply({
        ...f.request,
        requestId: "operation-2",
        action: "reapply",
      })
    ).status,
    "success",
  );
  assert.equal((await lstat(destination)).mode & 0o111, 0o111);
});
