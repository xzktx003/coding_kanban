import assert from "node:assert/strict";
import test from "node:test";

import { finalizeOnlineUpdate } from "./finalize-online-update.mjs";

const targetHead = "a".repeat(40);

test("waits for the confirmed fast-forward, then installs dependencies before restart", async () => {
  const heads = ["b".repeat(40), targetHead];
  const commands = [];

  await finalizeOnlineUpdate({
    repositoryRoot: "/repo",
    sourceRoot: "/source",
    targetHead,
    readHead: async () => heads.shift() ?? targetHead,
    sleep: async () => {},
    runCommand: async (command, args, options) => {
      commands.push({ command, args, cwd: options.cwd, env: options.env });
    },
    logger: { log() {}, error() {} },
  });

  assert.deepEqual(
    commands.map(({ command, args, cwd }) => ({ command, args, cwd })),
    [
      {
        command: "pnpm",
        args: ["install", "--frozen-lockfile"],
        cwd: "/source",
      },
      { command: "pnpm", args: ["dev:restart"], cwd: "/repo" },
    ],
  );
  assert.equal(commands[1].env.APP_SOURCE_ROOT, "/source");
});

test("does not install or restart when the expected revision was not applied", async () => {
  const commands = [];

  await assert.rejects(
    finalizeOnlineUpdate({
      repositoryRoot: "/repo",
      sourceRoot: "/repo",
      targetHead,
      readHead: async () => "b".repeat(40),
      sleep: async () => {},
      timeoutMs: 0,
      runCommand: async (...args) => commands.push(args),
      logger: { log() {}, error() {} },
    }),
    /confirmed revision was not applied/,
  );
  assert.deepEqual(commands, []);
});

test("attempts the safe restart even if dependency installation fails", async () => {
  const commands = [];

  await assert.rejects(
    finalizeOnlineUpdate({
      repositoryRoot: "/repo",
      sourceRoot: "/source",
      targetHead,
      readHead: async () => targetHead,
      runCommand: async (command, args) => {
        commands.push([command, args]);
        if (args[0] === "install") throw new Error("install failed");
      },
      logger: { log() {}, error() {} },
    }),
    /dependency installation failed/,
  );
  assert.deepEqual(commands, [
    ["pnpm", ["install", "--frozen-lockfile"]],
    ["pnpm", ["dev:restart"]],
  ]);
});

test("rejects malformed target revisions before invoking commands", async () => {
  const commands = [];

  await assert.rejects(
    finalizeOnlineUpdate({
      repositoryRoot: "/repo",
      sourceRoot: "/repo",
      targetHead: "not-a-git-hash",
      runCommand: async (...args) => commands.push(args),
      logger: { log() {}, error() {} },
    }),
    /invalid target revision/,
  );
  assert.deepEqual(commands, []);
});
