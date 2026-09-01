import assert from "node:assert/strict";
import test from "node:test";

import type { LaunchSshPtyInput } from "@agent-orchestrator/shared";

import { buildServer } from "../app.js";
import {
  RemoteLaunchPreflightError,
  type RemoteLaunchPreflightLike,
} from "../services/remote-launch-preflight.js";

const requestBody: LaunchSshPtyInput = {
  workspaceId: "default",
  displayName: "missing remote agent",
  agentKind: "claude",
  sshTarget: {
    host: "remote.example.test",
    username: "developer",
  },
  remoteCommand: "claude",
  workingDirectory: "/srv/project",
};

test("SSH PTY launch rejects an unavailable remote agent before registering a session", async () => {
  const calls: LaunchSshPtyInput[] = [];
  const remoteLaunchPreflight: RemoteLaunchPreflightLike = {
    async check(input) {
      calls.push(input);
      throw new RemoteLaunchPreflightError(
        "REMOTE_AGENT_UNAVAILABLE",
        "远程服务器未找到 claude，请先安装或配置交互式 shell PATH",
        400,
      );
    },
  };
  const { app, registry } = buildServer({ remoteLaunchPreflight });

  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/agent-launch/ssh-pty",
      payload: requestBody,
    });

    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json(), {
      error: "远程服务器未找到 claude，请先安装或配置交互式 shell PATH",
      code: "REMOTE_AGENT_UNAVAILABLE",
    });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], requestBody);
    assert.deepEqual(registry.list().items, []);
  } finally {
    await app.close();
  }
});

test("SSH PTY launch maps preflight transport failures to a gateway error", async () => {
  const remoteLaunchPreflight: RemoteLaunchPreflightLike = {
    async check() {
      throw new RemoteLaunchPreflightError(
        "REMOTE_PREFLIGHT_FAILED",
        "远程启动检查失败：Connection refused",
        502,
      );
    },
  };
  const { app, registry } = buildServer({ remoteLaunchPreflight });

  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/agent-launch/ssh-pty",
      payload: requestBody,
    });

    assert.equal(response.statusCode, 502);
    assert.deepEqual(response.json(), {
      error: "远程启动检查失败：Connection refused",
      code: "REMOTE_PREFLIGHT_FAILED",
    });
    assert.deepEqual(registry.list().items, []);
  } finally {
    await app.close();
  }
});

test("SSH PTY launch rejects unsafe connection parameters before preflight", async () => {
  let preflightCalls = 0;
  const remoteLaunchPreflight: RemoteLaunchPreflightLike = {
    async check() {
      preflightCalls += 1;
    },
  };
  const { app, registry } = buildServer({ remoteLaunchPreflight });

  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/agent-launch/ssh-pty",
      payload: {
        ...requestBody,
        sshTarget: { host: "-oProxyCommand=touch /tmp/unsafe", port: 22 },
      },
    });

    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json(), {
      error: "SSH 连接参数无效",
      code: "INVALID_SSH_TARGET",
    });
    assert.equal(preflightCalls, 0);
    assert.deepEqual(registry.list().items, []);
  } finally {
    await app.close();
  }
});
