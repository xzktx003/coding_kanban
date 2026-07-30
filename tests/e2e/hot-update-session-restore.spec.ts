import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { resolveTmuxBinary } from "./tmux-binary";

const REPOSITORY_ROOT = process.cwd();
const TMUX_BINARY = resolveTmuxBinary();

interface AgentSessionSummary {
  id: string;
  displayName: string;
  connectionState: string;
  transportRef?: {
    tmuxSession?: string;
  };
}

interface AgentSessionSnapshot {
  items: AgentSessionSummary[];
}

interface AppVersion {
  runtimeId: string;
  sourceRevision: string;
  autoUpdate?: {
    phase: string;
    conflictReason: string | null;
    remoteHead: string | null;
  };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function reservePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("could not reserve an isolated TCP port"));
        return;
      }

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolvePort(address.port);
      });
    });
  });
}

function readLogTail(filePath: string, maxLines = 80): string {
  try {
    return readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .slice(-maxLines)
      .join("\n");
  } catch {
    return "<log unavailable>";
  }
}

async function waitForUrl(
  url: string,
  processHandle: ChildProcess,
  logPath: string,
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (processHandle.exitCode !== null) {
      throw new Error(
        `isolated process exited before ${url} became ready\n${readLogTail(logPath)}`,
      );
    }

    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Process is still starting.
    }

    await delay(100);
  }

  throw new Error(`timed out waiting for ${url}\n${readLogTail(logPath)}`);
}

async function stopProcess(processHandle: ChildProcess | null): Promise<void> {
  if (!processHandle || processHandle.exitCode !== null || !processHandle.pid) {
    return;
  }

  try {
    process.kill(-processHandle.pid, "SIGTERM");
  } catch {
    processHandle.kill("SIGTERM");
  }

  const exited = await Promise.race([
    new Promise<boolean>((resolveExit) => {
      processHandle.once("exit", () => resolveExit(true));
    }),
    delay(3_000).then(() => false),
  ]);
  if (exited || processHandle.exitCode !== null) {
    return;
  }

  try {
    process.kill(-processHandle.pid, "SIGKILL");
  } catch {
    processHandle.kill("SIGKILL");
  }
}

class IsolatedKanbanRuntime {
  readonly root = mkdtempSync(join(tmpdir(), "coding-kanban-hot-update-"));
  readonly sourceRoot = join(this.root, "source");
  readonly remoteRoot = join(this.root, "remote.git");
  readonly peerRoot = join(this.root, "peer");
  readonly sessionStatePath = join(this.root, "runtime", "sessions.json");
  readonly tmuxTmpDir = join(this.root, "tmux");
  readonly backendLogPath = join(this.root, "backend.log");
  readonly frontendLogPath = join(this.root, "frontend.log");
  backendPort = 0;
  frontendPort = 0;
  backend: ChildProcess | null = null;
  frontend: ChildProcess | null = null;

  constructor(readonly gitAutoPullIntervalMinutes?: 10 | 30) {}

  get backendUrl(): string {
    return `http://127.0.0.1:${this.backendPort}`;
  }

  get frontendUrl(): string {
    return `http://127.0.0.1:${this.frontendPort}`;
  }

  private get tmuxEnv(): NodeJS.ProcessEnv {
    const env = {
      ...process.env,
      TMUX_TMPDIR: this.tmuxTmpDir,
    };
    delete env.TMUX;
    delete env.TMUX_PANE;
    return env;
  }

  async start(): Promise<void> {
    mkdirSync(this.sourceRoot, { recursive: true });
    mkdirSync(this.tmuxTmpDir, { recursive: true });
    writeFileSync(join(this.sourceRoot, "revision.txt"), "revision-1\n");
    execFileSync("git", ["init", "-q"], { cwd: this.sourceRoot });
    execFileSync("git", ["config", "user.email", "e2e@example.invalid"], {
      cwd: this.sourceRoot,
    });
    execFileSync("git", ["config", "user.name", "Coding Kanban E2E"], {
      cwd: this.sourceRoot,
    });
    execFileSync("git", ["add", "revision.txt"], { cwd: this.sourceRoot });
    execFileSync("git", ["commit", "-qm", "initial"], {
      cwd: this.sourceRoot,
    });
    if (this.gitAutoPullIntervalMinutes) {
      execFileSync(
        "git",
        ["init", "--bare", "--initial-branch=main", this.remoteRoot],
        { cwd: this.root },
      );
      execFileSync("git", ["branch", "-M", "main"], {
        cwd: this.sourceRoot,
      });
      execFileSync("git", ["remote", "add", "origin", this.remoteRoot], {
        cwd: this.sourceRoot,
      });
      execFileSync("git", ["push", "-u", "origin", "main"], {
        cwd: this.sourceRoot,
      });
      execFileSync("git", ["clone", this.remoteRoot, this.peerRoot], {
        cwd: this.root,
      });
      execFileSync("git", ["config", "user.email", "peer@example.invalid"], {
        cwd: this.peerRoot,
      });
      execFileSync("git", ["config", "user.name", "Coding Kanban Peer"], {
        cwd: this.peerRoot,
      });
    }

    this.backendPort = await reservePort();
    this.frontendPort = await reservePort();
    await this.startBackend();
    await this.startFrontend();
  }

  async startBackend(): Promise<void> {
    const logFd = openSync(this.backendLogPath, "a");
    this.backend = spawn(
      resolve(REPOSITORY_ROOT, "apps/server/node_modules/.bin/tsx"),
      ["src/index.ts"],
      {
        cwd: resolve(REPOSITORY_ROOT, "apps/server"),
        detached: true,
        env: {
          ...this.tmuxEnv,
          APP_SOURCE_ROOT: this.sourceRoot,
          SERVER_BIND_HOST: "127.0.0.1",
          SERVER_PORT: String(this.backendPort),
          SESSION_STATE_PATH: this.sessionStatePath,
          GIT_AUTO_PULL_INTERVAL_MINUTES: String(
            this.gitAutoPullIntervalMinutes ?? 0,
          ),
        },
        stdio: ["ignore", logFd, logFd],
      },
    );
    closeSync(logFd);

    await waitForUrl(
      `${this.backendUrl}/api/health`,
      this.backend,
      this.backendLogPath,
    );
  }

  async restartBackendWithSourceChange(): Promise<void> {
    await stopProcess(this.backend);
    this.backend = null;
    this.changeSourceRevision("revision-2");
    await this.startBackend();
  }

  changeSourceRevision(revision: string): void {
    writeFileSync(join(this.sourceRoot, "revision.txt"), `${revision}\n`);
  }

  pushRemoteRevision(revision: string): string {
    writeFileSync(join(this.peerRoot, "revision.txt"), `${revision}\n`);
    execFileSync("git", ["add", "revision.txt"], { cwd: this.peerRoot });
    execFileSync("git", ["commit", "-qm", revision], {
      cwd: this.peerRoot,
    });
    execFileSync("git", ["push"], { cwd: this.peerRoot });
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: this.peerRoot,
      encoding: "utf8",
    }).trim();
  }

  restoreLocalSource(): void {
    execFileSync("git", ["restore", "--", "revision.txt"], {
      cwd: this.sourceRoot,
    });
  }

  sourceHead(): string {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: this.sourceRoot,
      encoding: "utf8",
    }).trim();
  }

  async startFrontend(): Promise<void> {
    const logFd = openSync(this.frontendLogPath, "a");
    this.frontend = spawn(
      resolve(REPOSITORY_ROOT, "apps/web/node_modules/.bin/vite"),
      ["--host", "127.0.0.1", "--port", String(this.frontendPort)],
      {
        cwd: resolve(REPOSITORY_ROOT, "apps/web"),
        detached: true,
        env: {
          ...process.env,
          VITE_API_BASE_URL: this.backendUrl,
          VITE_API_WS_URL: this.backendUrl.replace(/^http/, "ws"),
          VITE_DEV_HTTPS: "0",
          WEB_HOST: "127.0.0.1",
          WEB_PORT: String(this.frontendPort),
        },
        stdio: ["ignore", logFd, logFd],
      },
    );
    closeSync(logFd);

    await waitForUrl(this.frontendUrl, this.frontend, this.frontendLogPath);
  }

  runTmux(args: string[]): string {
    return execFileSync(TMUX_BINARY, args, {
      encoding: "utf8",
      env: this.tmuxEnv,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  }

  createTmuxSession(sessionName: string): void {
    this.runTmux([
      "new-session",
      "-d",
      "-s",
      sessionName,
      "-c",
      REPOSITORY_ROOT,
      "bash --noprofile --norc",
    ]);
  }

  createRawInputTmuxSession(sessionName: string, capturePath: string): void {
    this.runTmux([
      "new-session",
      "-d",
      "-s",
      sessionName,
      "-c",
      REPOSITORY_ROOT,
      [
        "node -e ",
        JSON.stringify(
          [
            "const fs = require('node:fs');",
            "process.stdin.setRawMode(true);",
            "process.stdin.resume();",
            "const chunks = [];",
            "process.stdin.on('data', (chunk) => {",
            "chunks.push(chunk);",
            `fs.writeFileSync(${JSON.stringify(capturePath)}, Buffer.concat(chunks).toString('hex'));`,
            "});",
          ].join(""),
        ),
      ].join(""),
    ]);
  }

  createSplitTmuxSession(sessionName: string): {
    leftPane: string;
    rightPane: string;
  } {
    this.createTmuxSession(sessionName);
    const leftPane = this.runTmux([
      "list-panes",
      "-t",
      sessionName,
      "-F",
      "#{pane_id}",
    ]);
    this.runTmux([
      "split-window",
      "-h",
      "-t",
      leftPane,
      "-c",
      REPOSITORY_ROOT,
      "bash --noprofile --norc",
    ]);
    const paneIds = this.runTmux([
      "list-panes",
      "-t",
      sessionName,
      "-F",
      "#{pane_id}",
    ])
      .split("\n")
      .filter(Boolean);
    const rightPane = paneIds.find((paneId) => paneId !== leftPane);
    if (!rightPane) {
      throw new Error("isolated tmux session did not create a right pane");
    }

    this.runTmux(["set-option", "-t", sessionName, "mouse", "on"]);
    this.runTmux(["select-pane", "-t", leftPane]);
    return { leftPane, rightPane };
  }

  activePane(sessionName: string): string {
    return (
      this.runTmux([
        "list-panes",
        "-t",
        sessionName,
        "-F",
        "#{?pane_active,#{pane_id},}",
      ])
        .split("\n")
        .find(Boolean) ?? ""
    );
  }

  paneContainsText(paneId: string, text: string): boolean {
    return this.runTmux(["capture-pane", "-pt", paneId]).includes(text);
  }

  paneCount(sessionName: string): number {
    return this.runTmux(["list-panes", "-t", sessionName, "-F", "#{pane_id}"])
      .split("\n")
      .filter(Boolean).length;
  }

  async dispose(): Promise<void> {
    await stopProcess(this.backend);
    await stopProcess(this.frontend);
    try {
      this.runTmux(["kill-server"]);
    } catch {
      // Isolated tmux server may already be gone.
    }
    rmSync(this.root, { recursive: true, force: true });
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers,
    },
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`);
  }
  return (await response.json()) as T;
}

async function addManagedSession(
  runtime: IsolatedKanbanRuntime,
  tmuxSession: string,
  displayName: string,
  tmuxPane?: string,
): Promise<AgentSessionSummary> {
  return requestJson<AgentSessionSummary>(
    `${runtime.backendUrl}/api/agent-discovery/tmux/add`,
    {
      method: "POST",
      body: JSON.stringify({
        tmuxSession,
        tmuxPane,
        displayName,
        workingDirectory: REPOSITORY_ROOT,
        agentKind: "shell",
        interactionState: "running",
      }),
    },
  );
}

async function installTerminalKeyboardProbe(
  page: Page,
  platform: "mac" | "windows",
): Promise<void> {
  await page.addInitScript((emulatedPlatform) => {
    const navigatorPlatform = emulatedPlatform === "mac" ? "MacIntel" : "Win32";
    const userAgent =
      emulatedPlatform === "mac"
        ? "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/136.0.0.0 Safari/537.36"
        : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/136.0.0.0 Safari/537.36";

    Object.defineProperty(window.navigator, "platform", {
      configurable: true,
      get: () => navigatorPlatform,
    });
    Object.defineProperty(window.navigator, "userAgent", {
      configurable: true,
      get: () => userAgent,
    });

    const sentFrames: string[] = [];
    (
      window as typeof window & { __terminalKeyboardFrames?: string[] }
    ).__terminalKeyboardFrames = sentFrames;

    const originalSend = window.WebSocket.prototype.send;
    window.WebSocket.prototype.send = function patchedSend(data: unknown) {
      if (typeof data === "string" && !data.includes('"type":"resize"')) {
        sentFrames.push(data);
      }

      return originalSend.call(this, data as Parameters<WebSocket["send"]>[0]);
    };
  }, platform);
}

async function openFocusedTerminal(
  page: Page,
  frontendUrl: string,
  displayName: string,
): Promise<void> {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(frontendUrl);
  const card = page.locator(".grid-card", {
    has: page.locator(".grid-card-name", { hasText: displayName }),
  });
  await expect(card).toBeVisible({ timeout: 20_000 });
  await card.dblclick();

  const screen = page.locator(".focus-main .terminal-view .xterm-screen");
  await expect(screen).toBeVisible({ timeout: 20_000 });
  await screen.click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.activeElement?.classList.contains("xterm-helper-textarea") ??
          false,
      ),
    )
    .toBeTruthy();
}

test("automatic Git polling reports conflicts and resumes the existing hot-update flow", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const runtime = new IsolatedKanbanRuntime(10);

  try {
    await runtime.start();
    const initialHead = runtime.sourceHead();
    const initialVersion = await requestJson<AppVersion>(
      `${runtime.backendUrl}/api/app-version`,
    );

    await page.goto(runtime.frontendUrl);
    await expect
      .poll(() =>
        page.evaluate(() =>
          localStorage.getItem("coding-kanban-accepted-revision-v1"),
        ),
      )
      .toBe(initialVersion.sourceRevision);

    runtime.changeSourceRevision("local draft");
    const remoteHead = runtime.pushRemoteRevision("remote update");
    const availableStatus = await requestJson<{
      phase: string;
      conflictReason: string | null;
      remoteHead: string | null;
    }>(`${runtime.backendUrl}/api/app-update/check`, {
      method: "POST",
      body: "{}",
    });

    expect(availableStatus).toMatchObject({
      phase: "available",
      conflictReason: null,
      remoteHead,
    });
    expect(runtime.sourceHead()).toBe(initialHead);
    expect(readFileSync(join(runtime.sourceRoot, "revision.txt"), "utf8")).toBe(
      "local draft\n",
    );

    const availableBanner = page.getByTestId("remote-update-banner");
    await expect(availableBanner).toBeVisible({ timeout: 20_000 });
    await expect(availableBanner).toContainText("确认后才会拉取");
    await expect(page.getByTestId("pull-app-update")).toHaveText("拉取并更新");
    await expect(page.getByTestId("apply-app-update")).toHaveCount(0);

    await page.getByTestId("pull-app-update").click();
    const conflictBanner = page.getByTestId("app-update-conflict-banner");
    await expect(conflictBanner).toBeVisible({ timeout: 20_000 });
    await expect(conflictBanner).toContainText("检测到新版本，但存在冲突");
    await expect(conflictBanner).toContainText("本地未提交修改会被覆盖");
    await expect(page.getByTestId("retry-app-update")).toBeVisible();
    await expect(page.getByTestId("apply-app-update")).toHaveCount(0);

    runtime.restoreLocalSource();
    await Promise.all([
      page.waitForEvent("framenavigated"),
      page.getByTestId("retry-app-update").click(),
    ]);

    await expect
      .poll(() => runtime.sourceHead(), { timeout: 20_000 })
      .toBe(remoteHead);
    const updatedVersion = await requestJson<AppVersion>(
      `${runtime.backendUrl}/api/app-version`,
    );
    await expect
      .poll(() =>
        page.evaluate(() =>
          localStorage.getItem("coding-kanban-accepted-revision-v1"),
        ),
      )
      .toBe(updatedVersion.sourceRevision);
    await expect(page.getByTestId("session-restore-banner")).toContainText(
      "历史会话已恢复",
    );
    await expect(page.getByTestId("app-update-banner")).toHaveCount(0);
    await expect(page.getByTestId("app-update-conflict-banner")).toHaveCount(0);
  } finally {
    await runtime.dispose();
  }
});

test("hot update restores stable managed sessions and the dual-pane workspace", async ({
  page,
}) => {
  test.setTimeout(150_000);
  const runtime = new IsolatedKanbanRuntime();
  const suffix = Date.now();
  const firstTmuxSession = `hot-update-a-${suffix}`;
  const secondTmuxSession = `hot-update-b-${suffix}`;
  const firstDisplayName = `Hot Update A ${suffix}`;
  const secondDisplayName = `Hot Update B ${suffix}`;

  try {
    await runtime.start();
    runtime.createTmuxSession(firstTmuxSession);
    runtime.createTmuxSession(secondTmuxSession);

    const firstSession = await addManagedSession(
      runtime,
      firstTmuxSession,
      firstDisplayName,
    );
    const secondSession = await addManagedSession(
      runtime,
      secondTmuxSession,
      secondDisplayName,
    );

    await expect
      .poll(() => {
        try {
          const persisted = JSON.parse(
            readFileSync(runtime.sessionStatePath, "utf8"),
          ) as { snapshot?: AgentSessionSnapshot };
          return persisted.snapshot?.items.map((session) => session.id).sort();
        } catch {
          return [];
        }
      })
      .toEqual([firstSession.id, secondSession.id].sort());

    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto(runtime.frontendUrl);

    const firstCard = page.locator(".grid-card", {
      has: page.locator(".grid-card-name", {
        hasText: firstSession.displayName,
      }),
    });
    await expect(firstCard).toBeVisible({ timeout: 20_000 });
    await firstCard.dblclick();

    await page.getByRole("button", { name: /屏幕布局/ }).click();
    await page.getByRole("menuitemradio", { name: /左右双屏/ }).click();

    const firstPane = page.locator(
      '[data-terminal-pane-slot="terminal-monitor-slot-1"]',
    );
    const secondPane = page.locator(
      '[data-terminal-pane-slot="terminal-monitor-slot-2"]',
    );
    await expect(firstPane).toHaveAttribute(
      "data-terminal-pane-session",
      firstSession.id,
    );
    await expect(secondPane).toHaveAttribute(
      "data-terminal-pane-session",
      secondSession.id,
    );
    await secondPane.getByRole("button", { name: "设为输入" }).click();
    await expect(secondPane).toHaveAttribute(
      "data-active-terminal-pane",
      "true",
    );

    await expect
      .poll(() =>
        page.evaluate(() => {
          const raw = localStorage.getItem("terminal-monitor-workspace-v1");
          return raw ? JSON.parse(raw) : null;
        }),
      )
      .toMatchObject({
        mode: "dual",
        activeSlotId: "terminal-monitor-slot-2",
        slots: [
          {
            id: "terminal-monitor-slot-1",
            sessionId: firstSession.id,
          },
          {
            id: "terminal-monitor-slot-2",
            sessionId: secondSession.id,
          },
        ],
      });

    const initialVersion = await requestJson<AppVersion>(
      `${runtime.backendUrl}/api/app-version`,
    );
    await expect
      .poll(() =>
        page.evaluate(() =>
          localStorage.getItem("coding-kanban-accepted-revision-v1"),
        ),
      )
      .toBe(initialVersion.sourceRevision);

    await runtime.restartBackendWithSourceChange();
    const updatedVersion = await requestJson<AppVersion>(
      `${runtime.backendUrl}/api/app-version`,
    );
    expect(updatedVersion.runtimeId).not.toBe(initialVersion.runtimeId);
    expect(updatedVersion.sourceRevision).not.toBe(
      initialVersion.sourceRevision,
    );

    await expect(page.getByTestId("app-update-banner")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByTestId("apply-app-update")).toHaveText("更新并恢复");
    await expect(page.locator(".focus-main")).toBeVisible();

    await page.getByTestId("dismiss-app-update").click();
    await expect(page.getByTestId("app-update-banner")).toBeHidden();
    await expect
      .poll(() =>
        page.evaluate(() =>
          localStorage.getItem("coding-kanban-dismissed-revision-v1"),
        ),
      )
      .toBe(updatedVersion.sourceRevision);

    await page.reload();
    await expect(page.locator(".focus-main")).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(3_500);
    await expect(page.getByTestId("app-update-banner")).toBeHidden();

    runtime.changeSourceRevision("revision-3");
    await expect
      .poll(
        async () =>
          (
            await requestJson<AppVersion>(
              `${runtime.backendUrl}/api/app-version`,
            )
          ).sourceRevision,
        { timeout: 20_000 },
      )
      .not.toBe(updatedVersion.sourceRevision);
    await expect(page.getByTestId("app-update-banner")).toBeVisible({
      timeout: 20_000,
    });
    await expect
      .poll(() =>
        page.evaluate(() =>
          localStorage.getItem("coding-kanban-dismissed-revision-v1"),
        ),
      )
      .toBe(updatedVersion.sourceRevision);

    await expect
      .poll(
        async () => {
          const snapshot = await requestJson<AgentSessionSnapshot>(
            `${runtime.backendUrl}/api/agent-sessions`,
          );
          return snapshot.items
            .filter((session) =>
              [firstSession.id, secondSession.id].includes(session.id),
            )
            .map((session) => ({
              id: session.id,
              connectionState: session.connectionState,
            }))
            .sort((left, right) => left.id.localeCompare(right.id));
        },
        { timeout: 20_000 },
      )
      .toEqual(
        [firstSession.id, secondSession.id]
          .sort()
          .map((id) => ({ id, connectionState: "online" })),
      );

    await Promise.all([
      page.waitForEvent("framenavigated"),
      page.getByTestId("apply-app-update").click(),
    ]);

    await expect(page.locator(".focus-main")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("dismiss-session-restore")).toBeVisible({
      timeout: 20_000,
    });
    await page.getByTestId("dismiss-session-restore").click();
    await expect(page.getByTestId("session-restore-banner")).toBeHidden();

    await page.evaluate(() => {
      localStorage.setItem("coding-kanban-restore-after-reload-v1", "1");
    });
    await page.reload();
    await expect(page.getByTestId("dismiss-session-restore")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByTestId("session-restore-banner")).toBeHidden({
      timeout: 6_000,
    });

    await expect(firstPane).toHaveAttribute(
      "data-terminal-pane-session",
      firstSession.id,
    );
    await expect(secondPane).toHaveAttribute(
      "data-terminal-pane-session",
      secondSession.id,
    );
    await expect(secondPane).toHaveAttribute(
      "data-active-terminal-pane",
      "true",
    );
    await expect(firstPane.locator(".xterm-screen")).toBeVisible();
    await expect(secondPane.locator(".xterm-screen")).toBeVisible();

    const firstMarker = `__HOT_RESTORE_A_${suffix}__`;
    const secondMarker = `__HOT_RESTORE_B_${suffix}__`;
    await requestJson(
      `${runtime.backendUrl}/api/agent-sessions/${firstSession.id}/stdin`,
      {
        method: "POST",
        body: JSON.stringify({
          input: `printf '${firstMarker}\\n'\r`,
        }),
      },
    );
    await requestJson(
      `${runtime.backendUrl}/api/agent-sessions/${secondSession.id}/stdin`,
      {
        method: "POST",
        body: JSON.stringify({
          input: `printf '${secondMarker}\\n'\r`,
        }),
      },
    );
    await expect(firstPane.locator(".xterm-rows")).toContainText(firstMarker, {
      timeout: 20_000,
    });
    await expect(secondPane.locator(".xterm-rows")).toContainText(
      secondMarker,
      {
        timeout: 20_000,
      },
    );

    await requestJson(
      `${runtime.backendUrl}/api/agent-sessions/${firstSession.id}/stdin`,
      {
        method: "POST",
        body: JSON.stringify({ input: "\x02" }),
      },
    );
    await requestJson(
      `${runtime.backendUrl}/api/agent-sessions/${firstSession.id}/stdin`,
      {
        method: "POST",
        body: JSON.stringify({ input: "%" }),
      },
    );
    await expect
      .poll(() => runtime.paneCount(firstTmuxSession), { timeout: 10_000 })
      .toBe(2);
  } finally {
    await runtime.dispose();
  }
});

test("browser input follows the pane selected inside one split tmux window", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const runtime = new IsolatedKanbanRuntime();
  const suffix = Date.now();
  const tmuxSession = `active-pane-input-${suffix}`;
  const displayName = `Active Pane Input ${suffix}`;
  const marker = `__RIGHT_PANE_INPUT_${suffix}__`;

  try {
    await runtime.start();
    const { leftPane, rightPane } = runtime.createSplitTmuxSession(tmuxSession);
    const managedSession = await addManagedSession(
      runtime,
      tmuxSession,
      displayName,
      leftPane,
    );

    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto(runtime.frontendUrl);
    const card = page.locator(".grid-card", {
      has: page.locator(".grid-card-name", {
        hasText: managedSession.displayName,
      }),
    });
    await expect(card).toBeVisible({ timeout: 20_000 });
    await card.dblclick();

    const terminal = page.locator(".focus-main .terminal-view");
    const screen = terminal.locator(".xterm-screen");
    await expect(screen).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const terminalElement = document.querySelector(
              ".focus-main .terminal-view",
            ) as
              | (HTMLDivElement & {
                  __xterm?: {
                    modes?: { mouseTrackingMode?: string };
                  };
                })
              | null;
            return terminalElement?.__xterm?.modes?.mouseTrackingMode ?? "none";
          }),
        { timeout: 20_000 },
      )
      .not.toBe("none");

    const screenBox = await screen.boundingBox();
    if (!screenBox) {
      throw new Error("split tmux terminal screen has no bounding box");
    }
    await screen.click({
      position: {
        x: Math.floor(screenBox.width * 0.75),
        y: Math.floor(screenBox.height * 0.4),
      },
    });
    await expect
      .poll(() => runtime.activePane(tmuxSession), { timeout: 10_000 })
      .toBe(rightPane);

    await page.keyboard.type(`printf '${marker}\\n'`);
    await page.keyboard.press("Enter");

    await expect
      .poll(() => runtime.paneContainsText(rightPane, marker), {
        timeout: 10_000,
      })
      .toBeTruthy();
    expect(runtime.paneContainsText(leftPane, marker)).toBeFalsy();
  } finally {
    await runtime.dispose();
  }
});

test("macOS Option+Space and Windows Alt+Space reach tmux as Meta+Space", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const runtime = new IsolatedKanbanRuntime();
  const suffix = Date.now();
  const platforms = [
    {
      platform: "mac" as const,
      tmuxSession: `meta-space-mac-${suffix}`,
      displayName: `Meta Space macOS ${suffix}`,
    },
    {
      platform: "windows" as const,
      tmuxSession: `meta-space-windows-${suffix}`,
      displayName: `Meta Space Windows ${suffix}`,
    },
  ];

  try {
    await runtime.start();

    for (const scenario of platforms) {
      const capturePath = join(
        runtime.root,
        `${scenario.platform}-meta-space.hex`,
      );
      runtime.createRawInputTmuxSession(scenario.tmuxSession, capturePath);
      const managedSession = await addManagedSession(
        runtime,
        scenario.tmuxSession,
        scenario.displayName,
      );

      const context = await browser.newContext();
      const page = await context.newPage();
      try {
        await installTerminalKeyboardProbe(page, scenario.platform);
        await openFocusedTerminal(
          page,
          runtime.frontendUrl,
          managedSession.displayName,
        );

        await expect
          .poll(() =>
            page.evaluate(() => {
              const terminal = document.querySelector(
                ".focus-main .terminal-view",
              ) as
                | (HTMLDivElement & {
                    __xterm?: { options?: { macOptionIsMeta?: boolean } };
                  })
                | null;
              return terminal?.__xterm?.options?.macOptionIsMeta;
            }),
          )
          .toBe(true);

        await page.keyboard.press("Alt+Space");
        await expect
          .poll(() =>
            page.evaluate(
              () =>
                (
                  window as typeof window & {
                    __terminalKeyboardFrames?: string[];
                  }
                ).__terminalKeyboardFrames ?? [],
            ),
          )
          .toContain("\x1b ");

        await expect
          .poll(() => {
            try {
              return readFileSync(capturePath, "utf8");
            } catch {
              return "";
            }
          })
          .toBe("1b20");
      } finally {
        await context.close();
      }
    }
  } finally {
    await runtime.dispose();
  }
});
