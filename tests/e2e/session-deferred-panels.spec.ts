import { expect, test, type Locator, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

const cwd = "/fixture/项目/very-long-project-path-for-ui-regression";
const originalDraft = "Keep the original conversation draft";
const otherDraft = "Keep the other followed conversation draft";
const newDraft = "Keep the separate new conversation draft";
const owner = (id: string | null) =>
  JSON.stringify(["codex", "", id ? "session" : "new", id ?? cwd]);
const composer = (page: Page) =>
  page.locator(".session-codex-composer:visible");
const editor = (page: Page) => composer(page).locator("[contenteditable=true]");
const navigation = (page: Page) =>
  page.getByRole("navigation", { name: "会话工作台导航" });
const activate = (page: Page, target: Locator) =>
  page.viewportSize()?.width === 393 ? target.tap() : target.click();

async function expectInput(page: Page, id: string | null, text: string) {
  await expect(composer(page)).toHaveCount(1);
  await expect(composer(page)).toHaveAttribute("data-draft-owner", owner(id));
  await expect(editor(page)).toHaveText(text);
}

async function closeMenus(page: Page) {
  for (
    let attempt = 0;
    attempt < 3 && (await page.getByRole("menu").count());
    attempt++
  )
    await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
}

async function openMainMenu(page: Page) {
  await closeMenus(page);
  const trigger = navigation(page).getByRole("button", {
    name: "更多功能",
    exact: true,
  });
  await expect(trigger.locator("svg")).toBeVisible();
  await activate(page, trigger);
  await expect(page.locator(".session-main-menu")).toBeVisible();
}

async function chooseLayout(page: Page, label: string) {
  const direct = navigation(page).getByRole("button", {
    name: label,
    exact: true,
  });
  if (await direct.isVisible()) await activate(page, direct);
  else {
    await openMainMenu(page);
    await activate(
      page,
      page.getByRole("menuitemradio", { name: label, exact: true }),
    );
  }
}

async function selectFollowed(page: Page, id: string) {
  await closeMenus(page);
  await activate(page, navigation(page).locator(".session-attention-trigger"));
  const row = page.locator(
    `.session-followed-menu [data-session-key="codex:${id}"]`,
  );
  await expect(row).toBeVisible();
  await expect(row.locator("svg").first()).toBeVisible();
  await activate(page, row);
  await expect(composer(page)).toHaveAttribute("data-draft-owner", owner(id));
}

async function inputSnapshot(page: Page) {
  return page.evaluate(async () => {
    const load = (path: string) =>
      import(
        performance
          .getEntriesByType("resource")
          .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
          path
      );
    const [
      { useAgentCenterStore },
      { useCodexStore },
      { useSessionDraftStore },
    ] = await Promise.all([
      load("/src/session-mode/stores/useAgentCenterStore.ts"),
      load("/src/session-mode/components/codex/stores/useCodexStore.ts"),
      load("/src/session-mode/stores/useSessionDraftStore.ts"),
    ]);
    const selected = useAgentCenterStore.getState();
    return {
      cardId: selected.currentAgentCardId,
      cardKind: selected.currentAgentCardKind,
      threadId: useCodexStore.getState().currentThreadId,
      drafts: Object.fromEntries(
        Object.entries(useSessionDraftStore.getState().drafts).map(
          ([key, value]) => [key, (value as { text: string }).text],
        ),
      ),
    };
  });
}

async function prepare(page: Page) {
  const errors: string[] = [];
  const modules = new Set<string>();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/src/session-mode/")) modules.add(path);
  });
  // All APIs and WebSockets stay inside the existing isolated fixture. Opening
  // a UI panel must never attach a formal PTY or mutate a native Agent.
  const fixture = await installSessionUxFixture(page, 2);
  await page.route("**/api/filesystem/home-directory", (route) =>
    route.fulfill({ json: "/fixture/home" }),
  );
  await page.route("**/api/import/preview", (route) =>
    route.fulfill({
      json: { projects: 1, tasks: 0, records: { bots: 0, acp_sessions: 2 } },
    }),
  );
  await page.addInitScript(() => {
    localStorage.setItem(
      "kanban.session.layout-storage",
      JSON.stringify({
        version: 0,
        state: {
          view: "agent",
          sidebarMode: "agent",
          isSidebarOpen: false,
          isRightPanelOpen: false,
          activeRightPanelTab: null,
          openRightPanelTabs: [],
        },
      }),
    );
  });
  await page.goto("/?mode=session&view=agent");
  await editor(page).first().waitFor({ timeout: 60_000 });
  await seedSessionUx(page, 2, { sidebarOpen: false });
  await page.evaluate(async () => {
    const load = (path: string) =>
      import(
        performance
          .getEntriesByType("resource")
          .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
          path
      );
    const [{ useAgentCenterStore }, { useCodexStore }] = await Promise.all([
      load("/src/session-mode/stores/useAgentCenterStore.ts"),
      load("/src/session-mode/components/codex/stores/useCodexStore.ts"),
    ]);
    useCodexStore.setState({
      historyLoadedMap: { "ux-0": true, "ux-1": true },
    });
    for (const id of ["ux-0", "ux-1"])
      useAgentCenterStore.getState().addAgentCard(
        {
          kind: "codex",
          id,
          cwd: "/fixture/项目/very-long-project-path-for-ui-regression",
          preview: `Deferred panel fixture ${id}`,
        },
        { activate: id === "ux-0" },
      );
    useAgentCenterStore.setState({ cardsViewMode: "solo" });
  });
  await expect(composer(page)).toHaveAttribute(
    "data-draft-owner",
    owner("ux-0"),
  );
  await editor(page).fill(originalDraft);
  await expectInput(page, "ux-0", originalDraft);
  return { fixture, errors, modules };
}

function mutationCalls(calls: Array<{ path: string; body: unknown }>) {
  return calls.filter(({ path }) =>
    /\/(?:turn\/(?:start|steer|interrupt)|thread\/(?:start|resume|acquire|fork|rollback|revert|delete)|followups\/(?:submit|change|stop)|git\/(?:commit|push)|import\/apply)$/.test(
      path,
    ),
  );
}

for (const width of [1440, 393]) {
  test.describe(`${width}px deferred panels`, () => {
    test.use({
      viewport: { width, height: 852 },
      hasTouch: width === 393,
      isMobile: width === 393,
    });

    test("top navigation loads followed, new-chat, Git and import controls without mixing drafts", async ({
      page,
    }, info) => {
      test.setTimeout(120_000);
      const { fixture, errors, modules } = await prepare(page);
      await selectFollowed(page, "ux-1");
      await editor(page).fill(otherDraft);
      await selectFollowed(page, "ux-0");
      await expectInput(page, "ux-0", originalDraft);

      // NewAgentButton exists in the top bar for the grid/list layouts; the
      // phone's actual entry delegates from the visible More menu.
      await chooseLayout(page, "多会话网格");
      if (width === 393) {
        await openMainMenu(page);
        await activate(
          page,
          page.getByRole("menuitem", { name: "新聊天", exact: true }),
        );
      } else {
        const newChat = navigation(page)
          .locator(".session-global-new")
          .getByRole("button", { name: "新聊天", exact: true });
        await expect(newChat.locator("svg")).toBeVisible();
        await activate(page, newChat);
      }
      await expectInput(page, null, "");
      await editor(page).fill(newDraft);
      await selectFollowed(page, "ux-0");
      await chooseLayout(page, "自由分屏");
      await expectInput(page, "ux-0", originalDraft);

      if (width === 393) await openMainMenu(page);
      const git = (
        width === 393
          ? page.locator(".session-menu-git")
          : navigation(page).locator(".session-global-git")
      ).getByRole("button", { name: "Git 操作", exact: true });
      await expect(git.locator("svg")).toBeVisible();
      await activate(page, git);
      const commitItem = page.getByRole("menuitem", {
        name: "提交更改…",
        exact: true,
      });
      await expect(commitItem.locator("svg")).toBeVisible();
      await activate(page, commitItem);
      const commit = page.getByRole("dialog", {
        name: "提交 Git 更改",
        exact: true,
      });
      await expect(commit).toBeVisible();
      await commit
        .getByRole("textbox", { name: "Git 提交说明", exact: true })
        .fill("Cancel this isolated fixture commit");
      await activate(
        page,
        commit.getByRole("button", { name: "取消", exact: true }),
      );
      await expect(commit).toHaveCount(0);
      await closeMenus(page);
      await expectInput(page, "ux-0", originalDraft);

      expect(modules.has("/src/session-mode/DataImportDialog.tsx")).toBe(false);
      for (const attempt of [0, 1]) {
        await openMainMenu(page);
        const importItem = page.getByRole("menuitem", {
          name: "导入会话",
          exact: true,
        });
        await expect(importItem.locator("svg")).toBeVisible();
        await activate(page, importItem);
        const dialog = page.getByRole("dialog", {
          name: "从 Codexia 导入",
          exact: true,
        });
        await expect(dialog).toBeVisible();
        const source = dialog.getByRole("textbox", {
          name: "来源数据目录",
          exact: true,
        });
        if (attempt === 0) {
          await expect(source).toHaveValue("/fixture/home/.codexia");
          await source.fill("/fixture/import-source-preserved");
          await activate(
            page,
            dialog.getByRole("button", { name: "预览数据", exact: true }),
          );
          await expect(
            dialog.getByRole("button", { name: "确认导入", exact: true }),
          ).toBeVisible();
        } else
          await expect(source).toHaveValue("/fixture/import-source-preserved");
        await activate(
          page,
          dialog.getByRole("button", { name: "取消", exact: true }),
        );
        await expect(dialog).toHaveCount(0);
        await expectInput(page, "ux-0", originalDraft);
      }
      const state = await inputSnapshot(page);
      expect(state).toMatchObject({
        cardId: "ux-0",
        cardKind: "codex",
        threadId: "ux-0",
      });
      expect(state.drafts[owner("ux-0")]).toBe(originalDraft);
      expect(state.drafts[owner("ux-1")]).toBe(otherDraft);
      expect(state.drafts[owner(null)]).toBe(newDraft);
      for (const path of [
        "/src/session-mode/components/agent/FollowedSessionsMenu.tsx",
        "/src/session-mode/components/common/NewAgentButton.tsx",
        "/src/session-mode/features/git/GitActions.tsx",
        "/src/session-mode/DataImportDialog.tsx",
      ])
        expect(modules.has(path), `actual UI must acquire ${path}`).toBe(true);
      expect(mutationCalls(fixture.calls)).toEqual([]);
      expect(errors).toEqual([]);
      await page.screenshot({
        path: info.outputPath("top-navigation-restored.png"),
        fullPage: true,
      });
      await writeFile(
        info.outputPath("top-navigation.json"),
        JSON.stringify(
          {
            width,
            state,
            modules: [...modules].sort(),
            mutationCalls: mutationCalls(fixture.calls),
            errors,
          },
          null,
          2,
        ),
      );
    });

    test("left and right panels first open, close and reopen with the same local state and input owner", async ({
      page,
    }, info) => {
      test.setTimeout(120_000);
      const { fixture, errors, modules } = await prepare(page);
      expect(
        modules.has("/src/session-mode/components/layout/AppSidebar.tsx"),
      ).toBe(false);
      expect(
        modules.has("/src/session-mode/components/layout/RightPanel.tsx"),
      ).toBe(false);
      const projectEntry = navigation(page).locator(".session-global-projects");
      await expect(projectEntry.locator("svg")).toBeVisible();
      await activate(page, projectEntry);
      const sidebar = page.locator('[data-sidebar="sidebar"]');
      await expect(
        sidebar.getByRole("button", { name: "搜索和管理会话", exact: true }),
      ).toBeVisible();
      const projects = sidebar.getByRole("button", {
        name: "项目列表",
        exact: true,
      });
      await expect(projects.locator("svg")).toBeVisible();
      if ((await projects.getAttribute("aria-expanded")) === "true")
        await activate(page, projects);
      await expect(projects).toHaveAttribute("aria-expanded", "false");
      if (width === 393) {
        await activate(
          page,
          sidebar.getByRole("button", { name: "收起项目列表", exact: true }),
        );
        await expect(
          page.getByRole("dialog", { name: "项目与会话列表", exact: true }),
        ).toHaveCount(0);
      } else {
        await activate(page, projectEntry);
        await expect(
          page.locator('[data-slot="sidebar-container"]'),
        ).toHaveAttribute("inert", "");
      }
      await expectInput(page, "ux-0", originalDraft);
      await activate(page, projectEntry);
      await expect(projects).toBeVisible();
      await expect(projects).toHaveAttribute("aria-expanded", "false");
      if (width === 393)
        await activate(
          page,
          sidebar.getByRole("button", { name: "收起项目列表", exact: true }),
        );
      else await activate(page, projectEntry);

      if (width === 393) {
        await openMainMenu(page);
        const files = page.getByRole("menuitem", {
          name: "文件浏览器",
          exact: true,
        });
        await expect(files.locator("svg")).toBeVisible();
        await activate(page, files);
      } else {
        const files = page
          .getByRole("group", { name: "常驻工作工具", exact: true })
          .getByRole("button", { name: "文件浏览器", exact: true });
        await expect(files.locator("svg")).toBeVisible();
        await activate(page, files);
      }
      const files = page.getByRole("region", {
        name: "会话文件管理",
        exact: true,
      });
      await expect(files).toBeVisible();
      await files.evaluate((element) => {
        (element as HTMLElement).dataset.fixtureInstance =
          "retained-file-panel";
      });
      // This is FilesPanel's component-local toggle, rather than a store value.
      // A remount on close would reset it at either viewport width.
      const treeToggle = files.getByRole("button", {
        name: width === 393 ? "显示文件树" : "隐藏文件树",
        exact: true,
      });
      await expect(treeToggle.locator("svg")).toBeVisible();
      await activate(page, treeToggle);
      const toggleLabel = width === 393 ? "隐藏文件树" : "显示文件树";
      const retainedTreeToggle = files.locator(
        `button[aria-label="${toggleLabel}"][aria-expanded]`,
      );
      await expect(retainedTreeToggle).toHaveAttribute(
        "aria-expanded",
        width === 393 ? "true" : "false",
      );
      if (width === 393) {
        await activate(
          page,
          page.getByRole("button", { name: "返回会话", exact: true }),
        );
      } else
        await activate(
          page,
          page.getByRole("button", { name: "收起右侧面板", exact: true }),
        );
      await expect(files).toBeHidden();
      await expectInput(page, "ux-0", originalDraft);
      if (width === 393) {
        await openMainMenu(page);
        await activate(
          page,
          page.getByRole("menuitem", { name: "文件浏览器", exact: true }),
        );
      } else
        await activate(
          page,
          page.getByRole("button", { name: "展开右侧面板", exact: true }),
        );
      await expect(files).toBeVisible();
      await expect(files).toHaveAttribute(
        "data-fixture-instance",
        "retained-file-panel",
      );
      await expect(retainedTreeToggle).toHaveAttribute(
        "aria-expanded",
        width === 393 ? "true" : "false",
      );
      await page.screenshot({
        path: info.outputPath("reopened-file-panel.png"),
        fullPage: true,
      });
      if (width === 393)
        await activate(
          page,
          page.getByRole("button", { name: "返回会话", exact: true }),
        );
      else
        await activate(
          page,
          page.getByRole("button", { name: "收起右侧面板", exact: true }),
        );
      await expectInput(page, "ux-0", originalDraft);
      await editor(page).press("End");
      await editor(page).press("x");
      await expectInput(page, "ux-0", originalDraft + "x");
      for (const path of [
        "/src/session-mode/components/layout/AppSidebar.tsx",
        "/src/session-mode/components/layout/RightPanel.tsx",
        "/src/session-mode/features/files/FilesPanel.tsx",
      ])
        expect(modules.has(path), `actual UI must acquire ${path}`).toBe(true);
      const state = await inputSnapshot(page);
      expect(state).toMatchObject({
        cardId: "ux-0",
        cardKind: "codex",
        threadId: "ux-0",
      });
      expect(mutationCalls(fixture.calls)).toEqual([]);
      expect(errors).toEqual([]);
      await writeFile(
        info.outputPath("panels.json"),
        JSON.stringify(
          {
            width,
            state,
            modules: [...modules].sort(),
            localPanelStateRetained: true,
            mutationCalls: mutationCalls(fixture.calls),
            errors,
          },
          null,
          2,
        ),
      );
    });
  });
}
