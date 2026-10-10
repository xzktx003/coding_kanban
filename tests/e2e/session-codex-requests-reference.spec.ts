import { expect, test } from "@playwright/test";
import { installSessionUxFixture } from "./session-ux-fixture";
const reference = process.env.CODEX_NATIVE_REFERENCE_URL;
for (const theme of ["dark", "light"])
  test(`typed request choices match actual plugin card tokens and geometry (${theme})`, async ({
    page,
  }, info) => {
    test.skip(
      !reference,
      "Set CODEX_NATIVE_REFERENCE_URL to the isolated original VSIX webview harness",
    );
    test.setTimeout(90_000);
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
    const schema = {
      type: "object",
      properties: {
        choice: {
          type: "string",
          title: "选择环境",
          oneOf: [
            { const: "isolated", title: "隔离 (Recommended)" },
            { const: "production", title: "生产" },
          ],
        },
        detail: { type: "string", title: "补充要求" },
      },
      required: ["choice"],
    };
    const native = await page.context().newPage();
    await native.route("**/*", (route) =>
      new URL(route.request().url()).origin === new URL(reference!).origin
        ? route.continue()
        : route.abort(),
    );
    await native.setViewportSize({ width: 900, height: 500 });
    await native.goto(reference!);
    await native.waitForFunction(() => (window as any).nativeLoaded);
    await native.evaluate(
      async ({ theme, host, schema }) => {
        const w = window as any;
        document.documentElement.setAttribute("data-theme", theme);
        document.body.style.background = host.background;
        for (const [key, value] of Object.entries({
          "font-family": "system-ui",
          "editor-background": host.background,
          "sideBar-background": host.secondary,
          "dropdown-background": host.secondary,
          foreground: host.foreground,
          descriptionForeground: host.description,
        }))
          document.documentElement.style.setProperty(`--vscode-${key}`, value);
        document.getElementById("root")!.style.cssText =
          "width:616px;padding:16px;box-sizing:border-box";
        const m = await import(
          /* @vite-ignore */ "./native/assets/request-panel-960b28c40ada.js"
        );
        m.n();
        w.renderNativeElement(m.t, {
          standalone: true,
          conversationId: "fixture",
          hostId: "local",
          requestId: 1,
          elicitation: {
            kind: "formElicitation",
            serverName: "Fixture",
            message: "填写选择",
            schema,
          },
          onReply: () => {},
        });
      },
      { theme, host, schema },
    );
    await expect(native.getByRole("radio", { name: /隔离/ })).toBeVisible();
    const expected = await native
      .locator("#root [data-codex-character-input-boundary]")
      .evaluate((el) => {
        const card = el.parentElement!,
          choice = el.querySelector("input[type=radio]")!.parentElement!,
          index = choice.querySelector("span")!;
        const css = getComputedStyle(card),
          row = getComputedStyle(choice),
          number = getComputedStyle(index);
        return {
          background: css.backgroundColor,
          radius: css.borderRadius,
          rowMinHeight: row.minHeight,
          rowPadding: row.padding,
          indexWidth: number.width,
          indexHeight: number.height,
          indexRadius: number.borderRadius,
        };
      });
    await installSessionUxFixture(page);
    await page.setViewportSize({ width: 900, height: 500 });
    await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
    await page
      .locator(".session-mode [contenteditable=true]")
      .first()
      .waitFor({ timeout: 60_000 });
    await page.evaluate(
      async ({ theme, host, schema }) => {
        const module = (path: string) =>
          import(
            performance
              .getEntriesByType("resource")
              .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
          );
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
        const { ElicitationItem } = await module(
          "/src/session-mode/components/codex/items/ElicitationItem.tsx",
        );
        const { useElicitationStore } = await module(
          "/src/session-mode/components/codex/stores/useElicitationStore.ts",
        );
        document.getElementById("root")!.style.display = "none";
        document.body.style.margin = "0";
        document.body.style.background = host.background;
        const fixture = document.createElement("div");
        fixture.id = "native-request-product";
        fixture.className = `session-mode ${theme === "dark" ? "dark" : ""}`;
        fixture.style.cssText =
          "width:616px;padding:16px;box-sizing:border-box";
        for (const [key, value] of Object.entries({
          "font-family": "system-ui",
          "editor-background": host.background,
          "sideBar-background": host.secondary,
          "dropdown-background": host.secondary,
          foreground: host.foreground,
          descriptionForeground: host.description,
        }))
          fixture.style.setProperty(`--vscode-${key}`, value);
        document.body.append(fixture);
        useElicitationStore.setState({
          pendingRequests: [
            {
              mode: "form",
              threadId: "fixture",
              turnId: "turn",
              requestId: 1,
              serverName: "Fixture",
              message: "填写选择",
              requestedSchema: schema,
              _meta: null,
            },
          ],
          drafts: {},
        });
        createRoot(fixture).render(
          R.createElement(ElicitationItem, { currentThreadId: "fixture" }),
        );
      },
      { theme, host, schema },
    );
    const product = page.locator("#native-request-product");
    await expect(product.getByRole("radio", { name: /隔离/ })).toBeVisible();
    const actual = await product
      .locator(".codex-elicitation")
      .evaluate((card) => {
        const choice = card.querySelector("input[type=radio]")!.parentElement!,
          index = choice.querySelector(".codex-elicitation__choice-index")!;
        const css = getComputedStyle(card),
          row = getComputedStyle(choice),
          number = getComputedStyle(index);
        return {
          background: css.backgroundColor,
          radius: css.borderRadius,
          rowMinHeight: row.minHeight,
          rowPadding: row.padding,
          indexWidth: number.width,
          indexHeight: number.height,
          indexRadius: number.borderRadius,
        };
      });
    await info.attach("original-request-metrics", {
      body: JSON.stringify({ expected, actual }, null, 2),
      contentType: "application/json",
    });
    await native
      .locator("#root")
      .screenshot({ path: info.outputPath(`native-request-${theme}.png`) });
    await product.screenshot({
      path: info.outputPath(`product-request-${theme}.png`),
    });
    expect(actual).toEqual(expected);
    await native.close();
  });
