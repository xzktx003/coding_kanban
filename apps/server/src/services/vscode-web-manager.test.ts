import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { AgentSessionRecord, SshTarget } from "@agent-orchestrator/shared";

import {
  VsCodeWebManager,
  VsCodeWebUnavailableError,
  resolveSshTunnelTarget,
} from "./vscode-web-manager.js";

const TEST_DATA_ROOT = "/tmp/coding-kanban-vscode-root";

function resolveTestExtensionsDir(root: string): string {
  return `${root}/extensions`;
}

class FakeChildProcess extends EventEmitter {
  killed = false;

  kill(): boolean {
    this.killed = true;
    return true;
  }
}

function buildSession(
  id: string,
  overrides: Partial<AgentSessionRecord> = {},
): AgentSessionRecord {
  return {
    id,
    workspaceId: "default",
    sourceType: "local",
    agentKind: "shell",
    displayName: `Local Shell ${id}`,
    workingDirectory: `/tmp/${id}`,
    connectionState: "online",
    interactionState: "running",
    ...overrides,
  };
}

test("ensureSession starts remote code-server targets for SSH sessions", async () => {
  const remoteCommands: string[] = [];
  const tunnelLaunches: Array<{ command: string; args: string[] }> = [];
  const tunnel = new FakeChildProcess();
  const waitedUrls: string[] = [];
  const manager = new VsCodeWebManager({
    allocatePort: async () => 43131,
    runRemoteCommand: async (_sshTarget: SshTarget, command: string) => {
      remoteCommands.push(command);
      if (command.includes('printf "state=%s\\n" "$STATE"')) {
        return [
          "state=started",
          "port=13338",
          "workingDirectory=/srv/remote-project",
          "pid=4242",
          "",
        ].join("\n");
      }

      return "";
    },
    spawnProcess: (command: string, args: string[]) => {
      tunnelLaunches.push({ command, args });
      return tunnel as never;
    },
    resolveTunnelTarget: async (sshTarget: SshTarget) => sshTarget,
    waitForUrlReady: async (url) => {
      waitedUrls.push(url);
    },
  });

  const response = await manager.ensureSession(
    buildSession("session-1", {
      displayName: "Remote Shell session-1",
      sourceType: "remote-connect",
      sshTarget: { host: "10.30.0.24", username: "xuzk" },
      workingDirectory: "~/remote-project",
    }),
    {
      requestHost: "10.30.0.22",
      requestProtocol: "http",
    },
  );

  assert.equal(response.provider, "code-server");
  assert.equal(
    response.url,
    "http://10.30.0.22/vscode/?folder=%2Fsrv%2Fremote-project",
  );
  assert.equal(response.reused, false);
  assert.equal(response.workingDirectory, "/srv/remote-project");
  assert.equal(manager.getProxyTargetUrl(), "http://127.0.0.1:43131");
  assert.deepEqual(waitedUrls, ["http://127.0.0.1:43131"]);
  assert.equal(remoteCommands.length, 1);
  assert.match(remoteCommands[0] ?? "", /code-server/);
  assert.match(remoteCommands[0] ?? "", /python3/);
  assert.match(remoteCommands[0] ?? "", /editor\.editContext/);
  assert.match(
    remoteCommands[0] ?? "",
    /editor\.experimentalEditContextEnabled/,
  );
  assert.doesNotMatch(
    remoteCommands[0] ?? "",
    /\.vscode-server\/(?:bin|cli\/servers)\//,
  );
  assert.deepEqual(tunnelLaunches, [
    {
      command: "ssh",
      args: [
        "-F",
        "/dev/null",
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=5",
        "-o",
        "ExitOnForwardFailure=yes",
        "-L",
        "127.0.0.1:43131:127.0.0.1:13338",
        "-N",
        "xuzk@10.30.0.24",
      ],
    },
  ]);

  await manager.stopSession("session-1");

  assert.equal(tunnel.killed, true);
  assert.equal(remoteCommands.length, 2);
  assert.match(remoteCommands[1] ?? "", /kill '4242'/);
});

test("ensureSession resolves ssh aliases before launching configless remote vscode tunnels", async () => {
  const tunnelLaunches: Array<{ command: string; args: string[] }> = [];
  const tunnel = new FakeChildProcess();
  const manager = new VsCodeWebManager({
    allocatePort: async () => 43132,
    runRemoteCommand: async (_sshTarget: SshTarget, command: string) => {
      if (command.includes('printf "state=%s\\n" "$STATE"')) {
        return [
          "state=reused",
          "port=13338",
          "workingDirectory=/data01/home/xuzk",
          "pid=",
          "",
        ].join("\n");
      }

      return "";
    },
    spawnProcess: (command: string, args: string[]) => {
      tunnelLaunches.push({ command, args });
      return tunnel as never;
    },
    waitForUrlReady: async () => {},
    resolveTunnelTarget: async () => ({
      host: "10.30.0.21",
      port: 22,
      username: "xuzk",
    }),
  } as never);

  await manager.ensureSession(
    buildSession("session-alias", {
      displayName: "Remote Alias",
      sourceType: "remote-connect",
      sshTarget: { host: "10.30.0.21_host", username: "xuzk" },
      workingDirectory: "/data01/home/xuzk",
    }),
    {
      requestHost: "10.30.0.22",
      requestProtocol: "http",
    },
  );

  assert.equal(tunnelLaunches.length, 1);
  assert.equal(tunnelLaunches[0]?.args.at(-1), "xuzk@10.30.0.21");
});

test("resolveSshTunnelTarget keeps numeric hosts but still applies ssh config port and identity", async () => {
  const resolved = await resolveSshTunnelTarget(
    { host: "10.30.0.23", username: "xuzk" },
    async () =>
      [
        "user xuzk",
        "hostname 10.30.0.23",
        "port 10022",
        "identityfile /tmp/test-key",
        "",
      ].join("\n"),
  );

  assert.deepEqual(resolved, {
    host: "10.30.0.23",
    port: 10022,
    username: "xuzk",
    identityFile: "/tmp/test-key",
  });
});

test("ensureSession rejects when no supported provider is installed", async () => {
  const manager = new VsCodeWebManager({
    findCommand: async () => null,
    installCodeServer: async () => {},
  });

  await assert.rejects(
    () => manager.ensureSession(buildSession("session-1")),
    VsCodeWebUnavailableError,
  );
});

test("ensureSession launches one global code-server and returns session-specific workspace urls", async () => {
  const launches: Array<{ command: string; args: string[] }> = [];
  const child = new FakeChildProcess();
  const files = new Map<string, string>();
  const manager = new VsCodeWebManager({
    allocatePort: async () => 43111,
    createDataRoot: async () => TEST_DATA_ROOT,
    findCommand: async (candidate) =>
      candidate === "code-server" ? "/usr/bin/code-server" : null,
    resolveLaunchEnv: async () => ({
      HOME: "/tmp/demo-home",
      PATH: "/tmp/demo-bin",
      SHELL: "/bin/bash",
    }),
    resolveExtensionsDir: resolveTestExtensionsDir,
    spawnProcess: (command, args) => {
      launches.push({ command, args });
      return child as never;
    },
    waitForUrlReady: async () => {},
    writeFile: async (pathValue, content) => {
      files.set(pathValue, content);
    },
  });

  const first = await manager.ensureSession(buildSession("session-a"), {
    requestHost: "10.30.0.22",
    requestProtocol: "http",
  });
  const second = await manager.ensureSession(
    buildSession("session-b", {
      workingDirectory: "/tmp/project-b",
    }),
    {
      requestHost: "10.30.0.22",
      requestProtocol: "http",
    },
  );

  assert.equal(launches.length, 1);
  assert.equal(first.reused, false);
  assert.equal(second.reused, true);
  assert.match(first.url, /^http:\/\/10\.30\.0\.22\/vscode\/\?/);
  assert.match(
    first.url,
    /workspace=%2Ftmp%2Fcoding-kanban-vscode-root%2Fworkspaces%2Fsession-a-[a-f0-9]{16}\.code-workspace/,
  );
  assert.match(
    second.url,
    /workspace=%2Ftmp%2Fcoding-kanban-vscode-root%2Fworkspaces%2Fproject-b-[a-f0-9]{16}\.code-workspace/,
  );
  assert.notEqual(first.url, second.url);
  assert.equal(launches[0].command, "/usr/bin/code-server");
  assert.deepEqual(launches[0].args.slice(0, 5), [
    "--auth",
    "none",
    "--bind-addr",
    "0.0.0.0:43111",
    "--disable-update-check",
  ]);
  assert.deepEqual(launches[0].args.slice(5, 9), [
    "--config",
    `${TEST_DATA_ROOT}/config.yaml`,
    "--user-data-dir",
    `${TEST_DATA_ROOT}/user-data`,
  ]);
  assert.deepEqual(launches[0].args.slice(9, 11), [
    "--extensions-dir",
    `${TEST_DATA_ROOT}/extensions`,
  ]);
  assert.match(files.get(`${TEST_DATA_ROOT}/config.yaml`) ?? "", /auth: none/);
  const userSettingsPath = `${TEST_DATA_ROOT}/user-data/User/settings.json`;
  const userSettings = JSON.parse(files.get(userSettingsPath) ?? "{}");
  assert.equal(
    userSettings["terminal.integrated.defaultProfile.linux"],
    "coding-kanban-user-shell",
  );
  assert.equal(userSettings["editor.editContext"], false);
  assert.equal(userSettings["editor.experimentalEditContextEnabled"], false);
  assert.equal(userSettings["terminal.integrated.inheritEnv"], true);
  assert.equal(
    userSettings["terminal.integrated.profiles.linux"][
      "coding-kanban-user-shell"
    ].path,
    "/bin/bash",
  );
  assert.deepEqual(
    userSettings["terminal.integrated.profiles.linux"][
      "coding-kanban-user-shell"
    ].args,
    ["-i"],
  );
  const sessionAWorkspacePath = [...files.keys()].find((pathValue) =>
    pathValue.includes("/workspaces/session-a-"),
  );
  const sessionBWorkspacePath = [...files.keys()].find((pathValue) =>
    pathValue.includes("/workspaces/project-b-"),
  );
  assert.ok(sessionAWorkspacePath);
  assert.ok(sessionBWorkspacePath);
  assert.match(
    files.get(sessionAWorkspacePath) ?? "",
    /"path": "\/tmp\/session-a"/,
  );
  assert.match(
    files.get(sessionBWorkspacePath) ?? "",
    /"path": "\/tmp\/project-b"/,
  );

  await manager.dispose();
});

test("ensureSession auto-installs code-server when no provider is initially available", async () => {
  let installCount = 0;
  let findCount = 0;
  const child = new FakeChildProcess();
  const manager = new VsCodeWebManager({
    allocatePort: async () => 43114,
    createDataRoot: async () => TEST_DATA_ROOT,
    findCommand: async (candidate) => {
      if (candidate !== "code-server") {
        return null;
      }

      findCount += 1;
      return findCount >= 2 ? "/data01/home/xuzk/.local/bin/code-server" : null;
    },
    installCodeServer: async () => {
      installCount += 1;
    },
    resolveExtensionsDir: resolveTestExtensionsDir,
    spawnProcess: () => child as never,
    waitForUrlReady: async () => {},
    writeFile: async () => {},
  });

  const result = await manager.ensureSession(buildSession("session-1"));

  assert.equal(installCount, 1);
  assert.equal(result.provider, "code-server");

  await manager.dispose();
});

test("ensureSession respawns the global server when the cached process is no longer reachable", async () => {
  const launches: Array<{ args: string[] }> = [];
  const children = [new FakeChildProcess(), new FakeChildProcess()];
  const readyAttempts = new Map<string, number>();
  let childIndex = 0;

  const manager = new VsCodeWebManager({
    allocatePort: async () => (childIndex === 0 ? 43119 : 43120),
    createDataRoot: async () => TEST_DATA_ROOT,
    findCommand: async (candidate) =>
      candidate === "code-server" ? "/usr/bin/code-server" : null,
    findRunningServer: async () => null,
    resolveExtensionsDir: resolveTestExtensionsDir,
    spawnProcess: (_command, args) => {
      launches.push({ args });
      return children[childIndex++] as never;
    },
    waitForUrlReady: async (url) => {
      const count = (readyAttempts.get(url) ?? 0) + 1;
      readyAttempts.set(url, count);

      if (url === "http://127.0.0.1:43119" && count === 2) {
        throw new Error("connection refused");
      }
    },
    writeFile: async () => {},
  });

  await manager.ensureSession(buildSession("session-1"));
  const reopened = await manager.ensureSession(buildSession("session-1"));

  assert.equal(launches.length, 2);
  assert.equal(reopened.reused, false);
  assert.match(reopened.url, /workspace=.*session-1/);

  await manager.dispose();
});

test("stopSession removes only the deleted session workspace and keeps the global server for other sessions", async () => {
  const child = new FakeChildProcess();
  const removedPaths: string[] = [];
  const manager = new VsCodeWebManager({
    allocatePort: async () => 43115,
    createDataRoot: async () => TEST_DATA_ROOT,
    findCommand: async (candidate) =>
      candidate === "code-server" ? "/usr/bin/code-server" : null,
    resolveExtensionsDir: resolveTestExtensionsDir,
    spawnProcess: () => child as never,
    waitForUrlReady: async () => {},
    writeFile: async () => {},
    removePath: async (pathValue) => {
      removedPaths.push(pathValue);
    },
  });

  await manager.ensureSession(buildSession("session-a"));
  await manager.ensureSession(buildSession("session-b"));
  await manager.stopSession("session-a");

  assert.equal(child.killed, false);

  await manager.stopSession("session-b");
  assert.equal(child.killed, true);

  await manager.dispose();
});

test("ensureSession prefers the request host for the returned public url", async () => {
  const child = new FakeChildProcess();
  const manager = new VsCodeWebManager({
    allocatePort: async () => 43116,
    createDataRoot: async () => TEST_DATA_ROOT,
    findCommand: async (candidate) =>
      candidate === "code-server" ? "/usr/bin/code-server" : null,
    resolveExtensionsDir: resolveTestExtensionsDir,
    spawnProcess: () => child as never,
    waitForUrlReady: async () => {},
    writeFile: async () => {},
  });

  const result = await manager.ensureSession(buildSession("session-1"), {
    requestHost: "10.30.0.22",
    requestProtocol: "http",
  });

  assert.match(result.url, /^http:\/\/10\.30\.0\.22\/vscode\/\?/);

  await manager.dispose();
});

test("ensureSession returns a fixed /vscode/ url on the public host", async () => {
  const child = new FakeChildProcess();
  const manager = new VsCodeWebManager({
    allocatePort: async () => 43120,
    createDataRoot: async () => TEST_DATA_ROOT,
    findCommand: async (candidate) =>
      candidate === "code-server" ? "/usr/bin/code-server" : null,
    resolveExtensionsDir: resolveTestExtensionsDir,
    spawnProcess: () => child as never,
    waitForUrlReady: async () => {},
    writeFile: async () => {},
  });

  const result = await manager.ensureSession(
    buildSession("session-fixed-url"),
    {
      requestHost: "10.30.0.22:3000",
      requestProtocol: "http",
    },
  );

  assert.match(result.url, /^http:\/\/10\.30\.0\.22:3000\/vscode\/\?/);
  assert.doesNotMatch(result.url, /:43120\//);

  await manager.dispose();
});

test("ensureSession reuses a compatible code-server already running for the current user", async () => {
  const launches: Array<{ command: string; args: string[] }> = [];
  const manager = new VsCodeWebManager({
    allocatePort: async () => 43121,
    createDataRoot: async () => TEST_DATA_ROOT,
    findCommand: async (candidate) =>
      candidate === "code-server" ? "/usr/bin/code-server" : null,
    findRunningServer: async () => ({
      pid: 321654,
      port: 43121,
      provider: "code-server",
    }),
    resolveExtensionsDir: resolveTestExtensionsDir,
    spawnProcess: (command, args) => {
      launches.push({ command, args });
      return new FakeChildProcess() as never;
    },
    waitForUrlReady: async (url) => {
      assert.equal(url, "http://127.0.0.1:43121");
    },
    writeFile: async () => {},
  });

  const result = await manager.ensureSession(buildSession("session-reuse"), {
    requestHost: "10.30.0.22:3000",
    requestProtocol: "http",
  });

  assert.equal(launches.length, 0);
  assert.equal(result.reused, true);
  assert.equal(result.provider, "code-server");
  assert.equal(manager.getProxyTargetUrl(), "http://127.0.0.1:43121");

  await manager.dispose();
});

test("stopSession does not kill an adopted code-server that was already running", async () => {
  let killCount = 0;
  const manager = new VsCodeWebManager({
    allocatePort: async () => 43122,
    createDataRoot: async () => TEST_DATA_ROOT,
    findCommand: async (candidate) =>
      candidate === "code-server" ? "/usr/bin/code-server" : null,
    findRunningServer: async () => ({
      pid: 321655,
      port: 43122,
      provider: "code-server",
      kill: () => {
        killCount += 1;
        return true;
      },
    }),
    resolveExtensionsDir: resolveTestExtensionsDir,
    waitForUrlReady: async () => {},
    writeFile: async () => {},
  });

  await manager.ensureSession(buildSession("session-adopted"));
  await manager.stopSession("session-adopted");

  assert.equal(killCount, 0);

  await manager.dispose();
});

test("ensureSession reuses a matching current-user code-server from the process list", async () => {
  const launches: Array<{ command: string; args: string[] }> = [];
  const manager = new VsCodeWebManager({
    allocatePort: async () => 43123,
    createDataRoot: async () => TEST_DATA_ROOT,
    findCommand: async (candidate) =>
      candidate === "code-server" ? "/usr/bin/code-server" : null,
    listUserProcesses: async () => [
      {
        pid: 321656,
        args: [
          "/usr/bin/code-server",
          "--auth",
          "none",
          "--bind-addr",
          "0.0.0.0:43123",
          "--disable-update-check",
          "--config",
          `${TEST_DATA_ROOT}/config.yaml`,
          "--user-data-dir",
          `${TEST_DATA_ROOT}/user-data`,
          "--extensions-dir",
          `${TEST_DATA_ROOT}/extensions`,
        ].join(" "),
      },
    ],
    resolveExtensionsDir: resolveTestExtensionsDir,
    spawnProcess: (command, args) => {
      launches.push({ command, args });
      return new FakeChildProcess() as never;
    },
    waitForUrlReady: async (url) => {
      assert.equal(url, "http://127.0.0.1:43123");
    },
    writeFile: async () => {},
  });

  const result = await manager.ensureSession(
    buildSession("session-process-list"),
  );

  assert.equal(launches.length, 0);
  assert.equal(result.reused, true);
  assert.equal(manager.getProxyTargetUrl(), "http://127.0.0.1:43123");

  await manager.dispose();
});

test("ensureSession does not rewrite an unchanged workspace file", async () => {
  const child = new FakeChildProcess();
  const writes = new Map<string, number>();
  const manager = new VsCodeWebManager({
    allocatePort: async () => 43117,
    createDataRoot: async () => TEST_DATA_ROOT,
    findCommand: async (candidate) =>
      candidate === "code-server" ? "/usr/bin/code-server" : null,
    resolveExtensionsDir: resolveTestExtensionsDir,
    spawnProcess: () => child as never,
    waitForUrlReady: async () => {},
    writeFile: async (pathValue) => {
      writes.set(pathValue, (writes.get(pathValue) ?? 0) + 1);
    },
  });

  await manager.ensureSession(buildSession("session-1"));
  await manager.ensureSession(buildSession("session-1"));

  const workspaceWrites = [...writes.entries()].filter(([pathValue]) =>
    pathValue.includes("/workspaces/"),
  );
  assert.equal(workspaceWrites.length, 1);
  assert.equal(workspaceWrites[0]?.[1], 1);

  await manager.dispose();
});

test("ensureSession uses an explicit shared extensions directory override", async () => {
  const child = new FakeChildProcess();
  const launches: Array<{ args: string[] }> = [];
  const previousExtensionsDir = process.env.VSCODE_WEB_EXTENSIONS_DIR;
  process.env.VSCODE_WEB_EXTENSIONS_DIR = "/tmp/shared-vscode-extensions";

  try {
    const manager = new VsCodeWebManager({
      allocatePort: async () => 43118,
      createDataRoot: async () => TEST_DATA_ROOT,
      findCommand: async (candidate) =>
        candidate === "code-server" ? "/usr/bin/code-server" : null,
      spawnProcess: (_command, args) => {
        launches.push({ args });
        return child as never;
      },
      waitForUrlReady: async () => {},
      writeFile: async () => {},
    });

    await manager.ensureSession(buildSession("session-1"));

    assert.deepEqual(launches[0]?.args.slice(9, 11), [
      "--extensions-dir",
      "/tmp/shared-vscode-extensions",
    ]);

    await manager.dispose();
  } finally {
    if (previousExtensionsDir === undefined) {
      delete process.env.VSCODE_WEB_EXTENSIONS_DIR;
    } else {
      process.env.VSCODE_WEB_EXTENSIONS_DIR = previousExtensionsDir;
    }
  }
});

test("ensureSession uses the current user's vscode-server extensions directory by default when available", async () => {
  const child = new FakeChildProcess();
  const launches: Array<{ args: string[] }> = [];
  const previousHome = process.env.HOME;
  const tempHome = await mkdtemp(join(tmpdir(), "coding-kanban-vscode-home-"));
  const sharedExtensionsDir = join(tempHome, ".vscode-server", "extensions");

  await mkdir(sharedExtensionsDir, { recursive: true });

  try {
    process.env.HOME = tempHome;

    const manager = new VsCodeWebManager({
      allocatePort: async () => 43124,
      createDataRoot: async () =>
        join(tempHome, ".local", "share", "coding-kanban", "vscode-web"),
      findCommand: async (candidate) =>
        candidate === "code-server" ? "/usr/bin/code-server" : null,
      spawnProcess: (_command, args) => {
        launches.push({ args });
        return child as never;
      },
      waitForUrlReady: async () => {},
    });

    await manager.ensureSession(buildSession("session-shared-extensions"));

    assert.deepEqual(launches[0]?.args.slice(9, 11), [
      "--extensions-dir",
      sharedExtensionsDir,
    ]);

    await manager.dispose();
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }

    await rm(tempHome, { recursive: true, force: true });
  }
});

test("ensureSession reuses a persisted port across global server restarts so the browser origin is stable", async () => {
  const ports: number[] = [];
  const launches: Array<{ args: string[] }> = [];
  const savedPortContents = new Map<string, string>();

  let childInstance: FakeChildProcess | null = null;
  const manager = new VsCodeWebManager({
    allocatePort: async (preferredPort) => {
      if (typeof preferredPort === "number") {
        ports.push(preferredPort);
        return preferredPort;
      }
      const allocated = 43200 + ports.length;
      ports.push(allocated);
      return allocated;
    },
    createDataRoot: async () => TEST_DATA_ROOT,
    findCommand: async (candidate) =>
      candidate === "code-server" ? "/usr/bin/code-server" : null,
    resolveExtensionsDir: resolveTestExtensionsDir,
    resolvePreferredPort: async (dataRoot) => {
      const saved = savedPortContents.get(`${dataRoot}/port.json`);
      if (!saved) {
        return null;
      }
      const parsed = JSON.parse(saved);
      return typeof parsed.port === "number" ? parsed.port : null;
    },
    spawnProcess: (_command, args) => {
      launches.push({ args });
      childInstance = new FakeChildProcess();
      return childInstance as never;
    },
    waitForUrlReady: async () => {},
    writeFile: async (pathValue, content) => {
      if (pathValue.endsWith("/port.json")) {
        savedPortContents.set(pathValue, content);
      }
    },
  });

  const first = await manager.ensureSession(buildSession("session-1"), {
    requestHost: "10.30.0.22:3000",
    requestProtocol: "http",
  });
  assert.match(first.url, /10\.30\.0\.22:3000\/vscode\//);

  // Simulate idle timeout / dispose that kills the global server.
  const launchedChild = childInstance as FakeChildProcess | null;
  if (launchedChild) {
    launchedChild.emit("exit", 0, null);
  }
  await manager.dispose();

  const second = await manager.ensureSession(buildSession("session-2"), {
    requestHost: "10.30.0.22:3000",
    requestProtocol: "http",
  });

  assert.equal(launches.length, 2);
  assert.match(
    second.url,
    /10\.30\.0\.22:3000\/vscode\//,
    `expected persisted port to be reused but got url ${second.url}`,
  );

  await manager.dispose();
});

test("ensureSession uses the resolved shell env and strips inherited VS Code IPC hooks before spawning", async () => {
  const child = new FakeChildProcess();
  let spawnedEnv: NodeJS.ProcessEnv | undefined;
  const manager = new VsCodeWebManager({
    allocatePort: async () => 43119,
    createDataRoot: async () => TEST_DATA_ROOT,
    findCommand: async (candidate) =>
      candidate === "code-server" ? "/usr/bin/code-server" : null,
    resolveExtensionsDir: resolveTestExtensionsDir,
    resolveLaunchEnv: async () => ({
      HOME: "/tmp/demo-home",
      PATH: "/tmp/demo-bin",
      SHELL: "/bin/zsh",
      HOST: "3000",
      PASSWORD: "secret",
      HASHED_PASSWORD: "hashed-secret",
      VSCODE_IPC_HOOK_CLI: "/tmp/vscode-ipc-hook.sock",
      npm_config_prefix: "/tmp/npm-prefix",
    }),
    spawnProcess: (_command, _args, options) => {
      spawnedEnv = options.env;
      return child as never;
    },
    waitForUrlReady: async () => {},
    writeFile: async () => {},
  });

  await manager.ensureSession(buildSession("session-1"));

  assert.equal(spawnedEnv?.HOME, "/tmp/demo-home");
  assert.equal(spawnedEnv?.PATH, "/tmp/demo-bin");
  assert.equal(spawnedEnv?.SHELL, "/bin/zsh");
  assert.equal(spawnedEnv?.BROWSER, "none");
  assert.equal(spawnedEnv?.HOST, undefined);
  assert.equal(spawnedEnv?.PASSWORD, undefined);
  assert.equal(spawnedEnv?.HASHED_PASSWORD, undefined);
  assert.equal(spawnedEnv?.VSCODE_IPC_HOOK_CLI, undefined);
  assert.equal(spawnedEnv?.npm_config_prefix, undefined);

  await manager.dispose();
});

test("ensureSession registers an unref-ed idle timer so `node --test` can exit after suites finish", async () => {
  const child = new FakeChildProcess();
  const manager = new VsCodeWebManager({
    allocatePort: async () => 43555,
    createDataRoot: async () => TEST_DATA_ROOT,
    findCommand: async (candidate) =>
      candidate === "code-server" ? "/usr/bin/code-server" : null,
    resolveExtensionsDir: resolveTestExtensionsDir,
    spawnProcess: () => child as never,
    waitForUrlReady: async () => {},
    writeFile: async () => {},
  });

  try {
    await manager.ensureSession(buildSession("session-idle-timer"));

    const idleTimer = (
      manager as unknown as {
        globalServer: { idleTimer: NodeJS.Timeout | null } | null;
      }
    ).globalServer?.idleTimer;

    assert.ok(idleTimer, "expected an idle timer to be scheduled");
    assert.equal(
      idleTimer?.hasRef(),
      false,
      "the idle cleanup timer must be unref-ed so Node can exit cleanly",
    );
  } finally {
    await manager.dispose();
  }
});
