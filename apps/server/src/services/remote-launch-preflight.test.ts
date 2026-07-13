import assert from "node:assert/strict";
import test from "node:test";

import type { LaunchSshPtyInput } from "@agent-orchestrator/shared";

import {
  buildRemoteLaunchPreflightCommand,
  buildRemoteLaunchPreflightScript,
  RemoteLaunchPreflight,
  RemoteLaunchPreflightError,
} from "./remote-launch-preflight.js";

function launchInput(
  overrides: Partial<LaunchSshPtyInput> = {},
): LaunchSshPtyInput {
  return {
    workspaceId: "default",
    displayName: "remote test",
    agentKind: "copilot",
    sshTarget: {
      host: "remote.example.test",
      port: 10022,
      username: "developer",
    },
    remoteCommand: "copilot",
    workingDirectory: "/srv/project's workspace",
    ...overrides,
  };
}

test("preflight checks the quoted directory and selected agent in an interactive shell", () => {
  const script = buildRemoteLaunchPreflightScript(launchInput());
  const command = buildRemoteLaunchPreflightCommand(launchInput());

  assert.match(script, /cd '\/srv\/project'\\''s workspace'/);
  assert.match(script, /command -v 'copilot'/);
  assert.doesNotMatch(script, /command -v 'tmux'/);
  assert.match(script, /REMOTE_PREFLIGHT_OK/);
  assert.match(command, /exec "\$SHELL_BIN" -i -c/);
});

test("preflight expands a home-relative working directory without accepting arbitrary agents", () => {
  const command = buildRemoteLaunchPreflightScript(
    launchInput({ agentKind: "shell", workingDirectory: "~/workspace" }),
  );

  assert.match(command, /cd ~\/'workspace'/);
  assert.doesNotMatch(command, /command -v 'shell'/);

  assert.throws(
    () =>
      buildRemoteLaunchPreflightCommand(
        launchInput({ agentKind: "printf hacked" }),
      ),
    /Unsupported remote agent kind/,
  );
});

test("preflight requires tmux when a tmux session will be created", () => {
  const command = buildRemoteLaunchPreflightScript(
    launchInput({ tmuxSessionName: "remote-test" }),
  );

  assert.match(command, /command -v 'tmux'/);
});

test("preflight passes bounded SSH arguments and accepts a successful result", async () => {
  const calls: Array<{ file: string; args: string[] }> = [];
  const preflight = new RemoteLaunchPreflight(async (file, args) => {
    calls.push({ file, args });
    return { stdout: "REMOTE_PREFLIGHT_OK\n", stderr: "" };
  });

  await preflight.check(launchInput());

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.file, "ssh");
  assert.deepEqual(calls[0]?.args.slice(0, 4), [
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=8",
  ]);
  assert.equal(calls[0]?.args.at(-2), "developer@remote.example.test");
  assert.match(calls[0]?.args.at(-1) ?? "", /REMOTE_PREFLIGHT_OK/);
});

for (const scenario of [
  {
    marker: "REMOTE_PREFLIGHT_DIRECTORY_UNAVAILABLE",
    code: "REMOTE_DIRECTORY_UNAVAILABLE",
    message: "远程目录不存在或无法访问：/srv/project's workspace",
  },
  {
    marker: "REMOTE_PREFLIGHT_AGENT_UNAVAILABLE",
    code: "REMOTE_AGENT_UNAVAILABLE",
    message: "远程服务器未找到 copilot，请先安装或配置交互式 shell PATH",
  },
  {
    marker: "REMOTE_PREFLIGHT_TMUX_UNAVAILABLE",
    code: "REMOTE_TMUX_UNAVAILABLE",
    message: "远程服务器未安装 tmux，无法使用 tmux 启动模式",
  },
] as const) {
  test(`preflight classifies ${scenario.code}`, async () => {
    const preflight = new RemoteLaunchPreflight(async () => {
      const error = new Error("remote check failed") as Error & {
        stdout: string;
        stderr: string;
      };
      error.stdout = `${scenario.marker}\n`;
      error.stderr = "";
      throw error;
    });

    await assert.rejects(preflight.check(launchInput()), (error: unknown) => {
      assert.ok(error instanceof RemoteLaunchPreflightError);
      assert.equal(error.code, scenario.code);
      assert.equal(error.message, scenario.message);
      assert.equal(error.httpStatus, 400);
      return true;
    });
  });
}

test("preflight sanitizes SSH failures", async () => {
  const preflight = new RemoteLaunchPreflight(async () => {
    const error = new Error("ssh failed") as Error & { stderr: string };
    error.stderr =
      "ssh: connect to host remote.example.test port 10022: Connection refused\nsecret-line";
    throw error;
  });

  await assert.rejects(preflight.check(launchInput()), (error: unknown) => {
    assert.ok(error instanceof RemoteLaunchPreflightError);
    assert.equal(error.code, "REMOTE_PREFLIGHT_FAILED");
    assert.equal(error.httpStatus, 502);
    assert.equal(
      error.message,
      "远程启动检查失败：ssh: connect to host remote.example.test port 10022: Connection refused",
    );
    assert.doesNotMatch(error.message, /secret-line/);
    return true;
  });
});

test("preflight reports a bounded timeout without exposing process details", async () => {
  const preflight = new RemoteLaunchPreflight(async () => {
    const error = new Error("timed out") as Error & { code: string };
    error.code = "ETIMEDOUT";
    throw error;
  });

  await assert.rejects(preflight.check(launchInput()), (error: unknown) => {
    assert.ok(error instanceof RemoteLaunchPreflightError);
    assert.equal(error.code, "REMOTE_PREFLIGHT_FAILED");
    assert.equal(error.httpStatus, 502);
    assert.equal(
      error.message,
      "远程启动检查超时，请检查服务器连接和 shell 配置",
    );
    return true;
  });
});
