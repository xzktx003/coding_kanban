import assert from "node:assert/strict";
import test from "node:test";
import { createRestartQueue } from "./watch-server.mjs";

test("dependency preparation finishes before stopping the current gateway", async () => {
  const calls = [];
  const queue = createRestartQueue({
    prepare: async () => calls.push("prepare"),
    restart: async () => calls.push("restart"),
    onError: (e) => {
      throw e;
    },
  });
  await queue();
  assert.deepEqual(calls, ["prepare", "restart"]);
});

test("failed installation preserves the current gateway and can be retried", async () => {
  const calls = [];
  let fail = true;
  const queue = createRestartQueue({
    prepare: async () => {
      calls.push("prepare");
      if (fail) throw Error("install failed");
    },
    restart: async () => calls.push("restart"),
    onError: (e) => calls.push(e.message),
  });
  await queue();
  assert.deepEqual(calls, ["prepare", "install failed"]);
  fail = false;
  await queue();
  assert.deepEqual(calls, ["prepare", "install failed", "prepare", "restart"]);
});

test("changes during installation are coalesced into a serialized follow-up", async () => {
  let release;
  const barrier = new Promise((resolve) => {
    release = resolve;
  });
  const calls = [];
  const queue = createRestartQueue({
    prepare: async () => {
      calls.push("prepare");
      if (calls.length === 1) await barrier;
    },
    restart: async () => calls.push("restart"),
    onError: (e) => {
      throw e;
    },
  });
  const first = queue();
  queue();
  queue();
  release();
  await first;
  assert.deepEqual(calls, ["prepare", "prepare", "restart"]);
});

test("real watcher keeps the live gateway on failed install and recovers on a new change", async () => {
  const { mkdtemp, mkdir, writeFile, copyFile, rm } =
    await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { spawn } = await import("node:child_process");
  const root = await mkdtemp(join(tmpdir(), "gateway-watch-"));
  let watcher;
  let output = "";
  const waitFor = async (predicate) => {
    const deadline = Date.now() + 8000;
    while (!predicate()) {
      if (Date.now() > deadline) throw Error(`watcher timeout: ${output}`);
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
  };
  try {
    for (const path of [
      "scripts",
      "bin",
      "apps/server/src",
      "apps/server/node_modules/tsx",
      "apps/web",
      "packages/shared/src",
    ])
      await mkdir(join(root, path), { recursive: true });
    for (const path of [
      "package.json",
      "apps/server/package.json",
      "apps/web/package.json",
      "packages/shared/package.json",
    ])
      await writeFile(join(root, path), '{"type":"module","dependencies":{}}');
    for (const path of ["pnpm-lock.yaml", "pnpm-workspace.yaml"])
      await writeFile(join(root, path), "fixture");
    await writeFile(
      join(root, "apps/server/node_modules/tsx/package.json"),
      '{"type":"module","exports":"./index.js"}',
    );
    await writeFile(join(root, "apps/server/node_modules/tsx/index.js"), "");
    await writeFile(
      join(root, "apps/server/src/index.ts"),
      'console.log("GATEWAY="+process.pid); setInterval(()=>{},1000);',
    );
    await copyFile(
      new URL("./watch-server.mjs", import.meta.url),
      join(root, "scripts/watch-server.mjs"),
    );
    await writeFile(
      join(root, "bin/pnpm"),
      "#!/bin/sh\nif [ -f install-fails ]; then echo INSTALL_FAILED; exit 1; fi\necho INSTALLED\n",
      { mode: 0o755 },
    );
    watcher = spawn(
      process.execPath,
      [join(root, "scripts/watch-server.mjs")],
      {
        env: {
          ...process.env,
          PATH: `${join(root, "bin")}:${process.env.PATH}`,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    watcher.stdout.on("data", (data) => {
      output += data;
    });
    watcher.stderr.on("data", (data) => {
      output += data;
    });
    const pids = () =>
      [...output.matchAll(/GATEWAY=(\d+)/g)].map((match) => Number(match[1]));
    await waitFor(() => pids().length === 1);
    const original = pids()[0];
    await writeFile(join(root, "install-fails"), "");
    await writeFile(
      join(root, "apps/server/package.json"),
      '{"type":"module","dependencies":{"new-dependency":"1.0.0"}}',
    );
    await waitFor(() => output.includes("Preparation failed"));
    assert.equal(pids().length, 1);
    process.kill(original, 0);
    await mkdir(join(root, "apps/server/node_modules/new-dependency"));
    await writeFile(
      join(root, "apps/server/node_modules/new-dependency/package.json"),
      '{"main":"index.js"}',
    );
    await writeFile(
      join(root, "apps/server/node_modules/new-dependency/index.js"),
      "",
    );
    await rm(join(root, "install-fails"));
    await writeFile(
      join(root, "apps/server/src/index.ts"),
      'console.log("GATEWAY="+process.pid); setInterval(()=>{},1000);\n',
    );
    await waitFor(() => pids().length === 2);
    assert.throws(() => process.kill(original, 0), /ESRCH/);
    const lastPid = pids()[1];
    const exited = new Promise((resolve) => watcher.once("exit", resolve));
    watcher.kill("SIGTERM");
    await exited;
    assert.throws(() => process.kill(lastPid, 0), /ESRCH/);
  } finally {
    if (watcher && watcher.exitCode === null && watcher.signalCode === null) {
      const exited = new Promise((resolve) => watcher.once("exit", resolve));
      watcher.kill("SIGTERM");
      await exited;
    }
    await rm(root, { recursive: true, force: true });
  }
});

test("preparation installs changed manifests, skips ordinary edits and repairs missing runtime dependencies", async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { createDependencyPreparation } = await import("./watch-server.mjs");
  const root = await mkdtemp(join(tmpdir(), "gateway-deps-"));
  let installs = 0;
  try {
    for (const path of ["apps/server", "apps/web", "packages/shared"])
      await mkdir(join(root, path), { recursive: true });
    for (const path of [
      "package.json",
      "apps/server/package.json",
      "apps/web/package.json",
      "packages/shared/package.json",
    ])
      await writeFile(join(root, path), '{"dependencies":{}}');
    for (const path of ["pnpm-lock.yaml", "pnpm-workspace.yaml"])
      await writeFile(join(root, path), "fixture");
    const prepare = createDependencyPreparation({
      root,
      run: async (command, args, options) => {
        assert.equal(command, "pnpm");
        assert.deepEqual(args, ["install", "--frozen-lockfile"]);
        assert.equal(options.cwd, root);
        installs++;
        if (installs === 1)
          await writeFile(
            join(root, "pnpm-lock.yaml"),
            "changed during install",
          );
        await mkdir(join(root, "apps/server/node_modules/new-dep"), {
          recursive: true,
        });
        await writeFile(
          join(root, "apps/server/node_modules/new-dep/package.json"),
          '{"main":"index.js"}',
        );
        await writeFile(
          join(root, "apps/server/node_modules/new-dep/index.js"),
          "",
        );
      },
    });
    await prepare();
    assert.equal(installs, 2);
    await prepare();
    assert.equal(installs, 2);
    await writeFile(
      join(root, "apps/server/package.json"),
      '{"dependencies":{"new-dep":"1.0.0"}}',
    );
    await prepare();
    assert.equal(installs, 3);
    await rm(join(root, "apps/server/node_modules/new-dep/index.js"));
    await prepare();
    assert.equal(installs, 4);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
