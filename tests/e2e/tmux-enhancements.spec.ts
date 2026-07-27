import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import { resolveTmuxBinary } from "./tmux-binary";

test.use({ ignoreHTTPSErrors: true });

const TMUX_BINARY = resolveTmuxBinary();
const COPILOT_SESSION_ROOT = path.join(
  os.homedir(),
  ".copilot",
  "session-state",
);
const backendBaseUrl = process.env.PLAYWRIGHT_BACKEND_URL ?? "";

function backendPath(pathname: string): string {
  if (!backendBaseUrl) {
    return pathname;
  }

  return new URL(pathname, backendBaseUrl).toString();
}

function runTmux(args: string[]): string {
  return execFileSync(TMUX_BINARY, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function killTmuxSession(sessionName: string): void {
  try {
    execFileSync(TMUX_BINARY, ["kill-session", "-t", sessionName], {
      stdio: "ignore",
    });
  } catch {
    // ignore cleanup failures
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function getTmuxClientSize(
  sessionName: string,
): { cols: number; rows: number } | null {
  const output = runTmux([
    "list-clients",
    "-t",
    sessionName,
    "-F",
    "#{client_width}x#{client_height}",
  ]);
  const firstLine = output.split("\n").find(Boolean);

  if (!firstLine) {
    return null;
  }

  const match = firstLine.match(/^(\d+)x(\d+)$/);
  if (!match) {
    return null;
  }

  return {
    cols: Number(match[1]),
    rows: Number(match[2]),
  };
}

function runSshCommand(
  host: {
    host: string;
    port: number;
    username?: string;
    identityFile?: string;
  },
  remoteCommand: string,
): string {
  const args = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=5"];

  if (host.port) {
    args.push("-p", String(host.port));
  }

  if (host.identityFile) {
    args.push("-i", host.identityFile);
  }

  const userHost = host.username ? `${host.username}@${host.host}` : host.host;
  args.push(userHost, remoteCommand);

  return execFileSync("ssh", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function killRemoteTmuxSession(
  host: {
    host: string;
    port: number;
    username?: string;
    identityFile?: string;
  },
  sessionName: string,
): void {
  try {
    runSshCommand(
      host,
      `tmux kill-session -t ${shellQuote(sessionName)} 2>/dev/null || true`,
    );
  } catch {
    // ignore cleanup failures
  }
}

function tmuxPaneContainsText(sessionName: string, text: string): boolean {
  try {
    return runTmux(["capture-pane", "-pt", sessionName]).includes(text);
  } catch {
    return false;
  }
}

async function waitForSessionInList(
  request: APIRequestContext,
  sessionId: string,
): Promise<void> {
  await expect
    .poll(async () => {
      const response = await request.get(backendPath("/api/agent-sessions"));
      const payload = (await response.json()) as {
        items?: Array<{ id?: string }>;
      };

      return payload.items?.some((item) => item.id === sessionId) ?? false;
    })
    .toBeTruthy();
}

async function ensureGridMode(page: Page): Promise<void> {
  const exitButton = page.getByRole("button", { name: "返回宫格" });
  if ((await exitButton.count()) === 0) {
    return;
  }

  if (await exitButton.first().isVisible()) {
    await exitButton.first().click();
  }
}

async function getSshHosts(request: APIRequestContext): Promise<
  Array<{
    name: string;
    host: string;
    port: number;
    username?: string;
    identityFile?: string;
    defaultPath: string;
  }>
> {
  const response = await request.get(backendPath("/api/ssh-hosts"));
  expect(response.ok()).toBeTruthy();

  const payload = await response.json();
  return payload.hosts;
}

function createCopilotSessionState(options: {
  sessionId: string;
  sessionName: string;
  workingDirectory: string;
  running: boolean;
}): string {
  const sessionDir = path.join(COPILOT_SESSION_ROOT, options.sessionId);
  fs.rmSync(sessionDir, { recursive: true, force: true });
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(
    path.join(sessionDir, "workspace.yaml"),
    [
      `id: ${options.sessionId}`,
      `cwd: ${options.workingDirectory}`,
      `name: ${options.sessionName}`,
      `updated_at: ${new Date().toISOString()}`,
    ].join("\n"),
  );

  if (options.running) {
    fs.writeFileSync(path.join(sessionDir, `inuse.${process.pid}.lock`), "");
  }

  return sessionDir;
}

function removeCopilotSessionState(sessionId: string): void {
  fs.rmSync(path.join(COPILOT_SESSION_ROOT, sessionId), {
    recursive: true,
    force: true,
  });
}

async function findSessionByDisplayName(
  request: APIRequestContext,
  displayName: string,
) {
  const response = await request.get(backendPath("/api/agent-sessions"));
  if (!response.ok()) {
    return undefined;
  }

  const payload = await response.json();
  return payload.items.find(
    (item: {
      id: string;
      displayName: string;
      interactionState: string;
      transportRef?: { tmuxSession?: string };
    }) => item.displayName === displayName,
  ) as
    | {
        id: string;
        displayName: string;
        interactionState: string;
        transportRef?: { tmuxSession?: string };
      }
    | undefined;
}

async function findSessionsByDisplayName(
  request: APIRequestContext,
  displayName: string,
) {
  const response = await request.get(backendPath("/api/agent-sessions"));
  if (!response.ok()) {
    return [];
  }

  const payload = await response.json();
  return payload.items.filter(
    (item: {
      id: string;
      displayName: string;
      interactionState: string;
      transportRef?: { tmuxSession?: string };
      agentSessionId?: string;
    }) => item.displayName === displayName,
  ) as Array<{
    id: string;
    displayName: string;
    interactionState: string;
    transportRef?: { tmuxSession?: string };
    agentSessionId?: string;
  }>;
}

async function deleteSessionIfPresent(
  request: APIRequestContext,
  displayName: string,
): Promise<void> {
  const session = await findSessionByDisplayName(request, displayName);
  if (session) {
    await request.delete(backendPath(`/api/agent-sessions/${session.id}`));
  }
}

async function getSessionOutputEntries(
  request: APIRequestContext,
  agentSessionId: string,
): Promise<string[]> {
  const response = await request.get(
    backendPath(`/api/agent-sessions/${agentSessionId}`),
  );
  expect(response.ok()).toBeTruthy();

  const payload = await response.json();
  return payload.outputEntries.map((entry: { text: string }) => entry.text);
}

async function getLastReportedTtySize(
  request: APIRequestContext,
  agentSessionId: string,
): Promise<{ rows: number; cols: number } | null> {
  const entries = await getSessionOutputEntries(request, agentSessionId);
  const text = entries.join("");
  const matches = [...text.matchAll(/tty-size:(\d+)x(\d+)/g)];
  const last = matches.at(-1);

  if (!last) {
    return null;
  }

  return {
    rows: Number(last[1]),
    cols: Number(last[2]),
  };
}

async function installWebSocketSpy(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const sentFrames: string[] = [];
    (
      window as typeof window & { __terminalMouseFrames?: string[] }
    ).__terminalMouseFrames = sentFrames;

    const originalSend = window.WebSocket.prototype.send;
    window.WebSocket.prototype.send = function patchedSend(data: unknown) {
      if (typeof data === "string" && !data.includes('"type":"resize"')) {
        sentFrames.push(data);
      }

      return originalSend.call(this, data as Parameters<WebSocket["send"]>[0]);
    };
  });
}

async function terminalSentFrames(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      (
        window as typeof window & {
          __terminalMouseFrames?: string[];
        }
      ).__terminalMouseFrames ?? [],
  );
}

test("browser: 普通对话终端可以用鼠标滚轮浏览历史", async ({
  page,
  request,
}) => {
  const displayName = `E2E Scroll ${Date.now()}`;
  let sessionId: string | undefined;

  try {
    await page.setViewportSize({ width: 1600, height: 1200 });

    const launchResponse = await request.post(
      backendPath("/api/agent-launch/pty"),
      {
        data: {
          workspaceId: "default",
          displayName,
          agentKind: "copilot",
          command: "node ./scripts/mock-terminal-agent.mjs scroll",
          workingDirectory: process.cwd(),
        },
      },
    );

    expect(launchResponse.ok()).toBeTruthy();
    sessionId = (await launchResponse.json()).id;

    await installWebSocketSpy(page);
    await page.goto("/");

    const card = page.locator(".grid-card", {
      has: page.locator(".grid-card-name", { hasText: displayName }),
    });
    await expect(card).toBeVisible({ timeout: 15000 });
    await card.dblclick();

    const viewport = page.locator(".focus-main .xterm-viewport");
    await expect(viewport).toBeVisible({ timeout: 15000 });
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const terminal = document.querySelector(
            ".focus-main .terminal-view",
          ) as
            | (HTMLDivElement & {
                __xterm?: {
                  buffer?: { active?: { viewportY?: number } };
                };
              })
            | null;

          return terminal?.__xterm?.buffer?.active?.viewportY ?? 0;
        }),
      )
      .toBeGreaterThan(0);

    const before = await page.evaluate(() => {
      const terminal = document.querySelector(".focus-main .terminal-view") as
        | (HTMLDivElement & {
            __xterm?: {
              buffer?: { active?: { viewportY?: number } };
            };
          })
        | null;

      return terminal?.__xterm?.buffer?.active?.viewportY ?? 0;
    });
    await page.locator(".focus-main .terminal-view").hover();
    await page.mouse.wheel(0, -1200);
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => {
      const terminal = document.querySelector(".focus-main .terminal-view") as
        | (HTMLDivElement & {
            __xterm?: {
              buffer?: { active?: { viewportY?: number } };
            };
          })
        | null;

      return terminal?.__xterm?.buffer?.active?.viewportY ?? 0;
    });

    expect(after).toBeLessThan(before);
  } finally {
    if (sessionId) {
      await request.delete(backendPath(`/api/agent-sessions/${sessionId}`));
    }
  }
});

test("browser: tmux attach 终端预灌 pane 历史后可用鼠标滚轮浏览旧上文", async ({
  page,
  request,
}) => {
  const sessionName = `e2e-tmux-history-${Date.now()}`;
  const displayName = `E2E Tmux History ${Date.now()}`;
  const marker = `E2E_TMUX_HISTORY_${Date.now()}`;
  let sessionId: string | undefined;

  killTmuxSession(sessionName);

  try {
    runTmux([
      "new-session",
      "-d",
      "-s",
      sessionName,
      "-c",
      process.cwd(),
      `sh -lc 'for i in $(seq 1 80); do printf "${marker}_%03d\\n" "$i"; done; sleep 30'`,
    ]);

    await expect
      .poll(() => tmuxPaneContainsText(sessionName, `${marker}_080`), {
        timeout: 10000,
      })
      .toBeTruthy();

    const launchResponse = await request.post(
      backendPath("/api/agent-launch/pty"),
      {
        data: {
          workspaceId: "default",
          displayName,
          agentKind: "shell",
          command: `tmux attach -t ${shellQuote(sessionName)}`,
          workingDirectory: process.cwd(),
          tmuxSessionName: sessionName,
        },
      },
    );

    expect(launchResponse.ok()).toBeTruthy();
    sessionId = (await launchResponse.json()).id;

    await page.setViewportSize({ width: 1600, height: 1200 });
    await page.goto("/");

    const card = page.locator(".grid-card", {
      has: page.locator(".grid-card-name", { hasText: displayName }),
    });
    await expect(card).toBeVisible({ timeout: 15000 });
    await card.dblclick();

    const terminal = page.locator(".focus-main .terminal-view");
    await expect(terminal).toBeVisible({ timeout: 15000 });

    const bufferState = async () =>
      page.evaluate(() => {
        const terminalElement = document.querySelector(
          ".focus-main .terminal-view",
        ) as
          | (HTMLDivElement & {
              __xterm?: {
                buffer?: {
                  active?: {
                    baseY?: number;
                    length?: number;
                    viewportY?: number;
                    getLine?: (index: number) =>
                      | {
                          translateToString?: (trimRight?: boolean) => string;
                        }
                      | undefined;
                  };
                };
              };
            })
          | null;
        const active = terminalElement?.__xterm?.buffer?.active;
        const lines: string[] = [];

        for (let index = 0; index < (active?.length ?? 0); index += 1) {
          lines.push(active?.getLine?.(index)?.translateToString?.(true) ?? "");
        }

        return {
          baseY: active?.baseY ?? 0,
          text: lines.join("\n"),
          viewportY: active?.viewportY ?? 0,
        };
      });

    await expect
      .poll(async () => {
        const state = await bufferState();
        return state.text.includes(`${marker}_001`);
      })
      .toBeTruthy();

    await expect
      .poll(async () => {
        const state = await bufferState();
        return state.text.includes(`${marker}_080`);
      })
      .toBeTruthy();

    const before = await bufferState();
    expect(before.baseY).toBeGreaterThan(0);

    await terminal.hover();
    await page.mouse.wheel(0, -1200);

    await expect
      .poll(async () => {
        const state = await bufferState();
        return state.viewportY;
      })
      .toBeLessThan(before.viewportY);
  } finally {
    if (sessionId) {
      await request.delete(backendPath(`/api/agent-sessions/${sessionId}`));
    }
    killTmuxSession(sessionName);
  }
});

test("browser: 运行中终端滚轮浏览历史时不会被实时输出拉回底部", async ({
  page,
  request,
}) => {
  const displayName = `E2E Live Scroll ${Date.now()}`;
  let sessionId: string | undefined;

  try {
    await page.setViewportSize({ width: 1600, height: 1200 });

    const launchResponse = await request.post(
      backendPath("/api/agent-launch/pty"),
      {
        data: {
          workspaceId: "default",
          displayName,
          agentKind: "copilot",
          command: "node ./scripts/mock-terminal-agent.mjs scroll-live",
          workingDirectory: process.cwd(),
        },
      },
    );

    expect(launchResponse.ok()).toBeTruthy();
    sessionId = (await launchResponse.json()).id;

    await page.goto("/");

    const card = page.locator(".grid-card", {
      has: page.locator(".grid-card-name", { hasText: displayName }),
    });
    await expect(card).toBeVisible({ timeout: 15000 });
    await card.dblclick();

    const terminal = page.locator(".focus-main .terminal-view");
    await expect(terminal.locator(".xterm-viewport")).toBeVisible({
      timeout: 15000,
    });

    const viewportState = async () =>
      page.evaluate(() => {
        const terminal = document.querySelector(
          ".focus-main .terminal-view",
        ) as
          | (HTMLDivElement & {
              __xterm?: {
                buffer?: {
                  active?: {
                    baseY?: number;
                    viewportY?: number;
                  };
                };
              };
            })
          | null;
        const active = terminal?.__xterm?.buffer?.active;

        return {
          baseY: active?.baseY ?? 0,
          viewportY: active?.viewportY ?? 0,
        };
      });

    await expect
      .poll(async () => {
        const state = await viewportState();
        return state.baseY;
      })
      .toBeGreaterThan(0);

    const before = await viewportState();
    await terminal.hover();
    await page.mouse.wheel(0, -1200);

    await expect
      .poll(async () => {
        const state = await viewportState();
        return state.viewportY;
      })
      .toBeLessThan(before.viewportY);

    const afterWheel = await viewportState();
    await page.waitForTimeout(1000);
    const afterLiveOutput = await viewportState();

    expect(afterLiveOutput.baseY).toBeGreaterThan(afterWheel.baseY);
    expect(afterLiveOutput.viewportY).toBeLessThan(afterLiveOutput.baseY);
    expect(afterLiveOutput.viewportY).toBeLessThanOrEqual(
      afterWheel.viewportY + 1,
    );
  } finally {
    if (sessionId) {
      await request.delete(backendPath(`/api/agent-sessions/${sessionId}`));
    }
  }
});

test("browser: 运行中终端滚轮浏览历史超过旧锁定时间也不会被拉回底部", async ({
  page,
  request,
}) => {
  const displayName = `E2E Long Live Scroll ${Date.now()}`;
  let sessionId: string | undefined;

  try {
    await page.setViewportSize({ width: 1600, height: 1200 });

    const launchResponse = await request.post(
      backendPath("/api/agent-launch/pty"),
      {
        data: {
          workspaceId: "default",
          displayName,
          agentKind: "copilot",
          command: "node ./scripts/mock-terminal-agent.mjs scroll-live",
          workingDirectory: process.cwd(),
        },
      },
    );

    expect(launchResponse.ok()).toBeTruthy();
    sessionId = (await launchResponse.json()).id;

    await page.goto("/");

    const card = page.locator(".grid-card", {
      has: page.locator(".grid-card-name", { hasText: displayName }),
    });
    await expect(card).toBeVisible({ timeout: 15000 });
    await card.dblclick();

    const terminal = page.locator(".focus-main .terminal-view");
    await expect(terminal.locator(".xterm-viewport")).toBeVisible({
      timeout: 15000,
    });

    const viewportState = async () =>
      page.evaluate(() => {
        const terminal = document.querySelector(
          ".focus-main .terminal-view",
        ) as
          | (HTMLDivElement & {
              __xterm?: {
                buffer?: {
                  active?: {
                    baseY?: number;
                    viewportY?: number;
                  };
                };
              };
            })
          | null;
        const active = terminal?.__xterm?.buffer?.active;

        return {
          baseY: active?.baseY ?? 0,
          viewportY: active?.viewportY ?? 0,
        };
      });

    await expect
      .poll(async () => {
        const state = await viewportState();
        return state.baseY;
      })
      .toBeGreaterThan(0);

    const before = await viewportState();
    await terminal.hover();
    await page.mouse.wheel(0, -1200);

    await expect
      .poll(async () => {
        const state = await viewportState();
        return state.viewportY;
      })
      .toBeLessThan(before.viewportY);

    const afterWheel = await viewportState();
    await page.waitForTimeout(11_000);
    const afterLongLiveOutput = await viewportState();

    expect(afterLongLiveOutput.baseY).toBeGreaterThan(afterWheel.baseY);
    expect(afterLongLiveOutput.viewportY).toBeLessThan(
      afterLongLiveOutput.baseY,
    );
    expect(afterLongLiveOutput.viewportY).toBeLessThanOrEqual(
      afterWheel.viewportY + 1,
    );
  } finally {
    if (sessionId) {
      await request.delete(backendPath(`/api/agent-sessions/${sessionId}`));
    }
  }
});

test("browser: 终端区域内的 document-level wheel 也会滚动对应终端上下文", async ({
  page,
  request,
}) => {
  const displayName = `E2E Document Wheel ${Date.now()}`;
  let sessionId: string | undefined;

  try {
    await page.setViewportSize({ width: 1600, height: 1200 });

    const launchResponse = await request.post(
      backendPath("/api/agent-launch/pty"),
      {
        data: {
          workspaceId: "default",
          displayName,
          agentKind: "copilot",
          command: "node ./scripts/mock-terminal-agent.mjs scroll",
          workingDirectory: process.cwd(),
        },
      },
    );

    expect(launchResponse.ok()).toBeTruthy();
    sessionId = (await launchResponse.json()).id;

    await page.goto("/");

    const card = page.locator(".grid-card", {
      has: page.locator(".grid-card-name", { hasText: displayName }),
    });
    await expect(card).toBeVisible({ timeout: 15000 });
    await card.dblclick();

    const terminal = page.locator(".focus-main .terminal-view");
    await expect(terminal.locator(".xterm-viewport")).toBeVisible({
      timeout: 15000,
    });

    const viewportY = async () =>
      page.evaluate(() => {
        const terminal = document.querySelector(
          ".focus-main .terminal-view",
        ) as
          | (HTMLDivElement & {
              __xterm?: {
                buffer?: { active?: { viewportY?: number } };
              };
            })
          | null;

        return terminal?.__xterm?.buffer?.active?.viewportY ?? 0;
      });

    await expect.poll(viewportY).toBeGreaterThan(0);

    const before = await viewportY();
    await page.evaluate(() => {
      const terminal = document.querySelector(
        ".focus-main .terminal-view",
      ) as HTMLElement | null;
      if (!terminal) {
        throw new Error("terminal not found");
      }

      const rect = terminal.getBoundingClientRect();
      document.body.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
          deltaY: -1200,
        }),
      );
    });

    await expect.poll(viewportY).toBeLessThan(before);
  } finally {
    if (sessionId) {
      await request.delete(backendPath(`/api/agent-sessions/${sessionId}`));
    }
  }
});

test("browser: tmux 扫描弹层上的滚轮只滚动扫描结果，不穿透滚动后方单屏终端", async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);

  const displayName = `E2E Wheel Overlay ${Date.now()}`;
  const tmuxPrefix = `e2e-wheel-overlay-${Date.now()}`;
  const tmuxSessionNames = Array.from(
    { length: 24 },
    (_, index) => `${tmuxPrefix}-${String(index + 1).padStart(2, "0")}`,
  );
  let sessionId: string | undefined;

  for (const sessionName of tmuxSessionNames) {
    killTmuxSession(sessionName);
  }

  try {
    await page.setViewportSize({ width: 1400, height: 720 });

    const launchResponse = await request.post(
      backendPath("/api/agent-launch/pty"),
      {
        data: {
          workspaceId: "default",
          displayName,
          agentKind: "copilot",
          command: "node ./scripts/mock-terminal-agent.mjs scroll",
          workingDirectory: process.cwd(),
        },
      },
    );

    expect(launchResponse.ok()).toBeTruthy();
    sessionId = (await launchResponse.json()).id;

    for (const sessionName of tmuxSessionNames) {
      runTmux([
        "new-session",
        "-d",
        "-s",
        sessionName,
        "-c",
        process.cwd(),
        "sleep 60",
      ]);
    }

    await page.goto("/");

    const card = page.locator(".grid-card", {
      has: page.locator(".grid-card-name", { hasText: displayName }),
    });
    await expect(card).toBeVisible({ timeout: 15000 });
    await card.dblclick();

    const terminal = page.locator(".focus-main .terminal-view");
    await expect(terminal).toBeVisible({ timeout: 15000 });

    const terminalViewport = async () =>
      page.evaluate(() => {
        const terminalElement = document.querySelector(
          ".focus-main .terminal-view",
        ) as
          | (HTMLDivElement & {
              __xterm?: {
                buffer?: { active?: { baseY?: number; viewportY?: number } };
              };
            })
          | null;
        const active = terminalElement?.__xterm?.buffer?.active;

        return {
          baseY: active?.baseY ?? 0,
          viewportY: active?.viewportY ?? 0,
        };
      });

    await expect
      .poll(async () => (await terminalViewport()).baseY)
      .toBeGreaterThan(0);

    await terminal.hover();
    await page.mouse.wheel(0, -1200);

    await expect
      .poll(async () => {
        const state = await terminalViewport();
        return state.viewportY < state.baseY;
      })
      .toBeTruthy();

    const terminalBeforeOverlayWheel = await terminalViewport();

    await page.getByTestId("scan-menu-toggle").click();
    await page.getByTestId("btn-扫描 tmux").click();
    await page.locator(".host-dropdown-item", { hasText: "本机" }).click();

    const dialog = page.locator(".discovery-dialog");
    await expect(dialog).toBeVisible({ timeout: 15000 });
    await expect(dialog.locator(".discovery-item").first()).toBeVisible({
      timeout: 15000,
    });

    const list = dialog.locator(".discovery-list");
    await expect
      .poll(
        async () =>
          list.evaluate(
            (element) => element.scrollHeight > element.clientHeight,
          ),
        { timeout: 15000 },
      )
      .toBeTruthy();

    await list.hover();
    await page.mouse.wheel(0, 1200);

    await expect
      .poll(async () => list.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);

    const terminalAfterOverlayWheel = await terminalViewport();
    expect(terminalAfterOverlayWheel.viewportY).toBe(
      terminalBeforeOverlayWheel.viewportY,
    );
  } finally {
    if (sessionId) {
      await request.delete(backendPath(`/api/agent-sessions/${sessionId}`));
    }
    for (const sessionName of tmuxSessionNames) {
      killTmuxSession(sessionName);
    }
  }
});

test("browser: 多屏非输入终端也可以用鼠标滚轮浏览自己的历史", async ({
  page,
  request,
}) => {
  const firstDisplayName = `E2E Scroll Pane A ${Date.now()}`;
  const secondDisplayName = `E2E Scroll Pane B ${Date.now()}`;
  let firstSessionId: string | undefined;
  let secondSessionId: string | undefined;

  try {
    await page.setViewportSize({ width: 1600, height: 1200 });

    for (const displayName of [firstDisplayName, secondDisplayName]) {
      const launchResponse = await request.post(
        backendPath("/api/agent-launch/pty"),
        {
          data: {
            workspaceId: "default",
            displayName,
            agentKind: "copilot",
            command: "node ./scripts/mock-terminal-agent.mjs scroll",
            workingDirectory: process.cwd(),
          },
        },
      );

      expect(launchResponse.ok()).toBeTruthy();
      const id = (await launchResponse.json()).id as string;
      if (!firstSessionId) {
        firstSessionId = id;
      } else {
        secondSessionId = id;
      }
    }

    await page.goto("/");

    const card = page.locator(".grid-card", {
      has: page.locator(".grid-card-name", { hasText: firstDisplayName }),
    });
    await expect(card).toBeVisible({ timeout: 15000 });
    await card.dblclick();

    await page.getByRole("button", { name: /屏幕布局/ }).click();
    await page.getByRole("menuitemradio", { name: /左右双屏/ }).click();

    const secondPane = page.locator(
      '[data-terminal-pane-slot="terminal-monitor-slot-2"]',
    );
    await expect(secondPane).toHaveAttribute(
      "data-terminal-pane-session",
      secondSessionId!,
    );
    await expect(secondPane.locator(".xterm-viewport")).toBeVisible({
      timeout: 15000,
    });

    const secondPaneViewportY = async () =>
      page.evaluate(() => {
        const terminal = document.querySelector(
          '[data-terminal-pane-slot="terminal-monitor-slot-2"] .terminal-view',
        ) as
          | (HTMLDivElement & {
              __xterm?: {
                buffer?: { active?: { viewportY?: number } };
              };
            })
          | null;

        return terminal?.__xterm?.buffer?.active?.viewportY ?? 0;
      });

    await expect.poll(secondPaneViewportY).toBeGreaterThan(0);

    const before = await secondPaneViewportY();
    await secondPane.locator(".terminal-view").hover();
    await page.mouse.wheel(0, -1200);
    await expect.poll(secondPaneViewportY).toBeLessThan(before);
  } finally {
    if (firstSessionId) {
      await request.delete(
        backendPath(`/api/agent-sessions/${firstSessionId}`),
      );
    }
    if (secondSessionId) {
      await request.delete(
        backendPath(`/api/agent-sessions/${secondSessionId}`),
      );
    }
  }
});

test("browser: 调整窗口大小会把新的终端尺寸同步到 PTY", async ({
  page,
  request,
}) => {
  const displayName = `E2E Initial Resize ${Date.now()}`;
  let sessionId: string | undefined;

  try {
    await page.setViewportSize({ width: 1280, height: 820 });

    const launchResponse = await request.post(
      backendPath("/api/agent-launch/pty"),
      {
        data: {
          workspaceId: "default",
          displayName,
          agentKind: "copilot",
          command: "node ./scripts/mock-terminal-agent.mjs size",
          workingDirectory: process.cwd(),
        },
      },
    );

    expect(launchResponse.ok()).toBeTruthy();
    sessionId = (await launchResponse.json()).id;

    await page.goto("/");

    const card = page.locator(".grid-card", {
      has: page.locator(".grid-card-name", { hasText: displayName }),
    });
    await expect(card).toBeVisible({ timeout: 15000 });
    await card.dblclick();
    await page.waitForTimeout(1200);

    await expect
      .poll(() => getLastReportedTtySize(request, sessionId!), {
        timeout: 15000,
      })
      .not.toBeNull();

    const initialSize = await getLastReportedTtySize(request, sessionId!);
    expect(initialSize).not.toBeNull();

    await page.setViewportSize({ width: 1600, height: 1200 });

    await expect
      .poll(
        async () => {
          const size = await getLastReportedTtySize(request, sessionId!);
          if (!size || !initialSize) {
            return null;
          }

          return size.cols > initialSize.cols || size.rows > initialSize.rows
            ? size
            : null;
        },
        {
          timeout: 15000,
        },
      )
      .not.toBeNull();

    const resizedSize = await getLastReportedTtySize(request, sessionId!);

    expect(initialSize).not.toBeNull();
    expect(resizedSize).not.toBeNull();
    expect(resizedSize!.rows).toBeGreaterThanOrEqual(initialSize!.rows);
    expect(resizedSize!.cols).toBeGreaterThan(initialSize!.cols);
  } finally {
    if (sessionId) {
      await request.delete(backendPath(`/api/agent-sessions/${sessionId}`));
    }
  }
});

test("browser: tmux 缩略图不会把真实终端缩回小尺寸", async ({
  page,
  request,
}) => {
  const sessionName = `e2e-thumbnail-${Date.now()}`;
  const displayName = `E2E Thumbnail Tmux ${Date.now()}`;

  let launchedSessionId: string | undefined;

  killTmuxSession(sessionName);

  try {
    runTmux([
      "new-session",
      "-d",
      "-s",
      sessionName,
      "-c",
      process.cwd(),
      "bash",
    ]);

    const launchResponse = await request.post(
      backendPath("/api/agent-launch/pty"),
      {
        data: {
          workspaceId: "default",
          displayName,
          agentKind: "copilot",
          command: `tmux attach -t '${sessionName}'`,
          workingDirectory: process.cwd(),
          tmuxSessionName: sessionName,
        },
      },
    );

    expect(launchResponse.ok()).toBeTruthy();
    launchedSessionId = (await launchResponse.json()).id;

    await page.setViewportSize({ width: 1600, height: 1200 });
    await page.goto("/");

    const card = page.locator(".grid-card", {
      has: page.locator(".grid-card-name", { hasText: displayName }),
    });
    await expect(card).toBeVisible({ timeout: 15000 });

    await card.dblclick();

    await expect
      .poll(() => getTmuxClientSize(sessionName), {
        timeout: 15000,
      })
      .not.toBeNull();

    await page.waitForTimeout(1200);

    const focusedSize = getTmuxClientSize(sessionName);
    expect(focusedSize).not.toBeNull();

    await page.getByRole("button", { name: "返回宫格" }).click();
    await expect(card).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(1200);

    const gridSize = getTmuxClientSize(sessionName);
    expect(gridSize).not.toBeNull();
    expect(gridSize).toEqual(focusedSize);
  } finally {
    if (launchedSessionId) {
      await request.delete(
        backendPath(`/api/agent-sessions/${launchedSessionId}`),
      );
    }
    killTmuxSession(sessionName);
  }
});

test("browser: tmux 终端会转发鼠标二进制事件", async ({ page, request }) => {
  const sessionName = `e2e-mouse-${Date.now()}`;
  const displayName = `E2E Mouse Tmux ${Date.now()}`;

  let launchedSessionId: string | undefined;

  killTmuxSession(sessionName);

  try {
    runTmux([
      "new-session",
      "-d",
      "-s",
      sessionName,
      "-c",
      process.cwd(),
      "node ./scripts/mock-terminal-agent.mjs mouse",
    ]);

    const launchResponse = await request.post(
      backendPath("/api/agent-launch/pty"),
      {
        data: {
          workspaceId: "default",
          displayName,
          agentKind: "copilot",
          command: `tmux attach -t '${sessionName}'`,
          workingDirectory: process.cwd(),
          tmuxSessionName: sessionName,
        },
      },
    );

    expect(launchResponse.ok()).toBeTruthy();
    launchedSessionId = (await launchResponse.json()).id;

    await installWebSocketSpy(page);
    await page.goto("/");

    const card = page.locator(".grid-card", {
      has: page.locator(".grid-card-name", { hasText: displayName }),
    });
    await expect(card).toBeVisible({ timeout: 15000 });
    await expect(card.locator(".grid-card-tag")).toHaveText("tmux");

    await card.dblclick();
    const terminal = page.locator(".focus-main .terminal-view");
    const screen = page.locator(".focus-main .terminal-view .xterm-screen");
    await expect(terminal).toBeVisible({ timeout: 15000 });
    await expect(screen).toBeVisible({ timeout: 15000 });
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const terminal = document.querySelector(
            ".focus-main .terminal-view",
          ) as
            | (HTMLDivElement & {
                __xterm?: {
                  modes?: {
                    mouseTrackingMode?: string;
                  };
                  options?: {
                    disableStdin?: boolean;
                  };
                };
              })
            | null;

          return {
            mouseTrackingMode:
              terminal?.__xterm?.modes?.mouseTrackingMode ?? "none",
            disableStdin: terminal?.__xterm?.options?.disableStdin ?? null,
          };
        }),
      )
      .toMatchObject({
        disableStdin: false,
      });
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const terminal = document.querySelector(
            ".focus-main .terminal-view",
          ) as
            | (HTMLDivElement & {
                __xterm?: {
                  modes?: {
                    mouseTrackingMode?: string;
                  };
                };
              })
            | null;

          return terminal?.__xterm?.modes?.mouseTrackingMode ?? "none";
        }),
      )
      .not.toBe("none");

    await screen.click({ position: { x: 80, y: 40 } });
    const beforeWheel = (await terminalSentFrames(page)).length;
    await page.mouse.wheel(0, -300);

    await expect
      .poll(async () => {
        const wheelFrames = (await terminalSentFrames(page)).slice(beforeWheel);
        return wheelFrames.some((frame) => {
          let payload = frame;
          try {
            const parsed = JSON.parse(frame) as {
              type?: string;
              data?: string;
            };
            if (parsed.type === "binary" && parsed.data) {
              payload = Buffer.from(parsed.data, "base64").toString("latin1");
            }
          } catch {
            // Raw terminal mouse reports are expected to be non-JSON.
          }

          return (
            /\u001b\[<(?:64|65);\d+;\d+M/.test(payload) ||
            /\u001b\[M[\x60\x61][\s\S]{2}/.test(payload)
          );
        });
      })
      .toBeTruthy();
  } finally {
    if (launchedSessionId) {
      await request.delete(
        backendPath(`/api/agent-sessions/${launchedSessionId}`),
      );
    }
    killTmuxSession(sessionName);
  }
});

test("browser: tmux mouse clicks are handled by tmux instead of leaking escape bytes into the pane", async ({
  page,
  request,
}) => {
  const sessionName = `e2e-tmux-mouse-routing-${Date.now()}`;
  const displayName = `E2E Tmux Mouse Routing ${Date.now()}`;

  let launchedSessionId: string | undefined;

  killTmuxSession(sessionName);

  try {
    runTmux([
      "new-session",
      "-d",
      "-s",
      sessionName,
      "-c",
      process.cwd(),
      "node ./scripts/mock-terminal-agent.mjs raw",
    ]);
    runTmux(["set-option", "-t", sessionName, "mouse", "on"]);

    const launchResponse = await request.post(
      backendPath("/api/agent-launch/pty"),
      {
        data: {
          workspaceId: "default",
          displayName,
          agentKind: "copilot",
          command: `tmux attach -t '${sessionName}'`,
          workingDirectory: process.cwd(),
          tmuxSessionName: sessionName,
        },
      },
    );

    expect(launchResponse.ok()).toBeTruthy();
    launchedSessionId = (await launchResponse.json()).id;
    await waitForSessionInList(request, launchedSessionId!);

    await page.goto("/");
    await ensureGridMode(page);

    const card = page.locator(".grid-card", {
      has: page.locator(".grid-card-name", { hasText: displayName }),
    });
    await expect(card).toBeVisible({ timeout: 15000 });

    await card.dblclick();

    const terminal = page.locator(".focus-main .terminal-view");
    const screen = page.locator(".focus-main .terminal-view .xterm-screen");
    await expect(terminal).toBeVisible({ timeout: 15000 });
    await expect(screen).toBeVisible({ timeout: 15000 });
    await expect
      .poll(() => tmuxPaneContainsText(sessionName, "raw-ready"))
      .toBeTruthy();
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const terminal = document.querySelector(
            ".focus-main .terminal-view",
          ) as
            | (HTMLDivElement & {
                __xterm?: {
                  modes?: {
                    mouseTrackingMode?: string;
                  };
                };
              })
            | null;

          return terminal?.__xterm?.modes?.mouseTrackingMode ?? "none";
        }),
      )
      .not.toBe("none");

    await screen.click({ position: { x: 90, y: 50 } });
    await page.waitForTimeout(300);

    expect(tmuxPaneContainsText(sessionName, "raw-bytes:")).toBeFalsy();
  } finally {
    if (launchedSessionId) {
      await request.delete(
        backendPath(`/api/agent-sessions/${launchedSessionId}`),
      );
    }
    killTmuxSession(sessionName);
  }
});

test("browser: 切回浏览器窗口后会恢复 tmux 输入焦点", async ({
  page,
  request,
}) => {
  const sessionName = `e2e-mouse-window-refocus-${Date.now()}`;
  const displayName = `E2E Mouse Window Refocus ${Date.now()}`;

  let launchedSessionId: string | undefined;

  killTmuxSession(sessionName);

  try {
    runTmux([
      "new-session",
      "-d",
      "-s",
      sessionName,
      "-c",
      process.cwd(),
      "node ./scripts/mock-terminal-agent.mjs mouse",
    ]);

    const launchResponse = await request.post(
      backendPath("/api/agent-launch/pty"),
      {
        data: {
          workspaceId: "default",
          displayName,
          agentKind: "copilot",
          command: `tmux attach -t '${sessionName}'`,
          workingDirectory: process.cwd(),
          tmuxSessionName: sessionName,
        },
      },
    );

    expect(launchResponse.ok()).toBeTruthy();
    launchedSessionId = (await launchResponse.json()).id;
    await waitForSessionInList(request, launchedSessionId!);

    await installWebSocketSpy(page);
    await page.goto("/");
    await ensureGridMode(page);

    const card = page.locator(".grid-card", {
      has: page.locator(".grid-card-name", { hasText: displayName }),
    });
    await expect(card).toBeVisible({ timeout: 15000 });

    await card.dblclick();

    const terminal = page.locator(".focus-main .terminal-view");
    const screen = page.locator(".focus-main .terminal-view .xterm-screen");
    await expect(terminal).toBeVisible({ timeout: 15000 });
    await expect(screen).toBeVisible({ timeout: 15000 });
    await expect
      .poll(() => tmuxPaneContainsText(sessionName, "mouse-ready"))
      .toBeTruthy();
    await page.waitForTimeout(150);

    await screen.click({ position: { x: 90, y: 50 } });

    await expect
      .poll(async () =>
        page.evaluate(
          () =>
            document.activeElement?.classList.contains(
              "xterm-helper-textarea",
            ) ?? false,
        ),
      )
      .toBeTruthy();

    const backgroundPage = await page.context().newPage();
    await backgroundPage.goto("about:blank");
    await backgroundPage.bringToFront();
    await page.bringToFront();
    await backgroundPage.close();

    await expect
      .poll(async () =>
        page.evaluate(
          () =>
            document.activeElement?.classList.contains(
              "xterm-helper-textarea",
            ) ?? false,
        ),
      )
      .toBeTruthy();
  } finally {
    if (launchedSessionId) {
      await request.delete(
        backendPath(`/api/agent-sessions/${launchedSessionId}`),
      );
    }
    killTmuxSession(sessionName);
  }
});

test("browser: 切换窗口后会把 focus in/out 事件发回 tmux 应用", async ({
  page,
  request,
}) => {
  const sessionName = `e2e-focus-events-${Date.now()}`;
  const displayName = `E2E Focus Events ${Date.now()}`;

  let launchedSessionId: string | undefined;

  killTmuxSession(sessionName);

  try {
    runTmux([
      "new-session",
      "-d",
      "-s",
      sessionName,
      "-c",
      process.cwd(),
      "node ./scripts/mock-terminal-agent.mjs focus",
    ]);

    const launchResponse = await request.post(
      backendPath("/api/agent-launch/pty"),
      {
        data: {
          workspaceId: "default",
          displayName,
          agentKind: "copilot",
          command: `tmux attach -t '${sessionName}'`,
          workingDirectory: process.cwd(),
          tmuxSessionName: sessionName,
        },
      },
    );

    expect(launchResponse.ok()).toBeTruthy();
    launchedSessionId = (await launchResponse.json()).id;
    await waitForSessionInList(request, launchedSessionId!);

    await page.goto("/");
    await ensureGridMode(page);

    const card = page.locator(".grid-card", {
      has: page.locator(".grid-card-name", { hasText: displayName }),
    });
    await expect(card).toBeVisible({ timeout: 15000 });

    await card.dblclick();

    const terminal = page.locator(".focus-main .terminal-view");
    const screen = page.locator(".focus-main .terminal-view .xterm-screen");
    const backButton = page.getByRole("button", { name: "返回宫格" });
    await expect(terminal).toBeVisible({ timeout: 15000 });
    await expect(screen).toBeVisible({ timeout: 15000 });
    await expect(backButton).toBeVisible({ timeout: 15000 });
    await expect
      .poll(() => tmuxPaneContainsText(sessionName, "focus-ready"))
      .toBeTruthy();
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const terminal = document.querySelector(
            ".focus-main .terminal-view",
          ) as
            | (HTMLDivElement & {
                __xterm?: {
                  modes?: {
                    sendFocusMode?: boolean;
                  };
                  options?: {
                    disableStdin?: boolean;
                  };
                };
              })
            | null;

          return {
            sendFocusMode: terminal?.__xterm?.modes?.sendFocusMode ?? false,
            disableStdin: terminal?.__xterm?.options?.disableStdin ?? null,
          };
        }),
      )
      .toMatchObject({
        sendFocusMode: true,
        disableStdin: false,
      });
    await expect
      .poll(async () =>
        page.evaluate(
          () =>
            document.activeElement?.classList.contains(
              "xterm-helper-textarea",
            ) ?? false,
        ),
      )
      .toBeTruthy();

    await backButton.focus();

    await expect
      .poll(async () =>
        page.evaluate(
          () =>
            document.activeElement?.classList.contains(
              "xterm-helper-textarea",
            ) ?? false,
        ),
      )
      .toBeFalsy();

    await expect
      .poll(() => tmuxPaneContainsText(sessionName, "focus-out"), {
        timeout: 5000,
      })
      .toBeTruthy();

    await screen.click({ position: { x: 90, y: 50 } });

    await expect
      .poll(() => tmuxPaneContainsText(sessionName, "focus-in"), {
        timeout: 5000,
      })
      .toBeTruthy();
  } finally {
    if (launchedSessionId) {
      await request.delete(
        backendPath(`/api/agent-sessions/${launchedSessionId}`),
      );
    }
    killTmuxSession(sessionName);
  }
});

test("browser: 终端 helper textarea 失焦后仍能继续把文本输入发回 tmux 会话", async ({
  page,
  request,
}) => {
  const sessionName = `e2e-terminal-refocus-input-${Date.now()}`;
  const displayName = `E2E Terminal Refocus Input ${Date.now()}`;
  const firstMarker = `before-blur-${Date.now()}`;
  const secondMarker = `after-blur-${Date.now()}`;

  let launchedSessionId: string | undefined;

  killTmuxSession(sessionName);

  try {
    runTmux([
      "new-session",
      "-d",
      "-s",
      sessionName,
      "-c",
      process.cwd(),
      "node ./scripts/mock-terminal-agent.mjs scroll",
    ]);

    const launchResponse = await request.post(
      backendPath("/api/agent-launch/pty"),
      {
        data: {
          workspaceId: "default",
          displayName,
          agentKind: "copilot",
          command: `tmux attach -t '${sessionName}'`,
          workingDirectory: process.cwd(),
          tmuxSessionName: sessionName,
        },
      },
    );

    expect(launchResponse.ok()).toBeTruthy();
    launchedSessionId = (await launchResponse.json()).id;
    await waitForSessionInList(request, launchedSessionId!);

    await installWebSocketSpy(page);
    await page.goto("/");
    await ensureGridMode(page);

    const card = page.locator(".grid-card", {
      has: page.locator(".grid-card-name", { hasText: displayName }),
    });
    await expect(card).toBeVisible({ timeout: 15000 });

    await card.dblclick();

    const terminal = page.locator(".focus-main .terminal-view");
    const screen = page.locator(".focus-main .terminal-view .xterm-screen");
    await expect(terminal).toBeVisible({ timeout: 15000 });
    await expect(screen).toBeVisible({ timeout: 15000 });
    await expect
      .poll(() => tmuxPaneContainsText(sessionName, "scroll-ready"))
      .toBeTruthy();
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const terminal = document.querySelector(
            ".focus-main .terminal-view",
          ) as
            | (HTMLDivElement & {
                __xterm?: {
                  options?: {
                    disableStdin?: boolean;
                  };
                };
              })
            | null;

          return terminal?.__xterm?.options?.disableStdin ?? null;
        }),
      )
      .toBe(false);

    await screen.click({ position: { x: 90, y: 50 } });
    await expect
      .poll(async () =>
        page.evaluate(
          () =>
            document.activeElement?.classList.contains(
              "xterm-helper-textarea",
            ) ?? false,
        ),
      )
      .toBeTruthy();

    await page.keyboard.type(firstMarker);
    await page.keyboard.press("Enter");
    await expect
      .poll(async () => (await terminalSentFrames(page)).join(""))
      .toContain(firstMarker);

    await expect
      .poll(() => tmuxPaneContainsText(sessionName, `stdin:${firstMarker}`), {
        timeout: 10000,
      })
      .toBeTruthy();

    await page.evaluate(() => {
      const active = document.activeElement as HTMLElement | null;
      active?.blur();
    });

    await expect
      .poll(async () =>
        page.evaluate(
          () =>
            document.activeElement?.classList.contains(
              "xterm-helper-textarea",
            ) ?? false,
        ),
      )
      .toBeTruthy();

    await page.keyboard.type(secondMarker);
    await page.keyboard.press("Enter");
    await expect
      .poll(async () => (await terminalSentFrames(page)).join(""))
      .toContain(secondMarker);

    await expect
      .poll(() => tmuxPaneContainsText(sessionName, `stdin:${secondMarker}`), {
        timeout: 10000,
      })
      .toBeTruthy();
  } finally {
    if (launchedSessionId) {
      await request.delete(
        backendPath(`/api/agent-sessions/${launchedSessionId}`),
      );
    }
    killTmuxSession(sessionName);
  }
});

test("browser: 点击 focus view 标题让终端失焦后，普通字符输入仍会精确回到终端", async ({
  page,
  request,
}) => {
  const sessionName = `e2e-terminal-header-refocus-${Date.now()}`;
  const displayName = `E2E Terminal Header Refocus ${Date.now()}`;
  const marker = `header-refocus-${Date.now()}`;

  let launchedSessionId: string | undefined;

  killTmuxSession(sessionName);

  try {
    runTmux([
      "new-session",
      "-d",
      "-s",
      sessionName,
      "-c",
      process.cwd(),
      "node ./scripts/mock-terminal-agent.mjs scroll",
    ]);

    const launchResponse = await request.post(
      backendPath("/api/agent-launch/pty"),
      {
        data: {
          workspaceId: "default",
          displayName,
          agentKind: "copilot",
          command: `tmux attach -t '${sessionName}'`,
          workingDirectory: process.cwd(),
          tmuxSessionName: sessionName,
        },
      },
    );

    expect(launchResponse.ok()).toBeTruthy();
    launchedSessionId = (await launchResponse.json()).id;
    await waitForSessionInList(request, launchedSessionId!);

    await installWebSocketSpy(page);
    await page.goto("/");
    await ensureGridMode(page);

    const card = page.locator(".grid-card", {
      has: page.locator(".grid-card-name", { hasText: displayName }),
    });
    await expect(card).toBeVisible({ timeout: 15000 });

    await card.dblclick();

    const terminal = page.locator(".focus-main .terminal-view");
    const title = page.locator(".focus-main-name");
    await expect(terminal).toBeVisible({ timeout: 15000 });
    await expect(title).toBeVisible({ timeout: 15000 });
    await expect
      .poll(() => tmuxPaneContainsText(sessionName, "scroll-ready"))
      .toBeTruthy();

    await title.click();
    await expect
      .poll(async () =>
        page.evaluate(
          () =>
            document.activeElement?.classList.contains(
              "xterm-helper-textarea",
            ) ?? false,
        ),
      )
      .toBeTruthy();

    await page.keyboard.type(marker);
    await page.keyboard.press("Enter");
    await expect
      .poll(async () => (await terminalSentFrames(page)).join(""))
      .toContain(marker);

    await expect
      .poll(() => tmuxPaneContainsText(sessionName, `stdin:${marker}`), {
        timeout: 10000,
      })
      .toBeTruthy();
    await expect
      .poll(async () =>
        page.evaluate(
          () =>
            document.activeElement?.classList.contains(
              "xterm-helper-textarea",
            ) ?? false,
        ),
      )
      .toBeTruthy();
  } finally {
    if (launchedSessionId) {
      await request.delete(
        backendPath(`/api/agent-sessions/${launchedSessionId}`),
      );
    }
    killTmuxSession(sessionName);
  }
});

test("browser: Ctrl/Meta+E 可以快速连接远端 tmux 并自动聚焦", async ({
  page,
  request,
}) => {
  const sshHosts = await getSshHosts(request);
  const hm24 = sshHosts.find((host) => host.name === "hm24");

  test.skip(!hm24, "requires hm24 ssh preset");

  const sessionName = `quick-e2e-${Date.now()}`;
  const workingDirectory = "~/";
  let launchedSessionId: string | undefined;

  killRemoteTmuxSession(hm24!, sessionName);

  try {
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: /快速连接 tmux/ }),
    ).toHaveCount(0);

    await page.evaluate(() => {
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "e",
          metaKey: true,
          ctrlKey: true,
          bubbles: true,
        }),
      );
    });

    await expect(page.getByTestId("quick-tmux-connect-dialog")).toBeVisible();

    const hostSearch = page.getByTestId("quick-tmux-host-search");
    await hostSearch.fill("hm24");
    await page.keyboard.press("Enter");

    await expect(page.getByTestId("quick-tmux-session-name")).toBeVisible();
    await page.getByTestId("quick-tmux-session-name").fill(sessionName);
    await page
      .getByTestId("quick-tmux-working-directory")
      .fill(workingDirectory);
    await page.getByRole("button", { name: "打开 tmux" }).click();

    await expect(page.locator(".focus-main-name")).toHaveText(sessionName, {
      timeout: 15000,
    });

    await expect
      .poll(async () => findSessionByDisplayName(request, sessionName), {
        timeout: 15000,
      })
      .toMatchObject({
        displayName: sessionName,
        transportRef: {
          tmuxSession: sessionName,
        },
      });

    launchedSessionId = (await findSessionByDisplayName(request, sessionName))
      ?.id;

    await page.getByRole("button", { name: "返回宫格" }).click();

    const card = page.locator(".grid-card", {
      has: page.locator(".grid-card-name", { hasText: sessionName }),
    });
    await expect(card).toBeVisible({ timeout: 15000 });
    await expect(card.locator(".grid-card-tag")).toHaveText("tmux");
  } finally {
    if (launchedSessionId) {
      await request.delete(
        backendPath(`/api/agent-sessions/${launchedSessionId}`),
      );
    }

    if (hm24) {
      killRemoteTmuxSession(hm24, sessionName);
    }
  }
});

test("browser: 扫描结果会合并 tmux 运行态并支持 tmux 恢复", async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);

  const runningSessionId = `e2e-running-${Date.now()}`;
  const runningSessionName = `e2e-running-tmux-${Date.now()}`;
  const stoppedSessionId = `e2e-stopped-${Date.now()}`;
  const stoppedSessionName = `e2e-stopped-tmux-${Date.now()}`;
  const scanDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), `tmux-scan-e2e-${Date.now()}-`),
  );

  killTmuxSession(runningSessionName);
  killTmuxSession(stoppedSessionName);

  createCopilotSessionState({
    sessionId: runningSessionId,
    sessionName: runningSessionName,
    workingDirectory: scanDirectory,
    running: true,
  });
  createCopilotSessionState({
    sessionId: stoppedSessionId,
    sessionName: stoppedSessionName,
    workingDirectory: scanDirectory,
    running: false,
  });

  let attachedRunningId: string | undefined;
  let resumedStoppedId: string | undefined;

  try {
    runTmux([
      "new-session",
      "-d",
      "-s",
      runningSessionName,
      "-c",
      scanDirectory,
      "sleep 120",
    ]);

    await page.goto("/");

    await page.getByTestId("scan-menu-toggle").click();
    await page.getByTestId("btn-扫描会话").click();
    await page.locator(".host-dropdown-item", { hasText: "本机" }).click();

    await expect(page.locator(".discovery-dialog-title")).toContainText(
      "发现会话",
    );

    const dialog = page.locator(".discovery-dialog");
    await dialog.locator(".discovery-path-input").fill(scanDirectory);
    await dialog.locator(".discovery-scan-btn").click();

    await expect(page.locator(".discovery-list")).toBeVisible({
      timeout: 15000,
    });

    const scanStyles = await page
      .locator(".discovery-list")
      .evaluate((element) => {
        const styles = window.getComputedStyle(element);
        return {
          overflowY: styles.overflowY,
        };
      });

    expect(scanStyles.overflowY).toBe("auto");

    const runningItem = dialog
      .locator(".discovery-item")
      .filter({ hasText: runningSessionName });
    await expect(runningItem).toContainText("copilot");
    await expect(runningItem).toContainText("tmux");
    await runningItem.getByRole("button", { name: "从 tmux 加入宫格" }).click();

    await expect
      .poll(async () => findSessionByDisplayName(request, runningSessionName), {
        timeout: 15000,
      })
      .toMatchObject({
        displayName: runningSessionName,
        transportRef: {
          tmuxSession: runningSessionName,
        },
      });

    attachedRunningId = (
      await findSessionByDisplayName(request, runningSessionName)
    )?.id;

    const runningCard = page.locator(".grid-card", {
      has: page.locator(".grid-card-name", { hasText: runningSessionName }),
    });
    await expect(runningCard).toBeVisible({ timeout: 15000 });
    await expect(runningCard.locator(".grid-card-tag")).toHaveText("tmux");

    const stoppedItem = dialog
      .locator(".discovery-item")
      .filter({ hasText: stoppedSessionName });
    await expect(stoppedItem).toContainText("已停止", { timeout: 15000 });
    await expect(stoppedItem.locator(".discovery-add-btn")).toBeVisible({
      timeout: 15000,
    });
    await stoppedItem.locator(".discovery-add-btn").click();

    await expect
      .poll(async () => findSessionByDisplayName(request, stoppedSessionName), {
        timeout: 15000,
      })
      .toMatchObject({
        displayName: stoppedSessionName,
      });

    resumedStoppedId = (
      await findSessionByDisplayName(request, stoppedSessionName)
    )?.id;
  } finally {
    if (attachedRunningId) {
      await request.delete(
        backendPath(`/api/agent-sessions/${attachedRunningId}`),
      );
    }
    if (resumedStoppedId) {
      await request.delete(
        backendPath(`/api/agent-sessions/${resumedStoppedId}`),
      );
    }

    await deleteSessionIfPresent(request, runningSessionName);
    await deleteSessionIfPresent(request, stoppedSessionName);
    removeCopilotSessionState(runningSessionId);
    removeCopilotSessionState(stoppedSessionId);
    killTmuxSession(runningSessionName);
    killTmuxSession(stoppedSessionName);
    fs.rmSync(scanDirectory, { recursive: true, force: true });
  }
});

test("browser: 扫描应用中的 tmux 结果同时支持直接加入和从 tmux 加入", async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);

  const runningSessionId = `e2e-app-running-${Date.now()}`;
  const runningSessionName = `e2e-app-running-tmux-${Date.now()}`;
  const scanDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), `app-scan-e2e-${Date.now()}-`),
  );

  killTmuxSession(runningSessionName);

  createCopilotSessionState({
    sessionId: runningSessionId,
    sessionName: runningSessionName,
    workingDirectory: scanDirectory,
    running: true,
  });

  let directSessionId: string | undefined;
  let tmuxSessionId: string | undefined;

  try {
    runTmux([
      "new-session",
      "-d",
      "-s",
      runningSessionName,
      "-c",
      scanDirectory,
      "sleep 120",
    ]);

    await page.goto("/");

    await page.getByTestId("scan-menu-toggle").click();
    await page.getByTestId("btn-扫描会话").click();
    await page.locator(".host-dropdown-item", { hasText: "本机" }).click();

    const dialog = page.locator(".discovery-dialog");
    await expect(page.locator(".discovery-dialog-title")).toContainText(
      "发现会话",
    );

    await dialog.locator(".discovery-path-input").fill(scanDirectory);
    await dialog.locator(".discovery-scan-btn").click();

    const runningItem = dialog
      .locator(".discovery-item")
      .filter({ hasText: runningSessionName });

    await expect(runningItem).toContainText("copilot");
    await expect(runningItem).toContainText("tmux");
    await expect(
      runningItem.getByRole("button", { name: "加入宫格", exact: true }),
    ).toBeVisible({ timeout: 15000 });
    await expect(
      runningItem.getByRole("button", { name: "从 tmux 加入宫格" }),
    ).toBeVisible({ timeout: 15000 });

    await runningItem
      .getByRole("button", { name: "加入宫格", exact: true })
      .click();

    await expect
      .poll(
        async () =>
          (await findSessionsByDisplayName(request, runningSessionName)).some(
            (session) => !session.transportRef?.tmuxSession,
          ),
        {
          timeout: 15000,
        },
      )
      .toBe(true);

    directSessionId = (
      await findSessionsByDisplayName(request, runningSessionName)
    ).find((session) => !session.transportRef?.tmuxSession)?.id;

    expect(directSessionId).toBeTruthy();

    await runningItem.getByRole("button", { name: "从 tmux 加入宫格" }).click();

    await expect
      .poll(
        async () =>
          (await findSessionsByDisplayName(request, runningSessionName)).some(
            (session) =>
              session.transportRef?.tmuxSession === runningSessionName,
          ),
        {
          timeout: 15000,
        },
      )
      .toBe(true);

    tmuxSessionId = (
      await findSessionsByDisplayName(request, runningSessionName)
    ).find(
      (session) => session.transportRef?.tmuxSession === runningSessionName,
    )?.id;

    expect(tmuxSessionId).toBeTruthy();
  } finally {
    if (directSessionId) {
      await request.delete(
        backendPath(`/api/agent-sessions/${directSessionId}`),
      );
    }
    if (tmuxSessionId) {
      await request.delete(backendPath(`/api/agent-sessions/${tmuxSessionId}`));
    }

    await deleteSessionIfPresent(request, runningSessionName);
    removeCopilotSessionState(runningSessionId);
    killTmuxSession(runningSessionName);
    fs.rmSync(scanDirectory, { recursive: true, force: true });
  }
});
