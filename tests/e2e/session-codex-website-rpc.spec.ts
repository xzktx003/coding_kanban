import { test, expect, type Locator } from "@playwright/test";
import Fastify from "fastify";
import { writeFile } from "node:fs/promises";
import { WebsitePreviewService } from "../../apps/server/src/services/codex-website-preview";
import { registerCodexWebsitePreviewRoutes } from "../../apps/server/src/routes/codex-website-preview";
import { renderNativeMarkdownReference } from "./session-native-markdown-reference";
import {
  attachNativeWebsiteRpc,
  initializeNativeWebsiteRpc,
} from "./session-native-website-rpc";
import { setup } from "./session-composer-v2-fixture";
const reference = process.env.CODEX_NATIVE_REFERENCE_URL;
async function geometry(tip: Locator, anchor: Locator) {
  const a = (await anchor.boundingBox())!;
  return tip.evaluate((root, a) => {
    const b = root.getBoundingClientRect(),
      s = getComputedStyle(root);
    const field = (e: Element | null) => {
      if (!e) return null;
      const r = e.getBoundingClientRect(),
        c = getComputedStyle(e);
      return {
        x: r.x - b.x,
        y: r.y - b.y,
        width: r.width,
        height: r.height,
        color: c.color,
        font: c.font,
        radius: c.borderRadius,
        objectFit: c.objectFit,
      };
    };
    return {
      width: b.width,
      height: b.height,
      gap:
        root.getAttribute("data-side") === "top"
          ? a.y - b.bottom
          : b.y - a.y - a.height,
      side: root.getAttribute("data-side"),
      bg: s.backgroundColor,
      color: s.color,
      radius: s.borderRadius,
      padding: s.padding,
      border: s.border,
      shadow: s.boxShadow.replace(
        /(?:rgba\(0, 0, 0, 0\) 0px 0px 0px 0px, )+/u,
        "",
      ),
      title: field(root.querySelector("h3")),
      description: field(root.querySelector("p")),
      image: field(root.querySelector("img[width]")),
    };
  }, a);
}
for (const width of [390, 700])
  for (const theme of ["dark", "light"])
    test(`native website RPC and complete tooltip (${width}, ${theme})`, async ({
      page,
    }, info) => {
      test.skip(!reference, "Native reference required");
      test.setTimeout(90000);
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      const f = await setup(page, false),
        native = await page.context().newPage(),
        app = Fastify();
      try {
        const png = Buffer.from(
          await page.evaluate(() => {
            const c = document.createElement("canvas");
            c.width = 400;
            c.height = 200;
            const x = c.getContext("2d")!;
            x.fillStyle = "#3978ae";
            x.fillRect(0, 0, 400, 200);
            return c.toDataURL().split(",")[1];
          }),
          "base64",
        );
        registerCodexWebsitePreviewRoutes(
          app,
          new WebsitePreviewService({
            lookup: async () => [{ address: "93.184.216.34", family: 4 }],
            fetch: async (u) =>
              u.pathname === "/hero.png"
                ? new Response(png, {
                    headers: { "Content-Type": "image/png" },
                  })
                : new Response(
                    `<head><title>Native website RPC</title><meta name="description" content="Preserve the active agent and captured URL.">${u.pathname === "/hero" ? '<meta property="og:image" content="/hero.png">' : ""}</head>`,
                    { headers: { "Content-Type": "text/html" } },
                  ),
          }),
        );
        app.addHook("onRequest", async (_r, reply) => {
          reply.header("Access-Control-Allow-Origin", "*");
        });
        await app.listen({ host: "0.0.0.0", port: 0 });
        const a = app.server.address();
        if (!a || typeof a === "string") throw Error("listener");
        const origin = `http://${new URL(process.env.PLAYWRIGHT_BASE_URL!).hostname}:${a.port}`;
        for (const target of [page, native]) {
          await target.route(
            "**/api/session/api/codex/website-preview**",
            (r) =>
              r.continue({ url: origin + new URL(r.request().url()).pathname }),
          );
          await target.route("https://t0.gstatic.com/**", (r) =>
            r.fulfill({ status: 404, body: "Isolated favicon failure" }),
          );
        }
        const text =
          "[Website text](https://example.com/text)\n\n[Website hero](https://example.com/hero)";
        f.fixture.threads[0].turns = [
          {
            id: "rpc",
            status: "completed",
            items: [
              {
                type: "agentMessage",
                id: "rpc-message",
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
        await native.setViewportSize({ width, height: 900 });
        await native.emulateMedia({ reducedMotion: "reduce" });
        await attachNativeWebsiteRpc(native);
        await renderNativeMarkdownReference(
          native,
          reference!,
          text,
          theme,
          width,
          () => initializeNativeWebsiteRpc(native),
        );
        const results = [];
        for (const kind of ["text", "hero"]) {
          const label = "Website " + kind,
            productLink = page
              .locator(".codex-markdown")
              .getByRole("link", { name: label, exact: true }),
            originalLink = native.getByRole("link", {
              name: label,
              exact: true,
            });
          await expect(productLink).toBeVisible();
          await expect(originalLink).toBeVisible();
          await native.locator("#root").evaluate((e) => {
            (e as HTMLElement).style.transform = "none";
          });
          const a = (await productLink.boundingBox())!,
            b = (await originalLink.boundingBox())!;
          await native.locator("#root").evaluate(
            (e, o) => {
              const s = (e as HTMLElement).style;
              s.transform = "none";
              s.transform = `translate(${o.x}px,${o.y}px)`;
            },
            { x: a.x - b.x, y: a.y - b.y },
          );
          await originalLink.hover();
          await expect(native.getByRole("tooltip").locator("h3")).toHaveText(
            "Native website RPC",
          );
          await productLink.hover();
          await expect(page.getByRole("tooltip").locator("h3")).toHaveText(
            "Native website RPC",
          );
          if (kind === "hero")
            for (const target of [page, native])
              await expect
                .poll(() =>
                  target
                    .getByRole("tooltip")
                    .locator("img[width]")
                    .evaluate(
                      (e: HTMLImageElement) =>
                        e.complete && e.naturalWidth === 400,
                    ),
                )
                .toBe(true);
          const original = await geometry(
              native.getByRole("tooltip"),
              originalLink,
            ),
            product = await geometry(page.getByRole("tooltip"), productLink);
          results.push({ kind, original, product });
          await writeFile(
            info.outputPath("complete-tooltip.json"),
            JSON.stringify(results, null, 2),
          );
          await native
            .getByRole("tooltip")
            .screenshot({ path: info.outputPath(`native-${kind}.png`) });
          await page
            .getByRole("tooltip")
            .screenshot({ path: info.outputPath(`product-${kind}.png`) });
          expect(product).toEqual(original);
          for (const [target, trigger] of [
            [page, productLink],
            [native, originalLink],
          ] as const) {
            await target.bringToFront();
            await trigger.hover();
            await expect(target.getByRole("tooltip").locator("h3")).toHaveText(
              "Native website RPC",
            );
            await target
              .getByRole("tooltip")
              .getByRole("link", { name: "打开网站" })
              .hover();
            await expect(target.getByRole("tooltip")).toBeVisible();
            await target.keyboard.press("Escape");
            await target.waitForTimeout(80);
            await writeFile(
              info.outputPath(
                `${target === page ? "product" : "native"}-${kind}-escape.json`,
              ),
              JSON.stringify(
                await target.evaluate(() => ({
                  active: document.activeElement?.outerHTML.slice(0, 2000),
                  focus: document.hasFocus(),
                  tips: [...document.querySelectorAll('[role="tooltip"]')].map(
                    (e) => ({
                      html: e.outerHTML.slice(0, 12000),
                      style: {
                        display: getComputedStyle(e).display,
                        visibility: getComputedStyle(e).visibility,
                        opacity: getComputedStyle(e).opacity,
                      },
                      rect: e.getBoundingClientRect().toJSON(),
                    }),
                  ),
                })),
                null,
                2,
              ),
            );
            await expect(target.getByRole("tooltip")).toHaveCount(0);
            await target.mouse.move(0, 0);
            await trigger.focus();
            await expect(target.getByRole("tooltip").locator("h3")).toHaveText(
              "Native website RPC",
            );
            await target.keyboard.press("Tab");
            await expect(
              target
                .getByRole("tooltip")
                .getByRole("link", { name: "打开网站" }),
            ).toBeFocused();
            await target.getByRole("tooltip").screenshot({
              path: info.outputPath(
                `${target === page ? "product" : "native"}-${kind}-keyboard.png`,
              ),
            });
            await target.keyboard.press("Escape");
            await expect(target.getByRole("tooltip")).toHaveCount(0);
            await trigger.evaluate((e) => (e as HTMLElement).blur());
            await target.mouse.move(0, 0);
          }
        }
        const calls = await native.evaluate(
          () => (window as any).rpcWebsiteCalls,
        );
        await writeFile(
          info.outputPath("rpc-website-calls.json"),
          JSON.stringify(calls, null, 2),
        );
        expect(calls).toEqual([
          { url: "https://example.com/text" },
          { url: "https://example.com/hero" },
        ]);
        expect(f.calls).toEqual([]);
        expect(f.errors).toEqual([]);
      } finally {
        await native.close();
        await app.close();
        await f.close();
      }
    });
