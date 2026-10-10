import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

const cwd = "/fixture/项目/very-long-project-path-for-ui-regression";
const item = (
  id: string,
  type: string,
  fields: object,
  method = "item/completed",
) => ({
  method,
  params: {
    threadId: "ux-0",
    turnId: "spacing-turn",
    item: { id, type, ...fields },
  },
});
const assistant = (id: string, text: string) =>
  item(id, "agentMessage", { text, phase: "commentary", memoryCitation: null });
const user = item("user", "userMessage", {
  content: [
    { type: "text", text: "保留正常用户到助手间距", text_elements: [] },
  ],
  clientId: null,
});
const command = item("read", "commandExecution", {
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
});
const cases = [
  {
    name: "adjacent-assistant",
    events: [assistant("a", "第一条正文"), assistant("b", "第二条正文")],
    expectedRows: 2,
  },
  {
    name: "multi-paragraph-assistant",
    events: [
      assistant("a", "第一段正文\n\n最后一段正文"),
      assistant("b", "相邻后一条正文"),
    ],
    expectedRows: 2,
  },
  {
    name: "user-to-assistant",
    events: [user, assistant("a", "用户后的助手正文")],
    expectedRows: 2,
  },
  {
    name: "tool-to-assistant",
    events: [
      assistant("a", "工具前正文"),
      command,
      assistant("b", "工具后正文"),
    ],
    expectedRows: 3,
  },
  {
    name: "empty-reasoning",
    events: [
      assistant("a", "空思考前正文"),
      item("reason", "reasoning", { summary: [], content: [] }, "item/started"),
      item("reason", "reasoning", { summary: [], content: [] }),
      assistant("b", "空思考后正文"),
    ],
    expectedRows: 2,
  },
  {
    name: "empty-plan",
    events: [
      assistant("a", "空计划前正文"),
      item("plan", "plan", { text: "" }, "item/started"),
      item("plan", "plan", { text: "" }),
      assistant("b", "空计划后正文"),
    ],
    expectedRows: 2,
  },
  {
    name: "hidden-sleep-tool",
    events: [
      assistant("a", "隐藏工具前正文"),
      item("sleep", "sleep", { durationMs: 1 }, "item/started"),
      item("sleep", "sleep", { durationMs: 1 }),
      assistant("b", "隐藏工具后正文"),
    ],
    expectedRows: 2,
  },
  {
    name: "empty-hook-prompt",
    events: [
      assistant("a", "空hook前正文"),
      item("hook", "hookPrompt", { fragments: [] }, "item/started"),
      item("hook", "hookPrompt", { fragments: [] }),
      assistant("b", "空hook后正文"),
    ],
    expectedRows: 2,
  },
  {
    name: "public-reasoning-to-assistant",
    events: [
      item("reason", "reasoning", {
        summary: ["可公开的思考摘要"],
        content: [],
      }),
      assistant("b", "思考后正文"),
    ],
    expectedRows: 2,
  },
  {
    name: "streaming",
    events: [
      assistant("a", "流式前正文"),
      {
        method: "item/agentMessage/delta",
        params: {
          threadId: "ux-0",
          turnId: "spacing-turn",
          itemId: "b",
          delta: "流式正文\n\n流式尾段",
        },
      },
    ],
    expectedRows: 2,
  },
  {
    name: "streaming-completed",
    events: [
      assistant("a", "流式前正文"),
      {
        method: "item/agentMessage/delta",
        params: {
          threadId: "ux-0",
          turnId: "spacing-turn",
          itemId: "b",
          delta: "流式正文\n\n流式尾段",
        },
      },
      assistant("b", "完成正文\n\n完成尾段"),
    ],
    expectedRows: 2,
  },
];

for (const width of [1440, 390])
  test.describe(`message spacing ${width}`, () => {
    test.use({
      viewport: { width, height: 1000 },
      hasTouch: width === 390,
      isMobile: width === 390,
    });
    for (const theme of ["dark", "light"]) {
      test(`native message rows keep measured spacing without empty height (${theme})`, async ({
        page,
      }, info) => {
        test.setTimeout(90000);
        const errors: string[] = [];
        page.on("pageerror", (error) =>
          errors.push(error.stack ?? error.message),
        );
        const fixture = await installSessionUxFixture(page, 2);
        await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
        await page
          .locator(".session-codex-composer [contenteditable=true]")
          .first()
          .waitFor({ timeout: 60000 });
        await seedSessionUx(page, 2);
        await page.evaluate(
          async ({ theme, cwd }) => {
            const module = (path: string) =>
              import(
                performance
                  .getEntriesByType("resource")
                  .findLast((e) => new URL(e.name).pathname === path)?.name ??
                  path
              );
            const [
              { useAgentCenterStore },
              { useLayoutStore },
              { useThemeStore },
              { useSessionDraftStore, sessionDraftKey },
            ] = await Promise.all([
              module("/src/session-mode/stores/useAgentCenterStore.ts"),
              module("/src/session-mode/stores/useLayoutStore.ts"),
              module("/src/session-mode/stores/settings/useThemeStore.ts"),
              module("/src/session-mode/stores/useSessionDraftStore.ts"),
            ]);
            useThemeStore.getState().setTheme(theme);
            useLayoutStore.setState({
              view: "agent",
              isSidebarOpen: false,
              isRightPanelOpen: false,
            });
            useAgentCenterStore
              .getState()
              .addAgentCard(
                { kind: "codex", id: "ux-0", cwd, preview: "间距判别" },
                { activate: true },
              );
            useAgentCenterStore.setState({ cardsViewMode: "solo" });
            useSessionDraftStore
              .getState()
              .setText(sessionDraftKey("codex", "ux-0"), "保留间距测试原草稿");
          },
          { theme, cwd },
        );
        const native = await page.context().newPage();
        await native.goto(
          process.env.CODEX_NATIVE_REFERENCE_URL ??
            "http://10.30.0.24:43831/native-markdown.html",
        );
        await native.waitForFunction(() => (window as any).nativeLoaded);
        await native.evaluate(
          async ({ theme, width }) => {
            const S = await import(
              /* @vite-ignore */ "./native/assets/app-initial-e98b9eaef8e3.js"
            );
            const Auth = await import(
              /* @vite-ignore */ "./native/assets/app-initial-3192ac99b6cd.js"
            );
            S.v();
            S.U();
            const w = window as any,
              { React: R, Dst, zg } = w.nativeModules;
            const host =
              theme === "dark"
                ? {
                    "editor-background": "#20211d",
                    "sideBar-background": "#282a23",
                    foreground: "#ccc",
                    descriptionForeground: "#858585",
                  }
                : {
                    "editor-background": "#fff",
                    "sideBar-background": "#f5f5f3",
                    foreground: "#3b3b3b",
                    descriptionForeground: "#717171",
                  };
            for (const [key, value] of Object.entries(host))
              document.documentElement.style.setProperty(
                `--vscode-${key}`,
                value,
              );
            document.documentElement.dataset.theme = theme;
            const viewport = document.createElement("meta");
            viewport.name = "viewport";
            viewport.content = "width=device-width,initial-scale=1";
            document.head.append(viewport);
            document.getElementById("root")!.style.cssText =
              `width:${width - 34}px;padding:0`;
            w.renderNativeElement(S._, {
              children: R.createElement(
                Auth.Rpt.Provider,
                {
                  value: {
                    requiresAuth: false,
                    isLoading: false,
                    authMethod: null,
                  },
                },
                R.createElement(
                  S.H,
                  {},
                  R.createElement(
                    Dst,
                    {
                      scope: S.l1t,
                      value: {
                        conversationId: "spacing-reference",
                        hostId: "local",
                      },
                    },
                    R.createElement(
                      Dst,
                      { scope: S.W$t, value: { kind: "local" } },
                      R.createElement(zg, {
                        children: "第一段正文\n\n最后一段正文",
                      }),
                    ),
                  ),
                ),
              ),
            });
            setTimeout(
              () =>
                S.s5t.dispatchHostMessage({
                  type: "persisted-atom-sync",
                  state: {},
                  canWritePrimaryWindowTabPersistence: false,
                }),
              0,
            );
          },
          { theme, width },
        );
        await native.locator("#root p").last().waitFor();
        const nativeParagraphs = await native
          .locator("#root p")
          .evaluateAll((elements) =>
            elements.map((p) => {
              const b = p.getBoundingClientRect(),
                s = getComputedStyle(p);
              return {
                y: b.y,
                height: b.height,
                bottom: b.bottom,
                marginTop: s.marginTop,
                marginBottom: s.marginBottom,
                lineHeight: s.lineHeight,
              };
            }),
          );
        await native.screenshot({
          path: info.outputPath(`spacing-native-two-paragraphs-${theme}.png`),
          fullPage: true,
        });
        const observations: any[] = [];
        for (const scenario of cases.filter(
          (scenario) =>
            process.env.SPACING_SCOPE !== "footer" ||
            [
              "adjacent-assistant",
              "multi-paragraph-assistant",
              "user-to-assistant",
              "tool-to-assistant",
              "streaming",
              "streaming-completed",
            ].includes(scenario.name),
        )) {
          await page.evaluate(async (events) => {
            const path = "/src/session-mode/components/codex/stores/index.ts";
            const { useCodexStore } = await import(
              performance
                .getEntriesByType("resource")
                .findLast((e) => new URL(e.name).pathname === path)?.name ??
                path
            );
            useCodexStore.setState({
              events: { "ux-0": events },
              historyLoadedMap: { "ux-0": true },
              historyLoadingMap: {},
              currentThreadId: "ux-0",
              threadStatusMap: { "ux-0": { type: "idle" } },
              currentTurnId: null,
            });
          }, scenario.events);
          await expect(
            page.locator(".codex-assistant-content").last(),
          ).toContainText(
            (
              scenario.events.at(-1)?.params?.item?.text ??
              scenario.events.at(-1)?.params?.delta ??
              ""
            ).split("\n")[0],
          );
          // Collect after the browser's actual layout/RO frames, without changing scroll or sizing.
          await page.evaluate(
            () =>
              new Promise<void>((resolve) =>
                requestAnimationFrame(() =>
                  requestAnimationFrame(() => resolve()),
                ),
              ),
          );
          const rows = await page
            .locator("[data-codex-row]")
            .evaluateAll((elements) =>
              elements.map((element) => {
                const box = (e: Element) => {
                  const r = e.getBoundingClientRect();
                  return {
                    x: r.x,
                    y: r.y,
                    width: r.width,
                    height: r.height,
                    bottom: r.bottom,
                  };
                };
                const style = getComputedStyle(element);
                const children = Array.from(element.children);
                const content = element.querySelector(
                  ".codex-assistant-content,.codex-user-bubble,.codex-native-activity-header,.codex-native-tool-label",
                );
                const paragraphs = Array.from(
                  element.querySelectorAll(
                    ".codex-assistant-content .codex-markdown-blocks > .codex-paragraph",
                  ),
                ).map((p) => ({
                  text: p.textContent,
                  ...box(p),
                  marginTop: getComputedStyle(p).marginTop,
                  marginBottom: getComputedStyle(p).marginBottom,
                }));
                const actions = element.querySelector(
                  ".session-message-actions",
                );
                return {
                  key: element.getAttribute("data-codex-row"),
                  text: element.textContent,
                  ...box(element),
                  paddingBottom: style.paddingBottom,
                  children: children.map((e) => ({
                    ...box(e),
                    className: e.className,
                  })),
                  content: content ? box(content) : null,
                  paragraphs,
                  actions: actions
                    ? {
                        ...box(actions),
                        marginTop: getComputedStyle(actions).marginTop,
                        visibility: getComputedStyle(actions).visibility,
                      }
                    : null,
                };
              }),
            );
          observations.push({
            name: scenario.name,
            expectedRows: scenario.expectedRows,
            rows,
          });
          await page.screenshot({
            path: info.outputPath(`spacing-${scenario.name}-${theme}.png`),
            fullPage: true,
          });
        }
        await writeFile(
          info.outputPath("message-spacing-metrics.json"),
          JSON.stringify(
            {
              width,
              theme,
              nativeParagraphs,
              observations,
              errors,
              calls: fixture.calls,
            },
            null,
            2,
          ),
        );
        expect(nativeParagraphs).toHaveLength(2);
        const multi = observations.find(
          (item) => item.name === "multi-paragraph-assistant",
        ).rows[0].paragraphs;
        expect(
          multi.map((p: any) => ({
            height: p.height,
            marginTop: p.marginTop,
            marginBottom: p.marginBottom,
          })),
        ).toEqual(
          nativeParagraphs.map((p) => ({
            height: p.height,
            marginTop: p.marginTop,
            marginBottom: p.marginBottom,
          })),
        );
        for (const observation of observations) {
          expect
            .soft(observation.rows, observation.name)
            .toHaveLength(observation.expectedRows);
          expect
            .soft(
              observation.rows.filter((row: any) => !row.children.length),
              `${observation.name}: no invisible item owns a padded row`,
            )
            .toEqual([]);
          if (observation.name === "adjacent-assistant") {
            expect
              .soft(
                observation.rows[1].paragraphs[0].y -
                  observation.rows[0].paragraphs.at(-1).bottom,
                "retained completed actions preserve native desktop44/touch66 body gap",
              )
              .toBeCloseTo(width === 390 ? 66 : 44, 1);
          }
          for (const row of observation.rows) {
            if (width !== 390 && row.actions && row.paragraphs.length)
              expect
                .soft(
                  row.actions.height,
                  `${observation.name}: assistant custom actions match native22`,
                )
                .toBe(22);
            if (width !== 390 && row.actions && row.key.startsWith("user-"))
              expect
                .soft(
                  row.actions.height,
                  "user action geometry stays unchanged",
                )
                .toBe(24);
            if (width === 390 && row.actions)
              expect
                .soft(
                  row.actions.height,
                  `${observation.name}: retained mobile action row`,
                )
                .toBeGreaterThanOrEqual(44);
            if (row.paragraphs.length)
              expect
                .soft(
                  row.paragraphs.at(-1).marginBottom,
                  `${observation.name}: native last paragraph ends without trailing margin`,
                )
                .toBe("0px");
            if (row.content && row.actions && row.paragraphs.length) {
              const bottom = row.paragraphs.at(-1).bottom;
              expect
                .soft(
                  row.actions.y - bottom,
                  `${observation.name}: native content/action gap stays six pixels`,
                )
                .toBeCloseTo(6, 1);
            }
          }
          for (let i = 1; i < observation.rows.length; i++)
            expect
              .soft(
                observation.rows[i].y - observation.rows[i - 1].bottom,
                `${observation.name}: adjacent measured wrappers have no estimate hole`,
              )
              .toBeCloseTo(0, 1);
        }
        await native.close();
        const owner = await page.evaluate(async () => {
          const module = (path: string) =>
            import(
              performance
                .getEntriesByType("resource")
                .findLast((e) => new URL(e.name).pathname === path)?.name ??
                path
            );
          const [{ useCodexStore }, { useSessionDraftStore, sessionDraftKey }] =
            await Promise.all([
              module("/src/session-mode/components/codex/stores/index.ts"),
              module("/src/session-mode/stores/useSessionDraftStore.ts"),
            ]);
          return {
            target: useCodexStore.getState().currentThreadId,
            draft:
              useSessionDraftStore.getState().drafts[
                sessionDraftKey("codex", "ux-0")
              ]?.text,
          };
        });
        expect(owner).toEqual({ target: "ux-0", draft: "保留间距测试原草稿" });
        expect(errors).toEqual([]);
        expect(
          fixture.calls.filter((call) =>
            /\/turn\/start|\/thread\/resume|\/followups\/submit|\/thread\/rollback|\/thread\/fork/.test(
              call.path,
            ),
          ),
        ).toEqual([]);
      });
    }
  });

for (const width of [1440, 390])
  test.describe(`assistant footer entries ${width}`, () => {
    test.use({
      viewport: { width, height: 1000 },
      hasTouch: width === 390,
      isMobile: width === 390,
    });
    for (const theme of ["dark", "light"])
      test(`compact footer preserves captured owner and every entry (${theme})`, async ({
        page,
        browserName,
      }, info) => {
        test.setTimeout(90000);
        const errors: string[] = [],
          forks: any[] = [];
        page.on("pageerror", (error) =>
          errors.push(error.stack ?? error.message),
        );
        const fixture = await installSessionUxFixture(page, 2);
        await page.route(
          /\/api\/(?:session\/api\/)?codex\/thread\/fork$/,
          async (route) => {
            const body = route.request().postDataJSON();
            forks.push(body);
            const thread = {
              ...fixture.threads[0],
              id: body.lastTurnId ? "fixture-boundary" : "fixture-side",
              turns: [],
            };
            fixture.threads.push(thread);
            await route.fulfill({
              json: {
                thread,
                model: "fixture-model",
                reasoningEffort: "medium",
              },
            });
          },
        );
        if (browserName === "chromium")
          await page
            .context()
            .grantPermissions(["clipboard-read", "clipboard-write"]);
        await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
        await page
          .locator(".session-codex-composer [contenteditable=true]")
          .first()
          .waitFor({ timeout: 60000 });
        await seedSessionUx(page, 2);
        await page.evaluate(
          async ({ theme, cwd }) => {
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
              { useSessionDraftStore, sessionDraftKey },
            ] = await Promise.all([
              module("/src/session-mode/components/codex/stores/index.ts"),
              module("/src/session-mode/stores/useAgentCenterStore.ts"),
              module("/src/session-mode/stores/useLayoutStore.ts"),
              module("/src/session-mode/stores/settings/useThemeStore.ts"),
              module("/src/session-mode/stores/useSessionDraftStore.ts"),
            ]);
            useThemeStore.getState().setTheme(theme);
            useLayoutStore.setState({
              view: "agent",
              isSidebarOpen: false,
              isRightPanelOpen: false,
            });
            useAgentCenterStore
              .getState()
              .addAgentCard(
                { kind: "codex", id: "ux-0", cwd, preview: "Owner A" },
                { activate: false },
              );
            useAgentCenterStore
              .getState()
              .addAgentCard(
                { kind: "codex", id: "ux-1", cwd, preview: "Input B" },
                { activate: true },
              );
            useAgentCenterStore.setState({ cardsViewMode: "grid" });
            useCodexStore.setState({
              events: Object.fromEntries(
                ["ux-0", "ux-1"].map((threadId) => [
                  threadId,
                  [
                    {
                      method: "item/completed",
                      params: {
                        threadId,
                        turnId: "entry-turn",
                        item: {
                          id: "entry-reply",
                          type: "agentMessage",
                          text:
                            threadId === "ux-0"
                              ? "固定Owner A的引用与分支正文"
                              : "保留Owner B输入",
                          phase: "final_answer",
                          memoryCitation: null,
                        },
                      },
                    },
                  ],
                ]),
              ),
              currentThreadId: "ux-1",
              currentTurnId: null,
              historyLoadedMap: { "ux-0": true, "ux-1": true },
              historyLoadingMap: {},
              threadStatusMap: {
                "ux-0": { type: "idle" },
                "ux-1": { type: "idle" },
              },
            });
            useSessionDraftStore
              .getState()
              .setText(
                sessionDraftKey("codex", "ux-0"),
                "Owner A unsent draft",
              );
            useSessionDraftStore
              .getState()
              .setText(
                sessionDraftKey("codex", "ux-1"),
                "Owner B unsent draft",
              );
          },
          { theme, cwd },
        );
        const reply = page
          .locator('.codex-assistant[data-owner-thread="ux-0"]')
          .first();
        await expect(reply).toContainText("固定Owner A的引用与分支正文");
        const focusWitness: unknown[] = [];
        const captureReadiness = async (stage: string) => {
          const focus = await page.evaluate(() => ({
            hasFocus: document.hasFocus(),
            visibility: document.visibilityState,
            activeTag: document.activeElement?.tagName,
            activeClass: document.activeElement?.className,
            hoverHover: matchMedia("(hover: hover)").matches,
            hoverNone: matchMedia("(hover: none)").matches,
            pointerFine: matchMedia("(pointer: fine)").matches,
            pointerCoarse: matchMedia("(pointer: coarse)").matches,
          }));
          const geometry = await reply.evaluate((element) => {
            const actions = element.querySelector(".session-message-actions");
            return {
              hovered: element.matches(":hover"),
              groupHovered: element.matches(".group:hover"),
              actionClass: actions?.className,
              actionHoverSelectorMatch: actions?.matches(
                ":is(:where(.group):hover *)",
              ),
              actionVisibility: actions
                ? getComputedStyle(actions).visibility
                : null,
              utilityRules: (() => {
                const found: unknown[] = [];
                const walk = (rules: CSSRuleList, parents: string[]) => {
                  for (const rule of Array.from(rules)) {
                    const selector = (rule as CSSStyleRule).selectorText;
                    const condition = (rule as CSSConditionRule).conditionText;
                    if (
                      selector?.includes("group-hover") ||
                      selector?.includes("group-focus-within")
                    ) {
                      found.push({ selector, cssText: rule.cssText, parents });
                    }
                    const nested = (rule as CSSGroupingRule).cssRules;
                    if (nested)
                      walk(nested, [
                        ...parents,
                        selector || condition || rule.constructor.name,
                      ]);
                  }
                };
                for (const sheet of Array.from(document.styleSheets)) {
                  try {
                    walk(sheet.cssRules, []);
                  } catch {
                    /* Cross-origin styles are not inspected. */
                  }
                }
                return found;
              })(),
              buttons: Array.from(element.querySelectorAll("button")).map(
                (button) => {
                  const b = button.getBoundingClientRect(),
                    hit = document.elementFromPoint(
                      b.x + b.width / 2,
                      b.y + b.height / 2,
                    );
                  return {
                    label: button.ariaLabel || button.textContent,
                    x: b.x,
                    y: b.y,
                    width: b.width,
                    height: b.height,
                    visibility: getComputedStyle(button).visibility,
                    centerHit: hit === button || button.contains(hit),
                  };
                },
              ),
            };
          });
          focusWitness.push({ stage, focus, geometry });
          await writeFile(
            info.outputPath("message-footer-focus-witness.json"),
            JSON.stringify(
              { width, theme, browserName, focusWitness },
              null,
              2,
            ),
          );
        };
        await captureReadiness("before-foreground");
        await page.bringToFront();
        await page.waitForFunction(() => document.hasFocus());
        await captureReadiness("after-actual-foreground");
        if (width !== 390) await reply.hover();
        await captureReadiness("after-hover-before-visible-wait");
        for (const name of ["复制消息", "从此轮创建分支", "引用", "侧边追问"])
          await expect(
            reply.getByRole("button", { name, exact: true }),
          ).toBeVisible();
        await captureReadiness("after-four-buttons-visible");
        const controls = await reply.locator("button").evaluateAll((buttons) =>
          buttons.map((button) => {
            const b = button.getBoundingClientRect(),
              hit = document.elementFromPoint(
                b.x + b.width / 2,
                b.y + b.height / 2,
              );
            return {
              label: button.ariaLabel || button.textContent,
              width: b.width,
              height: b.height,
              centerHit: hit === button || button.contains(hit),
            };
          }),
        );
        expect(controls).toHaveLength(4);
        expect(controls.every((control) => control.centerHit)).toBe(true);
        expect(
          controls.every(
            (control) => control.height === (width === 390 ? 44 : 22),
          ),
        ).toBe(true);
        if (width === 390)
          expect(controls.every((control) => control.width >= 44)).toBe(true);
        const activate = async (button: ReturnType<typeof reply.getByRole>) =>
          width === 390 ? button.tap() : button.click();
        await activate(
          reply.getByRole("button", { name: "复制消息", exact: true }),
        );
        await expect(
          reply.getByRole("button", { name: "已复制", exact: true }),
        ).toBeVisible();
        if (width !== 390) {
          // Native keyboard navigation must reveal the same owner actions after hover ends.
          await page.keyboard.press("Tab");
          await expect(
            reply.getByRole("button", { name: "从此轮创建分支", exact: true }),
          ).toBeFocused();
          await page.mouse.move(0, 0);
          await expect
            .poll(() => reply.evaluate((element) => element.matches(":hover")))
            .toBe(false);
          for (const name of ["已复制", "从此轮创建分支", "引用", "侧边追问"])
            await expect(
              reply.getByRole("button", { name, exact: true }),
            ).toBeVisible();
          await captureReadiness("keyboard-focus-within-without-hover");
          await reply.hover();
        }
        if (browserName === "chromium")
          expect(
            await page.evaluate(() => navigator.clipboard.readText()),
          ).toBe("固定Owner A的引用与分支正文");
        await activate(
          reply.getByRole("button", { name: "引用", exact: true }),
        );
        const quote = reply.getByRole("button", { name: "引用", exact: true });
        await quote.focus();
        await page.keyboard.press("Enter");
        const state = () =>
          page.evaluate(async () => {
            const module = (path: string) =>
              import(
                performance
                  .getEntriesByType("resource")
                  .findLast((e) => new URL(e.name).pathname === path)?.name ??
                  path
              );
            const [
              { useCodexStore },
              { useSessionDraftStore, sessionDraftKey },
              { composerDrafts },
              { useSideChatStore },
            ] = await Promise.all([
              module("/src/session-mode/components/codex/stores/index.ts"),
              module("/src/session-mode/stores/useSessionDraftStore.ts"),
              module(
                "/src/session-mode/components/codex/composer/v2/drafts.ts",
              ),
              module("/src/session-mode/stores/useSideChatStore.ts"),
            ]);
            return {
              target: useCodexStore.getState().currentThreadId,
              a: useSessionDraftStore.getState().drafts[
                sessionDraftKey("codex", "ux-0")
              ]?.text,
              b: useSessionDraftStore.getState().drafts[
                sessionDraftKey("codex", "ux-1")
              ]?.text,
              aQuotes: composerDrafts.read(sessionDraftKey("codex", "ux-0"))
                .contexts,
              bQuotes: composerDrafts.read(sessionDraftKey("codex", "ux-1"))
                .contexts,
              side: useSideChatStore.getState().chat,
              sideText:
                useSessionDraftStore.getState().drafts[
                  sessionDraftKey("codex", "fixture-side")
                ]?.text,
            };
          });
        await expect.poll(async () => (await state()).aQuotes.length).toBe(2);
        await activate(
          reply.getByRole("button", { name: "从此轮创建分支", exact: true }),
        );
        await expect.poll(() => forks.length).toBe(1);
        expect(forks[0]).toMatchObject({
          threadId: "ux-0",
          lastTurnId: "entry-turn",
          deferGoalContinuation: true,
        });
        await expect.poll(async () => (await state()).target).toBe("ux-1");
        if (width !== 390) await reply.hover();
        await activate(
          reply.getByRole("button", { name: "侧边追问", exact: true }),
        );
        await expect
          .poll(async () => (await state()).side?.id)
          .toBe("fixture-side");
        expect(forks).toHaveLength(2);
        expect(forks[1]).toEqual({ threadId: "ux-0" });
        const owner = await state();
        expect(owner).toMatchObject({
          target: "ux-1",
          a: "Owner A unsent draft",
          b: "Owner B unsent draft",
          bQuotes: [],
          side: { id: "fixture-side", parentId: "ux-0" },
        });
        expect(
          owner.aQuotes.every(
            (quote: any) =>
              quote.sourceThreadId === "ux-0" &&
              quote.sourceItemId === "entry-reply" &&
              quote.text === "固定Owner A的引用与分支正文",
          ),
        ).toBe(true);
        expect(owner.sideText).toContain("固定Owner A的引用与分支正文");
        expect(errors).toEqual([]);
        expect(
          fixture.calls.filter((call) =>
            /\/turn\/start|\/thread\/resume|\/followups\/submit|\/thread\/rollback/.test(
              call.path,
            ),
          ),
        ).toEqual([]);
        await writeFile(
          info.outputPath("message-footer-entry-receipt.json"),
          JSON.stringify(
            {
              width,
              theme,
              controls,
              owner,
              forks,
              errors,
              fixture: true,
              focusWitness,
            },
            null,
            2,
          ),
        );
        await page.screenshot({
          path: info.outputPath(`message-footer-entries-${width}-${theme}.png`),
          fullPage: true,
        });
      });
  });
