import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { prepareFixtureDockerDiagnostic } from "./fixtures/docker-command-diagnostic.mjs";

const exec = promisify(execFile);
const sha = (value) => createHash("sha256").update(value).digest("hex");

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "desktop-docker-diag-"));
  await chmod(directory, 0o700);
  t.after(() => rm(directory, { recursive: true, force: true }));
  const pythonPath = (
    await exec("python3", [
      "-c",
      "import os,sys;print(os.path.realpath(sys.executable))",
    ])
  ).stdout.trim();
  const dockerPath = join(directory, "fake-docker");
  await writeFile(
    dockerPath,
    "#!" +
      pythonPath +
      '\nimport sys,time\nif sys.argv[1] == "start":\n sys.stderr.write("bounded diagnostic error\\n");sys.exit(42)\nif sys.argv[1] == "ready":\n print("ready");sys.exit(0)\nif sys.argv[1] == "wait":\n time.sleep(30)\nif sys.argv[1] == "large":\n sys.stderr.write("x" * 20000);sys.exit(1)\nprint(sys.stdin.read(),end="")\n',
    { mode: 0o700 },
  );
  const options = {
    directory,
    dockerPath,
    dockerSha256: sha(await readFile(dockerPath)),
    pythonPath,
    pythonSha256: sha(await readFile(pythonPath)),
  };
  return { directory, options };
}

test("fixed fixture wrapper preserves stdin/stdout, stages commands, and keeps args/environment out of private logs", async (t) => {
  const f = await fixture(t);
  const d = await prepareFixtureDockerDiagnostic(f.options);
  const child = spawn(d.dockerPath, ["inspect", "PRIVATE_ARG_SENTINEL"], {
    env: { ...process.env, PRIVATE_ENV_SENTINEL: "SECRET_VALUE" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let output = "",
    error = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (error += chunk));
  const exit = new Promise((resolve) =>
    child.once("exit", (code, signal) => resolve({ code, signal })),
  );
  child.stdin.end("PRIVATE_STDIN_SENTINEL");
  assert.deepEqual(await exit, { code: 0, signal: null });
  assert.equal(output, "PRIVATE_STDIN_SENTINEL");
  assert.equal(error, "");
  const log = await readFile(d.logPath, "utf8");
  for (const secret of [
    "PRIVATE_ARG_SENTINEL",
    "PRIVATE_ENV_SENTINEL",
    "SECRET_VALUE",
    "PRIVATE_STDIN_SENTINEL",
  ])
    assert.ok(!log.includes(secret));
  const records = log.trim().split("\n").map(JSON.parse);
  assert.deepEqual(
    records.map((v) => v.event),
    ["begin", "spawned", "result"],
  );
  assert.equal(records[0].stage, "inspect");
  assert.equal(records.at(-1).exitCode, 0);
  assert.equal(records.at(-1).timeout, false);
  assert.equal((await stat(d.logPath)).mode & 0o7777, 0o600);
  assert.equal((await stat(d.dockerPath)).mode & 0o7777, 0o700);
  assert.equal(sha(await readFile(d.dockerPath)), d.dockerSha256);
});

test("a failing command preserves exit code and captures bounded stderr without dumping arguments", async (t) => {
  const f = await fixture(t),
    d = await prepareFixtureDockerDiagnostic(f.options);
  await assert.rejects(
    exec(d.dockerPath, ["start", "PRIVATE_CONTAINER_SENTINEL"]),
    (e) => e.code === 42 && e.stderr === "bounded diagnostic error\n",
  );
  let records = (await readFile(d.logPath, "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse);
  assert.equal(records.at(-1).stage, "start");
  assert.equal(records.at(-1).exitCode, 42);
  assert.equal(records.at(-1).stderr, "bounded diagnostic error\n");
  assert.ok(!JSON.stringify(records).includes("PRIVATE_CONTAINER_SENTINEL"));
  await assert.rejects(
    exec(d.dockerPath, ["large"]),
    (e) => e.code === 1 && e.stderr.length === 20000,
  );
  records = (await readFile(d.logPath, "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse);
  assert.equal(records.at(-1).stderr.length, 16384);
  assert.equal(records.at(-1).stderrTruncated, true);
});

test("a full private diagnostic log is marked truncated without blocking the fixed Docker command", async (t) => {
  const f = await fixture(t), d = await prepareFixtureDockerDiagnostic(f.options);
  await writeFile(d.logPath, Buffer.alloc(262100, 120));
  const good = await exec(d.dockerPath, ["ready"], { timeout: 5000 });
  assert.equal(good.stdout, "ready\n");
  await assert.rejects(exec(d.dockerPath, ["start"]), (e) => e.code === 42 && e.stderr === "bounded diagnostic error\n");
  const log = await readFile(d.logPath, "utf8");
  assert.ok(Buffer.byteLength(log) <= 262144);
  assert.equal((log.match(/"event":"truncated"/g) ?? []).length, 1);
});

test("fixed tool mutations fail before any Docker command is spawned and retain safe diagnostic metadata", async (t) => {
  const f = await fixture(t),
    d = await prepareFixtureDockerDiagnostic(f.options);
  await writeFile(f.options.dockerPath, "#!/bin/sh\nprintf executed\n", {
    mode: 0o700,
  });
  await assert.rejects(
    exec(d.dockerPath, ["start"]),
    (e) => e.code === 125 && !e.stdout,
  );
  const records = (await readFile(d.logPath, "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse);
  assert.deepEqual(
    records.map((v) => v.event),
    ["begin", "result"],
  );
  assert.equal(records.at(-1).reasonCode, "fixed_docker_identity_changed");
  assert.equal(records.at(-1).exitCode, 125);
});

test("outer termination is recorded as interruption and forwarded only to the wrapper owned Docker client", async (t) => {
  const f = await fixture(t),
    d = await prepareFixtureDockerDiagnostic(f.options);
  const child = spawn(d.dockerPath, ["wait"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.resume();
  child.stderr.resume();
  let exited = false;
  const completion = new Promise((resolve) =>
    child.once("exit", (code, signal) => {
      exited = true;
      resolve({ code, signal });
    }),
  );
  t.after(async () => {
    if (!exited) child.kill("SIGKILL");
    await completion;
  });
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const log = await readFile(d.logPath, "utf8");
    if (log.includes('"event":"spawned"')) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok((await readFile(d.logPath, "utf8")).includes('"event":"spawned"'));
  child.kill("SIGTERM");
  assert.deepEqual(await completion, { code: null, signal: "SIGTERM" });
  const records = (await readFile(d.logPath, "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse);
  const last = records.at(-1);
  assert.equal(last.event, "result");
  assert.equal(last.externalSignal, "SIGTERM");
  assert.equal(last.timeout, null);
  assert.equal(last.signal, "SIGTERM");
});

test("diagnostics require a private directory, verified fixed tools and exclusive files", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    prepareFixtureDockerDiagnostic({
      ...f.options,
      dockerSha256: "0".repeat(64),
    }),
  );
  await chmod(f.directory, 0o755);
  await assert.rejects(prepareFixtureDockerDiagnostic(f.options));
  await chmod(f.directory, 0o700);
  await prepareFixtureDockerDiagnostic(f.options);
  await assert.rejects(prepareFixtureDockerDiagnostic(f.options));
});
