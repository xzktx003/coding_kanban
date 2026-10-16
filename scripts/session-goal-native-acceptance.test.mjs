import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const entry = fileURLToPath(
  new URL("./session-goal-native-acceptance.py", import.meta.url),
);
const python = spawnSync("python3", ["--version"]);
const run = (args) =>
  spawnSync("python3", ["-B", entry, ...args], { encoding: "utf8" });

test(
  "no explicit native CLI produces an explicit skip, never a passing acceptance",
  { skip: python.error?.code === "ENOENT" },
  async () => {
    const output = await mkdtemp(join(tmpdir(), "goal-entry-skip-"));
    try {
      const result = run([
        "--output-dir",
        output,
        "--scenario",
        "runtime-clear",
      ]);
      assert.equal(result.status, 0, result.stderr);
      const summary = JSON.parse(result.stdout);
      assert.equal(summary.status, "skipped");
      assert.equal(summary.passed, false);
      assert.deepEqual(
        JSON.parse(
          await readFile(
            join(summary.artifactDirectory, "summary.json"),
            "utf8",
          ),
        ),
        summary,
      );
    } finally {
      await rm(output, { recursive: true, force: true });
    }
  },
);

test(
  "an unavailable explicit CLI fails unless skip was explicitly requested; relative paths are refused",
  { skip: python.error?.code === "ENOENT" },
  async () => {
    const output = await mkdtemp(join(tmpdir(), "goal-entry-path-"));
    try {
      const absent = join(output, "not-installed-codex");
      assert.equal(run(["--codex", absent, "--output-dir", output]).status, 2);
      const skipped = run([
        "--codex",
        absent,
        "--output-dir",
        output,
        "--skip-missing-cli",
      ]);
      assert.equal(skipped.status, 0, skipped.stderr);
      assert.equal(JSON.parse(skipped.stdout).status, "skipped");
      const relative = run(["--codex", "codex", "--output-dir", output]);
      assert.equal(relative.status, 2);
      assert.match(relative.stderr, /absolute/i);
    } finally {
      await rm(output, { recursive: true, force: true });
    }
  },
);

test(
  "the native CAS counterexample stays a failed result instead of becoming an expected pass",
  { skip: python.error?.code === "ENOENT" },
  () => {
    const source = [
      "import importlib.util, json, sys",
      "spec=importlib.util.spec_from_file_location('goal_entry',sys.argv[1])",
      "module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)",
      "print(json.dumps(module.scenario_status({'passed':False,'nativeCompareAndClearSupported':False},1)))",
    ].join("\n");
    const result = spawnSync("python3", ["-B", "-c", source, entry], {
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout), "failed");
  },
);
