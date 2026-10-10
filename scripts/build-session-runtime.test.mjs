import assert from "node:assert/strict";
import test from "node:test";
import { runtimeBuildCommand } from "./build-session-runtime.mjs";
test("all default runtime verification commands use TS and never invoke Cargo", () => {
  for (const operation of ["build", "check", "test", "clippy"])
    assert.deepEqual(runtimeBuildCommand(operation), {
      command: "pnpm",
      args: [
        "--filter",
        "@agent-orchestrator/session-runtime",
        operation === "clippy" ? "check" : operation,
      ],
    });
  assert.throws(() => runtimeBuildCommand("--anything"), /Unsupported/);
});

test("standalone runtime operations build a missing shared output before using it", async (t) => {
  const {
    mkdtempSync,
    mkdirSync,
    copyFileSync,
    writeFileSync,
    readFileSync,
    rmSync,
    existsSync,
  } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const { spawnSync } = await import("node:child_process");
  const root = mkdtempSync(join(tmpdir(), "runtime-clean-build-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "scripts"));
  for (const name of ["build-session-runtime.mjs", "startup-env.mjs"])
    copyFileSync(
      fileURLToPath(new URL(name, import.meta.url)),
      join(root, "scripts", name),
    );
  const shared = join(root, "shared-ready"),
    log = join(root, "order.jsonl");
  writeFileSync(
    join(root, "pnpm"),
    `#!${process.execPath}\nconst fs = require('node:fs'); const args = process.argv.slice(2);fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args)+'\\n'); if(args[1]==='@agent-orchestrator/shared' && process.env.SESSION_FIXTURE_FAIL_SHARED) process.exit(17); if(args[1]==='@agent-orchestrator/shared') fs.writeFileSync(${JSON.stringify(shared)},'built'); else if(!fs.existsSync(${JSON.stringify(shared)})) process.exit(42);\n`,
    { mode: 0o700 },
  );
  for (const operation of ["build", "check", "test", "clippy"]) {
    rmSync(shared, { force: true });
    rmSync(log, { force: true });
    assert.equal(existsSync(shared), false);
    const result = spawnSync(
      process.execPath,
      [join(root, "scripts/build-session-runtime.mjs"), operation],
      { env: { ...process.env, PATH: root }, encoding: "utf8" },
    );
    assert.equal(result.status, 0, `${operation}: ${result.stderr}`);
    assert.deepEqual(
      readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line)),
      [
        ["--filter", "@agent-orchestrator/shared", "build"],
        [
          "--filter",
          "@agent-orchestrator/session-runtime",
          operation === "clippy" ? "check" : operation,
        ],
      ],
    );
  }
  rmSync(log, { force: true });
  const failure = spawnSync(
    process.execPath,
    [join(root, "scripts/build-session-runtime.mjs"), "build"],
    {
      env: { ...process.env, PATH: root, SESSION_FIXTURE_FAIL_SHARED: "1" },
      encoding: "utf8",
    },
  );
  assert.equal(failure.status, 17);
  assert.deepEqual(
    readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line)),
    [["--filter", "@agent-orchestrator/shared", "build"]],
  );
});

test("root build and check cover shared, runtime, gateway and frontend in dependency order", async () => {
  const { readFileSync } = await import("node:fs");
  const pkg = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  for (const name of ["build", "check"]) {
    const commands = pkg.scripts[name].split(" && ");
    assert.deepEqual(commands, [
      "pnpm --filter shared build",
      "pnpm --filter @agent-orchestrator/session-runtime build",
      "pnpm --filter server build",
      "pnpm --filter web build",
    ]);
  }
});

test("root test prepares shared before recursively running consumers", async () => {
  const { readFileSync } = await import("node:fs");
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.ok(pkg.scripts.test.startsWith("pnpm --filter shared build && pnpm --recursive test"));
});
