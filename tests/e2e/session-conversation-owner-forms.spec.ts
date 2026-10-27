import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";
const output =
  ".dev-runtime/session-conversation-owner-audit-20261027/acceptance";
async function prepare(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const fixture = await installSessionUxFixture(page, 2);
  fixture.threads.forEach((t, i) => {
    t.cwd = i ? "/fixture/project-b" : "/fixture/project-a";
    t.name = i ? "Owner B" : "Owner A";
  });
  const mutations: Array<{ path: string; body: unknown }> = [];
  await page.route(
    /\/api\/(codex\/thread\/(archive|delete)|git\/(create-branch|commit))$/,
    async (route) => {
      mutations.push({
        path: new URL(route.request().url()).pathname,
        body: route.request().postDataJSON(),
      });
      await route.fulfill({ json: {} });
    },
  );
  await page.route("**/api/git/branch-info", async (route) => {
    const body = route.request().postDataJSON(),
      id = body.cwd.endsWith("b") ? "b" : "a";
    await route.fulfill({
      json: {
        owner: "fixture-" + id,
        repo: "project-" + id,
        branch: "branch-" + id,
        isDetached: false,
      },
    });
  });
  await page.goto("/?mode=session&view=agent");
  await page
    .locator(".session-codex-composer [contenteditable=true]")
    .first()
    .waitFor();
  await seedSessionUx(page, 2);
  await page.evaluate(async () => {
    const load = (p: string) =>
      import(
        performance
          .getEntriesByType("resource")
          .findLast((e) => new URL(e.name).pathname === p)?.name ?? p
      );
    const [
      { useCodexStore: c },
      { useAgentCenterStore: a },
      { useLayoutStore: l },
      { useSessionDraftStore: d, sessionDraftKey: k },
    ] = await Promise.all([
      load("/src/session-mode/components/codex/stores/useCodexStore.ts"),
      load("/src/session-mode/stores/useAgentCenterStore.ts"),
      load("/src/session-mode/stores/useLayoutStore.ts"),
      load("/src/session-mode/stores/useSessionDraftStore.ts"),
    ]);
    c.setState((s: any) => ({
      threads: s.threads.map((t: any) => ({
        ...t,
        cwd: t.id === "ux-0" ? "/fixture/project-a" : "/fixture/project-b",
      })),
    }));
    a.getState().addAgentCard(
      {
        kind: "codex",
        id: "ux-0",
        cwd: "/fixture/project-a",
        preview: "Owner A",
      },
      { activate: true },
    );
    a.getState().addAgentCard(
      {
        kind: "codex",
        id: "ux-1",
        cwd: "/fixture/project-b",
        preview: "Owner B",
      },
      { activate: false },
    );
    a.setState({ cardsViewMode: "solo" });
    l.setState({
      view: "settings",
      isSidebarOpen: false,
      isRightPanelOpen: false,
    });
    d.getState().setText(k("codex", "ux-0"), "DRAFT-A");
    d.getState().setText(k("codex", "ux-1"), "DRAFT-B");
  });
  await page.getByRole("button", { name: "返回会话", exact: true }).waitFor();
  return { fixture, mutations, errors };
}
async function activate(page: Page, locator: Locator) {
  if (page.viewportSize()?.width === 390) await locator.tap();
  else await locator.click();
}
async function choose(page: Page, name: string) {
  await activate(
    page,
    page.getByRole("button", { name: "当前会话的更多操作", exact: true }),
  );
  await activate(page, page.getByRole("menuitem", { name, exact: true }));
}
async function selectViaAction(page: Page, id: string) {
  await page.evaluate(async (id) => {
    const load = (p: string) =>
      import(
        performance
          .getEntriesByType("resource")
          .findLast((e) => new URL(e.name).pathname === p)?.name ?? p
      );
    const [{ sessionTabSelect }, { useAgentCenterStore }] = await Promise.all([
      load("/src/session-mode/stores/sessionTabSelect.ts"),
      load("/src/session-mode/stores/useAgentCenterStore.ts"),
    ]);
    await sessionTabSelect(
      useAgentCenterStore.getState().cards.find((c: any) => c.id === id),
    );
  }, id);
}
async function drafts(page: Page) {
  return page.evaluate(async () => {
    const p = "/src/session-mode/stores/useSessionDraftStore.ts";
    const { useSessionDraftStore: d, sessionDraftKey: k } = await import(
      performance
        .getEntriesByType("resource")
        .findLast((e) => new URL(e.name).pathname === p)?.name ?? p
    );
    return {
      a: d.getState().drafts[k("codex", "ux-0")]?.text,
      b: d.getState().drafts[k("codex", "ux-1")]?.text,
    };
  });
}
async function assertPullRequestFormLayout(page: Page) {
  const layout = await page.locator(".session-pr-form").evaluate((form) => {
    const title = form.querySelector<HTMLInputElement>("[aria-label='PR 标题']");
    const body = form.querySelector<HTMLTextAreaElement>("[aria-label='PR 描述']");
    const submit = form.querySelector<HTMLAnchorElement>(".session-pr-form-submit");
    const titleField = title?.closest("label");
    const bodyField = body?.closest("label");
    const titleLabel = titleField?.querySelector("span");
    const bodyLabel = bodyField?.querySelector("span");
    if (!title || !body || !submit || !titleField || !bodyField || !titleLabel || !bodyLabel)
      throw new Error("PR form fields are missing their visible labels or action");
    const rect = (element: Element) => {
      const box = element.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom, width: box.width, height: box.height };
    };
    const sheetBody = form.closest(".session-composer-sheet-body");
    return {
      title: rect(title),
      titleLabel: rect(titleLabel),
      body: rect(body),
      bodyLabel: rect(bodyLabel),
      submit: rect(submit),
      formClientWidth: form.clientWidth,
      formScrollWidth: form.scrollWidth,
      sheetClientWidth: sheetBody?.clientWidth ?? 0,
      sheetScrollWidth: sheetBody?.scrollWidth ?? 0,
    };
  });

  expect(layout.title.height).toBeGreaterThanOrEqual(44);
  expect(layout.body.height).toBeGreaterThanOrEqual(112);
  expect(layout.submit.height).toBeGreaterThanOrEqual(44);
  expect(layout.titleLabel.bottom).toBeLessThanOrEqual(layout.title.top);
  expect(layout.bodyLabel.bottom).toBeLessThanOrEqual(layout.body.top);
  expect(layout.title.width).toBeGreaterThan(0);
  expect(layout.body.width).toBeGreaterThan(0);
  expect(layout.formScrollWidth).toBeLessThanOrEqual(layout.formClientWidth + 1);
  expect(layout.sheetScrollWidth).toBeLessThanOrEqual(layout.sheetClientWidth + 1);
}
for (const width of [390, 1440])
  test.describe(`${width}px owner forms`, () => {
    test.use({
      viewport: { width, height: 900 },
      hasTouch: width === 390,
      isMobile: width === 390,
    });
    test("notes remain isolated through actual menus and owner-key remounts", async ({
      page,
    }) => {
      test.setTimeout(60000);
      const { mutations, errors } = await prepare(page);
      await choose(page, "会议：记笔记");
      await page.getByLabel("会议笔记").fill("NOTE-A");
      await activate(
        page,
        page.getByRole("button", { name: "取消", exact: true }),
      );
      await choose(page, "切换聊天…");
      await activate(
        page,
        page.getByRole("option").filter({ hasText: /Owner B|中文会话 1/ }),
      );
      // Regression: the previous implementation leaves body pointer-events:none here.
      await expect
        .poll(() => page.evaluate(() => document.body.style.pointerEvents))
        .not.toBe("none");
      await choose(page, "会议：记笔记");
      await expect(page.getByLabel("会议笔记")).toHaveValue("");
      await page.getByLabel("会议笔记").fill("NOTE-B");
      await activate(
        page,
        page.getByRole("button", { name: "取消", exact: true }),
      );
      await choose(page, "切换聊天…");
      await activate(
        page,
        page.getByRole("option").filter({ hasText: /Owner A|中文会话 0/ }),
      );
      await choose(page, "会议：记笔记");
      await expect(page.getByLabel("会议笔记")).toHaveValue("NOTE-A");
      await expect(
        page.locator("[data-conversation-form-owner]"),
      ).toHaveAttribute("data-conversation-form-owner", "ux-0");
      await mkdir(output, { recursive: true });
      await page.screenshot({
        path: `${output}/notes-${width}.png`,
        fullPage: true,
      });
      await activate(
        page,
        page.getByRole("button", { name: "记入当前输入", exact: true }),
      );
      await expect
        .poll(() => drafts(page))
        .toEqual({ a: "DRAFT-A\nNOTE-A", b: "DRAFT-B" });
      expect(mutations).toEqual([]);
      expect(errors).toEqual([]);
      await activate(
        page,
        page.getByRole("button", { name: "返回会话", exact: true }),
      );
      await activate(
        page,
        page.getByRole("button", { name: "附加文件", exact: true }),
      );
      await choose(page, "会议：记笔记");
      await page.getByLabel("会议笔记").fill("MAIN-UNSAVED-A");
      await selectViaAction(page, "ux-1");
      await expect(page.getByLabel("会议笔记")).toHaveCount(0);
      await selectViaAction(page, "ux-0");
      await activate(
        page,
        page.getByRole("button", { name: "附加文件", exact: true }),
      );
      await choose(page, "会议：记笔记");
      await expect(page.getByLabel("会议笔记")).toHaveValue("MAIN-UNSAVED-A");
    });
    for (const kind of ["archive", "delete", "branch", "commit", "pr"] as const)
      test(`${kind} retains the opening target across production selection`, async ({
        page,
      }) => {
        const { mutations, errors } = await prepare(page);
        const names = {
          archive: "归档聊天",
          delete: "删除聊天",
          branch: "创建分支",
          commit: "提交或推送",
          pr: "创建 PR",
        };
        await choose(page, names[kind]);
        if (kind === "branch")
          await page.getByLabel("分支名称").fill("branch-for-a");
        if (kind === "commit") {
          await activate(
            page,
            page.getByRole("button", { name: "提交更改", exact: true }),
          );
          await page.getByLabel("Git 提交说明").fill("COMMIT-A");
        }
        if (kind === "pr") {
          await page.getByLabel("PR 标题").fill("TITLE-A");
          await page.getByLabel("PR 描述").fill("BODY-A");
          await assertPullRequestFormLayout(page);
        }
        await selectViaAction(page, "ux-1");
        await expect(
          page.locator("[data-conversation-form-owner]"),
        ).toHaveAttribute("data-conversation-form-owner", "ux-0");
        await mkdir(output, { recursive: true });
        await page.screenshot({
          path: `${output}/${kind}-${width}.png`,
          fullPage: true,
        });
        if (kind === "pr") {
          await expect(page.getByLabel("PR 标题")).toHaveValue("TITLE-A");
          await expect(
            page.getByRole("link", { name: "在 GitHub 上创建 PR" }),
          ).toHaveAttribute(
            "href",
            /fixture-a\/project-a\/compare\/branch-a\?/,
          );
          expect(mutations).toEqual([]);
          expect(errors).toEqual([]);
        } else {
          await activate(
            page,
            page.getByRole("dialog").getByRole("button", {
              name:
                kind === "archive"
                  ? "确认归档"
                  : kind === "delete"
                    ? "删除"
                    : kind === "branch"
                      ? "创建并检出"
                      : "提交更改",
              exact: true,
            }),
          );
          await expect.poll(() => mutations.length).toBe(1);
          expect(mutations[0].body).toEqual(
            kind === "archive" || kind === "delete"
              ? { threadId: "ux-0" }
              : kind === "branch"
                ? { cwd: "/fixture/project-a", branch: "branch-for-a" }
                : { cwd: "/fixture/project-a", message: "COMMIT-A" },
          );
        }
        expect(errors).toEqual([]);
        await mkdir(output, { recursive: true });
        await writeFile(
          `${output}/${kind}-${width}.json`,
          JSON.stringify(
            { width, kind, mutations, errors, drafts: await drafts(page) },
            null,
            2,
          ),
        );
      });
    test("light theme keeps PR fields readable without overflow", async ({
      page,
    }) => {
      const { mutations, errors } = await prepare(page);
      await activate(page, page.getByRole("tab", { name: "亮色", exact: true }));
      await choose(page, "创建 PR");
      await page.getByLabel("PR 标题").fill("LIGHT-TITLE");
      await page.getByLabel("PR 描述").fill("LIGHT-BODY");
      await assertPullRequestFormLayout(page);
      await mkdir(output, { recursive: true });
      await page.screenshot({
        path: `${output}/pr-light-${width}.png`,
        fullPage: true,
      });
      expect(mutations).toEqual([]);
      expect(errors).toEqual([]);
    });
  });
