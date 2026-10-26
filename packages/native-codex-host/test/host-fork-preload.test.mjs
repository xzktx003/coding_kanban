import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { buildChildEnv } from "../host.mjs";
const { installOwnedExtensionHostForkPreload } = createRequire(import.meta.url)(
  "../companion/preload.cjs",
);

async function probe(kind, entry = "entry") {
  const root = await mkdtemp(join(tmpdir(), "ck-fork-preload-"));
  try {
    const codeServerRoot = join(root, "code-server");
    for (const relative of ["bin", "out/node", "lib/vscode/out"])
      await mkdir(join(codeServerRoot, relative), { recursive: true });
    const codeServer = join(codeServerRoot, "bin/code-server"),
      bootstrap = join(codeServerRoot, "lib/vscode/out/bootstrap-fork.js");
    await writeFile(codeServer, "#!/bin/sh\nexit 1\n");
    await writeFile(
      join(codeServerRoot, "package.json"),
      JSON.stringify({ type: kind === "esm" ? "module" : "commonjs" }),
    );
    await writeFile(
      bootstrap,
      `process.stdout.write(JSON.stringify({preload:!!process[Symbol.for('coding-kanban.native-codex.appserver-provider')],nodeOptionsPresent:!!process.env.NODE_OPTIONS,execArgv:process.execArgv}));`,
    );
    const script =
      (kind === "esm"
        ? `import{fork}from'node:child_process';`
        : `const{fork}=require('node:child_process');`) +
      `
      const env={...process.env,VSCODE_ESM_ENTRYPOINT:'vs/workbench/api/node/extensionHostProcess'};
      delete env.NODE_OPTIONS;delete env.VSCODE_NODE_OPTIONS;
      const options={env,execArgv:['--dns-result-order=ipv4first'],silent:true};
      const child=fork(${JSON.stringify(bootstrap)},['--type=extensionHost'],options);
      child.stdout.pipe(process.stdout);child.stderr.pipe(process.stderr);
      child.once('exit',code=>{process.exitCode=code;});`;
    const file = join(codeServerRoot, "out/node", entry);
    await writeFile(file, script);
    const env = buildChildEnv(
      {
        codeServer,
        runtimeRoot: root,
        processHome: join(root, "home"),
        codexHome: join(root, "codex"),
      },
      { PATH: process.env.PATH },
    );
    const child = spawn(process.execPath, [file], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const code = await new Promise((resolve, reject) => {
      child.once("exit", resolve);
      child.once("error", reject);
    });
    assert.equal(code, 0, stderr);
    return JSON.parse(stdout);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

for (const kind of ["cjs", "esm"])
  test(`owned ${kind} code-server fork retains only the fixed preload after environment sanitization`, async () => {
    const child = await probe(kind);
    assert.equal(child.nodeOptionsPresent, false);
    assert.equal(child.preload, true);
    assert.ok(child.execArgv.includes("--dns-result-order=ipv4first"));
  });
test("an ordinary Node script cannot install the code-server child-launch hook", async () => {
  const child = await probe("cjs", "ordinary");
  assert.equal(child.preload, false);
  assert.deepEqual(child.execArgv, ["--dns-result-order=ipv4first"]);
});

test("owned fork hook keeps launch inputs immutable and rejects other targets or instance scopes", async () => {
  const root = await mkdtemp(join(tmpdir(), "ck-fork-scope-"));
  try {
    await mkdir(join(root, "bin"));
    const codeServer = join(root, "bin/code-server");
    await writeFile(codeServer, "owned fixture");
    const config = join(root, "private/companion-auth.json");
    const processObject = {
      argv: ["node", join(root, "out/node/entry")],
      env: {
        NATIVE_CODEX_HOST_CODE_SERVER: codeServer,
        NATIVE_CODEX_COMPANION_CONFIG: config,
      },
    };
    const calls = [],
      receipt = Symbol("original receipt");
    const original = function (...args) {
      calls.push({ receiver: this, args });
      return receipt;
    };
    const childProcess = { fork: original };
    let synchronizations = 0;
    const state = installOwnedExtensionHostForkPreload(
      childProcess,
      processObject,
      () => {
        synchronizations++;
      },
    );
    assert.equal(state.installed, true);
    const modulePath = join(root, "lib/vscode/out/bootstrap-fork.js"),
      args = Object.freeze(["--type=extensionHost", "--transformURIs"]);
    const env = Object.freeze({
      VSCODE_ESM_ENTRYPOINT: "vs/workbench/api/node/extensionHostProcess",
      NATIVE_CODEX_COMPANION_CONFIG: config,
    });
    const execArgv = Object.freeze(["--dns-result-order=ipv4first"]),
      options = Object.freeze({ env, execArgv, silent: true });
    assert.equal(childProcess.fork(modulePath, args, options), receipt);
    assert.notEqual(calls[0].args[2], options);
    assert.equal(calls[0].args[2].env, env);
    assert.deepEqual(calls[0].args[2].execArgv, [
      "--require",
      fileURLToPath(new URL("../companion/preload.cjs", import.meta.url)),
      ...execArgv,
    ]);
    assert.deepEqual(options.execArgv, ["--dns-result-order=ipv4first"]);
    assert.equal(state.extensionHostForks, 1);
    const invalid = [
      [join(root, "lib/vscode/out/other.js"), args, options],
      ["lib/vscode/out/bootstrap-fork.js", args, options],
      [modulePath, ["--type=fileWatcher"], options],
      [modulePath, ["--type=extensionHost", "--type=fileWatcher"], options],
      [modulePath, [], options],
      [
        modulePath,
        args,
        {
          ...options,
          env: {
            ...env,
            VSCODE_ESM_ENTRYPOINT: "vs/platform/agentHost/node/agentHostMain",
          },
        },
      ],
      [
        modulePath,
        args,
        {
          ...options,
          env: {
            ...env,
            NATIVE_CODEX_COMPANION_CONFIG: join(
              root,
              "different-instance.json",
            ),
          },
        },
      ],
      [modulePath, args, { ...options, execArgv: undefined }],
      [modulePath, args, { ...options, execArgv: [1] }],
      [modulePath, args, undefined],
    ];
    for (const originalArgs of invalid) {
      assert.equal(childProcess.fork(...originalArgs), receipt);
      assert.deepEqual(calls.at(-1).args, originalArgs);
      assert.equal(calls.at(-1).args[2], originalArgs[2]);
    }
    assert.equal(state.extensionHostForks, 1);
    // The held parent scope cannot be retargeted by later environment changes.
    processObject.env.NATIVE_CODEX_COMPANION_CONFIG = join(
      root,
      "different-instance.json",
    );
    const changed = {
      ...options,
      env: {
        ...env,
        NATIVE_CODEX_COMPANION_CONFIG:
          processObject.env.NATIVE_CODEX_COMPANION_CONFIG,
      },
    };
    childProcess.fork(modulePath, args, changed);
    assert.equal(calls.at(-1).args[2], changed);
    assert.equal(state.extensionHostForks, 1);
    assert.equal(synchronizations, 1);
    state.restore();
    assert.equal(childProcess.fork, original);
    assert.equal(synchronizations, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
