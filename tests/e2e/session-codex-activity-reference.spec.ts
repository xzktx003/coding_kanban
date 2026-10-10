import { expect, test } from "@playwright/test";
import { installSessionUxFixture } from "./session-ux-fixture";
const reference = process.env.CODEX_NATIVE_REFERENCE_URL;
for (const theme of ["dark", "light"])
  test(`activity header matches original group states and geometry (${theme})`, async ({
    page,
  }, info) => {
    test.skip(
      !reference,
      "Set CODEX_NATIVE_REFERENCE_URL to the original read-only webview harness",
    );
    test.setTimeout(90000);
    const native = await page.context().newPage();
    const errors: string[] = [];
    for (const current of [page, native])
      current.on("pageerror", (e) => errors.push(e.message));
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
          }
        : {
            background: "#fff",
            secondary: "#f5f5f3",
            foreground: "#3b3b3b",
            description: "#717171",
          };
    await native.setViewportSize({ width: 700, height: 400 });
    await native.emulateMedia({ reducedMotion: "reduce" });
    await native.goto(reference!);
    await native.waitForFunction(() => (window as any).nativeLoaded);
    await native.evaluate(
      async ({ theme, host }) => {
        for (const [key, value] of Object.entries({
          "font-family": "system-ui",
          "editor-background": host.background,
          "sideBar-background": host.secondary,
          foreground: host.foreground,
          descriptionForeground: host.description,
        }))
          document.documentElement.style.setProperty(`--vscode-${key}`, value);
        document.documentElement.setAttribute("data-theme", theme);
        document.body.style.background = host.background;
        const { installNativeGroupFixture } = await import(
          /* @vite-ignore */ "./native-group-fixture.js"
        );
        await installNativeGroupFixture();
      },
      { theme, host },
    );
    await installSessionUxFixture(page);
    await page.setViewportSize({ width: 700, height: 400 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
    await page
      .locator(".session-mode [contenteditable=true]")
      .first()
      .waitFor({ timeout: 60000 });
    await page.evaluate(
      async ({ theme, host }) => {
        const dependency = (name: string) => {
          const entry = performance
            .getEntriesByType("resource")
            .findLast((e) =>
              new URL(e.name).pathname.endsWith(`/deps/${name}`),
            );
          if (!entry) throw new Error(`Missing mounted dependency: ${name}`);
          return entry.name;
        };
        const react = await import(dependency("react.js")),
          dom = await import(dependency("react-dom_client.js"));
        const R = react.default ?? react,
          { createRoot } = dom.default ?? dom;
        const { NativeActivityGroup } =
          await import("/src/session-mode/components/codex/items/NativeActivityGroup.tsx");
        const { groupThreadActivities } =
          await import("/src/session-mode/components/codex/thread/activityRows.ts");
        const { buildThreadRows } =
          await import("/src/session-mode/components/codex/thread/threadRows.ts");
        document.getElementById("root")!.style.display = "none";
        document.body.style.margin = "0";
        const fixture = document.createElement("div");
        fixture.id = "native-group-product";
        fixture.className = `session-mode ${theme === "dark" ? "dark" : ""}`;
        fixture.style.cssText =
          "width:616px;padding:16px;box-sizing:border-box;min-height:400px";
        fixture.style.background = host.background;
        for (const [key, value] of Object.entries({
          "font-family": "system-ui",
          "editor-background": host.background,
          "sideBar-background": host.secondary,
          foreground: host.foreground,
          descriptionForeground: host.description,
        }))
          fixture.style.setProperty(`--vscode-${key}`, value);
        document.body.append(fixture);
        const root = createRoot(fixture);
        (window as any).renderProductGroup = (mode: string) => {
          const item = (
            id: string,
            type: string,
            fields: any,
            method = "item/completed",
          ) => ({
            method,
            params: {
              threadId: "fixture",
              turnId: "turn",
              item: { id, type, ...fields },
            },
          });
          const events: any[] = [
            item("read", "commandExecution", {
              command: "cat file.ts",
              commandActions: [
                {
                  type: "read",
                  command: "cat file.ts",
                  name: "file.ts",
                  path: "/fixture/file.ts",
                },
              ],
              cwd: "/fixture",
              status: "completed",
              aggregatedOutput: "",
              exitCode: 0,
            }),
            item(
              "cmd",
              "commandExecution",
              {
                command: "pnpm test",
                commandActions: [],
                cwd: "/fixture",
                status: mode === "active" ? "inProgress" : "completed",
                aggregatedOutput: "checks passed\n",
                exitCode: mode === "active" ? null : 0,
              },
              mode === "active" ? "item/started" : "item/completed",
            ),
          ];
          if (mode === "summary-mcp")
            events.splice(
              1,
              0,
              item("lookup", "mcpToolCall", {
                server: "fixture",
                tool: "lookup",
                status: "completed",
                arguments: { query: "ownership" },
                result: {
                  content: [{ type: "text", text: "Owned tool result" }],
                },
              }),
            );
          if (mode !== "summary" && mode !== "summary-mcp")
            events.unshift({
              method: "turn/started",
              params: {
                threadId: "fixture",
                turn: { id: "turn", status: "inProgress", items: [] },
              },
            });
          const group = groupThreadActivities(
            buildThreadRows(events),
            events,
          )[0].activity;
          root.render(
            R.createElement(
              "div",
              { className: "codex-presentation" },
              R.createElement(NativeActivityGroup, { group }),
            ),
          );
        };
      },
      { theme, host },
    );
    const metrics = (el: Element) => {
      const button = el.querySelector("button[aria-expanded]")!,
        label = el.querySelector(
          `#${CSS.escape(button.getAttribute("aria-labelledby")!)}`,
        )!,
        icons = el.querySelectorAll("svg"),
        rect = button.getBoundingClientRect();
      const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
      let textElement: Element = label;
      while (walker.nextNode()) {
        const text = walker.currentNode;
        if (
          text.textContent?.trim() &&
          !text.parentElement?.closest('[aria-hidden="true"]')
        ) {
          textElement = text.parentElement!;
          break;
        }
      }
      return {
        label: button.getAttribute("aria-labelledby")
          ? label.textContent?.replace(/(.+)\1$/, "$1")
          : button.textContent,
        height: rect.height,
        width: rect.width,
        font: getComputedStyle(label).font,
        textColor: getComputedStyle(textElement).color,
        icons: [...icons].map((icon) => ({
          width: icon.getBoundingClientRect().width,
          height: icon.getBoundingClientRect().height,
          color: getComputedStyle(icon).color,
          opacity: getComputedStyle(icon).opacity,
        })),
      };
    };
    for (const mode of ["summary", "summary-mcp", "active", "thinking"]) {
      await native.evaluate((mode) => {
        if (mode !== "summary-mcp") {
          (window as any).renderGroupFixture(mode);
          return;
        }
        (window as any).renderGroupFixture("summary", {
          items: [
            {
              item: {
                type: "exec",
                id: "read",
                parsedCmd: {
                  type: "read",
                  name: "file.ts",
                  path: "/fixture/file.ts",
                  cmd: "cat file.ts",
                  isFinished: true,
                },
                cwd: "/fixture",
                cmd: ["cat", "file.ts"],
                executionStatus: "completed",
                output: { aggregatedOutput: "", exitCode: 0 },
              },
              grouping: "groupable",
            },
            {
              item: {
                type: "mcp-tool-call",
                id: "lookup",
                completed: true,
                functionName: "fixture__lookup",
                invocation: {
                  server: "fixture",
                  tool: "lookup",
                  arguments: { query: "ownership" },
                },
                result: {
                  type: "success",
                  content: [{ type: "text", text: "Owned tool result" }],
                },
              },
              grouping: "groupable",
            },
            {
              item: {
                type: "exec",
                id: "cmd",
                parsedCmd: {
                  type: "unknown",
                  cmd: "pnpm test",
                  isFinished: true,
                },
                cwd: "/fixture",
                cmd: ["/bin/zsh", "-lc", "pnpm test"],
                executionStatus: "completed",
                output: {
                  aggregatedOutput: "checks passed\n",
                  exitCode: 0,
                },
              },
              grouping: "groupable",
            },
          ],
        });
      }, mode);
      await page.evaluate(
        (mode) => (window as any).renderProductGroup(mode),
        mode,
      );
      await native.waitForTimeout(1200);
      await page.waitForTimeout(100);
      const expected = await native.locator("#root").evaluate(metrics),
        actual = await page.locator("#native-group-product").evaluate(metrics);
      await info.attach(`group-${mode}-metrics`, {
        body: JSON.stringify({ expected, actual }, null, 2),
        contentType: "application/json",
      });
      expect(actual.label?.trim()).toBe(expected.label?.trim());
      expect(actual.height).toBe(expected.height);
      expect(actual.width).toBe(expected.width);
      expect(actual.font).toBe(expected.font);
      expect(actual.textColor).toBe(expected.textColor);
      expect(actual.icons).toEqual(expected.icons);
      await native.locator("#root").screenshot({
        path: info.outputPath(`reference-group-${mode}-${theme}.png`),
      });
      await page.locator("#native-group-product").screenshot({
        path: info.outputPath(`product-group-${mode}-${theme}.png`),
      });
      await native.locator("button[aria-expanded]").hover();
      await page.locator("#native-group-product button[aria-expanded]").hover();
      await page.waitForTimeout(200);
      const expectedHover = await native.locator("#root").evaluate(metrics),
        actualHover = await page
          .locator("#native-group-product")
          .evaluate(metrics);
      await info.attach(`group-${mode}-hover-metrics`, {
        body: JSON.stringify(
          { expected: expectedHover, actual: actualHover },
          null,
          2,
        ),
        contentType: "application/json",
      });
      expect(actualHover.textColor).toBe(expectedHover.textColor);
      expect(actualHover.icons).toEqual(expectedHover.icons);
      await native.mouse.move(690, 390);
      await page.mouse.move(690, 390);
    }
    expect(errors).toEqual([]);
    await native.close();
  });
