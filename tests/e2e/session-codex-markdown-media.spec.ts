import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

for (const width of [1440, 390])
  test.describe(`Markdown media ${width}`, () => {
    test.use({
      viewport: { width, height: 1000 },
      hasTouch: width === 390,
      isMobile: width === 390,
    });
    for (const theme of ["dark", "light"] as const)
      for (const cjk of width === 1440 && theme === "dark"
        ? [false, true]
        : [false])
        test(`native fences preserve actual Mermaid graphics, controls and math (${theme}${cjk ? " CJK" : ""})`, async ({
          page,
        }, info) => {
          test.setTimeout(90000);
          const errors: string[] = [];
          const consoleErrors: string[] = [];
          page.on("pageerror", (error) => errors.push(error.message));
          page.on("console", (message) => {
            if (message.type() === "error") consoleErrors.push(message.text());
          });
          const fixture = await installSessionUxFixture(page, 1);
          await page.goto("/?mode=session");
          await page
            .locator(".session-codex-composer [contenteditable=true]")
            .first()
            .waitFor({ timeout: 60000 })
            .catch((error) => {
              throw new Error(
                `${error.message}\n${[...errors, ...consoleErrors].join("\n")}`,
              );
            });
          await seedSessionUx(page, 1);
          await page.evaluate(() => {
            (window as any).mediaMeasurementFonts = [];
            (window as any).mediaMeasurementObserver = new MutationObserver(
              () => {
                for (const element of document.querySelectorAll("div")) {
                  if (element.shadowRoot?.querySelector("svg,g")) {
                    (window as any).mediaMeasurementFonts.push(
                      `${getComputedStyle(element).getPropertyValue("font-synthesis-weight")}/${getComputedStyle(element.shadowRoot.firstElementChild!).getPropertyValue("font-synthesis-weight")}`,
                    );
                  }
                }
              },
            );
            (window as any).mediaMeasurementObserver.observe(document.body, {
              childList: true,
              subtree: true,
            });
          });
          await page.evaluate(
            async ({ theme, cjk }) => {
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
                  cwd: "/fixture",
                  preview: "Mermaid media",
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
                        turnId: "media",
                        item: {
                          id: "answer",
                          type: "agentMessage",
                          phase: "final_answer",
                          text: "Native code remains separate.\n\n```typescript\nconst value = 42;\n```\n\n```mermaid\ngraph TD\n  A[Start] --> B[Done]\n```\n\nMath: \\(x^2+y^2=z^2\\).".replace(
                            "A[Start] --> B[Done]",
                            cjk
                              ? "A[会话同步与文件预览检查] --> B[完成]"
                              : "A[Start] --> B[Done]",
                          ),
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
            { theme, cjk },
          );
          const graph = page.locator('[data-streamdown="mermaid-block"]');
          await Promise.race([
            expect(graph.locator("svg.flowchart")).toBeVisible({
              timeout: 45000,
            }),
            page
              .getByRole("heading", { name: "会话界面加载失败" })
              .waitFor({ timeout: 45000 })
              .then(() => {
                throw new Error("Media renderer entered ErrorBoundary");
              }),
          ]).catch((error) => {
            throw new Error(
              `${error.message}\n${[...errors, ...consoleErrors].join("\n")}`,
            );
          });
          await expect(graph.locator("svg.flowchart")).toContainText(
            cjk ? "会话同步与文件预览检查" : "Start",
          );
          await expect(graph.locator("svg.flowchart")).toContainText(
            cjk ? "完成" : "Done",
          );
          await expect(page.locator(".codex-native-code-fence")).toHaveCount(1);
          await expect(page.locator(".codex-assistant .katex")).toHaveCount(1);
          await expect(
            page.getByRole("heading", { name: "会话界面加载失败" }),
          ).toHaveCount(0);
          expect(
            await graph.getByRole("button").count(),
          ).toBeGreaterThanOrEqual(3);
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          ).toBe(true);
          await page.screenshot({
            path: info.outputPath(
              `markdown-media-${width}-${theme}${cjk ? "-cjk" : ""}.png`,
            ),
            fullPage: true,
          });
          const visual = await graph
            .locator("svg.flowchart")
            .evaluate((svg) => {
              const node = svg.querySelector(".node rect")!;
              const arrow = svg.querySelector(".flowchart-link")!;
              const text = svg.querySelector(".node text, .node .nodeLabel")!;
              return {
                viewBox: svg.getAttribute("viewBox"),
                labelBoxes: [...svg.querySelectorAll(".node text")].map(
                  (element) => (element as SVGGraphicsElement).getBBox().width,
                ),
                nodes: [...svg.querySelectorAll(".node")].map((element) => ({
                  transform: element.getAttribute("transform"),
                  rect: ["x", "y", "width", "height"].map((name) =>
                    element.querySelector("rect")?.getAttribute(name),
                  ),
                })),
                edge: arrow.getAttribute("d"),
                marker: [...svg.querySelectorAll("marker path")].map(
                  (element) => element.getAttribute("d"),
                ),
                node: getComputedStyle(node).fill,
                border: getComputedStyle(node).stroke,
                arrow: getComputedStyle(arrow).stroke,
                text: getComputedStyle(text).fill,
                font: getComputedStyle(text).fontSize,
                weight: getComputedStyle(text).fontWeight,
                synthesisWeight: getComputedStyle(text).getPropertyValue(
                  "font-synthesis-weight",
                ),
                synthesisStyle: getComputedStyle(text).getPropertyValue(
                  "font-synthesis-style",
                ),
                smoothing: getComputedStyle(text).getPropertyValue(
                  "-webkit-font-smoothing",
                ),
                radius: getComputedStyle(node).rx,
              };
            });
          await writeFile(
            info.outputPath("mermaid-colors.json"),
            JSON.stringify(visual, null, 2),
          );
          // Actual original image.c(V) under the approved Codex host themes, not
          // Streamdown's default Mermaid lavender/#333 palette.
          expect(visual.node).toBe(
            theme === "dark" ? "rgb(13, 39, 63)" : "rgb(229, 242, 255)",
          );
          expect(visual.arrow).toBe(
            theme === "dark" ? "rgb(133, 133, 133)" : "rgb(113, 113, 113)",
          );
          expect(visual.text).toBe(
            theme === "dark" ? "rgb(131, 195, 255)" : "rgb(51, 156, 255)",
          );
          expect(visual.font).toBe("14px");
          expect(visual.weight).toBe("600");
          expect(visual.radius).toBe("16px");
          expect(visual.synthesisWeight).toBe("none");
          expect(visual.synthesisStyle).toBe("auto");
          expect(visual.smoothing).toBe("antialiased");
          const measurementFonts = await page.evaluate(() => [
            ...new Set((window as any).mediaMeasurementFonts),
          ]);
          await writeFile(
            info.outputPath("mermaid-measurement-fonts.json"),
            JSON.stringify(measurementFonts),
          );
          expect(measurementFonts).toEqual(["none/none"]);
          expect(
            visual.nodes.map((node) => node.rect.slice(2).map(Number)),
          ).toEqual([
            [cjk ? 226 : 112.126953125, 60],
            [cjk ? 100 : 112.703125, 60],
          ]);
          expect(visual.nodes.map((node) => node.transform)).toEqual([
            cjk ? "translate(125, 42)" : "translate(68.3515625, 42)",
            cjk ? "translate(125, 142)" : "translate(68.3515625, 142)",
          ]);
          expect(visual.viewBox).toBe(
            cjk ? "4 4 242 176" : "4 4 128.703125 176",
          );
          if (cjk) expect(visual.labelBoxes).toEqual([154, 28]);
          expect(visual.marker).toContain(
            "M 0 0 L 4 0 M 0.8180194846605362 -3.181980515339464 L 4 0 L 0.8180194846605362 3.181980515339464",
          );
          await page.evaluate(() => {
            (window as any).mediaCopied = [];
            Object.defineProperty(navigator, "clipboard", {
              configurable: true,
              value: {
                writeText: async (value: string) => {
                  (window as any).mediaCopied.push(value);
                },
              },
            });
          });
          await graph.getByTitle("Copy Code", { exact: true }).click();
          await expect
            .poll(() => page.evaluate(() => (window as any).mediaCopied))
            .toEqual([
              cjk
                ? "graph TD\n  A[会话同步与文件预览检查] --> B[完成]\n"
                : "graph TD\n  A[Start] --> B[Done]\n",
            ]);
          const pan = graph.getByRole("application");
          const beforeZoom = await pan.getAttribute("style");
          await graph.getByTitle("Zoom in", { exact: true }).click();
          await expect
            .poll(() => pan.getAttribute("style"))
            .not.toBe(beforeZoom);
          await graph.getByTitle("Reset zoom and pan", { exact: true }).click();
          await expect.poll(() => pan.getAttribute("style")).toBe(beforeZoom);
          await graph.getByTitle("Download diagram", { exact: true }).click();
          const downloadPromise = page.waitForEvent("download");
          await graph
            .getByTitle("Download diagram as SVG", { exact: true })
            .click();
          const download = await downloadPromise;
          expect(download.suggestedFilename()).toBe("diagram.svg");
          expect(await download.failure()).toBeNull();
          expect(errors).toEqual([]);
          expect(
            fixture.calls.filter((call) =>
              /turn\/(start|steer)|approval\/reply|thread\/rollback/.test(
                call.path,
              ),
            ),
          ).toEqual([]);
        });
  });
