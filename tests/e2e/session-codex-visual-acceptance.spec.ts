import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

const cwd = "/fixture/项目/very-long-project-path-for-ui-regression";
const profiles = [
  { name: "desktop", width: 1440, height: 1000, touch: false },
  { name: "narrow-pane", width: 768, height: 900, touch: false },
  { name: "small-pane", width: 480, height: 900, touch: false },
  { name: "phone", width: 390, height: 844, touch: true },
  { name: "phone-landscape", width: 844, height: 390, touch: true },
  // This is a reduced viewport check, not a physical OS keyboard claim.
  { name: "reduced-viewport", width: 390, height: 420, touch: true },
];

const item = (id: string, type: string, fields: object) => ({
  method: "item/completed",
  params: {
    threadId: "ux-0",
    turnId: "visual-turn",
    item: { id, type, ...fields },
  },
});
const events = [
  item("user", "userMessage", {
    content: [
      {
        type: "text",
        text: "请检查完整会话的字体、间距、代码与文件变更，保留当前草稿。",
        text_elements: [],
      },
    ],
    clientId: null,
  }),
  item("intro", "agentMessage", {
    text: "我会检查界面的排版与交互，并分别验证手机和桌面。\n\n真实消息保持原顺序，所有操作固定在自己的会话。",
    phase: "commentary",
    memoryCitation: null,
  }),
  item("read", "commandExecution", {
    command: "cat source.ts",
    cwd,
    commandActions: [
      {
        type: "read",
        command: "cat source.ts",
        name: "source.ts",
        path: `${cwd}/source.ts`,
      },
    ],
    status: "completed",
    exitCode: 0,
    durationMs: 5,
    aggregatedOutput: "source",
  }),
  item("check", "commandExecution", {
    command: "pnpm check",
    cwd,
    commandActions: [],
    status: "completed",
    exitCode: 0,
    durationMs: 1200,
    aggregatedOutput: "共享类型检查通过\n前后端构建通过",
  }),
  item("patch", "fileChange", {
    status: "completed",
    changes: [
      {
        path: `${cwd}/source.ts`,
        kind: { type: "update", move_path: null },
        diff: "@@ -42,3 +42,3 @@\n export function add(a: number, b: number) {\n-  return a - b;\n+  return a + b;\n }\n",
      },
    ],
  }),
  item("assistant", "agentMessage", {
    text: "检查完成。会话正文、代码和文件变更沿用相同的视觉标准。\n\n- 保留标签、分屏和独立输入区。\n- 切换会话时保留阅读位置与草稿。\n\n```typescript\nexport function add(a: number, b: number) {\n  return a + b;\n}\n```\n\n| 场景 | 检查内容 |\n| --- | --- |\n| 桌面 | 字体、行距与菜单 |\n| 手机 | 触控、换行与空间 |\n\n文件修改采用自己的路径 [source.ts:42](/fixture/项目/very-long-project-path-for-ui-regression/source.ts:42)，公式 \\(a+b=c\\) 保持可读。",
    phase: "final_answer",
    memoryCitation: null,
  }),
  {
    method: "turn/completed",
    params: {
      threadId: "ux-0",
      turn: {
        id: "visual-turn",
        status: "completed",
        items: [],
        startedAt: 1,
        durationMs: 2000,
        error: null,
      },
    },
  },
];

for (const profile of profiles) {
  test.describe(profile.name, () => {
    test.use({
      hasTouch: profile.touch,
      isMobile: profile.touch,
      viewport: { width: profile.width, height: profile.height },
    });
    for (const theme of ["dark", "light"]) {
      test(`complete Codex workbench remains readable and controls reachable (${theme})`, async ({
        page,
        browserName,
      }, info) => {
        test.setTimeout(90000);
        const errors: string[] = [];
        page.on("pageerror", (error) =>
          errors.push(error.stack ?? error.message),
        );
        const fixture = await installSessionUxFixture(page, 2);
        await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
        const composer = page.locator(".session-codex-composer").first();
        await composer
          .locator("[contenteditable=true]")
          .first()
          .waitFor({ timeout: 60000 });
        await seedSessionUx(page, 2);
        await page.evaluate(
          async ({ theme, events }) => {
            const module = (path: string) =>
              import(
                performance
                  .getEntriesByType("resource")
                  .findLast((e) => new URL(e.name).pathname === path)?.name ??
                  path
              );
            const [
              { useCodexStore },
              { useAgentCenterStore },
              { useLayoutStore },
              { useThemeStore },
            ] = await Promise.all([
              module("/src/session-mode/components/codex/stores/index.ts"),
              module("/src/session-mode/stores/useAgentCenterStore.ts"),
              module("/src/session-mode/stores/useLayoutStore.ts"),
              module("/src/session-mode/stores/settings/useThemeStore.ts"),
            ]);
            useThemeStore.getState().setTheme(theme);
            useLayoutStore.setState({
              view: "agent",
              isSidebarOpen: false,
              isRightPanelOpen: false,
            });
            useAgentCenterStore.getState().addAgentCard(
              {
                kind: "codex",
                id: "ux-0",
                cwd: "/fixture/项目/very-long-project-path-for-ui-regression",
                preview: "完整排版验收",
              },
              { activate: true },
            );
            useAgentCenterStore.setState({ cardsViewMode: "solo" });
            useCodexStore.setState({
              events: { "ux-0": events },
              historyLoadedMap: { "ux-0": true },
              historyLoadingMap: {},
              currentThreadId: "ux-0",
              threadStatusMap: { "ux-0": { type: "idle" } },
              currentTurnId: null,
            });
          },
          { theme, events },
        );
        await expect(page.locator(".codex-assistant").last()).toContainText(
          "检查完成",
        );
        await expect(
          page.locator('[data-streamdown="code-block"] pre').last(),
        ).toContainText("return a + b", { timeout: 30000 });
        await page
          .locator(".codex-native-code-fence .hljs-keyword")
          .last()
          .waitFor();
        await writeFile(
          info.outputPath("theme-diagnostics.json"),
          JSON.stringify(
            await page
              .locator('[data-streamdown="code-block"] pre')
              .last()
              .evaluate((el) => {
                const ancestors: Array<{
                  tag: string;
                  class: string;
                  background: string;
                }> = [];
                for (
                  let parent: Element | null = el;
                  parent;
                  parent = parent.parentElement
                )
                  ancestors.push({
                    tag: parent.tagName,
                    class: parent.className,
                    background: getComputedStyle(parent).backgroundColor,
                  });
                return {
                  style: el.getAttribute("style"),
                  shiki:
                    getComputedStyle(el).getPropertyValue("--shiki-dark-bg"),
                  sdm: getComputedStyle(el).getPropertyValue("--sdm-bg"),
                  ancestors,
                };
              }),
            null,
            2,
          ),
        );
        await expect(page.locator(".codex-native-code-fence").last()).toHaveCSS(
          "background-color",
          theme === "dark" ? "rgb(32, 33, 29)" : "rgb(255, 255, 255)",
        );
        await expect(
          page.locator('[data-streamdown="code-block"] pre').last(),
        ).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
        const fonts: Record<string, unknown> = {};
        if (browserName === "chromium") {
          const cdp = await page.context().newCDPSession(page);
          await cdp.send("DOM.enable");
          await cdp.send("CSS.enable");
          const documentNode = await cdp.send("DOM.getDocument");
          for (const [name, selector] of Object.entries({
            paragraph: ".codex-assistant .codex-paragraph",
            composer: ".session-codex-composer [contenteditable=true]",
            code: '[data-streamdown="code-block"] pre',
          })) {
            const node = await cdp.send("DOM.querySelector", {
              nodeId: documentNode.root.nodeId,
              selector,
            });
            if (node.nodeId)
              fonts[name] = (
                await cdp.send("CSS.getPlatformFontsForNode", {
                  nodeId: node.nodeId,
                })
              ).fonts;
          }
          await cdp.detach();
        } else {
          fonts.evidenceUnavailable = `${browserName} does not expose Chromium CDP platform-font inspection; geometry and computed typography remain checked below`;
        }
        await writeFile(
          info.outputPath("platform-fonts.json"),
          JSON.stringify(fonts, null, 2),
        );
        await composer
          .locator("[contenteditable=true]")
          .first()
          .fill("当前会话草稿");
        await page.mouse.move(0, 0);
        await page.screenshot({
          path: info.outputPath(`workbench-${profile.name}-${theme}.png`),
          fullPage: true,
        });
        const metrics = await composer.evaluate((el) => {
          const rect = (node: Element) => {
            const b = node.getBoundingClientRect(),
              s = getComputedStyle(node);
            return {
              x: b.x,
              y: b.y,
              w: b.width,
              h: b.height,
              font: s.font,
              line: s.lineHeight,
              color: s.color,
              background: s.backgroundColor,
              padding: s.padding,
            };
          };
          return {
            viewport: { width: innerWidth, height: innerHeight },
            pageScrollWidth: document.documentElement.scrollWidth,
            frame: rect(el.querySelector(".session-compact-frame")!),
            context: rect(el.querySelector(".session-compact-meta")!),
            toolbar: rect(el.querySelector(".session-composer-toolbar")!),
            editor: rect(el.querySelector("[contenteditable=true]")!),
            transcript: rect(
              document.querySelector(".codex-transcript-surface")!,
            ),
            typography: [
              ...document.querySelectorAll(
                ".codex-assistant .codex-paragraph,.codex-markdown td,.codex-markdown pre,.codex-presentation",
              ),
            ]
              .slice(0, 10)
              .map((node) => ({
                class: node.className,
                text: node.textContent?.slice(0, 45),
                ...rect(node),
              })),
            controls: [...el.querySelectorAll("button")]
              .filter((node) => node.getBoundingClientRect().width > 0)
              .map((node) => {
                const b = node.getBoundingClientRect();
                const hit = document.elementFromPoint(
                  b.x + b.width / 2,
                  b.y + b.height / 2,
                );
                return {
                  name: node.ariaLabel,
                  ...rect(node),
                  hit: !!hit && (hit === node || node.contains(hit)),
                };
              }),
          };
        });
        await info.attach("workbench-metrics.json", {
          contentType: "application/json",
          body: JSON.stringify(metrics, null, 2),
        });
        await writeFile(
          info.outputPath("workbench-metrics.json"),
          JSON.stringify(metrics, null, 2),
        );
        // Pure horizontal scrolling is limited to native table/code bodies, never the workbench.
        expect(metrics.pageScrollWidth).toBeLessThanOrEqual(profile.width);
        expect(metrics.frame.y + metrics.frame.h).toBeLessThanOrEqual(
          profile.height + 1,
        );
        if (metrics.frame.w <= 840) {
          expect(
            metrics.context.y + metrics.context.h,
            "narrow composer context stays above the frame without crowding its controls",
          ).toBeLessThanOrEqual(metrics.frame.y);
        }
        const sidebarGutter = await page.evaluate(() => {
          const handle = document.querySelector(".session-sidebar-edge");
          const header = document.querySelector(".codex-markdown th");
          if (!handle || !header || !handle.getBoundingClientRect().width)
            return null;
          const walker = document.createTreeWalker(
            header,
            NodeFilter.SHOW_TEXT,
          );
          let text = walker.nextNode();
          while (text && !text.textContent?.trim()) text = walker.nextNode();
          if (!text) throw new Error("expected a real table header glyph");
          const range = document.createRange();
          range.setStart(text, 0);
          range.setEnd(text, 1);
          return {
            handleRight: handle.getBoundingClientRect().right,
            glyphLeft: range.getBoundingClientRect().left,
          };
        });
        if (sidebarGutter)
          expect(
            sidebarGutter.handleRight,
            "collapsed sidebar handle remains inside the transcript gutter",
          ).toBeLessThanOrEqual(sidebarGutter.glyphLeft);
        for (const control of metrics.controls.filter(
          (control) =>
            control.name &&
            /发送消息|当前 Agent|Agent 与模型|执行权限|展开编辑|输入状态/.test(
              control.name,
            ),
        )) {
          expect(control.x, control.name!).toBeGreaterThanOrEqual(0);
          expect(control.x + control.w, control.name!).toBeLessThanOrEqual(
            profile.width + 1,
          );
          expect(control.y, control.name!).toBeGreaterThanOrEqual(0);
          expect(control.y + control.h, control.name!).toBeLessThanOrEqual(
            profile.height + 1,
          );
          expect(control.hit, control.name!).toBe(true);
        }
        // Capture actual source model and permission overlays in the complete workbench.
        await composer.getByRole("button", { name: /^Agent 与模型：/ }).click();
        const modelMenu = page.locator(".session-native-model-menu");
        await expect(modelMenu).toBeVisible();
        await page.screenshot({
          path: info.outputPath(`model-${profile.name}-${theme}.png`),
          fullPage: true,
        });
        const modelBox = await modelMenu.boundingBox();
        expect(modelBox!.y).toBeGreaterThanOrEqual(0);
        expect(modelBox!.y + modelBox!.height).toBeLessThanOrEqual(
          profile.height + 1,
        );
        await modelMenu.press("Escape");
        await composer.getByRole("button", { name: /^执行权限：/ }).click();
        const permissions = page.locator(".session-native-permission-menu");
        await expect(permissions).toBeVisible();
        await page.screenshot({
          path: info.outputPath(`permission-${profile.name}-${theme}.png`),
          fullPage: true,
        });
        const permissionBox = await permissions.boundingBox();
        expect(permissionBox!.y).toBeGreaterThanOrEqual(0);
        expect(permissionBox!.y + permissionBox!.height).toBeLessThanOrEqual(
          profile.height + 1,
        );
        expect(errors).toEqual([]);
        expect(
          fixture.calls.filter((call) =>
            /turn\/(start|steer)|approval\/reply|thread\/rollback/.test(
              call.path,
            ),
          ),
        ).toEqual([]);
      });
    }
  });
}
