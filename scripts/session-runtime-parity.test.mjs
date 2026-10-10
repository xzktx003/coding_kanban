import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
const root = new URL("../", import.meta.url);
const runtimeRoot = new URL("packages/session-runtime/", root);

test("TS runtime registers all 208 pinned method/path contracts in an isolated environment", (t) => {
  const contract = JSON.parse(
    readFileSync(new URL("route-contract.json", runtimeRoot), "utf8"),
  );
  assert.equal(contract.length, 208);
  assert.equal(
    new Set(contract.map((r) => `${r.method} ${r.path}`)).size,
    contract.length,
  );
  for (const route of contract) {
    assert.ok(["GET", "POST", "PUT", "DELETE", "PATCH"].includes(route.method));
    assert.match(route.path, /^\//);
    assert.equal(typeof route.legacyHandler, "string");
  }
  const home = mkdtempSync(join(tmpdir(), "session-parity-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  for (const dir of [".codex", ".claude"]) mkdirSync(join(home, dir));
  const require = createRequire(new URL("package.json", runtimeRoot));
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      require.resolve("tsx"),
      fileURLToPath(new URL("src/audit.ts", runtimeRoot)),
    ],
    {
      cwd: fileURLToPath(root),
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 2 * 1024 * 1024,
      env: {
        ...process.env,
        HOME: home,
        CODEX_HOME: join(home, ".codex"),
        CLAUDE_CONFIG_DIR: join(home, ".claude"),
        SESSION_DATA_HOME: home,
      },
    },
  );
  assert.equal(result.error, undefined, result.error?.message);
  let audit;
  try {
    audit = JSON.parse(result.stdout);
  } catch {
    assert.fail(
      `Runtime audit produced invalid JSON: ${result.stderr}\n${result.stdout.slice(0, 2000)}`,
    );
  }
  assert.equal(
    result.status,
    0,
    `TS runtime registered ${audit.registered}/${audit.total}; first missing: ${(
      audit.missing ?? []
    )
      .slice(0, 8)
      .map((r) => `${r.method} ${r.path}`)
      .join(", ")}\n${result.stderr}`,
  );
  assert.equal(audit.total, contract.length);
  assert.equal(audit.registered, contract.length);
  assert.deepEqual(audit.missing, []);
  // Registration proves surface coverage only; subsystem tests prove behavior.
  assert.match(audit.note, /does not prove behavior/);
});

test("TS package uses Node tooling and retains pinned MIT upstream provenance", () => {
  const pkg = JSON.parse(
    readFileSync(new URL("package.json", runtimeRoot), "utf8"),
  );
  assert.equal(pkg.type, "module");
  assert.match(pkg.scripts.build, /^tsc\b/);
  assert.match(pkg.scripts.check, /^tsc\b.*--noEmit/);
  assert.match(pkg.scripts.test, /tsx.*--test/);
  assert.equal(pkg.scripts.start, "node dist/main.js");
  assert.doesNotMatch(JSON.stringify(pkg.scripts), /cargo|rustc|src-tauri/);
  const upstream = JSON.parse(
    readFileSync(new URL("UPSTREAM.json", runtimeRoot), "utf8"),
  );
  assert.equal(upstream.project, "Codexia");
  assert.equal(upstream.version, "0.54.2");
  assert.equal(upstream.revision, "4caaa26550814ba91bda9c221607366b558f1bc5");
  assert.equal(upstream.license, "MIT");
  const license = readFileSync(new URL("LICENSE", runtimeRoot), "utf8");
  assert.match(license, /MIT License/);
  assert.match(license, /Copyright \(c\) 2026 milisp/);
  assert.match(license, /permission notice shall be included/);
});
