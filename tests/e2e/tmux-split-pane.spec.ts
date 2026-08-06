import { execFileSync } from "node:child_process";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { resolveTmuxBinary } from "./tmux-binary";

const TMUX = resolveTmuxBinary();
const backendBaseUrl = process.env.PLAYWRIGHT_BACKEND_URL ?? "";

function backendPath(p: string): string {
  return backendBaseUrl ? new URL(p, backendBaseUrl).toString() : p;
}

function runTmux(args: string[]): string {
  return execFileSync(TMUX, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function killSession(name: string) {
  try {
    execFileSync(TMUX, ["kill-session", "-t", name], { stdio: ["ignore"] });
  } catch {}
}

function paneCount(sessionName: string): number {
  const out = runTmux(["list-panes", "-t", sessionName, "-F", "#{pane_id}"]);
  return out.split("\n").filter(Boolean).length;
}

function readSessionOption(sessionName: string, optionName: string): string {
  try {
    return runTmux(["show-options", "-v", "-t", sessionName, optionName]);
  } catch {
    return "";
  }
}

async function waitForSessionInApi(
  request: APIRequestContext,
  sessionId: string,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const res = await request.get(backendPath("/api/agent-sessions"));
        if (!res.ok()) return false;
        const payload = await res.json();
        return (
          payload.items?.some(
            (item: { id: string }) => item.id === sessionId,
          ) ?? false
        );
      },
      { timeout: 15000 },
    )
    .toBeTruthy();
}

async function ensureGridMode(page: Page) {
  const exitBtn = page.getByRole("button", { name: "返回宫格" });
  if ((await exitBtn.count()) > 0 && (await exitBtn.first().isVisible())) {
    await exitBtn.first().click();
    await page.waitForTimeout(300);
  }
}

async function createTmuxAndAdd(
  request: APIRequestContext,
  sessionName: string,
  displayName: string,
): Promise<string> {
  runTmux([
    "new-session",
    "-d",
    "-s",
    sessionName,
    "-c",
    process.cwd(),
    "bash",
  ]);
  const addRes = await request.post(
    backendPath("/api/agent-discovery/tmux/add"),
    {
      data: {
        tmuxSession: sessionName,
        displayName,
        workingDirectory: process.cwd(),
        agentKind: "copilot",
        interactionState: "running",
        outputPreview: "",
      },
    },
  );
  expect(addRes.ok()).toBeTruthy();
  const added = await addRes.json();
  await waitForSessionInApi(request, added.id);
  return added.id;
}

async function sendCtrlB(request: APIRequestContext, sessionId: string) {
  await request.post(backendPath(`/api/agent-sessions/${sessionId}/stdin`), {
    data: { input: "\u0002" },
  });
}

async function sendKey(
  request: APIRequestContext,
  sessionId: string,
  key: string,
) {
  await request.post(backendPath(`/api/agent-sessions/${sessionId}/stdin`), {
    data: { input: key },
  });
}

test("tmux: Ctrl+B + : keeps command-prompt input on the attached client", async ({
  request,
}) => {
  const sessionName = `e2e-command-prompt-${Date.now()}`;
  const displayName = `命令提示符-${Date.now()}`;
  const optionName = "@kanban-command-prompt-ok";
  let sessionId: string | undefined;

  try {
    sessionId = await createTmuxAndAdd(request, sessionName, displayName);
    await new Promise((resolve) => setTimeout(resolve, 300));

    await sendCtrlB(request, sessionId);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await sendKey(request, sessionId, ":");
    await new Promise((resolve) => setTimeout(resolve, 100));
    await sendKey(request, sessionId, `set-option ${optionName} yes`);
    await sendKey(request, sessionId, "\r");

    await expect
      .poll(() => readSessionOption(sessionName, optionName), {
        timeout: 8_000,
        intervals: [200],
      })
      .toBe("yes");
  } finally {
    if (sessionId) {
      await request
        .delete(backendPath(`/api/agent-sessions/${sessionId}`))
        .catch(() => {});
    }
    killSession(sessionName);
  }
});

test("tmux: Ctrl+B + % 横向分屏 — 浏览器打开 focus 模式后 API 触发分屏，tmux pane 变为 2", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const sessionName = `e2e-split-h-${Date.now()}`;
  const displayName = `分屏H-${Date.now()}`;
  let sessionId: string | undefined;

  try {
    sessionId = await createTmuxAndAdd(request, sessionName, displayName);

    // 打开页面
    await page.goto("/");
    await ensureGridMode(page);

    // 找到卡片并进入 focus 模式
    const card = page.locator(".grid-card", {
      has: page.locator(".grid-card-name", { hasText: sessionName }),
    });
    await expect(card).toBeVisible({ timeout: 20000 });
    await card.dblclick();
    await expect(page.locator(".focus-main")).toBeVisible({ timeout: 5000 });

    // 等终端渲染
    const termTextarea = page.locator(".xterm-helper-textarea");
    await expect(termTextarea).toBeVisible({ timeout: 10000 });

    // 截图：分屏前
    await page.screenshot({ path: "test-results/tmux-before-split-h.png" });

    // 通过后端 API 发送 Ctrl+B + % (模拟用户在浏览器终端按下的效果)
    await sendCtrlB(request, sessionId);
    await new Promise((r) => setTimeout(r, 300));
    await sendKey(request, sessionId, "%");
    await new Promise((r) => setTimeout(r, 500));

    // 截图：分屏后
    await page.screenshot({ path: "test-results/tmux-after-split-h.png" });

    // 验证 tmux pane 数量
    await expect
      .poll(() => paneCount(sessionName), { timeout: 8000, intervals: [300] })
      .toBe(2);

    console.log(`✅ 横向分屏成功: pane ${paneCount(sessionName)}`);
  } finally {
    if (sessionId)
      await request
        .delete(backendPath(`/api/agent-sessions/${sessionId}`))
        .catch(() => {});
    killSession(sessionName);
  }
});

test('tmux: Ctrl+B + " 纵向分屏 — 浏览器打开 focus 模式后 API 触发分屏，tmux pane 变为 2', async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const sessionName = `e2e-split-v-${Date.now()}`;
  const displayName = `分屏V-${Date.now()}`;
  let sessionId: string | undefined;

  try {
    sessionId = await createTmuxAndAdd(request, sessionName, displayName);

    await page.goto("/");
    await ensureGridMode(page);

    const card = page.locator(".grid-card", {
      has: page.locator(".grid-card-name", { hasText: sessionName }),
    });
    await expect(card).toBeVisible({ timeout: 20000 });
    await card.dblclick();
    await expect(page.locator(".focus-main")).toBeVisible({ timeout: 5000 });

    const termTextarea = page.locator(".xterm-helper-textarea");
    await expect(termTextarea).toBeVisible({ timeout: 10000 });

    await page.screenshot({ path: "test-results/tmux-before-split-v.png" });

    // Ctrl+B + " 纵向分屏
    await sendCtrlB(request, sessionId);
    await new Promise((r) => setTimeout(r, 300));
    await sendKey(request, sessionId, '"');
    await new Promise((r) => setTimeout(r, 500));

    await page.screenshot({ path: "test-results/tmux-after-split-v.png" });

    await expect
      .poll(() => paneCount(sessionName), { timeout: 8000, intervals: [300] })
      .toBe(2);

    console.log(`✅ 纵向分屏成功: pane ${paneCount(sessionName)}`);
  } finally {
    if (sessionId)
      await request
        .delete(backendPath(`/api/agent-sessions/${sessionId}`))
        .catch(() => {});
    killSession(sessionName);
  }
});
