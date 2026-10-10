import { expect, test, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

const reference = process.env.CODEX_NATIVE_REFERENCE_URL;
const text =
  "检查完成。会话正文、代码和文件变更沿用相同的视觉标准。\n\n- 保留标签、分屏和独立输入区。\n- 切换会话时保留阅读位置与草稿。\n\n```typescript\nexport function add(a: number, b: number) {\n  return a + b;\n}\n```\n\n| 场景 | 检查内容 |\n| --- | --- |\n| 桌面 | 字体、行距与菜单 |\n| 手机 | 触控、换行与空间 |\n\n表格后保留段落。\n\n# Heading one\n\nParagraph with `inline`.\n\n## Heading two\n\nParagraph.\n\n### Heading three\n\n#### Heading four\n\n##### Heading five\n\n###### Heading six\n\n> Quoted text.\n>\n> Second quoted line.\n\n---\n\nLast paragraph.";

async function metrics(page: Page, original: boolean) {
  return page
    .locator(original ? "#root" : ".codex-assistant .codex-markdown")
    .first()
    .evaluate((root, original) => {
      const first = root.querySelector("p")!.getBoundingClientRect();
      const rect = (element: Element) => {
        const b = element.getBoundingClientRect(),
          s = getComputedStyle(element);
        // The product adds a sans-serif fallback after the same system-ui family;
        // actual CJK font equivalence is separately verified through browser CDP.
        return {
          x: b.x - first.x,
          y: b.y - first.y,
          width: b.width,
          height: b.height,
          font: s.fontSize,
          line: s.lineHeight,
          family: s.fontFamily.split(",")[0],
          weight: s.fontWeight,
          synthesisWeight: s.getPropertyValue("font-synthesis-weight"),
          synthesisStyle: s.getPropertyValue("font-synthesis-style"),
          smoothing: s.getPropertyValue("-webkit-font-smoothing"),
          padding: s.padding,
          margin: s.margin,
          background: s.backgroundColor,
          color: s.color,
          radius: s.borderRadius,
        };
      };
      const frame = root.querySelector(
        original ? "[class*=CodeBlock]" : ".codex-native-code-fence",
      )!;
      const code = frame.querySelector("code")!;
      return {
        paragraphs: [...root.querySelectorAll("p")].map(rect),
        headings: [...root.querySelectorAll("h1,h2,h3,h4,h5,h6")].map(rect),
        quotes: [...root.querySelectorAll("blockquote,hr")].map(rect),
        inline: [
          ...root.querySelectorAll(
            original ? "[class*=InlineCode]" : "[data-streamdown=inline-code]",
          ),
        ].map(rect),
        list: [...root.querySelectorAll("li")].map(rect),
        frame: rect(frame),
        header: rect(frame.firstElementChild!),
        code: rect(code),
        table: rect(root.querySelector("table")!),
        cells: [...root.querySelectorAll("th,td")].map(rect),
        syntax: [...code.querySelectorAll("span[class]")].map((element) => ({
          text: element.textContent,
          class: element.className,
          color: getComputedStyle(element).color,
        })),
        buttons: [...frame.querySelectorAll("button")].map((button) => ({
          label: button.ariaLabel,
          svg: [...button.querySelectorAll("path")].map((path) =>
            path.getAttribute("d"),
          ),
          ...rect(button),
        })),
      };
    }, original);
}

for (const width of [700, 390])
  test.describe(`original Markdown ${width}`, () => {
    test.use({
      viewport: { width, height: 1000 },
      hasTouch: width === 390,
      isMobile: width === 390,
    });
    for (const theme of ["dark", "light"])
      test(`primary fence, table and list geometry and syntax (${theme})`, async ({
        page,
      }, info) => {
        test.skip(!reference, "Set original native webview reference URL");
        test.setTimeout(90000);
        const native = await page.context().newPage();
        await native.goto(reference!);
        await native.waitForFunction(() => (window as any).nativeLoaded);
        await native.evaluate(
          async ({ theme, width }) => {
            const S = await import(
              /* @vite-ignore */ "./native/assets/app-initial-e98b9eaef8e3.js"
            );
            S.v();
            S.U();
            const w = window as any;
            w.renderNativeElement(S._, {
              children: w.nativeModules.React.createElement(
                "span",
                {},
                "persisted ready",
              ),
            });
            // Match the actual product's available content width after its retained
            // 1px focused pane borders. Supply the normal mobile host viewport meta.
            const viewport = document.createElement("meta");
            viewport.name = "viewport";
            viewport.content = "width=device-width,initial-scale=1";
            document.head.append(viewport);
            document.getElementById("root")!.style.cssText =
              `width:${width === 390 ? 388 : 616}px;box-sizing:border-box;padding:16px`;
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
            document.body.style.background = host["editor-background"];
            document.body.style.color = host.foreground;
          },
          { theme, width },
        );
        await native.getByText("persisted ready", { exact: true }).waitFor();
        await native.evaluate(async (text) => {
          const S = await import(
              /* @vite-ignore */ "./native/assets/app-initial-e98b9eaef8e3.js"
            ),
            Auth = await import(
              /* @vite-ignore */ "./native/assets/app-initial-3192ac99b6cd.js"
            );
          const w = window as any,
            { React: R, Dst, zg } = w.nativeModules;
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
                    value: { conversationId: "fixture", hostId: "local" },
                  },
                  R.createElement(
                    Dst,
                    { scope: S.W$t, value: { kind: "local" } },
                    R.createElement(zg, { children: text }),
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
        }, text);
        await native.locator("#root code .hljs-keyword").first().waitFor();
        const original = await metrics(native, true);
        await native.screenshot({
          path: info.outputPath(`native-${width}-${theme}.png`),
        });
        const fixture = await installSessionUxFixture(page, 1);
        await page.goto("/?mode=session");
        await page
          .locator(".session-codex-composer [contenteditable=true]")
          .first()
          .waitFor({ timeout: 60000 });
        await seedSessionUx(page, 1);
        await page.evaluate(
          async ({ text, theme }) => {
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
              { useThemeStore },
              { useLayoutStore },
            ] = await Promise.all([
              module("/src/session-mode/components/codex/stores/index.ts"),
              module("/src/session-mode/stores/useAgentCenterStore.ts"),
              module("/src/session-mode/stores/settings/useThemeStore.ts"),
              module("/src/session-mode/stores/useLayoutStore.ts"),
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
                cwd: "/fixture",
                preview: "Markdown reference",
              },
              { activate: true },
            );
            useAgentCenterStore.setState({ cardsViewMode: "solo" });
            useCodexStore.setState({
              events: {
                "ux-0": [
                  {
                    method: "item/completed",
                    params: {
                      threadId: "ux-0",
                      turnId: "markdown",
                      item: {
                        id: "final",
                        type: "agentMessage",
                        text,
                        phase: "final_answer",
                      },
                    },
                  },
                ],
              },
              historyLoadedMap: { "ux-0": true },
              historyLoadingMap: {},
              currentThreadId: "ux-0",
              currentTurnId: null,
              threadStatusMap: { "ux-0": { type: "idle" } },
            });
          },
          { text, theme },
        );
        await page.addStyleTag({
          content: `.codex-assistant-content{width:${width === 390 ? 356 : 584}px!important}`,
        });
        await page
          .locator(".codex-native-code-fence .hljs-keyword")
          .first()
          .waitFor();
        const measured = await metrics(page, false);
        await page.screenshot({
          path: info.outputPath(`product-${width}-${theme}.png`),
          fullPage: true,
        });
        await writeFile(
          info.outputPath("reference-metrics.json"),
          JSON.stringify({ original, measured }, null, 2),
        );
        expect(measured.list).toEqual(original.list);
        expect(measured.cells).toEqual(
          original.cells.map((cell) => ({
            ...cell,
            y: cell.y + (width === 390 ? 8 : 0),
          })),
        );
        expect(measured.syntax).toEqual(original.syntax);
        const shifted = (elements: typeof original.headings) =>
          elements.map((element) => ({
            ...element,
            y: element.y + (width === 390 ? 8 : 0),
          }));
        expect(measured.headings).toEqual(shifted(original.headings));
        expect(measured.quotes).toEqual(shifted(original.quotes));
        expect(measured.inline).toEqual(shifted(original.inline));
        for (const property of [
          "width",
          "font",
          "line",
          "family",
          "weight",
          "synthesisWeight",
          "synthesisStyle",
          "smoothing",
          "color",
          "background",
          "radius",
        ] as const)
          expect(measured.frame[property], `frame ${property}`).toBe(
            original.frame[property],
          );
        expect(measured.frame.height).toBe(
          original.frame.height + (width === 390 ? 8 : 0),
        );
        expect(measured.code.height).toBe(original.code.height);
        expect(measured.code.line).toBe(original.code.line);
        expect(measured.code.font).toBe(original.code.font);
        expect(measured.code.x).toBe(original.code.x);
        expect(measured.header.height).toBe(
          original.header.height + (width === 390 ? 8 : 0),
        );
        expect(
          measured.buttons.find((button) => button.label === "复制")!.svg,
        ).toEqual(
          original.buttons.find((button) => button.label === "复制")!.svg,
        );
        expect(
          measured.buttons.find((button) => button.label === "启用自动换行")!
            .svg,
        ).toEqual(
          original.buttons.find((button) => button.label === "启用自动换行")!
            .svg,
        );
        const fence = page.locator(".codex-native-code-fence");
        await fence.getByRole("button", { name: "启用自动换行" }).click();
        await expect(fence.locator("pre")).toHaveAttribute("data-wrap", "true");
        await expect(fence.locator("code")).toHaveCSS(
          "white-space",
          "pre-wrap",
        );
        await fence.getByRole("button", { name: "禁用自动换行" }).click();
        await fence.hover();
        await fence.getByRole("button", { name: "代码块更多操作" }).click();
        const download = page.waitForEvent("download");
        await page
          .getByRole("menuitem", { name: "下载代码", exact: true })
          .click();
        expect((await download).suggestedFilename()).toBe("code.typescript");
        const table = page.locator(".codex-native-table");
        await table.hover();
        await table.getByRole("button", { name: "表格更多操作" }).click();
        await expect(
          page.getByRole("menuitem", { name: "复制 · CSV" }),
        ).toBeVisible();
        await expect(
          page.getByRole("menuitem", { name: "复制 · TSV" }),
        ).toBeVisible();
        const tableDownload = page.waitForEvent("download");
        await page.getByRole("menuitem", { name: "下载 · Markdown" }).click();
        expect((await tableDownload).suggestedFilename()).toBe("table.md");
        expect(
          fixture.calls.filter((call) =>
            /turn\/(start|steer)|approval\/reply|thread\/rollback/.test(
              call.path,
            ),
          ),
        ).toEqual([]);
        await native.close();
      });
  });
