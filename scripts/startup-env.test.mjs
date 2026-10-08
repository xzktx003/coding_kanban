import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadStartupEnv } from "./startup-env.mjs";
test("startup env preserves explicit overrides and reads configuration without executing shell syntax", (t) => {
  const root = mkdtempSync(join(tmpdir(), "startup-env-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const marker = join(root, "executed");
  writeFileSync(
    join(root, ".env"),
    `SESSION_MODE_ENABLED=0\nSESSION_CARGO_BIN="/some path/cargo"\nPAYLOAD=$(touch ${marker})\n`,
  );
  const env = loadStartupEnv(root, { SESSION_MODE_ENABLED: "1" });
  assert.equal(env.SESSION_MODE_ENABLED, "1");
  assert.equal(env.SESSION_CARGO_BIN, "/some path/cargo");
  assert.match(env.PAYLOAD, /^\$\(touch /);
  assert.equal(existsSync(marker), false);
});

test("session build helper reads the Cargo executable from repository .env", async (t) => {
  const { copyFileSync, mkdirSync, symlinkSync, readFileSync } =
    await import("node:fs");
  const { spawnSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const root = mkdtempSync(join(tmpdir(), "startup-cargo-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "scripts"));
  for (const name of ["build-session-runtime.mjs", "startup-env.mjs"])
    copyFileSync(
      fileURLToPath(new URL(name, import.meta.url)),
      join(root, "scripts", name),
    );
  symlinkSync(
    fileURLToPath(new URL("../node_modules", import.meta.url)),
    join(root, "node_modules"),
    "dir",
  );
  const cargo = join(root, "cargo fixture");
  const output = join(root, "args.json");
  writeFileSync(
    cargo,
    `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(output)},JSON.stringify({args:process.argv.slice(2),bindings:process.env.WHISPER_DONT_GENERATE_BINDINGS}));\n`,
    { mode: 0o700 },
  );
  writeFileSync(join(root, ".env"), `SESSION_CARGO_BIN="${cargo}"\n`);
  const env = { ...process.env };
  delete env.SESSION_CARGO_BIN;
  const result = spawnSync(
    process.execPath,
    [join(root, "scripts/build-session-runtime.mjs"), "check"],
    { env, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const actual = JSON.parse(readFileSync(output, "utf8"));
  assert.deepEqual(actual.args, [
    "check",
    "--manifest-path",
    join(root, "packages/session-runtime/Cargo.toml"),
    "--locked",
    "-p",
    "codexia-web",
  ]);
  assert.equal(actual.bindings, "1");
});
