import { expect, test, type Locator } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { setup } from "./session-composer-v2-fixture";
import { renderNativeMarkdownReference } from "./session-native-markdown-reference";
const reference = process.env.CODEX_NATIVE_REFERENCE_URL;
async function geometry(tip: Locator, link: Locator) {
  const anchor = (await link.boundingBox())!;
  return tip.evaluate((e, a) => {
    const s = getComputedStyle(e),
      r = e.getBoundingClientRect(),
      open = e.querySelector("a")!,
      domain = e.querySelector("span:not(.sr-only)")!,
      bar = open.parentElement!;
    const b = getComputedStyle(bar),
      o = getComputedStyle(open),
      d = getComputedStyle(domain);
    return {
      width: r.width,
      height: r.height,
      side: e.getAttribute("data-side"),
      gap:
        e.getAttribute("data-side") === "top"
          ? a.y - r.bottom
          : r.top - a.y - a.height,
      left: r.x,
      bg: s.backgroundColor,
      color: s.color,
      radius: s.borderRadius,
      padding: s.padding,
      font: s.font,
      line: s.lineHeight,
      bar: {
        height: bar.getBoundingClientRect().height,
        gap: b.gap,
        padding: b.padding,
      },
      domain: { color: d.color, font: d.font, line: d.lineHeight },
      open: { color: o.color, font: o.font, line: o.lineHeight, gap: o.gap },
      glyphs: [...e.querySelectorAll("svg path")].map((p) => [
        p.getAttribute("d"),
        p.getAttribute("fill"),
      ]),
    };
  }, anchor);
}
for (const width of [390, 700])
  test.describe(`Slack preview ${width}`, () => {
    test.use({
      viewport: { width, height: 900 },
      isMobile: width === 390,
      hasTouch: width === 390,
    });
    for (const theme of ["dark", "light"])
      test(`Slack unavailable-preview card matches the actual native branch (${theme})`, async ({
        page,
      }, info) => {
        test.skip(!reference, "Set original native reference URL");
        test.setTimeout(90000);
        const text =
          "[Slack](https://team.slack.com/archives/C123/p1700000000000000)";
        const f = await setup(page, false),
          native = await page.context().newPage();
        try {
          f.fixture.threads[0].turns = [
            {
              id: "slack",
              status: "completed",
              items: [
                {
                  type: "agentMessage",
                  id: "slack-message",
                  text,
                  phase: "final_answer",
                },
              ],
            },
          ] as never;
          await page.evaluate(
            (theme) =>
              localStorage.setItem(
                "kanban.session.theme-storage",
                JSON.stringify({
                  version: 1,
                  state: { theme, accent: "default" },
                }),
              ),
            theme,
          );
          await page.reload();
          await renderNativeMarkdownReference(
            native,
            reference!,
            text,
            theme,
            width,
          );
          const originalLink = native.getByRole("link", {
              name: "Slack",
              exact: true,
            }),
            productLink = page
              .locator(".codex-markdown")
              .getByRole("link", { name: "Slack", exact: true });
          const a = (await productLink.boundingBox())!,
            b = (await originalLink.boundingBox())!;
          await native
            .locator("#root")
            .evaluate(
              (e, o) =>
                ((e as HTMLElement).style.transform =
                  `translate(${o.x}px,${o.y}px)`),
              { x: a.x - b.x, y: a.y - b.y },
            );
          await originalLink.hover();
          await expect(
            native.getByRole("tooltip").getByRole("link", { name: "打开网站" }),
          ).toBeVisible();
          await page
            .locator(".codex-markdown")
            .getByRole("link", { name: "Slack", exact: true })
            .hover();
          await page.getByRole("tooltip").waitFor();
          await native.screenshot({
            path: info.outputPath("native-slack-preview.png"),
          });
          await page.screenshot({
            path: info.outputPath("product-slack-preview.png"),
          });
          await expect(
            page.getByRole("tooltip").getByRole("link", { name: "打开网站" }),
          ).toBeVisible({ timeout: 2000 });
          const original = await geometry(
              native.getByRole("tooltip"),
              originalLink,
            ),
            product = await geometry(page.getByRole("tooltip"), productLink);
          await writeFile(
            info.outputPath("geometry.json"),
            JSON.stringify({ original, product }, null, 2),
          );
          expect(product).toEqual(original);
          for (const target of [page, native]) {
            await target
              .getByRole("tooltip")
              .getByRole("link", { name: "打开网站" })
              .hover();
            await expect(target.getByRole("tooltip")).toBeVisible();
            await target.keyboard.press("Escape");
            await expect(target.getByRole("tooltip")).not.toBeVisible();
          }
          for (const [target, trigger] of [
            [page, productLink],
            [native, originalLink],
          ] as const) {
            await target.mouse.move(0, 0);
            await trigger.focus();
            await expect(target.getByRole("tooltip")).toBeVisible();
            await target.keyboard.press("Tab");
            await expect(
              target
                .getByRole("tooltip")
                .getByRole("link", { name: "打开网站" }),
            ).toBeFocused();
            await expect(target.getByRole("tooltip")).toBeVisible();
            await target.screenshot({
              path: info.outputPath(
                `${target === page ? "product" : "native"}-keyboard.png`,
              ),
            });
            await target.keyboard.press("Escape");
            await expect(target.getByRole("tooltip")).not.toBeVisible();
          }
          const href = "https://team.slack.com/archives/C123/p1700000000000000";
          // Exercise real anchor navigation while isolating the remote site.
          await page.context().route("https://team.slack.com/**", (route) =>
            route.fulfill({
              contentType: "text/html",
              body: "External Slack navigation",
            }),
          );
          for (const [target, trigger] of [
            [page, productLink],
            [native, originalLink],
          ] as const) {
            await target.bringToFront();
            await trigger.evaluate((element) =>
              (element as HTMLElement).blur(),
            );
            await trigger.focus();
            await expect(target.getByRole("tooltip")).toBeVisible();
            const [opened] = await Promise.all([
              target.waitForEvent("popup"),
              target
                .getByRole("tooltip")
                .getByRole("link", { name: "打开网站" })
                .click(),
            ]);
            await opened.waitForURL(href);
            await expect(opened.locator("body")).toHaveText(
              "External Slack navigation",
            );
            await opened.close();
          }
          expect(f.errors).toEqual([]);
          expect(f.calls).toEqual([]);
        } finally {
          await native.close();
          await f.close();
        }
      });
  });

test("Slack Escape closes only its card while the captured Agent turn is running", async ({
  page,
}, info) => {
  const f = await setup(page, true),
    mutations: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (
      request.method() === "POST" &&
      /(?:turn\/interrupt|followups\/interrupt)$/u.test(path)
    )
      mutations.push(path);
  });
  try {
    f.fixture.threads[0].turns[0].items = [
      {
        type: "agentMessage",
        id: "busy-slack",
        text: "[Slack](https://team.slack.com/team/U123)",
        phase: "commentary",
      },
    ] as never;
    await page.reload();
    const stop = page
      .getByRole("button", { name: "停止", exact: true })
      .first();
    await expect(stop).toBeVisible();
    await page
      .locator(".codex-markdown")
      .getByRole("link", { name: "Slack", exact: true })
      .focus();
    await expect(page.getByRole("tooltip")).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "打开网站" })).toBeFocused();
    await page.screenshot({
      path: info.outputPath("running-agent-slack-preview.png"),
    });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("tooltip")).not.toBeVisible();
    await expect(stop).toBeEnabled();
    expect(mutations).toEqual([]);
    expect(f.calls).toEqual([]);
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});
