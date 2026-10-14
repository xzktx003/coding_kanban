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

test("real watcher builds shared before gateway imports and preserves the live gateway on failed preparation", async () => {
  const { mkdtemp, mkdir, writeFile, copyFile, rm } =
    await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { spawn } = await import("node:child_process");
  const root = await mkdtemp(join(tmpdir(), "gateway-watch-"));
  let watcher;
  let independentRuntime;
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
      "packages/shared/dist",
      "packages/session-runtime",
    ])
      await mkdir(join(root, path), { recursive: true });
    for (const path of [
      "package.json",
      "apps/server/package.json",
      "apps/web/package.json",
      "packages/shared/package.json",
      "packages/session-runtime/package.json",
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
      'import { value } from "../../../packages/shared/dist/index.js"; console.log("SHARED="+value); console.log("GATEWAY="+process.pid); setInterval(()=>{},1000);',
    );
    await writeFile(
      join(root, "packages/shared/src/index.ts"),
      "export const value = 1;\n",
    );
    await writeFile(
      join(root, "packages/shared/dist/index.js"),
      "export const oldValue = 0;\n",
    );
    await copyFile(
      new URL("./watch-server.mjs", import.meta.url),
      join(root, "scripts/watch-server.mjs"),
    );
    await copyFile(
      new URL("./startup-env.mjs", import.meta.url),
      join(root, "scripts/startup-env.mjs"),
    );
    await writeFile(
      join(root, "bin/pnpm"),
      '#!/bin/sh\nif [ "$1" = install ]; then\n  if [ -f install-fails ]; then echo INSTALL_FAILED; exit 1; fi\n  echo INSTALLED\nelse\n  if [ -f build-fails ]; then echo BUILD_FAILED; exit 1; fi\n  cp packages/shared/src/index.ts packages/shared/dist/index.js\n  echo BUILT_SHARED\nfi\n',
      { mode: 0o755 },
    );
    independentRuntime = spawn(
      process.execPath,
      ["-e", "setInterval(()=>{},1000)"],
      { stdio: "ignore" },
    );
    watcher = spawn(
      process.execPath,
      [join(root, "scripts/watch-server.mjs")],
      {
        env: {
          ...process.env,
          SESSION_MODE_ENABLED: "1",
          SESSION_RUNTIME_BIN: "",
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
    assert.match(output, /SHARED=1/);
    assert.ok(output.indexOf("INSTALLED") < output.indexOf("BUILT_SHARED"));
    assert.ok(output.indexOf("BUILT_SHARED") < output.indexOf("GATEWAY="));
    const original = pids()[0];
    await writeFile(join(root, "install-fails"), "");
    await writeFile(
      join(root, "packages/session-runtime/package.json"),
      '{"type":"module","dependencies":{"new-dependency":"1.0.0"}}',
    );
    await waitFor(() => output.includes("Preparation failed"));
    assert.equal(pids().length, 1);
    process.kill(original, 0);
    process.kill(independentRuntime.pid, 0);
    await mkdir(
      join(root, "packages/session-runtime/node_modules/new-dependency"),
      { recursive: true },
    );
    await writeFile(
      join(
        root,
        "packages/session-runtime/node_modules/new-dependency/package.json",
      ),
      '{"main":"index.js"}',
    );
    await writeFile(
      join(
        root,
        "packages/session-runtime/node_modules/new-dependency/index.js",
      ),
      "",
    );
    await rm(join(root, "install-fails"));
    await writeFile(join(root, "build-fails"), "");
    await writeFile(
      join(root, "packages/shared/src/index.ts"),
      "export const value = 2;\n",
    );
    await waitFor(
      () =>
        output.includes("BUILD_FAILED") &&
        output.match(/Preparation failed/g)?.length === 2,
    );
    assert.equal(pids().length, 1);
    process.kill(original, 0);
    process.kill(independentRuntime.pid, 0);
    await rm(join(root, "build-fails"));
    await writeFile(
      join(root, "packages/shared/src/index.ts"),
      "export const value = 3;\n",
    );
    await waitFor(() => pids().length === 2);
    assert.match(output, /SHARED=3/);
    assert.throws(() => process.kill(original, 0), /ESRCH/);
    const lastPid = pids()[1];
    process.kill(independentRuntime.pid, 0);
    const exited = new Promise((resolve) => watcher.once("exit", resolve));
    watcher.kill("SIGTERM");
    await exited;
    assert.throws(() => process.kill(lastPid, 0), /ESRCH/);
  } finally {
    if (independentRuntime) independentRuntime.kill("SIGTERM");
    if (watcher && watcher.exitCode === null && watcher.signalCode === null) {
      const exited = new Promise((resolve) => watcher.once("exit", resolve));
      watcher.kill("SIGTERM");
      await exited;
    }
    await rm(root, { recursive: true, force: true });
  }
});

test("preparation installs changed manifests, skips ordinary edits and repairs missing gateway dependencies", async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { createDependencyPreparation } = await import("./watch-server.mjs");
  const root = await mkdtemp(join(tmpdir(), "gateway-deps-"));
  let installs = 0;
  try {
    for (const path of [
      "apps/server",
      "apps/web",
      "packages/shared",
      "packages/session-runtime",
    ])
      await mkdir(join(root, path), { recursive: true });
    for (const path of [
      "package.json",
      "apps/server/package.json",
      "apps/web/package.json",
      "packages/shared/package.json",
      "packages/session-runtime/package.json",
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

test("runtime manifest and missing dependencies are checked only for the default enabled TS runtime", async (t) => {
  const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { createDependencyPreparation } = await import("./watch-server.mjs");
  const root = await mkdtemp(join(tmpdir(), "runtime-watch-deps-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const path of [
    "apps/server",
    "apps/web",
    "packages/shared",
    "packages/session-runtime",
  ])
    await mkdir(join(root, path), { recursive: true });
  for (const path of [
    "package.json",
    "apps/server/package.json",
    "apps/web/package.json",
    "packages/shared/package.json",
    "packages/session-runtime/package.json",
  ])
    await writeFile(join(root, path), '{"dependencies":{}}');
  for (const path of ["pnpm-lock.yaml", "pnpm-workspace.yaml"])
    await writeFile(join(root, path), "fixture");
  let installs = 0;
  const run = async () => {
    installs++;
  };
  const prepare = createDependencyPreparation({ root, env: {}, run });
  await prepare();
  assert.equal(installs, 1);
  await writeFile(
    join(root, "packages/session-runtime/package.json"),
    '{"dependencies":{"runtime-only-dep":"1.0.0"}}',
  );
  await assert.rejects(prepare(), /runtime-only-dep/);
  assert.equal(installs, 2);
  const dep = join(
    root,
    "packages/session-runtime/node_modules/runtime-only-dep",
  );
  await mkdir(dep, { recursive: true });
  await writeFile(join(dep, "package.json"), '{"main":"index.js"}');
  await writeFile(join(dep, "index.js"), "");
  await prepare();
  assert.equal(installs, 3);
  await prepare();
  assert.equal(installs, 3);
  await rm(join(dep, "index.js"));
  await assert.rejects(prepare(), /runtime-only-dep/);
  assert.equal(installs, 4);
  await createDependencyPreparation({
    root,
    env: { SESSION_MODE_ENABLED: "0" },
    run,
  })();
  await createDependencyPreparation({
    root,
    env: { SESSION_RUNTIME_BIN: "/custom/runtime" },
    run,
  })();
  await writeFile(join(root, ".env"), "SESSION_MODE_ENABLED=0\n");
  await createDependencyPreparation({ root, env: {}, run })();
  await assert.rejects(
    createDependencyPreparation({
      root,
      env: { SESSION_MODE_ENABLED: "1" },
      run,
    })(),
    /runtime-only-dep/,
  );
});
