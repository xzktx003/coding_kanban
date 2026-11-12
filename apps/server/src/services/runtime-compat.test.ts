import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";

import {
  buildInteractiveShellCommand,
  buildTmuxCommand,
  mergeShellStartupEnv,
  resolveTmuxBinary,
  resolveShellStartupEnv,
  stripNpmConfigEnv,
} from "./runtime-compat.js";

function createShellStub(
  directory: string,
  name: string,
  marker: string,
): string {
  const filePath = join(directory, name);
  writeFileSync(
    filePath,
    [
      "#!/bin/sh",
      `export SELECTED_SHELL=${marker}`,
      'if [ "$1" = "-i" ]; then',
      "  shift",
      '  if [ "$#" -eq 0 ]; then',
      '    printf %s "$SELECTED_SHELL"',
      "    exit 0",
      "  fi",
      "fi",
      'if [ "$1" = "-c" ]; then',
      "  shift",
      '  exec /bin/sh -c "$1"',
      "fi",
      'exec /bin/sh "$@"',
      "",
    ].join("\n"),
  );
  chmodSync(filePath, 0o755);
  return filePath;
}

function runInteractiveCommand(shellPath: string, pathValue: string): string {
  return execFileSync(
    "/bin/sh",
    ["-c", buildInteractiveShellCommand('printf %s "$SELECTED_SHELL"')],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: pathValue,
        SHELL: shellPath,
      },
    },
  );
}

test("prefers bash when login shell is plain sh", () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "runtime-compat-"));

  try {
    const shPath = createShellStub(tempDirectory, "sh", "sh");
    createShellStub(tempDirectory, "bash", "bash");

    const result = runInteractiveCommand(shPath, tempDirectory);

    assert.equal(result, "bash");
  } finally {
    rmSync(tempDirectory, { force: true, recursive: true });
  }
});

test("keeps the configured shell when it is not plain sh", () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "runtime-compat-"));

  try {
    const zshPath = createShellStub(tempDirectory, "zsh", "zsh");
    createShellStub(tempDirectory, "bash", "bash");

    const result = runInteractiveCommand(zshPath, tempDirectory);

    assert.equal(result, "zsh");
  } finally {
    rmSync(tempDirectory, { force: true, recursive: true });
  }
});

test("tmux command target still boots through the interactive shell wrapper", () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "runtime-compat-"));

  try {
    const shPath = createShellStub(tempDirectory, "sh", "sh");
    createShellStub(tempDirectory, "bash", "bash");

    const result = execFileSync(
      "/bin/sh",
      ["-c", `/bin/sh -c ${buildTmuxCommand('printf %s "$SELECTED_SHELL"')}`],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: tempDirectory,
          SHELL: shPath,
        },
      },
    );

    assert.equal(result, "bash");
  } finally {
    rmSync(tempDirectory, { force: true, recursive: true });
  }
});

test("tmux command can keep the pane open in the selected shell", () => {
  const command = buildTmuxCommand('printf "RUN"; exit 0', true);

  assert.match(command, /exec "\$SHELL_BIN" -i/);
  assert.match(command, /printf "RUN"; exit 0/);
});

test("resolveTmuxBinary prefers the tmux executable from PATH", () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "runtime-compat-tmux-"));

  try {
    createShellStub(tempDirectory, "tmux", "tmux");

    assert.equal(resolveTmuxBinary({ PATH: tempDirectory }), "tmux");
  } finally {
    rmSync(tempDirectory, { force: true, recursive: true });
  }
});

test("resolveShellStartupEnv prefers login and interactive startup for non-sh shells", async () => {
  let invokedFile = "";
  let invokedArgs: string[] = [];
  let invokedCwd = "";
  let invokedEnv: NodeJS.ProcessEnv | undefined;

  const result = await resolveShellStartupEnv(
    {
      HOME: "/tmp/demo-home",
      SHELL: "/bin/zsh",
    },
    {
      marker: "__TEST_ENV__",
      nodePath: "/tmp/node",
      shellPath: "/bin/zsh",
      execFileImpl: (file, args, options, callback) => {
        invokedFile = file;
        invokedArgs = args;
        invokedCwd = options.cwd;
        invokedEnv = options.env;
        callback(
          null,
          'shell noise\n__TEST_ENV__\n{"PATH":"/demo/bin","SHELL":"/bin/zsh"}\n__TEST_ENV__\n',
          "",
        );
      },
    },
  );

  assert.equal(invokedFile, "/bin/zsh");
  assert.deepEqual(invokedArgs.slice(0, 3), ["-l", "-i", "-c"]);
  assert.match(invokedArgs[3] ?? "", /\/tmp\/node/);
  assert.equal(invokedCwd, "/tmp/demo-home");
  assert.equal(invokedEnv?.SHELL, "/bin/zsh");
  assert.equal(result.PATH, "/demo/bin");
});

test("resolveShellStartupEnv falls back to interactive startup for plain sh", async () => {
  let invokedArgs: string[] = [];

  await resolveShellStartupEnv(
    {
      HOME: "/tmp/demo-home",
      SHELL: "/bin/sh",
    },
    {
      marker: "__TEST_ENV__",
      shellPath: "/bin/sh",
      execFileImpl: (_file, args, _options, callback) => {
        invokedArgs = args;
        callback(
          null,
          '__TEST_ENV__\n{"PATH":"/demo/bin"}\n__TEST_ENV__\n',
          "",
        );
      },
    },
  );

  assert.deepEqual(invokedArgs.slice(0, 2), ["-i", "-c"]);
});

test("resolveShellStartupEnv rejects a login shell that never returns", async () => {
  await assert.rejects(
    () =>
      resolveShellStartupEnv(
        {
          HOME: "/tmp/demo-home",
          SHELL: "/bin/zsh",
        },
        {
          marker: "__TEST_ENV__",
          shellPath: "/bin/zsh",
          timeoutMs: 20,
          execFileImpl: (_file, _args, options, callback) => {
            assert.equal(options.timeout, 20);
            const signal = options.signal;
            assert.ok(signal);
            signal.addEventListener(
              "abort",
              () => callback(new Error("shell startup aborted"), "", ""),
              { once: true },
            );
          },
        },
      ),
    /shell startup aborted/,
  );
});

test("shell launch environments drop npm config overrides and keep login PATH", () => {
  const result = mergeShellStartupEnv(
    {
      PATH: "/server/bin",
      npm_config_prefix: "/workspace/apps/server",
      NPM_CONFIG_USERCONFIG: "/private/npmrc",
      KEEP: "base",
    },
    {
      PATH: "/login/bin",
      NVM_BIN: "/home/user/.nvm/versions/node/v24/bin",
      KEEP: "login",
    },
  );

  assert.equal(result.PATH, "/login/bin");
  assert.equal(result.NVM_BIN, "/home/user/.nvm/versions/node/v24/bin");
  assert.equal(result.KEEP, "login");
  assert.equal(result.npm_config_prefix, undefined);
  assert.equal(result.NPM_CONFIG_USERCONFIG, undefined);
  assert.deepEqual(
    stripNpmConfigEnv({
      npm_config_prefix: "removed",
      NPM_CONFIG_CACHE: "removed",
      PATH: "/kept",
    }),
    { PATH: "/kept" },
  );
});
