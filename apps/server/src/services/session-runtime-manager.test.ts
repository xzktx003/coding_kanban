import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { SessionRuntimeManager } from "./session-runtime-manager.js";
test("disabled and missing runtimes leave terminal startup available", async () => {
  assert.equal(
    await new SessionRuntimeManager(process.cwd(), {
      SESSION_MODE_ENABLED: "0",
    }).start(),
    undefined,
  );
  const data = mkdtempSync(join(tmpdir(), "session-manager-"));
  try {
    assert.equal(
      await new SessionRuntimeManager(process.cwd(), {
        SESSION_DATA_HOME: data,
        SESSION_RUNTIME_BIN: resolve(data, "absent"),
      }).start(),
      undefined,
    );
  } finally {
    rmSync(data, { recursive: true, force: true });
  }
});
test("runtime startup validates configured ports and paths before spawning", async () => {
  const data = mkdtempSync(join(tmpdir(), "session-manager-"));
  try {
    const binary = process.execPath;
    await assert.rejects(
      new SessionRuntimeManager(process.cwd(), {
        SESSION_DATA_HOME: data,
        SESSION_RUNTIME_BIN: binary,
        SESSION_RUNTIME_PORT: "0",
      }).start(),
      /PORT/,
    );
    await assert.rejects(
      new SessionRuntimeManager(process.cwd(), {
        SESSION_DATA_HOME: data,
        SESSION_RUNTIME_BIN: "bad\0bin",
      }).start(),
      /paths/,
    );
  } finally {
    rmSync(data, { recursive: true, force: true });
  }
});

test("relative runtime binaries resolve against the repository rather than server cwd", async () => {
  const root = mkdtempSync(join(tmpdir(), "runtime-relative-"));
  try {
    mkdirSync(join(root, "bin"));
    writeFileSync(join(root, "bin/runtime"), "fixture");
    await assert.rejects(
      new SessionRuntimeManager(root, {
        SESSION_RUNTIME_BIN: "bin/runtime",
        SESSION_DATA_HOME: join(root, "data"),
        SESSION_RUNTIME_PORT: "0",
      }).start(),
      /PORT/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("new runtime uses Node TS build and gateway recreation reuses the exact child", async () => {
  const root = mkdtempSync(join(tmpdir(), "runtime-typescript-"));
  const data = join(root, "data"),
    entrypoint = join(root, "packages/session-runtime/dist/main.js");
  mkdirSync(join(root, "packages/session-runtime/dist"), { recursive: true });
  writeFileSync(
    entrypoint,
    `const http = require('node:http'); http.createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({status:'ok',instance:process.env.SESSION_RUNTIME_INSTANCE}));}).listen(Number(process.argv[process.argv.indexOf('--port')+1]),'127.0.0.1');`,
  );
  let pid: number | undefined;
  try {
    const env = {
      SESSION_DATA_HOME: data,
      PATH: process.env.PATH,
      SHELL: "/bin/sh",
    };
    const origin = await new SessionRuntimeManager(root, env).start();
    assert.match(origin!, /^http:\/\/127\.0\.0\.1:/);
    const identity = JSON.parse(
      readFileSync(join(data, "runtime.json"), "utf8"),
    );
    pid = identity.pid;
    assert.equal(identity.binary, process.execPath);
    assert.equal(identity.entrypoint, entrypoint);
    assert.match(identity.buildFingerprint, /^[a-f0-9]{64}$/);
    assert.equal(await new SessionRuntimeManager(root, env).start(), origin);
    assert.equal(
      JSON.parse(readFileSync(join(data, "runtime.json"), "utf8")).pid,
      pid,
    );
  } finally {
    if (pid) process.kill(pid, "SIGTERM");
    rmSync(root, { recursive: true, force: true });
  }
});

test("a live legacy runtime is reused even when the default changes to TypeScript", async () => {
  const { spawn } = await import("node:child_process");
  const root = mkdtempSync(join(tmpdir(), "runtime-legacy-")),
    data = join(root, "data");
  mkdirSync(data);
  const script = join(root, "legacy.cjs");
  writeFileSync(
    script,
    `const http = require('node:http'); const server=http.createServer((req,res)=>res.end(JSON.stringify({status:'ok',instance:'legacy-owned'})));server.listen(0,'127.0.0.1',()=>console.log(server.address().port));`,
  );
  const child = spawn(process.execPath, [script], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  try {
    const port = Number(
      await new Promise<string>((resolve) =>
        child.stdout!.once("data", (data) => resolve(data.toString())),
      ),
    );
    writeFileSync(
      join(data, "runtime.json"),
      JSON.stringify({
        binary: process.execPath,
        pid: child.pid,
        port,
        instance: "legacy-owned",
      }),
    );
    assert.equal(
      await new SessionRuntimeManager(root, {
        SESSION_DATA_HOME: data,
      }).start(),
      `http://127.0.0.1:${port}`,
    );
    assert.equal(child.exitCode, null);
  } finally {
    child.kill();
    rmSync(root, { recursive: true, force: true });
  }
});

test("owned live legacy process with failed health blocks replacement and preserves identity", async () => {
  const { spawn } = await import("node:child_process");
  const root = mkdtempSync(join(tmpdir(), "runtime-unready-"));
  const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
    stdio: "ignore",
  });
  const identity = JSON.stringify({
    binary: process.execPath,
    pid: child.pid,
    port: 1,
    instance: "legacy-unready",
  });
  writeFileSync(join(root, "runtime.json"), identity);
  try {
    await assert.rejects(
      new SessionRuntimeManager(root, { SESSION_DATA_HOME: root }).start(),
      /Owned session runtime/,
    );
    assert.equal(readFileSync(join(root, "runtime.json"), "utf8"), identity);
    assert.equal(child.exitCode, null);
  } finally {
    child.kill();
    rmSync(root, { recursive: true, force: true });
  }
});

test("live startup lock and corrupted identity prevent competing daemon creation", async () => {
  const root = mkdtempSync(join(tmpdir(), "runtime-lock-"));
  try {
    const lock = join(root, "runtime-start.lock");
    const encoded = JSON.stringify({
      pid: process.pid,
      token: "other-gateway",
    });
    writeFileSync(lock, encoded);
    await assert.rejects(
      new SessionRuntimeManager(root, { SESSION_DATA_HOME: root }).start(),
      /already in progress/,
    );
    assert.equal(readFileSync(lock, "utf8"), encoded);
    rmSync(lock);
    writeFileSync(join(root, "runtime.json"), "{partial");
    await assert.rejects(
      new SessionRuntimeManager(root, { SESSION_DATA_HOME: root }).start(),
    );
    assert.equal(readFileSync(join(root, "runtime.json"), "utf8"), "{partial");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("build fingerprint changes for any emitted JS module but ignores sourcemaps", async () => {
  const { runtimeBuildFingerprint } =
    await import("./session-runtime-manager.js");
  const root = mkdtempSync(join(tmpdir(), "runtime-build-hash-"));
  try {
    writeFileSync(join(root, "main.js"), "main");
    mkdirSync(join(root, "nested"));
    writeFileSync(join(root, "nested/service.js"), "first");
    const first = runtimeBuildFingerprint(root);
    writeFileSync(join(root, "main.js.map"), "map");
    assert.equal(runtimeBuildFingerprint(root), first);
    // `session:test` emits these next to the modules; they never load at runtime.
    writeFileSync(join(root, "nested/service.test.js"), "spec");
    assert.equal(runtimeBuildFingerprint(root), first);
    writeFileSync(join(root, "nested/service.js"), "second");
    assert.notEqual(runtimeBuildFingerprint(root), first);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
