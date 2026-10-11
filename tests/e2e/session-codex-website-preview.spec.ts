import { expect, test, type Locator } from "@playwright/test";
import Fastify from "fastify";
import { writeFile, readFile } from "node:fs/promises";
import { WebsitePreviewService } from "../../apps/server/src/services/codex-website-preview";
import { registerCodexWebsitePreviewRoutes } from "../../apps/server/src/routes/codex-website-preview";
import { setup } from "./session-composer-v2-fixture";
import { renderNativeMarkdownReference } from "./session-native-markdown-reference";
const reference = process.env.CODEX_NATIVE_REFERENCE_URL;
test("closed website cards release large payloads beyond the native host cache budget", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const f = await setup(page, false),
    app = Fastify();
  const pixel = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
    "base64",
  );
  try {
    app.addHook("onRequest", async (_req, reply) => {
      reply.raw.setHeader("Access-Control-Allow-Origin", "*");
    });
    app.options("/*", (_req, reply) =>
      reply
        .header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        .header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        .send(),
    );
    app.get(
      "/api/session/api/codex/website-preview/capabilities",
      async () => ({ supported: true }),
    );
    app.post("/api/session/api/codex/website-preview", async (req) => {
      const index = Number(
        new URL((req.body as any).url).pathname.split("/").at(-1),
      );
      const bytes = Buffer.alloc(2 * 1024 * 1024);
      pixel.copy(bytes);
      bytes[bytes.length - 1] = index;
      return {
        status: "ready",
        title: `Image ${index}`,
        description: null,
        image: {
          dataUrl: `data:image/png;base64,${bytes.toString("base64")}`,
          width: 1,
          height: 1,
        },
      };
    });
    await app.listen({ host: "0.0.0.0", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") throw Error("listener");
    const origin = `http://${new URL(process.env.PLAYWRIGHT_BASE_URL!).hostname}:${address.port}`;
    await page.route("**/api/session/api/codex/website-preview**", (r) =>
      r.continue({ url: origin + new URL(r.request().url()).pathname }),
    );
    await page.evaluate(async () => {
      const module = (path: string) =>
          import(
            performance
              .getEntriesByType("resource")
              .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
          ),
        w = window as any;
      const rm = await import(w.__sessionFixtureDependency("react.js")),
        dm = await import(w.__sessionFixtureDependency("react-dom_client.js")),
        R = rm.default ?? rm,
        { NativeWebsitePreview } = await module(
          "/src/session-mode/components/codex/presentation/NativeWebsitePreview.tsx",
        );
      const c = document.createElement("div");
      c.style.cssText = "position:fixed;left:16px;top:16px;z-index:100";
      document.querySelector(".session-mode")!.append(c);
      w.websiteMemoryRoot = (dm.default ?? dm).createRoot(c);
      w.websiteMemoryRoot.render(
        R.createElement(
          "div",
          {},
          ...Array.from({ length: 40 }, (_, i) =>
            R.createElement(
              NativeWebsitePreview,
              { key: i, href: `https://example.com/memory/${i}` },
              R.createElement(
                "a",
                {
                  href: `https://example.com/memory/${i}`,
                  style: { marginRight: 8 },
                },
                `Image ${i}`,
              ),
            ),
          ),
        ),
      );
    });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Runtime.enable");
    const browserCdp = await page.context().browser()!.newBrowserCDPSession();
    const sample = async () => {
      await cdp.send("HeapProfiler.collectGarbage");
      await cdp.send("HeapProfiler.collectGarbage");
      const heap = await cdp.send("Runtime.getHeapUsage");
      const { processInfo } = await browserCdp.send(
        "SystemInfo.getProcessInfo",
      );
      const renderers = await Promise.all(
        processInfo
          .filter((p: any) => p.type === "renderer")
          .map(async (p: any) => {
            try {
              const status = await readFile(`/proc/${p.id}/status`, "utf8");
              return {
                pid: p.id,
                rss: Number(/VmRSS:\s+(\d+)/u.exec(status)?.[1] ?? 0) * 1024,
              };
            } catch {
              return { pid: p.id, rss: null };
            }
          }),
      );
      return {
        usedSize: heap.usedSize,
        backingStorageSize: heap.backingStorageSize,
        embedderHeapUsedSize: heap.embedderHeapUsedSize,
        renderers,
      };
    };
    await page.getByRole("link", { name: "Image 0", exact: true }).hover();
    await expect(page.locator(".codex-native-website-preview h3")).toHaveText(
      "Image 0",
    );
    await expect
      .poll(() =>
        page
          .locator(".codex-native-slack-body img")
          .evaluate(
            (image: HTMLImageElement) =>
              image.complete && image.naturalWidth === 1,
          ),
      )
      .toBe(true);
    await page.keyboard.press("Escape");
    const baseline = await sample();
    for (let i = 1; i < 40; i++) {
      const trigger = page.getByRole("link", {
        name: `Image ${i}`,
        exact: true,
      });
      await trigger.focus();
      await expect(page.locator(".codex-native-website-preview h3")).toHaveText(
        `Image ${i}`,
      );
      await expect
        .poll(() =>
          page
            .locator(".codex-native-slack-body img")
            .evaluate(
              (image: HTMLImageElement) =>
                image.complete && image.naturalWidth === 1,
            ),
        )
        .toBe(true);
      await page.keyboard.press("Escape");
    }
    await page.evaluate(
      () =>
        new Promise<void>((r) =>
          requestAnimationFrame(() => requestAnimationFrame(() => r())),
        ),
    );
    const after = await sample();
    await writeFile(
      info.outputPath("website-heap-budget.json"),
      JSON.stringify(
        {
          baseline,
          after,
          increase: after.usedSize - baseline.usedSize,
          boundary:
            "40 unique 2MiB image payloads through native browser HTTP; test-only GC checks JS and backing storage; renderer RSS is recorded separately, not a natural-GC or long-running production stability claim.",
        },
        null,
        2,
      ),
    );
    await page.screenshot({
      path: info.outputPath("closed-website-cards.png"),
    });
    expect(after.usedSize - baseline.usedSize).toBeLessThan(42 * 1024 * 1024);
    expect(after.backingStorageSize - baseline.backingStorageSize).toBeLessThan(
      42 * 1024 * 1024,
    );
    expect(f.calls).toEqual([]);
    expect(f.errors).toEqual([]);
  } finally {
    await app.close();
    await f.close();
  }
});
async function geometry(card: Locator) {
  return card.evaluate((root) => {
    const b = root.getBoundingClientRect();
    const field = (e: Element | null) => {
      if (!e) return null;
      const r = e.getBoundingClientRect(),
        s = getComputedStyle(e);
      return {
        x: r.x - b.x,
        y: r.y - b.y,
        width: r.width,
        height: r.height,
        font: s.font,
        color: s.color,
        text: e.textContent,
        radius: s.borderRadius,
        objectFit: s.objectFit,
      };
    };
    const header =
      root.querySelector(".codex-native-slack-toolbar") ??
      root.firstElementChild;
    return {
      width: b.width,
      height: b.height,
      brand: field(
        header?.firstElementChild?.tagName.toLowerCase() === "svg"
          ? header.firstElementChild
          : null,
      ),
      title: field(root.querySelector("h3")),
      description: field(root.querySelector("p")),
      image: field(
        root.querySelector(".codex-native-slack-body img, img[width]"),
      ),
    };
  });
}
for (const width of [390, 700])
  for (const theme of ["dark", "light"])
    test(`Website production HTTP and native image layouts (${width}, ${theme})`, async ({
      page,
    }, info) => {
      test.skip(!reference, "Set original native reference URL");
      test.setTimeout(90000);
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      const f = await setup(page, false),
        native = await page.context().newPage(),
        app = Fastify();
      await page.route("https://t0.gstatic.com/**", (r) =>
        r.fulfill({ status: 404, body: "Isolated favicon failure" }),
      );
      const image = await page.evaluate(() => {
        const c = document.createElement("canvas");
        c.width = 400;
        c.height = 200;
        const ctx = c.getContext("2d")!;
        ctx.fillStyle = "#3778b2";
        ctx.fillRect(0, 0, 400, 200);
        ctx.fillStyle = "#80dabe";
        ctx.fillRect(100, 40, 160, 100);
        return c.toDataURL();
      });
      for (const target of [page, native])
        await target.route("https://t0.gstatic.com/**", (r) =>
          r.fulfill({
            status: 200,
            contentType: "image/png",
            body: Buffer.from(image.split(",")[1]!, "base64"),
          }),
        );
      const small = await page.evaluate(() => {
        const c = document.createElement("canvas");
        c.width = 100;
        c.height = 200;
        const ctx = c.getContext("2d")!;
        ctx.fillStyle = "#3778b2";
        ctx.fillRect(0, 0, 100, 200);
        return c.toDataURL();
      });
      const upstream: string[] = [],
        http: string[] = [];
      const service = new WebsitePreviewService({
        lookup: async () => [{ address: "93.184.216.34", family: 4 }],
        fetch: async (url) => {
          upstream.push(url.href);
          if (url.pathname === "/hero.png" || url.pathname === "/small.png")
            return new Response(
              Buffer.from(
                (url.pathname === "/hero.png" ? image : small).split(",")[1],
                "base64",
              ),
              { headers: { "content-type": "image/png" } },
            );
          if (url.pathname === "/no-metadata")
            return new Response("<head></head>", {
              headers: { "content-type": "text/html" },
            });
          if (url.pathname === "/direct-image")
            return new Response(Buffer.from(image.split(",")[1], "base64"), {
              headers: { "content-type": "image/png" },
            });
          const kind = url.pathname.slice(1),
            alone = kind === "standalone";
          return new Response(
            `<head>${alone ? "" : "<title>Release review</title><meta name=description content='Preserve running agents and the current workspace.'>"}${kind === "text-only" ? "" : `<meta property=og:image content='/${kind === "hero" ? "hero" : "small"}.png'>`}</head>`,
            { headers: { "content-type": "text/html" } },
          );
        },
      });
      try {
        app.addHook("onRequest", async (req, reply) => {
          http.push(req.url);
          reply.raw.setHeader("Access-Control-Allow-Origin", "*");
        });
        app.options("/*", (_req, reply) =>
          reply
            .header(
              "Access-Control-Allow-Headers",
              "Content-Type, Authorization",
            )
            .header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            .send(),
        );
        registerCodexWebsitePreviewRoutes(app, service);
        await app.listen({ host: "0.0.0.0", port: 0 });
        const address = app.server.address();
        if (!address || typeof address === "string") throw Error("listener");
        const origin = `http://${new URL(process.env.PLAYWRIGHT_BASE_URL!).hostname}:${address.port}`;
        await page.route(
          "**/api/session/api/codex/website-preview**",
          (route) =>
            route.continue({
              url: origin + new URL(route.request().url()).pathname,
            }),
        );
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
        await page
          .locator(".session-codex-composer [contenteditable=true]")
          .first()
          .waitFor();
        await native.route("https://t0.gstatic.com/**", (r) =>
          r.fulfill({
            status: 200,
            contentType: "image/png",
            body: Buffer.from(image.split(",")[1]!, "base64"),
          }),
        );
        await native.setViewportSize({ width, height: 900 });
        await native.emulateMedia({ reducedMotion: "reduce" });
        await renderNativeMarkdownReference(
          native,
          reference!,
          "ready",
          theme,
          width,
        );
        const measurements = [];
        for (const kind of [
          "hero",
          "thumbnail",
          "standalone",
          "text-only",
          "no-metadata",
          "direct-image",
          "github-pr-off",
        ]) {
          const href =
              kind === "github-pr-off"
                ? "https://github.com/OpenAI/Codex/pull/42"
                : `https://example.com/${kind}`,
            data = await service.get({ url: href });
          await native.evaluate(
            async ({ href, data }) => {
              const S = await import(
                /* @vite-ignore */ "./native/assets/app-initial-e98b9eaef8e3.js"
              );
              S.Wb();
              const w = window as any,
                R = w.nativeModules.React;
              document.getElementById("root")!.style.cssText =
                "width:360px;padding:0;margin:16px";
              w.renderNativeElement(S._, {
                children: R.createElement(S.Ub, {
                  href,
                  data,
                  loadRemoteIcon: true,
                }),
              });
            },
            { href, data },
          );
          await page.evaluate(
            async ({ href }) => {
              const module = (path: string) =>
                import(
                  performance
                    .getEntriesByType("resource")
                    .findLast((e) => new URL(e.name).pathname === path)?.name ??
                    path
                );
              const w = window as any,
                rm = await import(w.__sessionFixtureDependency("react.js")),
                dm = await import(
                  w.__sessionFixtureDependency("react-dom_client.js")
                ),
                R = rm.default ?? rm;
              const { NativeWebsitePreview } = await module(
                "/src/session-mode/components/codex/presentation/NativeWebsitePreview.tsx",
              );
              const { NativeGithubPreview } = await module(
                "/src/session-mode/components/codex/presentation/NativeGithubPreview.tsx",
              );
              w.websiteRoot?.unmount();
              document.getElementById("website-fixture")?.remove();
              const c = document.createElement("div");
              c.id = "website-fixture";
              c.style.cssText = "position:fixed;left:16px;top:16px;z-index:100";
              document.querySelector(".session-mode")!.append(c);
              w.websiteRoot = (dm.default ?? dm).createRoot(c);
              w.websiteRoot.render(
                R.createElement(
                  href.includes("github.com")
                    ? NativeGithubPreview
                    : NativeWebsitePreview,
                  { href },
                  R.createElement("a", { href }, "Website"),
                ),
              );
            },
            { href },
          );
          const trigger = page.getByRole("link", {
            name: "Website",
            exact: true,
          });
          await trigger.focus();
          // Host discovery precedes choosing a rich tooltip. Focus the new native trigger after the capability has resolved.
          await expect
            .poll(() => http.some((path) => path.endsWith("/capabilities")))
            .toBe(true);
          await trigger.evaluate((e) => (e as HTMLElement).blur());
          await trigger.focus();
          const product = page.locator(".codex-native-website-preview"),
            original = native.locator('[class~="w-90"]');
          await expect(product).toBeVisible();
          if (kind !== "github-pr-off") {
            const productIcon = product.locator(
                ".codex-native-slack-toolbar img",
              ),
              originalIcon = original.locator("img:not([width])");
            await expect(productIcon).toHaveCSS("opacity", "1");
            await expect(originalIcon).toHaveCSS("opacity", "1");
            expect(await productIcon.getAttribute("src")).toBe(
              await originalIcon.getAttribute("src"),
            );
            await expect(productIcon).toHaveCSS("object-fit", "contain");
            await expect(originalIcon).toHaveCSS("object-fit", "contain");
            await expect(productIcon).toHaveCSS("border-radius", "2.5px");
            await expect(originalIcon).toHaveCSS("border-radius", "2.5px");
            await expect(
              product.locator(".codex-native-slack-toolbar svg"),
            ).toHaveCount(1);
            await expect(original.locator("svg")).toHaveCount(1);
          } else {
            await expect(
              product.locator(".codex-native-slack-toolbar img"),
            ).toHaveCount(0);
            await expect(
              product.locator(".codex-native-slack-toolbar svg"),
            ).toHaveCount(2);
            await expect(original.locator("svg")).toHaveCount(2);
          }
          if (!["text-only", "no-metadata", "direct-image"].includes(kind)) {
            await expect(
              product.locator(".codex-native-slack-body img"),
            ).toBeVisible();
            await expect(original.locator("img[width]")).toBeVisible();
            await expect
              .poll(() =>
                product
                  .locator(".codex-native-slack-body img")
                  .evaluate(
                    (i: HTMLImageElement) => i.complete && i.naturalWidth > 0,
                  ),
              )
              .toBe(true);
          } else if (kind === "text-only")
            await expect(product.locator("h3")).toHaveText("Release review");
          else await expect(product.locator("h3")).toHaveCount(0);
          await page.keyboard.press("Tab");
          await expect(
            page.getByRole("link", { name: "打开网站" }),
          ).toBeFocused();
          await page.screenshot({
            path: info.outputPath(`product-${kind}.png`),
          });
          await native.screenshot({
            path: info.outputPath(`native-${kind}.png`),
          });
          const actual = await geometry(product),
            expected = await geometry(original);
          measurements.push({ kind, actual, expected });
          await writeFile(
            info.outputPath("geometry.json"),
            JSON.stringify(measurements, null, 2),
          );
          expect(actual).toEqual(expected);
          await page.keyboard.press("Escape");
          await expect(product).toHaveCount(0);
          await expect(trigger).toBeFocused();
        }
        expect(upstream.length).toBe(11);
        expect(f.calls).toEqual([]);
        expect(f.errors).toEqual([]);
        await writeFile(
          info.outputPath("http-evidence.json"),
          JSON.stringify(
            {
              http,
              upstream,
              boundary:
                "Native browser fetch and production route/service; public DNS and upstream HTML/image bytes are an isolated transport fixture.",
            },
            null,
            2,
          ),
        );
      } finally {
        await native.close();
        await app.close();
        await f.close();
      }
    });

test("live public HTTPS preview through the formal LAN gateway", async ({
  page,
}, info) => {
  const href = process.env.CODEX_WEBSITE_LIVE_URL;
  test.skip(
    !href || !reference,
    "Explicit public website and native reference required",
  );
  test.setTimeout(45000);
  await page.setViewportSize({ width: 700, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const f = await setup(page, false),
    native = await page.context().newPage();
  try {
    await page.route("**/api/session/api/codex/website-preview**", (r) =>
      r.continue(),
    );
    await page.route("https://t0.gstatic.com/**", (r) =>
      r.fulfill({ status: 404, body: "Isolated favicon" }),
    );
    await page.evaluate(async (href) => {
      const w = window as any,
        rm = await import(w.__sessionFixtureDependency("react.js")),
        dm = await import(w.__sessionFixtureDependency("react-dom_client.js")),
        R = rm.default ?? rm;
      const module = (p: string) =>
        import(
          performance
            .getEntriesByType("resource")
            .findLast((e) => new URL(e.name).pathname === p)?.name ?? p
        );
      const { NativeWebsitePreview } = await module(
        "/src/session-mode/components/codex/presentation/NativeWebsitePreview.tsx",
      );
      const c = document.createElement("div");
      c.style.cssText = "position:fixed;left:16px;top:16px;z-index:100";
      document.querySelector(".session-mode")!.append(c);
      w.liveWebsiteRoot = (dm.default ?? dm).createRoot(c);
      w.liveWebsiteRoot.render(
        R.createElement(
          NativeWebsitePreview,
          { href },
          R.createElement("a", { href }, "Live public website"),
        ),
      );
    }, href!);
    await page.waitForTimeout(400);
    const response = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname ===
          "/api/session/api/codex/website-preview" &&
        r.request().method() === "POST",
    );
    await page
      .getByRole("link", { name: "Live public website", exact: true })
      .focus();
    const data = await (await response).json();
    expect(data.status).toBe("ready");
    expect(data.title).toBeTruthy();
    const product = page.locator(".codex-native-website-preview");
    await expect(product.locator("h3")).toHaveText(data.title);
    await native.setViewportSize({ width: 700, height: 900 });
    await native.emulateMedia({ reducedMotion: "reduce" });
    await renderNativeMarkdownReference(
      native,
      reference!,
      "ready",
      "dark",
      700,
    );
    await native.evaluate(
      async ({ href, data }) => {
        const S = await import(
          /* @vite-ignore */ "./native/assets/app-initial-e98b9eaef8e3.js"
        );
        S.Wb();
        const w = window as any;
        document.getElementById("root")!.style.cssText =
          "width:360px;padding:0;margin:16px";
        w.renderNativeElement(S._, {
          children: w.nativeModules.React.createElement(S.Ub, { href, data }),
        });
      },
      { href: href!, data },
    );
    const original = native.locator('[class~="w-90"]');
    await expect(original.locator("h3")).toHaveText(data.title);
    await page.waitForTimeout(100);
    const actual = await geometry(product),
      expected = await geometry(original);
    expect(actual).toEqual(expected);
    await product.screenshot({
      path: info.outputPath("product-live-website.png"),
    });
    await original.screenshot({
      path: info.outputPath("native-live-website.png"),
    });
    await writeFile(
      info.outputPath("public-website-evidence.json"),
      JSON.stringify(
        {
          href,
          data,
          actual,
          expected,
          boundary:
            "Actual browser fetch through formal gateway to public HTTPS. Native original card renders exactly this returned projection; no logged-in account or Agent request.",
        },
        null,
        2,
      ),
    );
    await page.evaluate(async () => {
      const p = "/src/session-mode/lib/i18n.ts";
      const m = await import(
        performance
          .getEntriesByType("resource")
          .findLast((e) => new URL(e.name).pathname === p)?.name ?? p
      );
      await m.i18n.changeLanguage("ja");
    });
    await expect(
      product.getByRole("link", { name: "ウェブサイトを開く" }),
    ).toHaveText("ウェブサイトを開く");
    await native.evaluate(
      async ({ href, data }) => {
        const S = await import(
            /* @vite-ignore */ "./native/assets/app-initial-e98b9eaef8e3.js"
          ),
          { default: messages } = await import(
            /* @vite-ignore */ "./native/assets/ja-JP-cccb9b32b90a.js"
          );
        const w = window as any,
          { React: R, cyt } = w.nativeModules;
        w.renderNativeElement(S._, {
          children: R.createElement(
            cyt,
            { locale: "ja-JP", messages, onError: () => {} },
            R.createElement(S.Ub, { href, data }),
          ),
        });
      },
      { href: href!, data },
    );
    await expect(
      original.getByRole("link", { name: "ウェブサイトを開く" }),
    ).toHaveText("ウェブサイトを開く");
    expect(await geometry(product)).toEqual(await geometry(original));
    await product.screenshot({
      path: info.outputPath("product-japanese-website.png"),
    });
    await original.screenshot({
      path: info.outputPath("native-japanese-website.png"),
    });
    const destination = new URL(href!).href;
    await page.context().route(destination, (r) =>
      r.fulfill({
        contentType: "text/html",
        body: "<body>External website navigation</body>",
      }),
    );
    for (const [label, target] of [
      ["product", page],
      ["native", native],
    ] as const) {
      await target.bringToFront();
      if (target === page) {
        const trigger = page.getByRole("link", {
          name: "Live public website",
          exact: true,
        });
        await trigger.evaluate((e) => (e as HTMLElement).blur());
        await trigger.focus();
        await expect(product).toBeVisible();
      }
      const [opened] = await Promise.all([
        target.waitForEvent("popup"),
        target.getByRole("link", { name: "ウェブサイトを開く" }).click(),
      ]);
      await opened.waitForURL(destination);
      await expect(opened.locator("body")).toHaveText(
        "External website navigation",
      );
      await opened.screenshot({
        path: info.outputPath(label + "-opened-website.png"),
      });
      await opened.close();
    }
    expect(f.calls).toEqual([]);
    expect(f.errors).toEqual([]);
  } finally {
    await native.close();
    await f.close();
  }
});
