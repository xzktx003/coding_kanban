import { expect, test } from "@playwright/test";
import { installSessionUxFixture } from "./session-ux-fixture";
import { writeFile } from "node:fs/promises";
const reference = process.env.CODEX_NATIVE_REFERENCE_URL;
for (const theme of ["dark", "light"])
  for (const width of [1440, 390])
    test(`native tool states geometry and full page (${theme} ${width})`, async ({
      page,
    }, info) => {
      test.skip(!reference, "Requires original read-only VSIX harness");
      test.setTimeout(120000);
      const native = await page.context().newPage();
      const errors: string[] = [];
      for (const p of [page, native]) {
        p.on("pageerror", (e) => errors.push(e.stack ?? e.message));
        await p.setViewportSize({ width, height: 844 });
        await p.emulateMedia({ reducedMotion: "reduce" });
      }
      await native.route("**/*", (r) =>
        new URL(r.request().url()).origin === new URL(reference!).origin
          ? r.continue()
          : r.abort(),
      );
      const host =
        theme === "dark"
          ? {
              background: "#20211d",
              secondary: "#282a23",
              foreground: "#ccc",
              description: "#858585",
              warning: "#e25507",
            }
          : {
              background: "#fff",
              secondary: "#f5f5f3",
              foreground: "#3b3b3b",
              description: "#717171",
              warning: "#923b0f",
            };
      await native.goto(reference!);
      await native.waitForFunction(() => (window as any).nativeLoaded);
      await native.evaluate(
        async ({ theme, host }) => {
          const n = await import(
              /* @vite-ignore */ "./native-tools-reference.js"
            ),
            m = await import(
              /* @vite-ignore */ "./native-tools-mcp-reference.js"
            ),
            S = await import(
              /* @vite-ignore */ "./native/assets/app-initial-e98b9eaef8e3.js"
            ),
            auth = await import(
              /* @vite-ignore */ "./native/assets/app-initial-3192ac99b6cd.js"
            );
          n.initReasoning();
          n.initWebSearch();
          n.initActivityIcons();
          n.initCompaction();
          n.initReroute();
          n.initAutoReview();
          n.initDynamicTool();
          n.initRegisteredDynamicTool();
          m.initMcp();
          S.U();
          auth.zpt();
          for (const [key, value] of Object.entries({
            "font-family": "system-ui",
            "editor-background": host.background,
            "sideBar-background": host.secondary,
            foreground: host.foreground,
            descriptionForeground: host.description,
            "editorWarning-foreground": host.warning,
          }))
            document.documentElement.style.setProperty(
              `--vscode-${key}`,
              value,
            );
          document.documentElement.setAttribute("data-theme", theme);
          document.body.style.background = host.background;
          document.getElementById("root")!.style.cssText =
            "padding:16px;width:min(616px,100%);box-sizing:border-box";
          const { React: R, Dst } = (window as any).nativeModules;
          (window as any).renderToolReference = (mode: string) => {
            const completed = !mode.endsWith("active");
            const reviewStatus = mode.startsWith("review-denied")
              ? "denied"
              : mode.startsWith("review-timeout")
                ? "timedOut"
                : "inProgress";
            const reviewItem = {
              id: "review",
              type: "automatic-approval-review",
              status: reviewStatus,
              riskLevel: "high",
              rationale: "Real review rationale",
              action: {
                type: "command",
                command: "curl target",
                cwd: "/fixture",
                source: "shell",
              },
            };
            const firstPartyItem = {
              id: "firstparty",
              type: "dynamic-tool-call",
              namespace: "codex_app",
              tool: mode.includes("read")
                ? "read_thread"
                : mode.includes("settings")
                  ? "write_settings"
                  : "create_thread",
              arguments: {
                threadId: "child",
                config: mode.includes("invalid") ? null : {},
              },
              completed: !mode.endsWith("active") && !mode.endsWith("invalid"),
              success: mode.includes("failed")
                ? false
                : !mode.endsWith("active") && !mode.endsWith("invalid")
                  ? true
                  : null,
              contentItems: [
                {
                  type: "inputText",
                  text: '{"kind":"codex","threadId":"child","hostId":"local"}',
                },
              ],
            };
            const node = mode.startsWith("firstparty")
              ? R.createElement(n.nativeRegisteredDynamicTool, {
                  item: firstPartyItem,
                  agentActivityIcon: n.nativeActivityIcon(
                    { item: firstPartyItem },
                    {
                      hostId: "local",
                      grouped: false,
                      loadRemoteLogos: false,
                      resolvedApps: [],
                    },
                  ),
                  enableTimelineTargets: false,
                })
              : mode.startsWith("review")
                ? R.createElement(n.nativeAutoReview, {
                    icon: n.nativeActivityIcon(
                      { item: reviewItem },
                      {
                        hostId: "local",
                        grouped: false,
                        loadRemoteLogos: false,
                        resolvedApps: [],
                      },
                    ),
                    item: reviewItem,
                  })
                : mode.startsWith("reasoning")
                  ? R.createElement(n.nativeReasoning, {
                      item: {
                        id: "reasoning",
                        type: "reasoning",
                        content: "**Public title**\n\nVisible public body",
                        completed,
                      },
                      conversationId: "fixture",
                      hostId: "local",
                      cwd: "/fixture",
                    })
                  : mode.startsWith("mcp")
                    ? R.createElement(m.nativeMcp, {
                        item: {
                          type: "mcp-tool-call",
                          id: "tool",
                          callId: "tool",
                          functionName: "mcp__workspace__inspect_repository",
                          pluginId: null,
                          appContext: null,
                          invocation: {
                            server: "workspace",
                            tool: "inspect_repository",
                            arguments: { path: "file.ts" },
                          },
                          completed,
                          result: completed
                            ? {
                                type: "success",
                                content: [
                                  { type: "text", text: "Result body" },
                                ],
                                raw: {
                                  content: [
                                    { type: "text", text: "Result body" },
                                  ],
                                },
                              }
                            : null,
                        },
                        conversationId: "fixture",
                        hostId: "local",
                        loadRemoteLogos: false,
                        renderMcpApps: false,
                      })
                    : mode.startsWith("search")
                      ? R.createElement(n.nativeWebSearch, {
                          icon: n.nativeActivityIcon(
                            { item: { type: "web-search", query: "Codex" } },
                            {
                              hostId: "local",
                              grouped: false,
                              loadRemoteLogos: false,
                              resolvedApps: [],
                            },
                          ),
                          item: {
                            type: "web-search",
                            id: "search",
                            query: "Codex",
                            action: {
                              type: "search",
                              query: "Codex",
                              queries: null,
                            },
                            completed,
                          },
                        })
                      : mode.startsWith("dynamic")
                        ? R.createElement(n.nativeDynamicTool, {
                            item: {
                              id: "dynamic",
                              type: "dynamic-tool-call",
                              namespace: "functions",
                              tool:
                                mode === "dynamic-terminal"
                                  ? "read_thread_terminal"
                                  : "inspect_repository",
                              arguments: { path: "file.ts" },
                              completed,
                            },
                          })
                        : mode === "reroute"
                          ? R.createElement(n.nativeReroute, {
                              toModel: "gpt-b",
                              reason: "highRiskCyberActivity",
                            })
                          : R.createElement(n.nativeCompaction, {
                              status:
                                mode.endsWith("active") ||
                                mode === "compaction-delayed"
                                  ? "inProgress"
                                  : mode === "compaction-interrupted"
                                    ? "interrupted"
                                    : "completed",
                              source: "manual",
                              startedAtMs:
                                mode === "compaction-delayed"
                                  ? Date.now() - 11000
                                  : undefined,
                            });
            (window as any).renderNativeElement(
              () =>
                R.createElement(
                  auth.Rpt.Provider,
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
                        R.createElement(Dst, { scope: S._$t, value: {} }, node),
                      ),
                    ),
                  ),
                ),
              {},
            );
          };
        },
        { theme, host },
      );
      await installSessionUxFixture(page);
      await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
      await page
        .locator(".session-mode [contenteditable=true]")
        .first()
        .waitFor({ timeout: 60000 });
      await page.evaluate(
        async ({ theme, host }) => {
          const dep = (name: string) =>
            performance
              .getEntriesByType("resource")
              .findLast((entry) =>
                new URL(entry.name).pathname.endsWith("/deps/" + name + ".js"),
              )!.name;
          const react = await import(dep("react")),
            dom = await import(dep("react-dom_client")),
            R = react.default ?? react,
            { createRoot } = dom.default ?? dom;
          const { ReasoningSummaryItem } =
              await import("/src/session-mode/components/codex/items/ReasoningSummaryItem.tsx"),
            { McpToolCallItem } =
              await import("/src/session-mode/components/codex/items/McpToolCallItem.tsx"),
            { NativeActivityItem } =
              await import("/src/session-mode/components/codex/items/NativeActivityItem.tsx"),
            { NativeModelReroutedNotice, NativeAutomaticReviewItem } =
              await import("/src/session-mode/components/codex/items/NativeSystemNotice.tsx");
          document.getElementById("root")!.style.display = "none";
          document.body.style.margin = "0";
          document.body.style.background = host.background;
          const container = document.createElement("div");
          container.id = "tools-product";
          container.className = `session-mode ${theme === "dark" ? "dark" : ""}`;
          container.style.cssText =
            "padding:16px;width:min(616px,100%);box-sizing:border-box";
          for (const [key, value] of Object.entries({
            "font-family": "system-ui",
            "editor-background": host.background,
            "sideBar-background": host.secondary,
            foreground: host.foreground,
            descriptionForeground: host.description,
            "editorWarning-foreground": host.warning,
          }))
            container.style.setProperty(`--vscode-${key}`, value);
          container.style.background = host.background;
          document.body.append(container);
          const root = createRoot(container);
          (window as any).renderToolProduct = (mode: string) => {
            const running =
              mode.endsWith("active") || mode === "compaction-delayed";
            const item = {
              id: "tool",
              type: "mcpToolCall",
              server: "workspace",
              tool: "inspect_repository",
              arguments: { path: "file.ts" },
              status: running ? "inProgress" : "completed",
              durationMs: null,
              error: null,
              result: running
                ? null
                : {
                    content: [{ type: "text", text: "Result body" }],
                    structuredContent: null,
                  },
            };
            const reviewStatus = mode.startsWith("review-denied")
              ? "denied"
              : mode.startsWith("review-timeout")
                ? "timedOut"
                : "inProgress";
            const reviewValue = {
              threadId: "fixture",
              turnId: "turn",
              reviewId: "review",
              targetItemId: "target",
              startedAtMs: 1,
              review: {
                status: reviewStatus,
                riskLevel: "high",
                rationale: "Real review rationale",
                userAuthorization: "unknown",
              },
              action: {
                type: "command",
                command: "curl target",
                cwd: "/fixture",
                source: "shell",
              },
            };
            const firstPartyItem = {
              id: "firstparty",
              type: "dynamicToolCall",
              namespace: "codex_app",
              tool: mode.includes("read")
                ? "read_thread"
                : mode.includes("settings")
                  ? "write_settings"
                  : "create_thread",
              arguments: {
                threadId: "child",
                config: mode.includes("invalid") ? null : {},
              },
              status:
                mode.endsWith("active") || mode.endsWith("invalid")
                  ? "inProgress"
                  : "completed",
              success: mode.includes("failed")
                ? false
                : !mode.endsWith("active") && !mode.endsWith("invalid")
                  ? true
                  : null,
              contentItems: [
                {
                  type: "inputText",
                  text: '{"kind":"codex","threadId":"child","hostId":"local"}',
                },
              ],
            };
            const node = mode.startsWith("firstparty")
              ? R.createElement(NativeActivityItem, {
                  item: firstPartyItem,
                  running: firstPartyItem.status === "inProgress",
                })
              : mode.startsWith("review")
                ? R.createElement(NativeAutomaticReviewItem, {
                    value: reviewValue,
                  })
                : mode.startsWith("reasoning")
                  ? R.createElement(ReasoningSummaryItem, {
                      summary: ["**Public title**\n\nVisible public body"],
                      running,
                    })
                  : mode.startsWith("mcp")
                    ? R.createElement(McpToolCallItem, { item })
                    : mode.startsWith("search")
                      ? R.createElement(NativeActivityItem, {
                          item: {
                            type: "webSearch",
                            id: "search",
                            query: "Codex",
                            action: {
                              type: "search",
                              query: "Codex",
                              queries: null,
                            },
                          },
                          running,
                        })
                      : mode.startsWith("dynamic")
                        ? R.createElement(NativeActivityItem, {
                            item: {
                              id: "dynamic",
                              type: "dynamicToolCall",
                              namespace: "functions",
                              tool:
                                mode === "dynamic-terminal"
                                  ? "read_thread_terminal"
                                  : "inspect_repository",
                              arguments: { path: "file.ts" },
                              status: running ? "inProgress" : "completed",
                            },
                            running,
                          })
                        : mode === "reroute"
                          ? R.createElement(NativeModelReroutedNotice, {
                              value: {
                                toModel: "gpt-b",
                                reason: "highRiskCyberActivity",
                              },
                            })
                          : R.createElement(NativeActivityItem, {
                              item: {
                                type: "contextCompaction",
                                id: "compaction",
                                source: "manual",
                              },
                              running,
                              startedAtMs:
                                mode === "compaction-delayed"
                                  ? Date.now() - 11000
                                  : undefined,
                              termination:
                                mode === "compaction-interrupted"
                                  ? "interrupted"
                                  : undefined,
                            });
            root.render(
              R.createElement(
                "div",
                { key: mode, className: "codex-presentation" },
                node,
              ),
            );
          };
        },
        { theme, host },
      );
      const metrics = (el: Element) => {
        const button = el.querySelector("button[aria-expanded]"),
          r = el.getBoundingClientRect(),
          walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT),
          nodes = [];
        while (walker.nextNode()) {
          const n = walker.currentNode,
            p = n.parentElement;
          if (
            !n.textContent?.trim() ||
            p?.closest('[aria-hidden="true"],.sr-only,[hidden]')
          )
            continue;
          const range = document.createRange();
          range.selectNodeContents(n);
          const rect = range.getBoundingClientRect();
          let painted = rect.width > 0;
          for (
            let ancestor = p;
            painted && ancestor;
            ancestor = ancestor.parentElement
          ) {
            const style = getComputedStyle(ancestor),
              clip = ancestor.getBoundingClientRect();
            if (
              style.visibility === "hidden" ||
              style.display === "none" ||
              Number(style.opacity) === 0
            )
              painted = false;
            else if (
              /hidden|clip|auto|scroll/.test(style.overflowY) &&
              (clip.height === 0 ||
                rect.bottom <= clip.top ||
                rect.top >= clip.bottom)
            )
              painted = false;
            if (ancestor === el) break;
          }
          if (painted)
            nodes.push({
              text: n.textContent.trim(),
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
              font: getComputedStyle(p!).font,
              color: getComputedStyle(p!).color,
            });
        }
        return {
          text: nodes.map((n) => n.text).join(" "),
          height: r.height,
          expanded: button?.getAttribute("aria-expanded"),
          nodes,
          icons: [...el.querySelectorAll("svg")].map((svg) => ({
            html: svg.outerHTML,
            x: svg.getBoundingClientRect().x,
            y: svg.getBoundingClientRect().y,
            width: svg.getBoundingClientRect().width,
            height: svg.getBoundingClientRect().height,
            color: getComputedStyle(svg).color,
            opacity: getComputedStyle(svg).opacity,
            rotation: (() => {
              const style = getComputedStyle(svg),
                matrix = new DOMMatrixReadOnly(
                  style.transform === "none" ? undefined : style.transform,
                ),
                rotate = style.rotate === "none" ? 0 : parseFloat(style.rotate),
                angle =
                  (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI + rotate;
              return (
                Math.round((((angle % 360) + 360) % 360) * 1000000) / 1000000
              );
            })(),
          })),
        };
      };
      for (const mode of [
        "reasoning-active",
        "reasoning-completed",
        "reasoning-expanded",
        "mcp-active",
        "mcp-completed",
        "mcp-expanded",
        "search-active",
        "search-completed",
        "compaction-active",
        "compaction-completed",
        "compaction-delayed",
        "compaction-interrupted",
        "dynamic-active",
        "dynamic-completed",
        "dynamic-terminal",
        "reroute",
        "review-active",
        "review-denied",
        "review-denied-expanded",
        "review-timeout",
        "review-timeout-expanded",
        "review-timeout-rationale-expanded",
        "firstparty-create-active",
        "firstparty-create-completed",
        "firstparty-create-failed",
        "firstparty-read-active",
        "firstparty-read-completed",
        "firstparty-settings-active",
        "firstparty-settings-completed",
        "firstparty-settings-invalid",
      ].filter(
        (mode) =>
          !process.env.CODEX_TOOL_REFERENCE_MODES ||
          process.env.CODEX_TOOL_REFERENCE_MODES.split(",").includes(mode),
      )) {
        await native.evaluate(
          (mode) => (window as any).renderToolReference(mode),
          mode,
        );
        await page.evaluate(
          (mode) => (window as any).renderToolProduct(mode),
          mode,
        );
        await native.waitForTimeout(800);
        if (mode.endsWith("expanded")) {
          await native.locator("#root button[aria-expanded]").first().click();
          await page
            .locator("#tools-product button[aria-expanded]")
            .first()
            .click();
          await native.waitForTimeout(600);
          if (mode === "review-timeout-rationale-expanded") {
            await native.locator("#root button[aria-expanded]").nth(1).click();
            await page
              .locator("#tools-product button[aria-expanded]")
              .nth(1)
              .click();
            await native.waitForTimeout(600);
          }
        }
        await native.mouse.move(width - 1, 800);
        await page.mouse.move(width - 1, 800);
        expect(errors, `Runtime errors in ${mode}`).toEqual([]);
        const geometry = {
          native: await native.locator("#root").evaluate(metrics),
          product: await page.locator("#tools-product").evaluate(metrics),
        };
        await writeFile(
          info.outputPath(`${mode}-geometry.json`),
          JSON.stringify(geometry, null, 2),
        );
        await info.attach(`${mode}-geometry`, {
          body: JSON.stringify(geometry, null, 2),
          contentType: "application/json",
        });
        expect(
          geometry.product.nodes[0],
          `Primary ${mode} label geometry`,
        ).toEqual(geometry.native.nodes[0]);
        // Streaming Markdown splits words into adjacent spans. Compare the painted
        // line while retaining every font, color, baseline and separate detail label.
        const paintedLines = (nodes: typeof geometry.native.nodes) =>
          nodes.reduce((lines: typeof nodes, node) => {
            const previous = lines.at(-1);
            if (
              previous &&
              previous.y === node.y &&
              previous.height === node.height &&
              previous.font === node.font &&
              previous.color === node.color &&
              Math.abs(previous.x + previous.width - node.x) < 0.1
            ) {
              previous.text += ` ${node.text}`;
              previous.width = node.x + node.width - previous.x;
            } else lines.push({ ...node });
            return lines;
          }, []);
        const actualLines = paintedLines(geometry.product.nodes),
          expectedLines = paintedLines(geometry.native.nodes);
        expect(actualLines.length, `${mode} painted text line count`).toBe(
          expectedLines.length,
        );
        for (const [index, expected] of expectedLines.entries()) {
          const { width: expectedWidth, ...expectedStyle } = expected,
            { width: actualWidth, ...actualStyle } = actualLines[index];
          expect(actualStyle, `${mode} text line ${index}`).toEqual(
            expectedStyle,
          );
          expect(
            Math.abs(actualWidth - expectedWidth),
            `${mode} text line ${index} width`,
          ).toBeLessThan(0.05);
        }
        const icons = (data: typeof geometry.native) =>
          data.icons.map(({ html, ...rest }) => ({
            ...rest,
            paths: [...html.matchAll(/\bd="([^"]+)"/g)].map(
              (match) => match[1],
            ),
          }));
        expect(icons(geometry.product), `${mode} icons`).toEqual(
          icons(geometry.native),
        );
        await native.screenshot({
          path: info.outputPath(`native-${mode}-${theme}-${width}.png`),
          fullPage: true,
        });
        await page.screenshot({
          path: info.outputPath(`product-${mode}-${theme}-${width}.png`),
          fullPage: true,
        });
        if (mode.startsWith("reasoning") || mode.startsWith("mcp")) {
          const expected = await native
            .locator("#root button[aria-expanded]")
            .count();
          expect(
            await page.locator("#tools-product button[aria-expanded]").count(),
          ).toBe(expected);
          if (expected)
            expect(
              await page
                .locator("#tools-product button[aria-expanded]")
                .getAttribute("aria-expanded"),
            ).toBe(
              await native
                .locator("#root button[aria-expanded]")
                .getAttribute("aria-expanded"),
            );
        }
      }
      expect(errors).toEqual([]);
    });
