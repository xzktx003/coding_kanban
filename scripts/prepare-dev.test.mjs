import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  chmodSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { prepareDev, validateNodeVersion } from "./prepare-dev.mjs";
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "kanban-prepare-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const dir of [
    "node_modules",
    "apps/server/node_modules",
    "apps/web/node_modules",
    "packages/session-runtime/target/debug",
  ])
    mkdirSync(join(root, dir), { recursive: true });
  const binary = join(
    root,
    "packages/session-runtime/target/debug/codexia-web",
  );
  const executable = (p = binary) => {
    writeFileSync(p, "#!/bin/sh\n");
    chmodSync(p, 0o755);
  };
  return { root, binary, executable };
}
test("default startup builds shared and incrementally compiles the runtime before launch", (t) => {
  const f = fixture(t),
    calls = [];
  prepareDev({
    root: f.root,
    env: {},
    log: () => {},
    run: (bin, args) => {
      calls.push([bin, args]);
      if (
        args.includes("build") &&
        args.some((a) => a.endsWith("build-session-runtime.mjs"))
      )
        f.executable();
    },
  });
  assert.deepEqual(calls[0], [
    "pnpm",
    ["--filter", "@agent-orchestrator/shared", "build"],
  ]);
  assert.equal(calls[1][0], process.execPath);
  assert.equal(calls[1][1].at(-1), "build");
});
test("terminal-only startup does not require or compile Rust", (t) => {
  const f = fixture(t),
    calls = [];
  prepareDev({
    root: f.root,
    env: { SESSION_MODE_ENABLED: "0" },
    log: () => {},
    run: (bin, args) => calls.push([bin, args]),
  });
  assert.equal(calls.length, 1);
});
test("explicit runtime executable is validated and never rebuilt", (t) => {
  const f = fixture(t),
    calls = [];
  f.executable();
  prepareDev({
    root: f.root,
    env: { SESSION_RUNTIME_BIN: f.binary },
    log: () => {},
    run: (bin, args) => calls.push([bin, args]),
  });
  assert.equal(calls.length, 1);
});
test("missing custom binary and missing dependencies fail before any builds", (t) => {
  const f = fixture(t),
    calls = [];
  const run = (...args) => calls.push(args);
  assert.throws(
    () =>
      prepareDev({
        root: f.root,
        env: { SESSION_RUNTIME_BIN: join(f.root, "absent") },
        run,
        log: () => {},
      }),
    /SESSION_RUNTIME_BIN/,
  );
  rmSync(join(f.root, "apps/web/node_modules"), { recursive: true });
  assert.throws(
    () => prepareDev({ root: f.root, env: {}, run, log: () => {} }),
    /pnpm install/,
  );
  assert.equal(calls.length, 0);
});
test("build errors abort and never print a ready result", (t) => {
  const f = fixture(t),
    messages = [];
  assert.throws(
    () =>
      prepareDev({
        root: f.root,
        env: {},
        log: (m) => messages.push(m),
        run: () => {
          throw new Error("compiler failed");
        },
      }),
    /compiler failed/,
  );
  assert.ok(!messages.some((m) => m.includes("准备完成")));
});
test("Node versions match the installed Vite engine requirement", () => {
  for (const version of ["18.20.0", "20.18.0", "21.7.0", "22.11.0"])
    assert.throws(() => validateNodeVersion(version), /Node/);
  for (const version of ["20.19.0", "22.12.0", "24.14.0"])
    assert.doesNotThrow(() => validateNodeVersion(version));
});
