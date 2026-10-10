import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
const root = new URL("../", import.meta.url);
function python(code) {
  const prelude = `import importlib.util,sys,json,os,tempfile\nfrom pathlib import Path\nsys.dont_write_bytecode=True\nspec=importlib.util.spec_from_file_location('ownership', 'scripts/session-ownership-acceptance.py')\nm=importlib.util.module_from_spec(spec)\nspec.loader.exec_module(m)\n`;
  const result = spawnSync("python3", ["-c", prelude + code], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
test("native acceptance defaults to compiled TypeScript and preserves explicit legacy binary argv", () => {
  const result = python(
    `with tempfile.TemporaryDirectory() as path:\n m.ROOT=Path(path)\n entry=m.ROOT/'packages/session-runtime/dist/main.js'\n entry.parent.mkdir(parents=True)\n entry.write_text('// fixture')\n print(json.dumps({'default':m.runtime_command(None, 'node'), 'legacy':m.runtime_command('/bin/true','node')}))`,
  );
  assert.equal(result.default[0], "node");
  assert.match(result.default[1], /packages\/session-runtime\/dist\/main\.js$/);
  assert.deepEqual(result.legacy, [realpathSync("/bin/true")]);
});
test("native acceptance never inherits real app directories, provider credentials or remote telemetry", () => {
  const result = python(
    `os.environ.update({'OPENAI_API_KEY':'secret','ANTHROPIC_API_KEY':'secret','CODEX_HOME':'/real/cli','SESSION_DATA_HOME':'/real/app','SESSION_RUNTIME_BIN':'/real/runtime','CODEXIA_TELEMETRY_URL':'https://real.example'})\nwith tempfile.TemporaryDirectory() as path:\n e=m.isolated_environment(Path(path),'/fixture/codex')\n print(json.dumps({'root':path,'env':{k:v for k,v in e.items() if k.startswith(('OPENAI_','ANTHROPIC_','CODEX_','CLAUDE_','SESSION_','CODEXIA_'))},'dnt':e.get('DO_NOT_TRACK')}))`,
  );
  assert.equal(result.env.OPENAI_API_KEY, undefined);
  assert.equal(result.env.ANTHROPIC_API_KEY, undefined);
  assert.equal(result.env.SESSION_RUNTIME_BIN, undefined);
  assert.equal(result.env.CODEXIA_TELEMETRY_URL, undefined);
  assert.equal(result.env.CODEX_HOME, result.root + "/cli");
  assert.equal(result.env.SESSION_DATA_HOME, result.root + "/app");
  assert.equal(result.dnt, "1");
});
test("both acceptance entrypoints expose a no-model smoke mode", () => {
  for (const script of [
    "session-ownership-acceptance.py",
    "session-subagent-acceptance.py",
  ]) {
    const result = spawnSync(
      "python3",
      [new URL(script, import.meta.url).pathname, "--help"],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /--smoke/);
    assert.match(result.stdout, /--node/);
  }
});
