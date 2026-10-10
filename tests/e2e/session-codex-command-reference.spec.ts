import { expect, test, type Locator, type Page } from "@playwright/test";
import { installSessionUxFixture } from "./session-ux-fixture";

const reference = process.env.CODEX_NATIVE_REFERENCE_URL;

async function settleSummary(header: Locator) {
  // A CSS rotate/opacity transition is not an antialiasing exception. Wait for
  // the same actual completed animation state on both reference and product.
  await expect
    .poll(() =>
      header.evaluate((el) =>
        el
          .getAnimations({ subtree: true })
          .some((animation) => animation.playState === "running"),
      ),
    )
    .toBe(false);
}

async function summaryAppearance(header: Locator, labelSelector: string) {
  return header.evaluate((el, selector) => {
    const label = el.querySelector(selector);
    const icons = [...el.querySelectorAll("svg")];
    if (!label || icons.length !== 2)
      throw new Error("Completed shell summary must have a label and two icons");
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Cannot normalize computed shell colors");
    const rgba = (color: string) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data];
    };
    const icon = (svg: SVGSVGElement) => {
      const rect = svg.getBoundingClientRect();
      return {
        color: rgba(getComputedStyle(svg).color),
        opacity: getComputedStyle(svg).opacity,
        width: rect.width,
        height: rect.height,
        viewBox: svg.getAttribute("viewBox"),
        paths: [...svg.querySelectorAll("path")].map((path) =>
          path.getAttribute("d"),
        ),
      };
    };
    return {
      text: label.textContent,
      color: rgba(getComputedStyle(label).color),
      hovered: el.matches(":hover"),
      terminal: icon(icons[0]),
      chevron: icon(icons[1]),
      // CSS color-mix serialization differs between oklab and srgb even for
      // equal rendered colors. Retain it as evidence, compare normalized RGBA.
      computed: {
        label: getComputedStyle(label).color,
        terminal: getComputedStyle(icons[0]).color,
        chevron: getComputedStyle(icons[1]).color,
        nativeSummaryVariable: getComputedStyle(label).getPropertyValue(
          "--agent-activity-summary-color",
        ),
        headerClass: el.className,
        labelClass: label.className,
      },
    };
  }, labelSelector);
}

function renderedAppearance({
  computed: _computed,
  ...appearance
}: Awaited<ReturnType<typeof summaryAppearance>>) {
  return appearance;
}

async function collapsedSummaryStates(
  page: Page,
  header: Locator,
  labelSelector: string,
) {
  await page.mouse.move(699, 399);
  await settleSummary(header);
  const resting = await summaryAppearance(header, labelSelector);
  expect(resting.hovered).toBe(false);
  await header.hover();
  await settleSummary(header);
  const hover = await summaryAppearance(header, labelSelector);
  expect(hover.hovered).toBe(true);
  await page.mouse.move(699, 399);
  await settleSummary(header);
  const afterLeave = await summaryAppearance(header, labelSelector);
  expect(afterLeave).toEqual(resting);
  return { resting, hover, afterLeave };
}

for (const theme of ["dark", "light"])
  test(`shell matches actual extension component geometry (${theme})`, async ({
    page,
  }, info) => {
    test.skip(
      !reference,
      "Set CODEX_NATIVE_REFERENCE_URL to the isolated original webview harness",
    );
    test.setTimeout(90000);
    const native = await page.context().newPage();
    const errors: string[] = [];
    for (const current of [page, native])
      current.on("pageerror", (e) => errors.push(e.message));
    const host =
      theme === "dark"
        ? {
            background: "#20211d",
            secondary: "#282a23",
            foreground: "#ccc",
            description: "#858585",
            link: "#a9c5de",
          }
        : {
            background: "#fff",
            secondary: "#f5f5f3",
            foreground: "#3b3b3b",
            description: "#717171",
            link: "#006ab1",
          };
    await native.route("**/*", (r) =>
      new URL(r.request().url()).origin === new URL(reference!).origin
        ? r.continue()
        : r.abort(),
    );
    await native.setViewportSize({ width: 700, height: 400 });
    await native.goto(reference!);
    await native.waitForFunction(() => (window as any).nativeLoaded);
    await native.evaluate(
      async ({ host, theme }) => {
        const win = window as any;
        for (const [key, value] of Object.entries({
          "font-family": "system-ui",
          "editor-font-family": "ui-monospace",
          "editor-background": host.background,
          "sideBar-background": host.secondary,
          foreground: host.foreground,
          descriptionForeground: host.description,
          "textCodeBlock-background": host.secondary,
          "textLink-foreground": host.link,
        }))
          document.documentElement.style.setProperty(`--vscode-${key}`, value);
        document.documentElement.setAttribute("data-theme", theme);
        document.body.style.background = host.background;
        document.body.style.color = host.foreground;
        const m = await import(/* @vite-ignore */ "./native-exec-reference.js");
        const S = await import(
          /* @vite-ignore */ "./native/assets/app-initial-e98b9eaef8e3.js"
        );
        m.initNativeExec();
        S.U();
        const { React: R, Dst } = win.nativeModules;
        win.renderNativeElement(
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
                  R.createElement(m.nativeExec, {
                    conversationId: "fixture",
                    isReadOnly: true,
                    item: {
                      cmd: ["/bin/zsh", "-lc", "pnpm test"],
                      cwd: "/fixture/owner",
                      durationMs: 9400,
                      output: {
                        aggregatedOutput: "checks passed\nline two\n",
                        exitCode: 0,
                      },
                      executionStatus: "completed",
                    },
                    summary: {
                      type: "unknown",
                      cmd: "pnpm test",
                      isFinished: true,
                    },
                    isInProgress: false,
                    isBackgroundTerminalRunning: false,
                    isFinishedBackgroundTerminal: false,
                    showSummaryIcon: true,
                  }),
                ),
              ),
            ),
          {},
        );
      },
      { host, theme },
    );
    const nativeSummaryControl = native.locator("#root button").first();
    // Vx renders the original FEi/CEi activity wrapper: its button is an empty
    // absolute overlay, while label and icons are siblings in the parent header.
    const nativeSummary = nativeSummaryControl.locator("..");
    const expectedSummary = await collapsedSummaryStates(
      native,
      nativeSummary,
      ".font-sans",
    );
    await nativeSummaryControl.click();
    await expect(native.locator("#root")).toContainText("成功");
    await native.mouse.move(699, 399);
    await native.waitForTimeout(500);
    await settleSummary(nativeSummary);
    const expectedExpandedSummary = await summaryAppearance(
      nativeSummary,
      ".font-sans",
    );
    const expected = await native
      .locator("#root .border-strong")
      .evaluate((el) => {
        const rect = el.getBoundingClientRect();
        const command = el.querySelector('[role="button"]')!;
        const output = el.querySelector(".vertical-scroll-fade-mask")!;
        return {
          height: rect.height,
          width: rect.width,
          outputHeight: output.getBoundingClientRect().height,
          commandSize: getComputedStyle(command).fontSize,
          commandLineHeight: getComputedStyle(command).lineHeight,
          commandFont: getComputedStyle(
            command.querySelector("code") ?? command,
          ).fontFamily,
          outputFont: getComputedStyle(output.querySelector("code")!)
            .fontFamily,
          outputSize: getComputedStyle(output).fontSize,
          outputLineHeight: getComputedStyle(output).lineHeight,
          background: getComputedStyle(el).backgroundColor,
          radius: getComputedStyle(el).borderRadius,
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
      async ({ host, theme }) => {
        const dependency = (name: string) => {
          const entry = performance
            .getEntriesByType("resource")
            .findLast((e) =>
              new URL(e.name).pathname.endsWith(`/deps/${name}`),
            );
          if (!entry) throw new Error(`Missing mounted dependency: ${name}`);
          return entry.name;
        };
        const react = await import(dependency("react.js"));
        const dom = await import(dependency("react-dom_client.js"));
        const R = react.default ?? react;
        const { createRoot } = dom.default ?? dom;
        const { ShellCommand } =
          await import("/src/session-mode/components/codex/items/ShellCommand.tsx");
        document.getElementById("root")!.style.display = "none";
        document.body.style.margin = "0";
        document.body.style.background = host.background;
        const fixture = document.createElement("div");
        fixture.id = "native-command-product";
        fixture.className = `session-mode ${theme === "dark" ? "dark" : ""}`;
        fixture.style.cssText =
          "width:616px;padding:16px;box-sizing:border-box";
        fixture.style.background = host.background;
        for (const [key, value] of Object.entries({
          "font-family": "system-ui",
          "editor-font-family": "ui-monospace",
          "editor-background": host.background,
          "sideBar-background": host.secondary,
          foreground: host.foreground,
          descriptionForeground: host.description,
          "textCodeBlock-background": host.secondary,
          "textLink-foreground": host.link,
        }))
          fixture.style.setProperty(`--vscode-${key}`, value);
        document.body.append(fixture);
        createRoot(fixture).render(
          R.createElement(
            "div",
            { className: "codex-presentation" },
            R.createElement(ShellCommand, {
              threadId: "fixture",
              turnId: "turn",
              commandItemId: "cmd",
              command: "/bin/zsh -lc 'pnpm test'",
              cwd: "/fixture/owner",
              status: "completed",
              durationMs: 9400,
              aggregatedOutput: "checks passed\nline two\n",
              exitCode: 0,
            }),
          ),
        );
      },
      { host, theme },
    );
    const productSummary = page.locator(
      "#native-command-product .codex-command-summary",
    );
    await expect(productSummary).toBeVisible();
    const actualSummary = await collapsedSummaryStates(
      page,
      productSummary,
      ".codex-command-summary-label",
    );
    await productSummary.click();
    await page.mouse.move(699, 399);
    await page.waitForTimeout(500);
    await settleSummary(productSummary);
    const actualExpandedSummary = await summaryAppearance(
      productSummary,
      ".codex-command-summary-label",
    );
    const actual = await page
      .locator("#native-command-product .codex-command-shell")
      .evaluate((el) => {
        const rect = el.getBoundingClientRect();
        const command = el.querySelector(".codex-command-line")!;
        const output = el.querySelector(".codex-command-output")!;
        return {
          height: rect.height,
          width: rect.width,
          outputHeight: output.getBoundingClientRect().height,
          commandSize: getComputedStyle(command).fontSize,
          commandLineHeight: getComputedStyle(command).lineHeight,
          commandFont: getComputedStyle(command.querySelector("code")!)
            .fontFamily,
          outputFont: getComputedStyle(output.querySelector("code")!)
            .fontFamily,
          outputSize: getComputedStyle(output).fontSize,
          outputLineHeight: getComputedStyle(output).lineHeight,
          background: getComputedStyle(el).backgroundColor,
          radius: getComputedStyle(el).borderRadius,
        };
      });
    await info.attach("native-shell-metrics", {
      body: JSON.stringify({ expected, actual }, null, 2),
      contentType: "application/json",
    });
    await info.attach("native-shell-summary-states", {
      body: JSON.stringify(
        {
          expected: expectedSummary,
          actual: actualSummary,
          expectedExpanded: expectedExpandedSummary,
          actualExpanded: actualExpandedSummary,
        },
        null,
        2,
      ),
      contentType: "application/json",
    });
    console.log(
      JSON.stringify({
        expected,
        actual,
        children: await page
          .locator("#native-command-product .codex-command-shell")
          .evaluate((el) =>
            [...el.querySelectorAll("div,code,button")].map((child) => ({
              class: child.className,
              height: child.getBoundingClientRect().height,
              font: getComputedStyle(child).fontSize,
              line: getComputedStyle(child).lineHeight,
            })),
          ),
      }),
    );
    await page.screenshot({ path: info.outputPath(`product-${theme}.png`) });
    await native.screenshot({
      path: info.outputPath(`reference-${theme}.png`),
    });
    for (const key of ["height", "width", "outputHeight"] as const)
      expect(actual[key]).toBeCloseTo(expected[key], 0);
    for (const key of [
      "commandSize",
      "commandLineHeight",
      "outputSize",
      "outputLineHeight",
      "background",
      "radius",
    ] as const)
      expect(actual[key]).toBe(expected[key]);
    expect(actual.commandFont).toBe(expected.commandFont);
    expect(actual.outputFont).toBe(expected.outputFont);
    // Compare the final enabled FEi/CEi wrapper, including its important child
    // color override, rather than treating Vx's inner status class as final CSS.
    expect
      .soft(renderedAppearance(actualSummary.resting))
      .toEqual(renderedAppearance(expectedSummary.resting));
    expect
      .soft(renderedAppearance(actualSummary.hover))
      .toEqual(renderedAppearance(expectedSummary.hover));
    expect
      .soft(renderedAppearance(actualSummary.afterLeave))
      .toEqual(renderedAppearance(expectedSummary.afterLeave));
    expect
      .soft(renderedAppearance(actualExpandedSummary))
      .toEqual(renderedAppearance(expectedExpandedSummary));
    expect(errors).toEqual([]);
    await native.close();
  });
