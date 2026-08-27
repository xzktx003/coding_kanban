import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import {
  existsSync,
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

import { selectTerminalPaneSession } from "./terminal-session-switcher";

declare const process: {
  cwd(): string;
  env: Record<string, string | undefined>;
};

const ONE_BY_ONE_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9pX6lzUAAAAASUVORK5CYII=";

function setupFixture() {
  const rootDir = mkdtempSync(
    path.join(process.cwd(), "tests/e2e/file-browser-runtime-"),
  );

  mkdirSync(path.join(rootDir, "nested"), { recursive: true });
  writeFileSync(path.join(rootDir, "note.txt"), "hello file browser");
  writeFileSync(path.join(rootDir, "nested", "inside.txt"), "inside folder");
  writeFileSync(path.join(rootDir, ".secret.txt"), "hidden file");
  writeFileSync(path.join(rootDir, "rename-me.txt"), "rename me");
  writeFileSync(path.join(rootDir, "delete-me.txt"), "delete me");
  writeFileSync(
    path.join(rootDir, "photo.png"),
    Buffer.from(ONE_BY_ONE_PNG, "base64"),
  );

  const uploadFilePath = path.join(tmpdir(), `upload-${Date.now()}.txt`);
  writeFileSync(uploadFilePath, "uploaded from playwright");

  return {
    rootDir,
    uploadFilePath,
    folderName: path.basename(rootDir),
  };
}

interface RemoteFixture {
  rootDir: string;
  uploadFilePath: string;
  hostName: string;
  sshdDir: string;
  port: number;
  sshdProcess: ChildProcess;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function startRemoteSshFixture(): RemoteFixture {
  const rootDir = mkdtempSync(path.join(tmpdir(), "file-browser-remote-"));
  mkdirSync(path.join(rootDir, "nested"), { recursive: true });
  writeFileSync(path.join(rootDir, "note.txt"), "hello remote file browser");
  writeFileSync(path.join(rootDir, "nested", "inside.txt"), "inside remote");
  writeFileSync(path.join(rootDir, ".secret.txt"), "remote hidden file");
  writeFileSync(path.join(rootDir, "rename-me.txt"), "remote rename me");
  writeFileSync(path.join(rootDir, "delete-me.txt"), "remote delete me");
  writeFileSync(
    path.join(rootDir, "photo.png"),
    Buffer.from(ONE_BY_ONE_PNG, "base64"),
  );

  const uploadFilePath = path.join(tmpdir(), `remote-upload-${Date.now()}.txt`);
  writeFileSync(uploadFilePath, "uploaded to remote ssh fixture");

  const sshdDir = mkdtempSync(path.join(tmpdir(), "file-browser-sshd-"));
  const clientKeyPath = path.join(sshdDir, "client_key");
  const hostKeyPath = path.join(sshdDir, "host_key");
  const authorizedKeysPath = path.join(sshdDir, "authorized_keys");
  const sshdConfigPath = path.join(sshdDir, "sshd_config");
  const sshdLogPath = path.join(sshdDir, "sshd.log");
  const port = 22330 + Math.floor(Math.random() * 1000);

  execFileSync("ssh-keygen", ["-t", "ed25519", "-N", "", "-f", clientKeyPath], {
    stdio: "ignore",
  });
  execFileSync("ssh-keygen", ["-t", "ed25519", "-N", "", "-f", hostKeyPath], {
    stdio: "ignore",
  });
  copyFileSync(`${clientKeyPath}.pub`, authorizedKeysPath);

  writeFileSync(
    sshdConfigPath,
    [
      `Port ${port}`,
      "ListenAddress 127.0.0.1",
      `HostKey ${hostKeyPath}`,
      `PidFile ${path.join(sshdDir, "sshd.pid")}`,
      `AuthorizedKeysFile ${authorizedKeysPath}`,
      "PasswordAuthentication no",
      "KbdInteractiveAuthentication no",
      "ChallengeResponseAuthentication no",
      "UsePAM no",
      "PermitRootLogin no",
      `AllowUsers ${process.env.USER ?? "xuzk"}`,
      "StrictModes no",
      "PubkeyAuthentication yes",
      "Subsystem sftp internal-sftp",
      "LogLevel VERBOSE",
    ].join("\n"),
    "utf8",
  );

  const sshdProcess = spawn(
    "/usr/sbin/sshd",
    ["-D", "-f", sshdConfigPath, "-E", sshdLogPath],
    {
      stdio: "ignore",
    },
  );

  const hostName = `playwright-ssh-${Date.now()}`;

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const output = execFileSync(
        "ssh",
        [
          "-o",
          "StrictHostKeyChecking=no",
          "-o",
          "UserKnownHostsFile=/dev/null",
          "-i",
          clientKeyPath,
          "-p",
          String(port),
          `${process.env.USER ?? "xuzk"}@127.0.0.1`,
          "pwd",
        ],
        {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        },
      );

      if (output.trim() === homedir()) {
        return {
          rootDir,
          uploadFilePath,
          hostName,
          sshdDir,
          port,
          sshdProcess,
        };
      }
    } catch {
      // wait for sshd to become ready
    }
  }

  sshdProcess.kill("SIGKILL");
  throw new Error("remote ssh fixture did not become ready");
}

async function openRemoteFixture(
  page: Page,
  fixture: RemoteFixture,
  displayName: string,
) {
  const drawer = page.getByTestId("file-browser-drawer");
  await page.route("**/api/ssh-hosts", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        hosts: [
          {
            name: fixture.hostName,
            host: "127.0.0.1",
            port: fixture.port,
            username: process.env.USER ?? "xuzk",
            identityFile: path.join(fixture.sshdDir, "client_key"),
            defaultPath: fixture.rootDir,
          },
        ],
      }),
    });
  });

  await focusSession(page, displayName);
  await openFileBrowserForFocusedSession(page);

  await drawer.getByTestId("file-browser-host-toggle").click();
  await page
    .locator(".host-dropdown-item", { hasText: fixture.hostName })
    .click();
  await expect(drawer.getByTestId("file-entry-note.txt")).toBeVisible({
    timeout: 15_000,
  });
}

async function launchMockSession(
  request: APIRequestContext,
  displayName: string,
  workingDirectory: string,
) {
  const response = await request.post("/api/agent-launch/pty", {
    data: {
      workspaceId: "default",
      displayName,
      agentKind: "shell",
      command: `node ${JSON.stringify(path.join(process.cwd(), "scripts/mock-terminal-agent.mjs"))} scroll`,
      workingDirectory,
    },
  });

  expect(response.ok()).toBeTruthy();
  return (await response.json()).id as string;
}

async function deleteSessionIfPresent(
  request: APIRequestContext,
  sessionId?: string,
) {
  if (!sessionId) {
    return;
  }

  try {
    await request.delete(`/api/agent-sessions/${sessionId}`, {
      timeout: 5000,
    });
  } catch {
    // Cleanup should not mask the behavior under test when a browser/server
    // teardown race leaves the API request hanging.
  }
}

async function focusSession(page: Page, displayName: string) {
  await page.goto("/");
  const targetCard = page.locator(".grid-card", {
    has: page.locator(".grid-card-name", { hasText: displayName }),
  });
  await expect(targetCard).toBeVisible({ timeout: 15_000 });
  await targetCard.dblclick();
  await expect(page.locator(".focus-main-name")).toContainText(displayName, {
    timeout: 5000,
  });
}

async function switchFocusedSession(
  page: Page,
  displayName: string,
  sessionId?: string,
) {
  if (sessionId) {
    try {
      await selectTerminalPaneSession(
        page,
        page.locator('[data-active-terminal-pane="true"]'),
        sessionId,
      );
      await expect(page.locator(".focus-main-name")).toContainText(
        displayName,
        { timeout: 2000 },
      );
      return;
    } catch {
      // Fall back to the normal sidebar interaction when monitor-pane changes
      // are blocked by a transient layout state during resize tests.
    }
  }

  const sidebarCard = page.locator(".focus-sidebar-card", {
    has: page.locator("span", { hasText: displayName }),
  });
  await expect(sidebarCard).toBeVisible();
  await sidebarCard
    .locator(".focus-sidebar-card-name")
    .click({ timeout: 2000 });
  await expect(page.locator(".focus-main-name")).toContainText(displayName);
}

async function openFileBrowserForFocusedSession(page: Page) {
  const toggle = page.getByTestId("file-browser-toggle");
  await expect(toggle).toBeEnabled();
  await toggle.click();
  const drawer = page.getByTestId("file-browser-drawer");
  await expect(drawer).toBeVisible();
  return drawer;
}

test("file browser supports real local browsing, edit, upload, download, and delete flows", async ({
  page,
  request,
}) => {
  const fixture = setupFixture();
  const displayName = `file-browser-local-${Date.now()}`;
  let sessionId: string | undefined;

  try {
    sessionId = await launchMockSession(request, displayName, fixture.rootDir);
    await focusSession(page, displayName);
    const drawer = await openFileBrowserForFocusedSession(page);

    await expect(drawer.locator(".file-browser-path-input")).toHaveValue(
      fixture.rootDir,
    );

    await expect(drawer.getByTestId("file-entry-.secret.txt")).toHaveCount(0);
    await drawer.getByLabel("显示隐藏文件").check();
    await drawer.getByRole("button", { name: "刷新" }).click();
    await expect(drawer.getByTestId("file-entry-.secret.txt")).toBeVisible();

    await drawer.getByRole("button", { name: "新建" }).click();
    const createDialog = page.locator(".file-browser-dialog").first();
    await createDialog.locator("input").fill("created-folder");
    await createDialog.getByRole("button", { name: "创建" }).click();
    await expect(drawer.getByTestId("file-entry-created-folder")).toBeVisible();

    await drawer
      .getByTestId("file-entry-rename-me.txt")
      .click({ button: "right" });
    await page.getByRole("button", { name: "重命名" }).click();
    const renameDialog = page.locator(".file-browser-dialog").first();
    await renameDialog.locator("input").fill("renamed.txt");
    await renameDialog.getByRole("button", { name: "保存" }).click();
    await expect(drawer.getByTestId("file-entry-renamed.txt")).toBeVisible();

    await drawer
      .getByTestId("file-entry-note.txt")
      .getByRole("checkbox")
      .check();
    await expect(drawer.locator(".file-browser-preview-text")).toContainText(
      "hello file browser",
    );

    await drawer.getByRole("button", { name: "全屏预览" }).click();
    const fullscreenPreview = page.getByRole("dialog", {
      name: "note.txt 全屏预览",
    });
    await expect(fullscreenPreview).toBeVisible();
    await expect(
      fullscreenPreview.getByRole("button", { name: "退出全屏预览" }),
    ).toBeFocused();
    await expect(
      fullscreenPreview.locator(".file-browser-preview-text"),
    ).toContainText("hello file browser");
    const fullscreenBounds = await fullscreenPreview.boundingBox();
    expect(fullscreenBounds?.x).toBe(0);
    expect(fullscreenBounds?.y).toBe(0);
    expect(fullscreenBounds?.width).toBe(page.viewportSize()?.width);
    expect(fullscreenBounds?.height).toBe(page.viewportSize()?.height);
    await page.keyboard.press("Escape");
    await expect(fullscreenPreview).toHaveCount(0);

    await drawer.getByTestId("file-entry-note.txt").dblclick();
    await expect(drawer.locator(".file-browser-content")).toHaveAttribute(
      "data-preview-expanded",
      "true",
    );
    await drawer.getByRole("button", { name: "编辑" }).click();
    const editor = drawer.locator(".file-browser-editor");
    await expect(editor).toBeVisible();
    await editor.fill("hello file browser\nedited by playwright");
    await drawer.getByRole("button", { name: "保存" }).click();
    await drawer.getByRole("button", { name: "返回文件列表" }).click();
    await drawer
      .getByTestId("file-entry-note.txt")
      .getByRole("checkbox")
      .check();
    await expect(drawer.locator(".file-browser-preview-text")).toContainText(
      "edited by playwright",
    );

    await drawer
      .getByTestId("file-entry-note.txt")
      .getByRole("checkbox")
      .uncheck();
    await drawer
      .getByTestId("file-entry-photo.png")
      .getByRole("checkbox")
      .check();
    await expect(drawer.locator(".file-browser-preview-image")).toBeVisible();

    await drawer
      .getByTestId("file-browser-upload-file-input")
      .setInputFiles(fixture.uploadFilePath);
    await expect(
      drawer.getByTestId(`file-entry-${path.basename(fixture.uploadFilePath)}`),
    ).toBeVisible();

    await drawer
      .getByTestId("file-entry-photo.png")
      .getByRole("checkbox")
      .uncheck();
    await drawer
      .getByTestId("file-entry-renamed.txt")
      .getByRole("checkbox")
      .check();
    const downloadPromise = page.waitForEvent("download");
    await drawer.getByRole("button", { name: "下载" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("renamed.txt");

    await drawer
      .getByTestId("file-entry-delete-me.txt")
      .getByRole("checkbox")
      .check();
    await drawer
      .getByTestId(`file-entry-${path.basename(fixture.uploadFilePath)}`)
      .getByRole("checkbox")
      .check();
    page.once("dialog", (dialog) => dialog.accept());
    await drawer.getByRole("button", { name: "删除" }).click();
    await expect(drawer.getByTestId("file-entry-delete-me.txt")).toHaveCount(0);
    await expect(
      drawer.getByTestId(`file-entry-${path.basename(fixture.uploadFilePath)}`),
    ).toHaveCount(0);
  } finally {
    await deleteSessionIfPresent(request, sessionId);
    rmSync(fixture.rootDir, { recursive: true, force: true });
    rmSync(fixture.uploadFilePath, { force: true });
  }
});

test("Markdown files stay inline beside the terminal and render only one preview", async ({
  page,
  request,
}) => {
  const fixture = setupFixture();
  const displayName = `file-browser-markdown-${Date.now()}`;
  const markdownPath = path.join(fixture.rootDir, "paper.md");
  let sessionId: string | undefined;

  writeFileSync(
    markdownPath,
    Array.from(
      { length: 80 },
      (_, index) =>
        `## Section ${index + 1}\n\nFormula: $x_${index + 1} = \\frac{${index + 1}}{2}$.\n`,
    ).join("\n"),
  );

  try {
    sessionId = await launchMockSession(request, displayName, fixture.rootDir);
    await focusSession(page, displayName);
    const drawer = await openFileBrowserForFocusedSession(page);
    const terminal = page.locator(".focus-main .terminal-view").first();

    await drawer.getByTestId("file-entry-paper.md").click();
    await expect(drawer.getByTestId("markdown-mode-preview")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(drawer.getByTestId("markdown-rendered")).toContainText(
      "Section 1",
    );

    await drawer.getByTestId("file-entry-paper.md").dblclick();
    await expect(drawer.locator(".file-browser-content")).toHaveAttribute(
      "data-preview-expanded",
      "true",
    );
    await expect(page.getByTestId("markdown-file-dialog")).toHaveCount(0);
    await expect(drawer.getByTestId("file-entry-paper.md")).toBeHidden();
    await expect(terminal).toBeVisible();

    const renderedPreview = drawer.getByTestId("markdown-rendered");
    await expect(renderedPreview).toContainText("Section 80");
    await expect(page.getByTestId("markdown-rendered")).toHaveCount(1);
    const outline = drawer.getByRole("navigation", {
      name: "Markdown 目录",
    });
    await expect(outline).toBeVisible();
    await outline
      .getByRole("button", { name: "Section 60", exact: true })
      .click();
    await expect
      .poll(() => renderedPreview.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);

    const drawerBounds = await drawer.boundingBox();
    const terminalBounds = await terminal.boundingBox();
    expect(drawerBounds).not.toBeNull();
    expect(terminalBounds).not.toBeNull();
    expect(drawerBounds!.x + drawerBounds!.width).toBeLessThanOrEqual(
      terminalBounds!.x + 2,
    );

    await renderedPreview.evaluate((element) => {
      element.scrollTop = 0;
    });
    await renderedPreview.hover();
    await page.mouse.wheel(0, 480);
    await expect
      .poll(() => renderedPreview.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);

    await drawer.getByTestId("markdown-mode-split").click();
    const sourceEditor = drawer.getByTestId("markdown-editor");
    await expect(drawer.getByTestId("markdown-sync-scroll")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await sourceEditor.evaluate((element) => {
      element.scrollTop = Math.max(1, element.scrollHeight / 2);
      element.dispatchEvent(new Event("scroll"));
    });
    await expect
      .poll(() => renderedPreview.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);

    await drawer.getByRole("button", { name: "返回文件列表" }).click();
    await expect(drawer.getByTestId("file-entry-paper.md")).toBeVisible();
  } finally {
    await deleteSessionIfPresent(request, sessionId);
    rmSync(fixture.rootDir, { recursive: true, force: true });
    rmSync(fixture.uploadFilePath, { force: true });
  }
});

test("file browser create dialog supports creating an empty file", async ({
  page,
  request,
}) => {
  const fixture = setupFixture();
  const displayName = `file-browser-create-file-${Date.now()}`;
  const createdFileName = `created-file-${Date.now()}.txt`;
  let sessionId: string | undefined;

  try {
    sessionId = await launchMockSession(request, displayName, fixture.rootDir);
    await focusSession(page, displayName);
    const drawer = await openFileBrowserForFocusedSession(page);

    await drawer.getByRole("button", { name: "新建" }).click();
    const createDialog = page.locator(".file-browser-dialog").first();
    await expect(createDialog).toBeVisible();
    await createDialog
      .getByRole("button", { name: "文件", exact: true })
      .click();
    await createDialog.locator("input").fill(createdFileName);
    await createDialog.getByRole("button", { name: "创建" }).click();

    await expect(
      drawer.getByTestId(`file-entry-${createdFileName}`),
    ).toBeVisible();
    expect(existsSync(path.join(fixture.rootDir, createdFileName))).toBe(true);
  } finally {
    await deleteSessionIfPresent(request, sessionId);
    rmSync(fixture.rootDir, { recursive: true, force: true });
    rmSync(fixture.uploadFilePath, { force: true });
  }
});

test("file browser context menu copies file and directory paths without clipboard API", async ({
  page,
  request,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });

    const copiedPaths: string[] = [];
    Object.defineProperty(window, "__fileBrowserCopiedPaths", {
      configurable: true,
      value: copiedPaths,
    });

    const originalExecCommand = document.execCommand.bind(document);
    document.execCommand = (command: string) => {
      if (command === "copy") {
        const activeElement = document.activeElement;
        copiedPaths.push(
          activeElement instanceof HTMLTextAreaElement
            ? activeElement.value
            : "",
        );
        return true;
      }

      return originalExecCommand(command);
    };
  });

  const fixture = setupFixture();
  const displayName = `file-browser-copy-path-${Date.now()}`;
  let sessionId: string | undefined;

  try {
    sessionId = await launchMockSession(request, displayName, fixture.rootDir);
    await focusSession(page, displayName);
    const drawer = await openFileBrowserForFocusedSession(page);

    await drawer.getByTestId("file-entry-note.txt").click({ button: "right" });
    await page
      .locator(".file-browser-context-menu")
      .getByRole("button", { name: "复制路径" })
      .click();

    await drawer.getByTestId("file-entry-nested").click({ button: "right" });
    await page
      .locator(".file-browser-context-menu")
      .getByRole("button", { name: "复制路径" })
      .click();

    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as Window & {
                __fileBrowserCopiedPaths?: string[];
              }
            ).__fileBrowserCopiedPaths ?? [],
        ),
      )
      .toEqual([
        path.join(fixture.rootDir, "note.txt"),
        path.join(fixture.rootDir, "nested"),
      ]);
  } finally {
    await deleteSessionIfPresent(request, sessionId);
    rmSync(fixture.rootDir, { recursive: true, force: true });
    rmSync(fixture.uploadFilePath, { force: true });
  }
});

test("file browser editor keeps focus instead of the terminal stealing it back", async ({
  page,
  request,
}) => {
  const fixture = setupFixture();
  const displayName = `file-browser-editor-focus-${Date.now()}`;
  const typedMarker = `focus-stays-here-${Date.now()}`;
  let sessionId: string | undefined;

  try {
    sessionId = await launchMockSession(request, displayName, fixture.rootDir);
    await focusSession(page, displayName);

    const terminalScreen = page.locator(
      ".focus-main .terminal-view .xterm-screen",
    );
    await expect(terminalScreen).toBeVisible({ timeout: 15_000 });
    await terminalScreen.click({ position: { x: 90, y: 50 } });

    const drawer = await openFileBrowserForFocusedSession(page);
    await drawer.getByTestId("file-entry-note.txt").dblclick();
    await drawer.getByRole("button", { name: "编辑" }).click();

    const editor = drawer.locator(".file-browser-editor");
    await expect(editor).toBeVisible();
    await editor.click();

    await expect
      .poll(async () =>
        page.evaluate(
          () =>
            document.activeElement instanceof HTMLTextAreaElement &&
            document.activeElement.classList.contains("file-browser-editor"),
        ),
      )
      .toBeTruthy();

    await page.waitForTimeout(300);
    await editor.fill("");
    await page.keyboard.type(typedMarker);
    await page.waitForTimeout(5_200);
    await page.keyboard.type("-after-tick");

    await expect(editor).toHaveValue(`${typedMarker}-after-tick`);
    await expect
      .poll(async () =>
        page.evaluate(
          () =>
            document.activeElement instanceof HTMLTextAreaElement &&
            document.activeElement.classList.contains("file-browser-editor"),
        ),
      )
      .toBeTruthy();
  } finally {
    await deleteSessionIfPresent(request, sessionId);
    rmSync(fixture.rootDir, { recursive: true, force: true });
    rmSync(fixture.uploadFilePath, { force: true });
  }
});
test("file browser create dialog stays open when the name is temporarily empty", async ({
  page,
  request,
}) => {
  const fixture = setupFixture();
  const displayName = `file-browser-create-empty-${Date.now()}`;
  let sessionId: string | undefined;

  try {
    sessionId = await launchMockSession(request, displayName, fixture.rootDir);
    await focusSession(page, displayName);
    const drawer = await openFileBrowserForFocusedSession(page);

    await drawer.getByRole("button", { name: "新建" }).click();
    const createDialog = page.locator(".file-browser-dialog").first();
    await expect(createDialog).toBeVisible();

    const nameInput = createDialog.locator("input");
    await nameInput.fill("");

    await expect(createDialog).toBeVisible();
    await expect(nameInput).toHaveValue("");
    await expect(
      createDialog.getByRole("button", { name: "创建" }),
    ).toBeDisabled();

    await createDialog.getByRole("button", { name: "取消" }).click();
    await expect(createDialog).toHaveCount(0);
  } finally {
    await deleteSessionIfPresent(request, sessionId);
    rmSync(fixture.rootDir, { recursive: true, force: true });
    rmSync(fixture.uploadFilePath, { force: true });
  }
});

test("file browser side collapse state is global while switching sessions", async ({
  page,
  request,
}) => {
  const fixtureA = setupFixture();
  const fixtureB = setupFixture();
  const sessionAName = `file-browser-collapse-a-${Date.now()}`;
  const sessionBName = `file-browser-collapse-b-${Date.now()}`;
  let sessionAId: string | undefined;
  let sessionBId: string | undefined;

  try {
    sessionAId = await launchMockSession(
      request,
      sessionAName,
      fixtureA.rootDir,
    );
    sessionBId = await launchMockSession(
      request,
      sessionBName,
      fixtureB.rootDir,
    );

    await focusSession(page, sessionAName);
    const drawerA = await openFileBrowserForFocusedSession(page);
    await expect(drawerA.getByTestId("file-entry-note.txt")).toBeVisible();

    const sideShell = page.locator(".file-browser-shell");
    const sideCollapseToggle = page.getByTestId("side-panel-collapse-toggle");

    await sideCollapseToggle.click();
    const collapsedSideBeforeSwitch = await sideShell.boundingBox();
    expect((collapsedSideBeforeSwitch?.width ?? 0) < 10).toBeTruthy();

    await switchFocusedSession(page, sessionBName, sessionBId);
    await expect(page.locator(".focus-main-name")).toContainText(sessionBName);
    const collapsedSideAfterSwitch = await sideShell.boundingBox();
    expect((collapsedSideAfterSwitch?.width ?? 0) < 10).toBeTruthy();

    await switchFocusedSession(page, sessionAName, sessionAId);
    await expect(page.locator(".focus-main-name")).toContainText(sessionAName);
    const restoredCollapsedSideShell = await sideShell.boundingBox();
    expect((restoredCollapsedSideShell?.width ?? 0) < 10).toBeTruthy();

    await sideCollapseToggle.click();
    await expect(drawerA.getByTestId("file-entry-note.txt")).toBeVisible();
  } finally {
    await deleteSessionIfPresent(request, sessionAId);
    await deleteSessionIfPresent(request, sessionBId);
    rmSync(fixtureA.rootDir, { recursive: true, force: true });
    rmSync(fixtureA.uploadFilePath, { force: true });
    rmSync(fixtureB.rootDir, { recursive: true, force: true });
    rmSync(fixtureB.uploadFilePath, { force: true });
  }
});

test("file browser follows the active monitor terminal when the side panel is open", async ({
  page,
  request,
}) => {
  const fixtureA = setupFixture();
  const fixtureB = setupFixture();
  const sessionAName = `file-browser-follow-a-${Date.now()}`;
  const sessionBName = `file-browser-follow-b-${Date.now()}`;
  let sessionAId: string | undefined;
  let sessionBId: string | undefined;

  try {
    sessionAId = await launchMockSession(
      request,
      sessionAName,
      fixtureA.rootDir,
    );
    sessionBId = await launchMockSession(
      request,
      sessionBName,
      fixtureB.rootDir,
    );

    await focusSession(page, sessionAName);
    await page.getByRole("button", { name: /屏幕布局/ }).click();
    await page.getByRole("menuitemradio", { name: /左右双屏/ }).click();

    const drawerA = await openFileBrowserForFocusedSession(page);
    await expect(drawerA.locator(".file-browser-path-input")).toHaveValue(
      fixtureA.rootDir,
    );

    const secondPane = page.locator(
      '[data-terminal-pane-slot="terminal-monitor-slot-2"]',
    );
    await selectTerminalPaneSession(page, secondPane, sessionBId!);
    await expect(secondPane).toHaveAttribute(
      "data-terminal-pane-session",
      sessionBId!,
    );
    await secondPane.locator(".terminal-view").click();

    await expect(page.locator(".focus-main-name")).toContainText(sessionBName);
    const drawerB = page.getByTestId("file-browser-drawer");
    await expect(drawerB.locator(".file-browser-path-input")).toHaveValue(
      fixtureB.rootDir,
    );
    await expect(drawerB.getByTestId("file-entry-note.txt")).toBeVisible();
  } finally {
    await deleteSessionIfPresent(request, sessionAId);
    await deleteSessionIfPresent(request, sessionBId);
    rmSync(fixtureA.rootDir, { recursive: true, force: true });
    rmSync(fixtureA.uploadFilePath, { force: true });
    rmSync(fixtureB.rootDir, { recursive: true, force: true });
    rmSync(fixtureB.uploadFilePath, { force: true });
  }
});

test("open file browser retargets to a monitor terminal that never opened files before", async ({
  page,
  request,
}) => {
  const fixtureA = setupFixture();
  const fixtureB = setupFixture();
  const sessionAName = `file-browser-unopened-a-${Date.now()}`;
  const sessionBName = `file-browser-unopened-b-${Date.now()}`;
  let sessionAId: string | undefined;
  let sessionBId: string | undefined;

  try {
    sessionAId = await launchMockSession(
      request,
      sessionAName,
      fixtureA.rootDir,
    );
    sessionBId = await launchMockSession(
      request,
      sessionBName,
      fixtureB.rootDir,
    );

    await focusSession(page, sessionAName);
    await page.getByRole("button", { name: /屏幕布局/ }).click();
    await page.getByRole("menuitemradio", { name: /左右双屏/ }).click();

    const firstPane = page.locator(
      '[data-terminal-pane-slot="terminal-monitor-slot-1"]',
    );
    const secondPane = page.locator(
      '[data-terminal-pane-slot="terminal-monitor-slot-2"]',
    );
    await selectTerminalPaneSession(page, secondPane, sessionBId!);
    await firstPane.locator(".terminal-view").click();
    await expect(page.locator(".focus-main-name")).toContainText(sessionAName);

    const drawerA = await openFileBrowserForFocusedSession(page);
    await expect(drawerA.locator(".file-browser-path-input")).toHaveValue(
      fixtureA.rootDir,
    );

    await secondPane.locator(".terminal-view").click();
    await expect(page.locator(".focus-main-name")).toContainText(sessionBName);
    const drawerB = page.getByTestId("file-browser-drawer");
    await expect(drawerB).toBeVisible();
    await expect(drawerB.locator(".file-browser-path-input")).toHaveValue(
      fixtureB.rootDir,
    );
    await expect(drawerB.getByTestId("file-entry-note.txt")).toBeVisible();
  } finally {
    await deleteSessionIfPresent(request, sessionAId);
    await deleteSessionIfPresent(request, sessionBId);
    rmSync(fixtureA.rootDir, { recursive: true, force: true });
    rmSync(fixtureA.uploadFilePath, { force: true });
    rmSync(fixtureB.rootDir, { recursive: true, force: true });
    rmSync(fixtureB.uploadFilePath, { force: true });
  }
});

test("file browser collapse state is controlled only by collapse buttons during monitor switches", async ({
  page,
  request,
}) => {
  const fixtureA = setupFixture();
  const fixtureB = setupFixture();
  const sessionAName = `file-browser-global-collapse-a-${Date.now()}`;
  const sessionBName = `file-browser-global-collapse-b-${Date.now()}`;
  let sessionAId: string | undefined;
  let sessionBId: string | undefined;

  try {
    sessionAId = await launchMockSession(
      request,
      sessionAName,
      fixtureA.rootDir,
    );
    sessionBId = await launchMockSession(
      request,
      sessionBName,
      fixtureB.rootDir,
    );

    await focusSession(page, sessionAName);
    await page.getByRole("button", { name: /屏幕布局/ }).click();
    await page.getByRole("menuitemradio", { name: /左右双屏/ }).click();

    const firstPane = page.locator(
      '[data-terminal-pane-slot="terminal-monitor-slot-1"]',
    );
    const secondPane = page.locator(
      '[data-terminal-pane-slot="terminal-monitor-slot-2"]',
    );
    await selectTerminalPaneSession(page, secondPane, sessionBId!);

    await openFileBrowserForFocusedSession(page);

    const sideShell = page.locator(".file-browser-shell");
    const sideCollapseToggle = page.getByTestId("side-panel-collapse-toggle");

    await sideCollapseToggle.click();
    const collapsedBeforeSwitch = await sideShell.boundingBox();
    expect((collapsedBeforeSwitch?.width ?? 0) < 10).toBeTruthy();

    await secondPane.locator(".terminal-view").click();
    await expect(page.locator(".focus-main-name")).toContainText(sessionBName);
    const collapsedAfterSwitch = await sideShell.boundingBox();
    expect((collapsedAfterSwitch?.width ?? 0) < 10).toBeTruthy();

    await sideCollapseToggle.click();
    const expandedOnB = await sideShell.boundingBox();
    expect((expandedOnB?.width ?? 0) > 200).toBeTruthy();

    await firstPane.locator(".terminal-view").click();
    await expect(page.locator(".focus-main-name")).toContainText(sessionAName);
    const expandedAfterSwitchBack = await sideShell.boundingBox();
    expect((expandedAfterSwitchBack?.width ?? 0) > 200).toBeTruthy();
  } finally {
    await deleteSessionIfPresent(request, sessionAId);
    await deleteSessionIfPresent(request, sessionBId);
    rmSync(fixtureA.rootDir, { recursive: true, force: true });
    rmSync(fixtureA.uploadFilePath, { force: true });
    rmSync(fixtureB.rootDir, { recursive: true, force: true });
    rmSync(fixtureB.uploadFilePath, { force: true });
  }
});

test("file browser stays mounted and retargets during repeated monitor terminal switches", async ({
  page,
  request,
}) => {
  const fixtureA = setupFixture();
  const fixtureB = setupFixture();
  const sessionAName = `file-browser-repeat-a-${Date.now()}`;
  const sessionBName = `file-browser-repeat-b-${Date.now()}`;
  let sessionAId: string | undefined;
  let sessionBId: string | undefined;

  try {
    sessionAId = await launchMockSession(
      request,
      sessionAName,
      fixtureA.rootDir,
    );
    sessionBId = await launchMockSession(
      request,
      sessionBName,
      fixtureB.rootDir,
    );

    await focusSession(page, sessionAName);
    await page.getByRole("button", { name: /屏幕布局/ }).click();
    await page.getByRole("menuitemradio", { name: /左右双屏/ }).click();

    const drawerA = await openFileBrowserForFocusedSession(page);
    await expect(drawerA.locator(".file-browser-path-input")).toHaveValue(
      fixtureA.rootDir,
    );

    const firstPane = page.locator(
      '[data-terminal-pane-slot="terminal-monitor-slot-1"]',
    );
    const secondPane = page.locator(
      '[data-terminal-pane-slot="terminal-monitor-slot-2"]',
    );
    await selectTerminalPaneSession(page, secondPane, sessionBId!);

    await secondPane.locator(".terminal-view").click();
    await expect(page.locator(".focus-main-name")).toContainText(sessionBName);
    await expect(
      page
        .getByTestId("file-browser-drawer")
        .locator(".file-browser-path-input"),
    ).toHaveValue(fixtureB.rootDir);
    await expect(
      page
        .getByTestId("file-browser-drawer")
        .getByTestId("file-entry-note.txt"),
    ).toBeVisible();

    await firstPane.locator(".terminal-view").click();
    await expect(page.locator(".focus-main-name")).toContainText(sessionAName);
    await expect(
      page
        .getByTestId("file-browser-drawer")
        .locator(".file-browser-path-input"),
    ).toHaveValue(fixtureA.rootDir);
    await expect(
      page
        .getByTestId("file-browser-drawer")
        .getByTestId("file-entry-note.txt"),
    ).toBeVisible();

    await secondPane.locator(".terminal-view").click();
    await expect(page.locator(".focus-main-name")).toContainText(sessionBName);
    await expect(
      page
        .getByTestId("file-browser-drawer")
        .locator(".file-browser-path-input"),
    ).toHaveValue(fixtureB.rootDir);
    await expect(
      page
        .getByTestId("file-browser-drawer")
        .getByTestId("file-entry-note.txt"),
    ).toBeVisible();
  } finally {
    await deleteSessionIfPresent(request, sessionAId);
    await deleteSessionIfPresent(request, sessionBId);
    rmSync(fixtureA.rootDir, { recursive: true, force: true });
    rmSync(fixtureA.uploadFilePath, { force: true });
    rmSync(fixtureB.rootDir, { recursive: true, force: true });
    rmSync(fixtureB.uploadFilePath, { force: true });
  }
});

test("file browser final target remains stable after rapid monitor terminal switches", async ({
  page,
  request,
}) => {
  const fixtureA = setupFixture();
  const fixtureB = setupFixture();
  const sessionAName = `file-browser-rapid-a-${Date.now()}`;
  const sessionBName = `file-browser-rapid-b-${Date.now()}`;
  let sessionAId: string | undefined;
  let sessionBId: string | undefined;

  try {
    sessionAId = await launchMockSession(
      request,
      sessionAName,
      fixtureA.rootDir,
    );
    sessionBId = await launchMockSession(
      request,
      sessionBName,
      fixtureB.rootDir,
    );

    await focusSession(page, sessionAName);
    await page.getByRole("button", { name: /屏幕布局/ }).click();
    await page.getByRole("menuitemradio", { name: /左右双屏/ }).click();

    await openFileBrowserForFocusedSession(page);

    const firstTerminal = page
      .locator('[data-terminal-pane-slot="terminal-monitor-slot-1"]')
      .locator(".terminal-view");
    const secondPane = page.locator(
      '[data-terminal-pane-slot="terminal-monitor-slot-2"]',
    );
    const secondTerminal = secondPane.locator(".terminal-view");
    await selectTerminalPaneSession(page, secondPane, sessionBId!);

    await secondTerminal.click();
    await firstTerminal.click();
    await secondTerminal.click();

    await expect(page.locator(".focus-main-name")).toContainText(sessionBName);
    const drawer = page.getByTestId("file-browser-drawer");
    await expect(drawer).toBeVisible();
    await expect(drawer.locator(".file-browser-path-input")).toHaveValue(
      fixtureB.rootDir,
    );
    await expect(drawer.getByTestId("file-entry-note.txt")).toBeVisible();
  } finally {
    await deleteSessionIfPresent(request, sessionAId);
    await deleteSessionIfPresent(request, sessionBId);
    rmSync(fixtureA.rootDir, { recursive: true, force: true });
    rmSync(fixtureA.uploadFilePath, { force: true });
    rmSync(fixtureB.rootDir, { recursive: true, force: true });
    rmSync(fixtureB.uploadFilePath, { force: true });
  }
});

test("monitor terminal switching updates the active header without opening a side panel", async ({
  page,
  request,
}) => {
  const fixtureA = setupFixture();
  const fixtureB = setupFixture();
  const sessionAName = `file-browser-no-panel-a-${Date.now()}`;
  const sessionBName = `file-browser-no-panel-b-${Date.now()}`;
  let sessionAId: string | undefined;
  let sessionBId: string | undefined;

  try {
    sessionAId = await launchMockSession(
      request,
      sessionAName,
      fixtureA.rootDir,
    );
    sessionBId = await launchMockSession(
      request,
      sessionBName,
      fixtureB.rootDir,
    );

    await focusSession(page, sessionAName);
    await page.getByRole("button", { name: /屏幕布局/ }).click();
    await page.getByRole("menuitemradio", { name: /左右双屏/ }).click();

    await expect(page.getByTestId("file-browser-drawer")).toHaveCount(0);

    const secondPane = page.locator(
      '[data-terminal-pane-slot="terminal-monitor-slot-2"]',
    );
    await selectTerminalPaneSession(page, secondPane, sessionBId!);
    await expect(secondPane).toHaveAttribute(
      "data-terminal-pane-session",
      sessionBId!,
    );
    await secondPane.locator(".terminal-view").click();

    await expect(page.locator(".focus-main-name")).toContainText(sessionBName);
    await expect(secondPane).toHaveAttribute(
      "data-active-terminal-pane",
      "true",
    );
    await expect(page.getByTestId("file-browser-drawer")).toHaveCount(0);

    const drawerB = await openFileBrowserForFocusedSession(page);
    await expect(page.locator(".focus-main-name")).toContainText(sessionBName);
    await expect(drawerB.locator(".file-browser-path-input")).toHaveValue(
      fixtureB.rootDir,
    );
  } finally {
    await deleteSessionIfPresent(request, sessionAId);
    await deleteSessionIfPresent(request, sessionBId);
    rmSync(fixtureA.rootDir, { recursive: true, force: true });
    rmSync(fixtureA.uploadFilePath, { force: true });
    rmSync(fixtureB.rootDir, { recursive: true, force: true });
    rmSync(fixtureB.uploadFilePath, { force: true });
  }
});

test("file browser is scoped per focused session, keeps splitter behavior, and stays unavailable in grid view", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const fixtureA = setupFixture();
  const fixtureB = setupFixture();
  const sessionAName = `file-browser-focus-a-${Date.now()}`;
  const sessionBName = `file-browser-focus-b-${Date.now()}`;
  let sessionAId: string | undefined;
  let sessionBId: string | undefined;

  writeFileSync(
    path.join(fixtureA.rootDir, "note.txt"),
    "hello file browser A",
  );
  writeFileSync(
    path.join(fixtureA.rootDir, "nested", "inside.txt"),
    "inside A",
  );
  writeFileSync(
    path.join(fixtureB.rootDir, "note.txt"),
    "hello file browser B",
  );
  writeFileSync(
    path.join(fixtureB.rootDir, "nested", "inside.txt"),
    "inside B",
  );

  await page.goto("/");

  const topBar = page.locator(".top-bar");
  const topToggle = topBar.getByTestId("file-browser-toggle");
  await expect(topToggle).toBeVisible();
  await expect(topToggle).toBeDisabled();

  try {
    sessionAId = await launchMockSession(
      request,
      sessionAName,
      fixtureA.rootDir,
    );
    sessionBId = await launchMockSession(
      request,
      sessionBName,
      fixtureB.rootDir,
    );

    await focusSession(page, sessionAName);
    const drawer = await openFileBrowserForFocusedSession(page);
    await expect(drawer.getByTestId("file-entry-note.txt")).toBeVisible();
    await expect(drawer.locator(".file-browser-preview-text")).toHaveCount(0);

    await drawer.getByTestId("file-entry-nested").dblclick();
    await expect(drawer.getByTestId("file-entry-inside.txt")).toBeVisible();
    await expect(drawer.locator(".file-browser-path-input")).toHaveValue(
      /nested$/,
    );

    const mainSplitter = page.getByTestId("file-browser-main-splitter");
    const drawerBefore = await drawer.boundingBox();
    await mainSplitter.hover();
    await page.mouse.down();
    await page.mouse.move(
      (drawerBefore?.x ?? 0) + (drawerBefore?.width ?? 0) + 120,
      300,
    );
    await page.mouse.up();
    const drawerAfter = await drawer.boundingBox();
    expect((drawerAfter?.width ?? 0) > (drawerBefore?.width ?? 0)).toBeTruthy();

    const sideCollapseToggle = page.getByTestId("side-panel-collapse-toggle");
    const mainCollapseToggle = page.getByTestId("main-panel-collapse-toggle");
    const sideShell = page.locator(".file-browser-shell");
    const mainContent = page.locator(".main-content");

    await sideCollapseToggle.click();
    const collapsedSideShell = await sideShell.boundingBox();
    expect((collapsedSideShell?.width ?? 0) < 10).toBeTruthy();

    await sideCollapseToggle.click();
    const expandedSideShell = await sideShell.boundingBox();
    expect((expandedSideShell?.width ?? 0) > 200).toBeTruthy();

    await mainCollapseToggle.click();
    const collapsedMainContent = await mainContent.boundingBox();
    expect((collapsedMainContent?.width ?? 0) < 10).toBeTruthy();

    await mainCollapseToggle.click();
    const expandedMainContent = await mainContent.boundingBox();
    expect((expandedMainContent?.width ?? 0) > 200).toBeTruthy();

    await test.step("file browser scope follows session B", async () => {
      await switchFocusedSession(page, sessionBName, sessionBId);
      const drawerB = page.getByTestId("file-browser-drawer");
      await expect(drawerB).toBeVisible();
      await expect(drawerB.locator(".file-browser-path-input")).toHaveValue(
        fixtureB.rootDir,
      );
      await expect(drawerB.getByTestId("file-entry-note.txt")).toBeVisible();
      await drawerB
        .getByTestId("file-entry-note.txt")
        .getByRole("checkbox")
        .check();
      await expect(drawerB.locator(".file-browser-preview-text")).toContainText(
        "hello file browser B",
      );

      const previewSplitter = drawerB.getByTestId(
        "file-browser-preview-splitter",
      );
      const previewBefore = await drawerB
        .locator(".file-browser-preview")
        .boundingBox();
      const previewSplitterBox = await previewSplitter.boundingBox();
      await page.mouse.move(
        (previewSplitterBox?.x ?? 0) + (previewSplitterBox?.width ?? 0) / 2,
        (previewSplitterBox?.y ?? 0) + 2,
      );
      await page.mouse.down();
      await page.mouse.move(
        (previewSplitterBox?.x ?? 0) + (previewSplitterBox?.width ?? 0) / 2,
        (previewSplitterBox?.y ?? 0) - 80,
      );
      await page.mouse.up();
      const previewAfter = await drawerB
        .locator(".file-browser-preview")
        .boundingBox();
      expect(
        (previewAfter?.height ?? 0) > (previewBefore?.height ?? 0),
      ).toBeTruthy();
    });

    await test.step("file browser restores session A before grid return", async () => {
      await switchFocusedSession(page, sessionAName, sessionAId);
      const restoredDrawer = page.getByTestId("file-browser-drawer");
      await expect(restoredDrawer).toBeVisible();
      await expect(
        restoredDrawer.getByTestId("file-entry-inside.txt"),
      ).toBeVisible();
      await expect(
        restoredDrawer.locator(".file-browser-path-input"),
      ).toHaveValue(/nested$/);

      await page
        .locator(".focus-main-header")
        .getByRole("button", { name: "返回宫格" })
        .click({ force: true, timeout: 5000 });
      await expect(page.getByTestId("file-browser-drawer")).toHaveCount(0, {
        timeout: 5000,
      });
      await expect(page.getByTestId("file-browser-toggle")).toBeDisabled();
    });
  } finally {
    await deleteSessionIfPresent(request, sessionAId);
    await deleteSessionIfPresent(request, sessionBId);
    rmSync(fixtureA.rootDir, { recursive: true, force: true });
    rmSync(fixtureA.uploadFilePath, { force: true });
    rmSync(fixtureB.rootDir, { recursive: true, force: true });
    rmSync(fixtureB.uploadFilePath, { force: true });
  }
});

test("file browser supports real SSH/SFTP browsing, edit, chmod, upload, download, and delete flows", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const fixture = startRemoteSshFixture();
  const displayName = `file-browser-remote-anchor-${Date.now()}`;
  let sessionId: string | undefined;

  try {
    sessionId = await launchMockSession(request, displayName, process.cwd());
    const drawer = page.getByTestId("file-browser-drawer");
    await openRemoteFixture(page, fixture, displayName);

    await expect(drawer.getByTestId("file-entry-.secret.txt")).toHaveCount(0);
    await drawer.getByLabel("显示隐藏文件").check();
    await drawer.getByRole("button", { name: "刷新" }).click();
    await expect(drawer.getByTestId("file-entry-.secret.txt")).toBeVisible();

    await drawer
      .getByTestId("file-entry-note.txt")
      .getByRole("checkbox")
      .check();
    await expect(drawer.locator(".file-browser-preview-text")).toContainText(
      "hello remote file browser",
    );

    await drawer.getByTestId("file-entry-note.txt").dblclick();
    await drawer.getByRole("button", { name: "编辑" }).click();
    const editor = drawer.locator(".file-browser-editor");
    await expect(editor).toBeVisible();
    await editor.fill("hello remote file browser\nedited over ssh");
    await drawer.getByRole("button", { name: "保存" }).click();
    await expect(drawer.getByRole("button", { name: "保存" })).toBeDisabled();
    await drawer.getByRole("button", { name: "返回文件列表" }).click();
    await drawer
      .getByTestId("file-entry-note.txt")
      .getByRole("checkbox")
      .check();
    await expect(drawer.locator(".file-browser-preview-text")).toContainText(
      "edited over ssh",
    );

    await drawer
      .getByTestId("file-entry-rename-me.txt")
      .click({ button: "right" });
    await page.getByRole("button", { name: "重命名" }).click();
    const renameDialog = page.locator(".file-browser-dialog").first();
    await renameDialog.locator("input").fill("renamed-remote.txt");
    await renameDialog.getByRole("button", { name: "保存" }).click();
    await expect(
      drawer.getByTestId("file-entry-renamed-remote.txt"),
    ).toBeVisible();

    await drawer
      .getByTestId("file-entry-renamed-remote.txt")
      .getByRole("checkbox")
      .check();
    await drawer.getByRole("button", { name: "chmod" }).click();
    const chmodDialog = page.locator(".file-browser-dialog").first();
    await chmodDialog
      .locator(".file-browser-chmod-group")
      .nth(1)
      .getByLabel("r")
      .uncheck();
    await chmodDialog
      .locator(".file-browser-chmod-group")
      .nth(1)
      .getByLabel("w")
      .uncheck();
    await chmodDialog
      .locator(".file-browser-chmod-group")
      .nth(2)
      .getByLabel("r")
      .uncheck();
    await chmodDialog.getByRole("button", { name: /应用 600/ }).click();
    await expect(chmodDialog).toHaveCount(0);
    await expect(
      drawer.getByTestId("file-entry-renamed-remote.txt"),
    ).toContainText("-rw-------");

    await drawer
      .getByTestId("file-browser-upload-file-input")
      .setInputFiles(fixture.uploadFilePath);
    await expect(
      drawer.getByTestId(`file-entry-${path.basename(fixture.uploadFilePath)}`),
    ).toBeVisible();

    await drawer
      .getByTestId("file-entry-renamed-remote.txt")
      .getByRole("checkbox")
      .check();
    await expect(drawer.getByRole("button", { name: "下载" })).toBeEnabled();
    const downloadResponse = await request.post("/api/fs/download", {
      data: {
        path: path.join(fixture.rootDir, "renamed-remote.txt"),
        sshTarget: {
          host: "127.0.0.1",
          port: fixture.port,
          username: process.env.USER ?? "xuzk",
          identityFile: path.join(fixture.sshdDir, "client_key"),
        },
      },
    });
    expect(downloadResponse.ok()).toBeTruthy();
    await expect(await downloadResponse.body()).toBeTruthy();

    await drawer
      .getByTestId("file-entry-delete-me.txt")
      .getByRole("checkbox")
      .check();
    await drawer
      .getByTestId(`file-entry-${path.basename(fixture.uploadFilePath)}`)
      .getByRole("checkbox")
      .check();
    page.once("dialog", (dialog) => dialog.accept());
    await drawer.getByRole("button", { name: "删除" }).click();
    await expect(drawer.getByTestId("file-entry-delete-me.txt")).toHaveCount(0);
    await expect(
      drawer.getByTestId(`file-entry-${path.basename(fixture.uploadFilePath)}`),
    ).toHaveCount(0);
  } finally {
    await deleteSessionIfPresent(request, sessionId);
    fixture.sshdProcess.kill("SIGKILL");
    await wait(100);
    rmSync(fixture.rootDir, { recursive: true, force: true });
    rmSync(fixture.uploadFilePath, { force: true });
    rmSync(fixture.sshdDir, { recursive: true, force: true });
  }
});
