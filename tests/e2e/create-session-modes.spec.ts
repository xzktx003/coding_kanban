import { execFileSync } from "node:child_process";

import { expect, test, type APIRequestContext } from "@playwright/test";

import { resolveTmuxBinary } from "./tmux-binary";

const TMUX_BINARY = resolveTmuxBinary();

function killTmuxSession(sessionName: string): void {
  try {
    execFileSync(TMUX_BINARY, ["kill-session", "-t", sessionName], {
      stdio: "ignore",
    });
  } catch {
    // ignore missing sessions during cleanup
  }
}

function tmuxSessionExists(sessionName: string): boolean {
  try {
    execFileSync(TMUX_BINARY, ["has-session", "-t", sessionName], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

async function findSessionByDisplayName(
  request: APIRequestContext,
  displayName: string,
) {
  const response = await request.get("/api/agent-sessions");
  expect(response.ok()).toBeTruthy();

  const payload = await response.json();
  return payload.items.find(
    (item: {
      id: string;
      displayName: string;
      transportRef?: { tmuxSession?: string };
    }) => item.displayName === displayName,
  ) as
    | {
        id: string;
        displayName: string;
        transportRef?: { tmuxSession?: string };
      }
    | undefined;
}

async function getSessionOutputText(
  request: APIRequestContext,
  sessionId: string,
) {
  const response = await request.get(`/api/agent-sessions/${sessionId}`);
  expect(response.ok()).toBeTruthy();

  const payload = await response.json();
  return (payload.outputEntries as Array<{ text: string }>)
    .map((entry) => entry.text)
    .join("\n");
}

async function openNewSessionForHost(
  page: import("@playwright/test").Page,
  hostLabel: string,
) {
  await page.getByTestId("new-session-toggle").click();
  await expect(page.getByTestId("new-session-dialog")).toHaveCount(0);
  await expect(page.getByTestId("host-dropdown-menu")).toBeVisible();
  await page.locator(".host-dropdown-item", { hasText: hostLabel }).click();
  await expect(page.getByTestId("new-session-dialog")).toBeVisible();
}

test("browser: 默认本机 copilot 直接创建不会带出 npm 环境污染警告", async ({
  page,
  request,
}) => {
  const directName = `E2E Default Local ${Date.now()}`;
  let sessionId: string | undefined;

  try {
    await page.goto("/");

    await openNewSessionForHost(page, "本机");
    await page.getByTestId("new-session-name").fill(directName);
    await page.getByTestId("new-session-kind-copilot").click();
    await page.getByTestId("new-session-mode-direct").click();
    await page.getByTestId("new-session-dir").fill("");
    await page.getByTestId("create-session").click();

    await expect(page.getByTestId("new-session-dialog")).toHaveCount(0);

    const directCard = page.locator(".grid-card", {
      has: page.locator(".grid-card-name", { hasText: directName }),
    });

    await expect(directCard).toBeVisible({ timeout: 15000 });
    await expect(directCard).not.toContainText("已退出", { timeout: 15000 });

    await expect
      .poll(async () => findSessionByDisplayName(request, directName), {
        timeout: 15000,
      })
      .toMatchObject({
        displayName: directName,
        connectionState: "online",
      });

    const directSession = await findSessionByDisplayName(request, directName);
    sessionId = directSession?.id;
    expect(directSession?.interactionState).not.toBe("exited");
    expect(directSession?.workingDirectory).not.toBe("~/");
    expect(sessionId).toBeTruthy();

    await expect
      .poll(async () => getSessionOutputText(request, sessionId!), {
        timeout: 15000,
      })
      .not.toContain("Unknown env config");
  } finally {
    if (sessionId) {
      await request.delete(`/api/agent-sessions/${sessionId}`);
    }
  }
});

test("browser: direct and tmux creation both work from the new session form", async ({
  page,
  request,
}) => {
  const directName = `E2E Direct ${Date.now()}`;
  const tmuxName = `E2E Tmux ${Date.now()}`;
  const workingDirectory = process.cwd();
  let directSessionId: string | undefined;
  let tmuxSessionId: string | undefined;

  killTmuxSession(tmuxName);

  try {
    await page.goto("/");

    await openNewSessionForHost(page, "本机");

    await page.getByTestId("new-session-name").fill(directName);
    await page.getByTestId("new-session-kind-copilot").click();
    await page.getByTestId("new-session-mode-direct").click();
    await page.getByTestId("new-session-dir").fill(workingDirectory);
    await page.getByTestId("create-session").click();

    await expect(page.getByTestId("new-session-dialog")).toHaveCount(0);

    const directCard = page.locator(".grid-card", {
      has: page.locator(".grid-card-name", { hasText: directName }),
    });

    await expect(directCard).toBeVisible({ timeout: 15000 });

    await expect
      .poll(async () => findSessionByDisplayName(request, directName), {
        timeout: 15000,
      })
      .toMatchObject({
        displayName: directName,
      });

    const directSession = await findSessionByDisplayName(request, directName);
    directSessionId = directSession?.id;
    expect(directSession?.transportRef?.tmuxSession).toBeFalsy();

    await openNewSessionForHost(page, "本机");
    await page.getByTestId("new-session-name").fill(tmuxName);
    await page.getByTestId("new-session-kind-copilot").click();
    await page.getByTestId("new-session-mode-tmux").click();
    await page.getByTestId("new-session-dir").fill("");

    await expect(page.getByTestId("new-session-tmux-note")).toContainText(
      "更新或重启看板后，可重新连接仍在运行的 tmux 会话",
    );

    await page.getByTestId("create-session").click();
    await expect(page.getByTestId("new-session-dialog")).toHaveCount(0);

    const tmuxCard = page.locator(".grid-card", {
      has: page.locator(".grid-card-name", { hasText: tmuxName }),
    });

    await expect(tmuxCard).toBeVisible({ timeout: 15000 });

    await expect
      .poll(async () => findSessionByDisplayName(request, tmuxName), {
        timeout: 15000,
      })
      .toMatchObject({
        displayName: tmuxName,
        transportRef: {
          tmuxSession: tmuxName,
        },
      });

    const tmuxSession = await findSessionByDisplayName(request, tmuxName);
    tmuxSessionId = tmuxSession?.id;

    await expect
      .poll(() => tmuxSessionExists(tmuxName), {
        timeout: 15000,
      })
      .toBeTruthy();
  } finally {
    if (directSessionId) {
      await request.delete(`/api/agent-sessions/${directSessionId}`);
    }

    if (tmuxSessionId) {
      await request.delete(`/api/agent-sessions/${tmuxSessionId}`);
    }

    killTmuxSession(tmuxName);
  }
});
