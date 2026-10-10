import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexCloudService } from "./codex-cloud.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execute = promisify(execFile);
test("API-key and absent login truthfully disable legacy ChatGPT cloud tasks", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kanban-cloud-test-"));
  try {
    const service = new CodexCloudService({
      dataHome: directory,
      authFile: join(directory, "auth.json"),
    });
    assert.equal((await service.capability()).available, false);
    await writeFile(
      join(directory, "auth.json"),
      JSON.stringify({ OPENAI_API_KEY: "test-only" }),
    );
    assert.match((await service.capability()).reason!, /ChatGPT/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("real worktree snapshot includes tracked changes and untracked files, excludes ignored files, and verifies upload before task creation", async () => {
  const directory = await mkdtemp(
      join(tmpdir(), "kanban-cloud-snapshot-test-"),
    ),
    cwd = join(directory, "repo");
  await execute("git", ["init", "-q", cwd]);
  await writeFile(join(cwd, ".gitignore"), "secret.env\n");
  await writeFile(join(cwd, "tracked.txt"), "saved");
  await execute("git", ["-C", cwd, "add", "--", ".gitignore", "tracked.txt"]);
  await execute("git", [
    "-C",
    cwd,
    "-c",
    "user.name=isolated-test",
    "-c",
    "user.email=isolated@example.invalid",
    "commit",
    "-qm",
    "test",
  ]);
  await writeFile(join(cwd, "tracked.txt"), "changed");
  await writeFile(join(cwd, "new.txt"), "new");
  await writeFile(join(cwd, "secret.env"), "ignored-test-only");
  const authFile = join(directory, "auth.json");
  await writeFile(
    authFile,
    JSON.stringify({
      tokens: { access_token: "test-access", account_id: "test-account" },
    }),
  );
  const calls: string[] = [];
  const service = new CodexCloudService({
    dataHome: directory,
    authFile,
    uploadHosts: ["uploads.example.invalid"],
    fetch: async (url, init) => {
      const path = String(url);
      calls.push(path);
      if (path.endsWith("upload_url"))
        return Response.json({
          upload_url: "https://uploads.example.invalid/one",
          file_id: "file-a",
          etag: "etag-a",
        });
      if (path.endsWith("finish_upload"))
        return Response.json({ file_id: "file-a" });
      if (init?.method === "PUT") return new Response(null, { status: 200 });
      return Response.json({ task: { id: "task-a" } });
    },
  });
  try {
    const snapshot = await service.prepare(cwd),
      capability = await service.capability();
    assert.deepEqual(snapshot.files.sort(), [
      ".gitignore",
      "new.txt",
      "tracked.txt",
    ]);
    assert.equal(snapshot.state, "prepared");
    assert.match(snapshot.sha256, /^[a-f0-9]{64}$/);
    const owner = { cwd, threadId: null, draftOwner: "draft-a" },
      request = {
        owner,
        requestId: "request-a",
        identity: capability.identity!,
        snapshotId: snapshot.id,
        prompt: "test",
      };
    await assert.rejects(service.create(request), /尚未上传/);
    await service.upload(snapshot.id, cwd, capability.identity!);
    assert.equal(snapshot.state, "verified");
    await service.create(request);
    assert.equal(calls.filter((p) => p.endsWith("/wham/tasks")).length, 1);
    assert.equal(
      calls.some((p) => p.endsWith("finish_upload")),
      true,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("new and follow-up requests follow the enabled /wham/tasks payload without exposing credentials", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kanban-cloud-test-")),
    calls: Array<{ url: string; init?: RequestInit }> = [];
  const authFile = join(directory, "auth.json");
  const service = new CodexCloudService({
    dataHome: directory,
    authFile,
    fetch: async (url, init) => {
      calls.push({ url: String(url), init });
      return Response.json(
        String(url).endsWith("environments")
          ? { environments: [{ id: "env-a", name: "Test" }] }
          : { task: { id: "task-a" } },
      );
    },
  });
  try {
    await writeFile(
      authFile,
      JSON.stringify({
        tokens: {
          access_token: "test-access-never-browser",
          account_id: "test-account",
        },
      }),
    );
    const capability = await service.capability();
    assert.equal(capability.available, true);
    assert.equal(JSON.stringify(capability).includes("test-access"), false);
    const owner = {
      cwd: directory,
      threadId: "thread-a",
      draftOwner: "draft-a",
    };
    const request = {
      owner,
      requestId: "request-a",
      identity: capability.identity!,
      prompt: "Test task",
      environmentId: "env-a",
    };
    await service.create(request);
    await service.create(request);
    assert.equal(calls.filter((c) => c.init?.method === "POST").length, 1);
    assert.deepEqual(JSON.parse(String(calls.at(-1)!.init!.body)).new_task, {
      branch: "HEAD",
      environment_id: "env-a",
      run_environment_in_qa_mode: false,
    });
    await service.create({
      ...request,
      requestId: "request-b",
      taskId: "task-a",
      turnId: "turn-a",
      environmentId: undefined,
    });
    assert.deepEqual(JSON.parse(String(calls.at(-1)!.init!.body)).follow_up, {
      task_id: "task-a",
      turn_id: "turn-a",
      environment_mode: "code",
    });
    await writeFile(
      authFile,
      JSON.stringify({
        tokens: { access_token: "changed", account_id: "other" },
      }),
    );
    await assert.rejects(
      service.create({ ...request, requestId: "request-c" }),
      /账号/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

for (const status of [403, 404]) {
  test(`snapshot HTTP ${status} expires without implicit cloud writes and allows an explicit recovery upload`, async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: 100_000 });
    const directory = await mkdtemp(
        join(tmpdir(), "kanban-cloud-capability-test-"),
      ),
      cwd = join(directory, "repo"),
      authFile = join(directory, "auth.json");
    await execute("git", ["init", "-q", cwd]);
    await writeFile(join(cwd, "context.txt"), "isolated context");
    await execute("git", ["-C", cwd, "add", "--", "context.txt"]);
    await execute("git", [
      "-C",
      cwd,
      "-c",
      "user.name=isolated-test",
      "-c",
      "user.email=isolated@example.invalid",
      "commit",
      "-qm",
      "fixture",
    ]);
    await writeFile(
      authFile,
      JSON.stringify({
        tokens: {
          access_token: "fixture-access",
          account_id: "fixture-account",
        },
      }),
    );
    const calls: Array<{ path: string; method: string }> = [];
    let recovered = false;
    const service = new CodexCloudService({
      dataHome: directory,
      authFile,
      uploadHosts: ["uploads.example.invalid"],
      fetch: async (url, init) => {
        const path = String(url);
        calls.push({ path, method: init?.method ?? "GET" });
        if (path.endsWith("upload_url"))
          return recovered
            ? Response.json({
                upload_url: "https://uploads.example.invalid/fixture",
                file_id: "file-fixture",
                etag: "etag-fixture",
              })
            : new Response(null, { status });
        if (path.endsWith("finish_upload"))
          return Response.json({ file_id: "file-fixture" });
        assert.equal(init?.method, "PUT");
        return new Response(null, { status: 200 });
      },
    });
    try {
      const snapshot = await service.prepare(cwd),
        initial = await service.capability();
      assert.equal(calls.length, 0);
      await assert.rejects(
        service.upload(snapshot.id, cwd, initial.identity!),
        { statusCode: status },
      );
      assert.equal(snapshot.state, "failed");
      const unavailable = await service.capability();
      assert.equal(unavailable.available, true);
      assert.equal(unavailable.snapshotAvailable, false);
      assert.match(unavailable.snapshotReason!, new RegExp(`HTTP ${status}`));
      recovered = true;
      t.mock.timers.tick(59_999);
      assert.equal((await service.capability()).snapshotAvailable, false);
      assert.equal(calls.length, 1);
      t.mock.timers.tick(1);
      const retryable = await service.capability();
      assert.equal(retryable.identity, initial.identity);
      assert.equal(retryable.snapshotAvailable, null);
      assert.equal(retryable.snapshotReason, null);
      assert.equal(snapshot.state, "failed");
      assert.equal(
        calls.length,
        1,
        "capability refresh must never probe upload, upload bytes or create a task",
      );
      await service.upload(snapshot.id, cwd, retryable.identity!);
      assert.equal(snapshot.state, "verified");
      assert.equal(calls.length, 4);
      assert.deepEqual(
        calls.map(({ method }) => method),
        ["POST", "POST", "PUT", "POST"],
      );
      assert.equal(
        calls.some(({ path }) => path.endsWith("/wham/tasks")),
        false,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}
