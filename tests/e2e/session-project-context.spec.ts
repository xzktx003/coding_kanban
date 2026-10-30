import { expect, test } from "@playwright/test";
import {
  chooseSessionLayout,
  installSessionUxFixture,
  seedSessionUx,
} from "./session-ux-fixture";

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  const geometry = await page
    .locator(".session-top-nav")
    .evaluate((nav) => {
      const shape = (el: Element) => {
        const box = el.getBoundingClientRect(),
          style = getComputedStyle(el);
        return {
          tag: el.tagName,
          className: el.className,
          label: el.getAttribute("aria-label"),
          x: box.x,
          width: box.width,
          display: style.display,
          minWidth: style.minWidth,
          flexShrink: style.flexShrink,
          overflow: style.overflow,
          fontSize: style.fontSize,
        };
      };
      return {
        viewport: innerWidth,
        nav: shape(nav),
        children: [...nav.children].map(shape),
        modeButtons: [...nav.querySelectorAll(".mode-switch-label")].map(shape),
      };
    })
    .catch(() => null);
  console.info("navigation-geometry", JSON.stringify(geometry));
  await testInfo.attach("navigation-geometry", {
    body: JSON.stringify(geometry),
    contentType: "application/json",
  });
});

test("every layout owns its project, details never select, order and drafts survive", async ({
  page,
}) => {
  test.setTimeout(120000);
  const fixture = await installSessionUxFixture(page, 4);
  const paths = ["/company/api", "/research/api", "/work/kanban", undefined];
  fixture.threads.forEach((t, i) => {
    if (paths[i]) t.cwd = paths[i]!;
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/?mode=session");
  await page.locator(".session-mode [contenteditable=true]").first().waitFor();
  await seedSessionUx(page, 4);
  await page.evaluate(async (paths) => {
    const load = async (path: string) =>
      import(
        performance
          .getEntriesByType("resource")
          .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
      );
    const { useAgentCenterStore } = await load(
      "/src/session-mode/stores/useAgentCenterStore.ts",
    );
    for (let i = 0; i < 4; i++)
      useAgentCenterStore.getState().addAgentCard({
        kind: "codex",
        id: `ux-${i}`,
        preview: `会话 ${i}`,
        cwd: paths[i],
        ...(i === 2 ? { worktreePath: "/trees/fix-login" } : {}),
      });
  }, paths);
  await page.locator('[data-tab-key="codex:ux-0"]').click();
  const editor = page.locator(".session-agent-view [contenteditable=true]");
  await editor.fill("项目 A 的草稿");
  const target = page.locator(".session-codex-composer");
  await expect(target).toHaveAttribute("data-owner-thread", "ux-0");
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const resource = performance
          .getEntriesByType("resource")
          .findLast(
            (entry) =>
              new URL(entry.name).pathname ===
              "/src/session-mode/stores/useWorkspaceStore.ts",
          );
        const { useWorkspaceStore } = await import(
          resource?.name ?? "/src/session-mode/stores/useWorkspaceStore.ts"
        );
        return useWorkspaceStore.getState().cwd;
      }),
    )
    .toBe("/company/api");
  expect(
    await target.evaluate(
      (el) =>
        !!el.querySelector(".session-composer-surface [contenteditable=true]"),
    ),
  ).toBe(true);
  for (const label of [
    "company/api",
    "research/api",
    "kanban · fix-login",
    "项目未知",
  ])
    await expect(
      page.getByRole("button", { name: `项目详情：${label}`, exact: true }),
    ).toBeVisible();
  await expect(
    page.locator(".session-agent-header,.session-project-context"),
  ).toHaveCount(0);
  const second = page.getByRole("button", {
    name: "项目详情：research/api",
    exact: true,
  });
  await second.click();
  await expect(page.getByText("/research/api", { exact: true })).toBeVisible();
  await expect(target).toHaveAttribute("data-owner-thread", "ux-0");
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const resource = performance
          .getEntriesByType("resource")
          .findLast(
            (entry) =>
              new URL(entry.name).pathname ===
              "/src/session-mode/stores/useWorkspaceStore.ts",
          );
        const { useWorkspaceStore } = await import(
          resource?.name ?? "/src/session-mode/stores/useWorkspaceStore.ts"
        );
        return useWorkspaceStore.getState().cwd;
      }),
    )
    .toBe("/company/api");
  await expect(editor).toHaveText("项目 A 的草稿");
  await page.keyboard.press("Escape");
  await page.screenshot({
    path: ".dev-runtime/project-context-v2/tabs.png",
    animations: "disabled",
  });
  for (const [layout, file] of [
    ["多会话网格", "grid"],
    ["会话列表", "list"],
  ] as const) {
    await chooseSessionLayout(page, layout);
    await expect(page.getByRole("tablist", { name: "关注会话" })).toHaveCount(
      0,
    );
    const headers = page.locator(".session-card-header");
    await expect(headers).toHaveCount(4);
    for (const label of [
      "company/api",
      "research/api",
      "kanban · fix-login",
      "项目未知",
    ])
      await expect(
        headers.getByRole("button", {
          name: `项目详情：${label}`,
          exact: true,
        }),
      ).toBeVisible();
    expect((await headers.first().boundingBox())!.height).toBe(48);
    await headers
      .getByRole("button", { name: "项目详情：research/api", exact: true })
      .click();
    await expect(target).toHaveAttribute("data-owner-thread", "ux-0");
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const resource = performance
            .getEntriesByType("resource")
            .findLast(
              (entry) =>
                new URL(entry.name).pathname ===
                "/src/session-mode/stores/useWorkspaceStore.ts",
            );
          const { useWorkspaceStore } = await import(
            resource?.name ?? "/src/session-mode/stores/useWorkspaceStore.ts"
          );
          return useWorkspaceStore.getState().cwd;
        }),
      )
      .toBe("/company/api");
    await page.keyboard.press("Escape");
    await page.screenshot({
      path: `.dev-runtime/project-context-v2/${file}.png`,
      animations: "disabled",
    });
  }
  const cards = page.locator("[data-session-card]");
  await cards
    .nth(1)
    .getByRole("button", { name: /^排列会话：/ })
    .click();
  await page.getByRole("menuitem", { name: "向前移动" }).click();
  await expect(cards.first()).toHaveAttribute("data-session-card", "ux-1");
  await expect(target).toHaveAttribute("data-owner-thread", "ux-0");
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const resource = performance
          .getEntriesByType("resource")
          .findLast(
            (entry) =>
              new URL(entry.name).pathname ===
              "/src/session-mode/stores/useWorkspaceStore.ts",
          );
        const { useWorkspaceStore } = await import(
          resource?.name ?? "/src/session-mode/stores/useWorkspaceStore.ts"
        );
        return useWorkspaceStore.getState().cwd;
      }),
    )
    .toBe("/company/api");
  await chooseSessionLayout(page, "自由分屏");
  await expect(page.getByRole("tab").first()).toHaveAttribute(
    "data-tab-key",
    "codex:ux-1",
  );
  await expect(editor).toHaveText("项目 A 的草稿");
  await page.locator('[data-tab-key="codex:ux-1"]').click();
  await expect(editor).toBeEmpty();
  await editor.fill("项目 B 的草稿");
  await page.locator('[data-tab-key="codex:ux-0"]').click();
  await expect(editor).toHaveText("项目 A 的草稿");
  await page.getByRole("button", { name: "切换为浅色模式" }).click();
  await expect(page.locator(".session-mode")).toHaveClass(/light/);
  await page.screenshot({
    path: ".dev-runtime/project-context-v2/light.png",
    animations: "disabled",
  });
  for (const width of [768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(
      page.locator(".session-window-group > .session-tabs"),
    ).toHaveCSS("height", "48px");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    const controls = [
      page.locator(".session-global-projects"),
      page.getByRole("button", { name: "更多功能", exact: true }),
    ];
    if (width >= 768)
      controls.push(
        page.getByRole("button", { name: "切换为深色模式", exact: true }),
      );
    for (const control of controls) {
      await expect
        .poll(async () => {
          const bounds = await control.boundingBox();
          return !!bounds && bounds.x >= 0 && bounds.x + bounds.width <= width;
        })
        .toBe(true);
    }
    if (width < 768) {
      await page
        .getByRole("button", { name: "展开项目列表", exact: true })
        .click();
      await expect(
        page.getByRole("dialog", { name: "项目与会话列表" }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("button", { name: "展开项目列表", exact: true }),
      ).toBeFocused();
    }
    await page.screenshot({
      path: `.dev-runtime/project-context-v2/width-${width}.png`,
      animations: "disabled",
    });
  }
  expect(
    fixture.calls.filter((c) =>
      /interrupt|\/stop$|\/turn\/start$|\/followups\/submit$|\/thread\/start$/.test(
        c.path,
      ),
    ),
  ).toEqual([]);
  expect(errors).toEqual([]);
});

test("phone grid and list keep global controls reachable and can create a draft", async ({
  page,
}) => {
  test.setTimeout(60000);
  const fixture = await installSessionUxFixture(page, 2);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?mode=session");
  await page.locator(".session-mode [contenteditable=true]").first().waitFor();
  await seedSessionUx(page, 2);
  for (const i of [0, 1])
    await page
      .locator(".session-nav-row[role=button]")
      .filter({ hasText: `中文会话 ${i} ` })
      .first()
      .click();
  const editor = page.locator(".session-agent-view [contenteditable=true]");
  await editor.fill("保留当前会话草稿");
  for (const mode of ["多会话网格", "会话列表"]) {
    await chooseSessionLayout(page, mode);
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.getByRole("tablist", { name: "关注会话" })).toHaveCount(
        0,
      );
      await expect(
        page.locator(".session-card-header .session-identity-project"),
      ).toHaveCount(2);
      for (const name of ["展开项目列表", "更多功能"]) {
        // The viewport acknowledgement precedes React's responsive branch.
        // Wait for the actual control geometry without relaxing the bound.
        await expect
          .poll(async () => {
            const box = await page
              .getByRole("button", { name, exact: true })
              .boundingBox();
            return box ? box.x + box.width : Infinity;
          })
          .toBeLessThanOrEqual(width);
      }
      await page.getByRole("button", { name: "更多功能", exact: true }).click();
      const theme = page.getByRole("menuitem", { name: /切换为.*色模式/ });
      await expect(theme).toBeInViewport();
      const nextTheme = (await theme.textContent())!.includes("浅色")
        ? "light"
        : "dark";
      await theme.click();
      await expect(page.locator(".session-mode")).toHaveClass(
        new RegExp(`\\b${nextTheme}\\b`),
      );
      await expect(editor).toHaveText("保留当前会话草稿");
    }
  }
  await page.getByRole("button", { name: "更多功能", exact: true }).click();
  await page.getByRole("menuitem", { name: "新聊天", exact: true }).click();
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(editor).toBeEmpty();
  await expect(page.locator(".session-codex-composer")).toHaveCount(1);
  await expect(page.locator(".session-codex-composer")).not.toHaveAttribute("data-owner-thread", /.+/);
  await page.getByRole("button", { name: "展开项目列表", exact: true }).click();
  await page
    .getByRole("dialog", { name: "项目与会话列表" })
    .locator(".session-nav-row[role=button]")
    .filter({ hasText: "中文会话 1 " })
    .first()
    .click();
  await expect(editor).toHaveText("保留当前会话草稿");
  expect(
    fixture.calls.filter((c) =>
      /interrupt|\/stop$|\/turn\/start$|\/followups\/submit$|\/thread\/start$/.test(
        c.path,
      ),
    ),
  ).toEqual([]);
});
