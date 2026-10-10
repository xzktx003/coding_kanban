import { expect, test } from "@playwright/test";
import { installSessionUxFixture } from "./session-ux-fixture";

const reference = process.env.CODEX_NATIVE_REFERENCE_URL;
for (const theme of ["dark", "light"])
  test(`exploration matches actual plugin captions, file links and colors (${theme})`, async ({
    page,
  }, info) => {
    test.skip(
      !reference,
      "Set CODEX_NATIVE_REFERENCE_URL to the isolated original webview harness",
    );
    test.setTimeout(90000);
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
    const native = await page.context().newPage();
    const errors: string[] = [];
    for (const current of [page, native])
      current.on("pageerror", (e) => errors.push(e.message));
    await native.route("**/*", (r) =>
      new URL(r.request().url()).origin === new URL(reference!).origin
        ? r.continue()
        : r.abort(),
    );
    await native.setViewportSize({ width: 700, height: 400 });
    await native.goto(reference!);
    await native.waitForFunction(() => (window as any).nativeLoaded);
    await native.evaluate(
      async ({ theme, host }) => {
        const w = window as any;
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
        const m = await import(/* @vite-ignore */ "./native-exec-reference.js"),
          S = await import(
            /* @vite-ignore */ "./native/assets/app-initial-e98b9eaef8e3.js"
          );
        m.initNativeExec();
        S.U();
        const { React: R, Dst } = w.nativeModules;
        w.renderNativeElement(
          () =>
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
                  R.createElement(
                    "div",
                    { style: { display: "flex", flexDirection: "column" } },
                    R.createElement(m.nativeRead, {
                      summary: {
                        type: "read",
                        isFinished: true,
                        name: "100%done:a.md",
                        path: "/fixture/100%done:a.md",
                      },
                      cwd: "/fixture",
                      hostId: "local",
                    }),
                    R.createElement(m.nativeSearch, {
                      summary: {
                        type: "search",
                        isFinished: true,
                        query: "foo",
                        path: "src",
                      },
                    }),
                    R.createElement(m.nativeList, {
                      summary: {
                        type: "list_files",
                        isFinished: true,
                        path: "src",
                      },
                    }),
                  ),
                ),
              ),
            ),
          {},
        );
      },
      { theme, host },
    );
    await expect(
      native.getByRole("link", { name: "100%done:a.md" }),
    ).toBeVisible();
    const expected = await native.locator("#root").evaluate((el) => {
      const link = el.querySelector('[role="link"]')!,
        label = link.parentElement!.parentElement!,
        verb = label.firstElementChild!;
      return {
        text: el.textContent,
        link: {
          height: link.getBoundingClientRect().height,
          width: link.getBoundingClientRect().width,
          color: getComputedStyle(link).color,
          decoration: getComputedStyle(link).textDecoration,
          offset: getComputedStyle(link).textUnderlineOffset,
          font: getComputedStyle(link).font,
        },
        labelColor: getComputedStyle(label).color,
        verbColor: getComputedStyle(verb).color,
      };
    });
    await installSessionUxFixture(page);
    await page.setViewportSize({ width: 700, height: 400 });
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
        const { CommandActionItem } =
          await import("/src/session-mode/components/codex/items/CommandActionItem.tsx");
        document.getElementById("root")!.style.display = "none";
        document.body.style.margin = "0";
        document.body.style.background = host.background;
        const fixture = document.createElement("div");
        fixture.id = "native-exploration-product";
        fixture.className = `session-mode ${theme === "dark" ? "dark" : ""}`;
        fixture.style.cssText =
          "width:616px;padding:16px;box-sizing:border-box";
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
        createRoot(fixture).render(
          R.createElement(
            "div",
            {
              className: "codex-presentation",
              style: { display: "flex", flexDirection: "column" },
            },
            ...[
              {
                type: "read",
                name: "100%done:a.md",
                path: "/fixture/100%done:a.md",
                command: "cat file",
              },
              { type: "search", query: "foo", path: "src", command: "rg foo" },
              { type: "listFiles", path: "src", command: "ls src" },
            ].map((action) =>
              R.createElement(CommandActionItem, {
                key: action.type,
                action,
                status: "completed",
                threadId: "fixture",
                cwd: "/fixture",
              }),
            ),
          ),
        );
      },
      { theme, host },
    );
    const product = page.locator("#native-exploration-product");
    await expect(
      product.getByRole("link", { name: "100%done:a.md" }),
    ).toBeVisible();
    const actual = await product.evaluate((el) => {
      const link = el.querySelector("a")!,
        label = link.parentElement!,
        verb = label.firstElementChild!;
      return {
        text: el.textContent,
        link: {
          height: link.getBoundingClientRect().height,
          width: link.getBoundingClientRect().width,
          color: getComputedStyle(link).color,
          decoration: getComputedStyle(link).textDecoration,
          offset: getComputedStyle(link).textUnderlineOffset,
          font: getComputedStyle(link).font,
        },
        labelColor: getComputedStyle(label).color,
        verbColor: getComputedStyle(verb).color,
      };
    });
    await info.attach("original-exploration-metrics", {
      body: JSON.stringify({ expected, actual }, null, 2),
      contentType: "application/json",
    });
    expect(actual).toEqual(expected);
    await native.locator("#root").screenshot({
      path: info.outputPath(`reference-exploration-${theme}.png`),
    });
    await product.screenshot({
      path: info.outputPath(`product-exploration-${theme}.png`),
    });
    expect(errors).toEqual([]);
    await native.close();
  });
