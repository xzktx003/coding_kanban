import { test, expect, type Page } from "@playwright/test";
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

async function fixture(
  page: Page,
  theme: string,
  height: number,
  delayed: boolean,
  brokenImage = false,
  width = 700,
) {
  await page.setViewportSize({ width, height });
  await page.emulateMedia({
    reducedMotion: delayed ? "no-preference" : "reduce",
  });
  const f = await setup(page, false),
    native = await page.context().newPage(),
    app = Fastify();
  const pending = new Map<string, () => void>();
  const reads: string[] = [];
  const png = Buffer.from(
    await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 400;
      c.height = 200;
      c.getContext("2d")!.fillStyle = "#3978ae";
      c.getContext("2d")!.fillRect(0, 0, 400, 200);
      return c.toDataURL().split(",")[1];
    }),
    "base64",
  );
  registerCodexWebsitePreviewRoutes(
    app,
    new WebsitePreviewService({
      lookup: async () => [{ address: "93.184.216.34", family: 4 }],
      fetch: async (u) => {
        reads.push(u.pathname);
        if (u.pathname === "/hero.png")
          return new Response(brokenImage ? png.subarray(0, 33) : png, {
            headers: { "Content-Type": "image/png" },
          });
        if (delayed)
          await new Promise<void>((resolve) =>
            pending.set(u.pathname, resolve),
          );
        return new Response(
          '<head><title>Native website RPC</title><meta name="description" content="Preserve the active agent and captured URL."><meta property="og:image" content="/hero.png"></head>',
          { headers: { "Content-Type": "text/html" } },
        );
      },
    }),
  );
  app.addHook("onRequest", async (_r, reply) => {
    reply.header("Access-Control-Allow-Origin", "*");
  });
  await app.listen({ host: "0.0.0.0", port: 0 });
  const address = app.server.address();
  if (!address || typeof address === "string") throw Error("listener");
  const origin = `http://${new URL(process.env.PLAYWRIGHT_BASE_URL!).hostname}:${address.port}`;
  for (const target of [page, native]) {
    await target.addInitScript(() => {
      (window as any).websiteImageErrors = 0;
      (window as any).websitePointerEvents = [];
      for (const name of ["pointerover", "pointerout", "pointerdown"])
        document.addEventListener(
          name,
          (event) => {
            const e = event as PointerEvent,
              link = (e.target as Element)?.closest?.('a[href*="example.com"]');
            if (link && (window as any).websitePointerEvents.length < 32)
              (window as any).websitePointerEvents.push({
                name,
                url: link.getAttribute("href"),
                x: e.clientX,
                y: e.clientY,
                time: performance.now(),
              });
          },
          true,
        );
      window.addEventListener(
        "error",
        (event) => {
          if (
            event.target instanceof HTMLImageElement &&
            event.target.getAttribute("width") === "400"
          )
            (window as any).websiteImageErrors++;
        },
        true,
      );
    });
    await target.route("**/api/session/api/codex/website-preview**", (r) =>
      r.continue({ url: origin + new URL(r.request().url()).pathname }),
    );
    await target.route("https://t0.gstatic.com/**", (r) =>
      r.fulfill({ status: 404, body: "Isolated favicon failure" }),
    );
  }
  f.fixture.threads[0].turns = [
    {
      id: "dynamic",
      status: "completed",
      items: [
        {
          type: "agentMessage",
          id: "dynamic-message",
          text: "[Website dynamic](https://example.com/product)",
          phase: "final_answer",
        },
      ],
    },
  ] as never;
  await page.evaluate(
    (theme) =>
      localStorage.setItem(
        "kanban.session.theme-storage",
        JSON.stringify({ version: 1, state: { theme, accent: "default" } }),
      ),
    theme,
  );
  await page.reload();
  await native.setViewportSize({ width, height });
  await native.emulateMedia({
    reducedMotion: delayed ? "no-preference" : "reduce",
  });
  await attachNativeWebsiteRpc(native);
  await renderNativeMarkdownReference(
    native,
    reference!,
    "[Website dynamic](https://example.com/native)",
    theme,
    width,
    () => initializeNativeWebsiteRpc(native),
  );
  const links = [
    page
      .locator(".codex-markdown")
      .getByRole("link", { name: "Website dynamic", exact: true }),
    native.getByRole("link", { name: "Website dynamic", exact: true }),
  ] as const;
  await links[0].scrollIntoViewIfNeeded();
  const a = (await links[0].boundingBox())!,
    b = (await links[1].boundingBox())!;
  await native.locator("#root").evaluate(
    (e, o) => {
      (e as HTMLElement).style.transform = `translate(${o.x}px,${o.y}px)`;
    },
    { x: a.x - b.x, y: a.y - b.y },
  );
  return {
    native,
    links,
    pending,
    reads,
    close: async () => {
      for (const release of pending.values()) release();
      await native.close();
      await app.close();
      await f.close();
    },
    assertIsolated: () => {
      expect(f.calls).toEqual([]);
      expect(f.errors).toEqual([]);
    },
  };
}

async function pairAnchors(f: Awaited<ReturnType<typeof fixture>>) {
  // Isolate tooltip constraints from this application's unique navigation/composer layout.
  // The full-page moving-anchor probe is retained separately; no product layout is changed.
  await f.native.locator("#root").evaluate((e) => {
    (e as HTMLElement).style.transform = "none";
  });
  for (const link of f.links)
    await link.evaluate((e) => {
      Object.assign((e as HTMLElement).style, {
        position: "fixed",
        left: "16px",
        top: "100px",
        zIndex: "1000",
        width: "140px",
        height: "20px",
      });
    });
  // Fixed descendants may use a contained chat row as their origin.
  // Match the actual resulting reference rectangles, not CSS coordinates.
  const anchorBox = (await f.links[0].boundingBox())!;
  await f.links[1].evaluate((e, box) => {
    Object.assign((e as HTMLElement).style, {
      left: `${box.x}px`,
      top: `${box.y}px`,
    });
  }, anchorBox);
}

async function sample(page: Page, selector: string) {
  return page.evaluate(async (selector) => {
    const node = document.querySelector(selector)!;
    const start = performance.now(),
      frames: { time: number; height: number; animatedHeight: number }[] = [];
    const writes: { time: number; height: number }[] = [];
    let commit: number | null = null;
    const observer = new MutationObserver((records) => {
      if (commit === null && node.querySelector("h3"))
        commit = performance.now() - start;
      if (records.some((record) => record.type === "attributes"))
        writes.push({
          time: performance.now() - start,
          height: node.getBoundingClientRect().height,
        });
    });
    observer.observe(node, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style"],
    });
    (window as any).websiteSamplingReady = true;
    await new Promise<void>((resolve) => {
      const frame = () => {
        frames.push({
          time: performance.now() - start,
          height: node.getBoundingClientRect().height,
          animatedHeight: parseFloat((node as HTMLElement).style.height),
        });
        if (performance.now() - start < 550) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
    observer.disconnect();
    return { frames, writes, commit };
  }, selector);
}
for (const theme of ["dark", "light"]) {
  test(`website delayed RPC animates complete body (${theme})`, async ({
    page,
  }, info) => {
    test.skip(!reference, "Native reference required");
    test.setTimeout(90000);
    const f = await fixture(page, theme, 900, true);
    try {
      for (const link of f.links) await link.focus();
      for (const target of [page, f.native])
        await expect(
          target.getByRole("status").filter({ hasText: "正在加载预览" }),
        ).toBeAttached();
      await expect.poll(() => f.pending.size).toBe(2);
      const sampled = Promise.all([
        sample(page, ".codex-native-slack-body"),
        sample(f.native, '[class~="w-90"] > div:last-child'),
      ]);
      for (const target of [page, f.native])
        await target.waitForFunction(
          () => (window as any).websiteSamplingReady,
        );
      for (const release of f.pending.values()) release();
      const [productCapture, originalCapture] = await sampled;
      const product = productCapture.frames,
        original = originalCapture.frames;
      await writeFile(
        info.outputPath("height-timeline.json"),
        JSON.stringify(
          {
            product: productCapture,
            original: originalCapture,
            boundary:
              "Original RPC and production HTTP handler; controlled delayed public HTML.",
          },
          null,
          2,
        ),
      );
      for (const frames of [product, original]) {
        const final = frames.at(-1)!.height;
        expect(frames[0].height).toBe(0);
        expect(
          frames.some((frame) => frame.height > 0 && frame.height < final - 1),
        ).toBe(true);
        expect(frames.find((frame) => frame.time >= 450)!.height).toBeCloseTo(
          final,
          1,
        );
      }
      expect(product.at(-1)!.height).toBeCloseTo(original.at(-1)!.height, 2);
      const normalized = (capture: typeof productCapture, time: number) => {
        const frames = capture.frames,
          onset = capture.commit!;
        expect(onset).not.toBeNull();
        const at = onset + time;
        const before = frames.findLast((frame) => frame.time <= at)!;
        const after = frames.find((frame) => frame.time >= at)!;
        expect(before).toBeTruthy();
        expect(after).toBeTruthy();
        // Compare the same elapsed time. Picking each page's nearest frame
        // can compare different moments one refresh interval apart.
        const fraction =
          after.time === before.time
            ? 0
            : (at - before.time) / (after.time - before.time);
        return (
          (before.height + (after.height - before.height) * fraction) /
          frames.at(-1)!.height
        );
      };
      for (const time of [60, 120, 180, 240])
        expect(
          Math.abs(
            normalized(productCapture, time) -
              normalized(originalCapture, time),
          ),
        ).toBeLessThan(0.12);
      for (const [name, target] of [
        ["product", page],
        ["native", f.native],
      ] as const) {
        await expect
          .poll(() =>
            target
              .getByRole("tooltip")
              .locator("img[width]")
              .evaluate(
                (e: HTMLImageElement) => e.complete && e.naturalWidth === 400,
              ),
          )
          .toBe(true);
        await target
          .getByRole("tooltip")
          .screenshot({ path: info.outputPath(`${name}-expanded.png`) });
      }
      f.assertIsolated();
    } finally {
      await f.close();
    }
  });
  for (const width of [390, 700])
    test(`website native collision fallback in a short viewport (${width}, ${theme})`, async ({
      page,
    }, info) => {
      test.skip(!reference, "Native reference required");
      test.setTimeout(90000);
      const f = await fixture(page, theme, 360, false, false, width);
      try {
        await pairAnchors(f);
        const metrics = [];
        for (const [name, target] of [
          ["product", page],
          ["native", f.native],
        ] as const) {
          await (target === page ? f.links[0] : f.links[1]).hover();
          try {
            await expect(target.getByRole("tooltip").locator("h3")).toHaveText(
              "Native website RPC",
            );
          } catch (error) {
            await writeFile(
              info.outputPath(`${name}-hover-failure.json`),
              JSON.stringify(
                {
                  reads: f.reads,
                  browser: await target.evaluate(() => ({
                    pointers: (window as any).websitePointerEvents,
                    link: [
                      ...document.querySelectorAll('a[href*="example.com"]'),
                    ].map((e) => ({
                      html: e.outerHTML,
                      box: e.getBoundingClientRect().toJSON(),
                      hovered: e.matches(":hover"),
                    })),
                    tips: [
                      ...document.querySelectorAll('[role="tooltip"]'),
                    ].map((e) => e.outerHTML),
                    active: document.activeElement?.outerHTML,
                  })),
                },
                null,
                2,
              ),
            );
            await target.screenshot({
              path: info.outputPath(`${name}-hover-failure.png`),
            });
            throw error;
          }
          await expect
            .poll(() =>
              target
                .getByRole("tooltip")
                .locator("img[width]")
                .evaluate(
                  (e: HTMLImageElement) => e.complete && e.naturalWidth === 400,
                ),
            )
            .toBe(true);
          const tip = target.getByRole("tooltip");
          const metric = await tip.evaluate((root) => {
            const scroll = [...root.querySelectorAll("div")].find(
              (e) => getComputedStyle(e).overflowY === "auto",
            )!;
            const r = root.getBoundingClientRect();
            return {
              x: r.x,
              y: r.y,
              width: r.width,
              height: r.height,
              side: root.getAttribute("data-side"),
              clientHeight: scroll.clientHeight,
              scrollHeight: scroll.scrollHeight,
              toolbarHeight: root
                .querySelector("a")!
                .parentElement!.getBoundingClientRect().height,
              inViewport: r.top >= 0 && r.bottom <= innerHeight,
            };
          });
          metrics.push({ name, ...metric });
          await writeFile(
            info.outputPath("constrained-geometry.json"),
            JSON.stringify(metrics, null, 2),
          );
          await writeFile(
            info.outputPath(`${name}-constrained-dom.json`),
            JSON.stringify(
              await tip.evaluate((root) => {
                const nodes = [
                  root,
                  root.parentElement!,
                  ...root.querySelectorAll("div"),
                ];
                return nodes.map((e) => ({
                  html: e.outerHTML.slice(0, 16000),
                  rect: e.getBoundingClientRect().toJSON(),
                  available: getComputedStyle(e).getPropertyValue(
                    "--radix-tooltip-content-available-height",
                  ),
                  maxHeight: getComputedStyle(e).maxHeight,
                }));
              }),
              null,
              2,
            ),
          );
          await tip.screenshot({
            path: info.outputPath(`${name}-scroll-top.png`),
          });
          expect(metric.inViewport).toBe(true);
          if (metric.scrollHeight > metric.clientHeight) {
            await tip.hover();
            await target.mouse.wheel(0, 600);
            await expect
              .poll(() =>
                tip.evaluate(
                  (root) =>
                    [...root.querySelectorAll("div")].find(
                      (e) => getComputedStyle(e).overflowY === "auto",
                    )!.scrollTop,
                ),
              )
              .toBeGreaterThan(0);
            await expect(tip.locator("h3")).toBeInViewport();
            await tip.screenshot({
              path: info.outputPath(`${name}-scroll-bottom.png`),
            });
          }
        }
        await writeFile(
          info.outputPath("constrained-geometry.json"),
          JSON.stringify(metrics, null, 2),
        );
        const { name: _p, ...product } = metrics[0],
          { name: _n, ...original } = metrics[1];
        expect(product).toEqual(original);
        f.assertIsolated();
      } finally {
        await f.close();
      }
    });
}

for (const theme of ["dark", "light"]) {
  test(`website image decode failure retains native text (${theme})`, async ({
    page,
  }, info) => {
    test.skip(!reference, "Native reference required");
    test.setTimeout(90000);
    const f = await fixture(page, theme, 900, false, true);
    try {
      const metrics = [];
      for (const [name, target, link] of [
        ["product", page, f.links[0]],
        ["native", f.native, f.links[1]],
      ] as const) {
        await link.focus();
        const tip = target.getByRole("tooltip");
        await expect(tip.locator("h3")).toHaveText("Native website RPC");
        await expect
          .poll(() => target.evaluate(() => (window as any).websiteImageErrors))
          .toBe(1);
        await expect(tip.locator("img[width]")).toHaveCount(0);
        await expect(tip.locator("p")).toHaveText(
          "Preserve the active agent and captured URL.",
        );
        metrics.push(
          await tip.evaluate((root) => {
            const r = root.getBoundingClientRect();
            return { width: r.width, height: r.height };
          }),
        );
        await tip.screenshot({
          path: info.outputPath(`${name}-decode-fallback.png`),
        });
      }
      await writeFile(
        info.outputPath("decode-fallback.json"),
        JSON.stringify(
          {
            product: metrics[0],
            original: metrics[1],
            errorsPerPeer: 1,
            boundary:
              "Actual browser decode failure of truncated PNG; production handler validated image dimensions.",
          },
          null,
          2,
        ),
      );
      expect(metrics[0]).toEqual(metrics[1]);
      f.assertIsolated();
    } finally {
      await f.close();
    }
  });
}

for (const theme of ["dark", "light"]) {
  test(`website opaque content matches original RGB in a composited scene (${theme})`, async ({
    page,
  }, info) => {
    test.skip(!reference, "Native reference required");
    test.setTimeout(90000);
    const f = await fixture(page, theme, 360, false);
    try {
      await pairAnchors(f);
      // The workbench card overlaps composited scrolling/editor layers. Give
      // the unchanged reference component the same compositor background scene.
      await f.native.evaluate(() => {
        const background = document.createElement("div");
        background.setAttribute("aria-hidden", "true");
        background.dataset.nativePixelScene = "composited-background";
        Object.assign(background.style, {
          position: "absolute",
          inset: "0",
          background: getComputedStyle(document.body).backgroundColor,
          willChange: "transform",
          pointerEvents: "none",
          zIndex: "0",
        });
        document.body.append(background);
      });

      const pictures: string[] = [],
        styles = [];
      for (const [name, target, link] of [
        ["product", page, f.links[0]],
        ["native", f.native, f.links[1]],
      ] as const) {
        await target.evaluate(() =>
          (document.activeElement as HTMLElement)?.blur?.(),
        );
        await link.hover();
        const tip = target.getByRole("tooltip");
        await expect(tip.locator("h3")).toHaveText("Native website RPC");
        await expect
          .poll(() =>
            tip
              .locator("img[width]")
              .evaluate(
                (e: HTMLImageElement) => e.complete && e.naturalWidth === 400,
              ),
          )
          .toBe(true);
        styles.push(
          await tip.evaluate((root) => {
            const title = root.querySelector("h3")!,
              image = root.querySelector("img[width]")!;
            return {
              fontSmoothing: getComputedStyle(title).webkitFontSmoothing,
              synthesis: getComputedStyle(title).fontSynthesis,
              titleRect: title.getBoundingClientRect().toJSON(),
              textRendering: getComputedStyle(title).textRendering,
              letterSpacing: getComputedStyle(title).letterSpacing,
              font: getComputedStyle(title).font,
              color: getComputedStyle(title).color,
              imageBorder: getComputedStyle(image).borderBottom,
              imageBoxSizing: getComputedStyle(image).boxSizing,
              ancestors: (() => {
                const rows = [];
                let e: Element | null = title;
                while (e) {
                  const c = getComputedStyle(e);
                  rows.push({
                    tag: e.tagName,
                    className: e.className,
                    position: c.position,
                    opacity: c.opacity,
                    transform: c.transform,
                    willChange: c.willChange,
                    isolation: c.isolation,
                    contain: c.contain,
                    filter: c.filter,
                    background: c.backgroundColor,
                  });
                  e = e.parentElement;
                }
                return rows;
              })(),
            };
          }),
        );
        let bytes: Buffer;
        if (page.context().browser()?.browserType().name() === "chromium") {
          const cdp = await page.context().newCDPSession(target);
          await cdp.send("DOM.enable");
          await cdp.send("CSS.enable");
          const { root } = await cdp.send("DOM.getDocument", { depth: 0 });
          const { nodeId } = await cdp.send("DOM.querySelector", {
            nodeId: root.nodeId,
            selector: '[role="tooltip"] h3',
          });
          await writeFile(
            info.outputPath(`${name}-platform-font.json`),
            JSON.stringify(
              await cdp.send("CSS.getPlatformFontsForNode", { nodeId }),
              null,
              2,
            ),
          );
          let layers: any[] = [];
          cdp.on("LayerTree.layerTreeDidChange", (event) => {
            layers = event.layers ?? [];
          });
          await cdp.send("LayerTree.enable");
          bytes = await tip.screenshot({
            path: info.outputPath(`${name}-rgb.png`),
          });
          const reports = [];
          for (const layer of layers) {
            try {
              reports.push({
                layer,
                reasons: await cdp.send("LayerTree.compositingReasons", {
                  layerId: layer.layerId,
                }),
              });
            } catch {}
          }
          await writeFile(
            info.outputPath(`${name}-layers.json`),
            JSON.stringify(reports, null, 2),
          );
          await cdp.detach();
        } else {
          bytes = await tip.screenshot({
            path: info.outputPath(`${name}-rgb.png`),
          });
        }
        pictures.push(bytes.toString("base64"));
      }
      const comparison = await page.evaluate(async (pictures) => {
        const images = await Promise.all(
          pictures.map(async (bytes) => {
            const image = new Image();
            image.src = `data:image/png;base64,${bytes}`;
            await image.decode();
            return image;
          }),
        );
        const [a, b] = images;
        if (a.width !== b.width || a.height !== b.height)
          throw Error("Screenshot dimensions differ");
        const read = (image: HTMLImageElement) => {
          const canvas = document.createElement("canvas");
          canvas.width = image.width;
          canvas.height = image.height;
          const c = canvas.getContext("2d")!;
          c.drawImage(image, 0, 0);
          return c.getImageData(0, 0, image.width, image.height).data;
        };
        const product = read(a),
          original = read(b);
        let changedPixels = 0,
          maximumChannelDifference = 0;
        let minX = a.width,
          minY = a.height,
          maxX = -1,
          maxY = -1;
        // The native body is opaque here. Keep external corner/backdrop differences separate.
        const region = {
          left: 8,
          top: 60,
          right: a.width - 8,
          bottom: a.height - 16,
        };
        const regions = [
          region,
          { left: 16, top: 8, right: a.width - 16, bottom: 38 },
        ];
        for (const region of regions)
          for (let y = region.top; y < region.bottom; y++)
            for (let x = region.left; x < region.right; x++) {
              const i = (y * a.width + x) * 4;
              let changed = false;
              for (let c = 0; c < 4; c++) {
                const diff = Math.abs(product[i + c] - original[i + c]);
                maximumChannelDifference = Math.max(
                  maximumChannelDifference,
                  diff,
                );
                if (diff) changed = true;
              }
              if (changed) {
                changedPixels++;
                minX = Math.min(minX, x);
                minY = Math.min(minY, y);
                maxX = Math.max(maxX, x);
                maxY = Math.max(maxY, y);
              }
            }
        return {
          regions,
          changedPixels,
          maximumChannelDifference,
          mismatchBounds: changedPixels ? { minX, minY, maxX, maxY } : null,
          boundary:
            "Exact RGBA in opaque toolbar and body under matched compositing; corners and whole-window parity are separate.",
        };
      }, pictures);
      await writeFile(
        info.outputPath("rgb-comparison.json"),
        JSON.stringify({ ...comparison, styles }, null, 2),
      );
      expect(comparison.changedPixels).toBe(0);
      f.assertIsolated();
    } finally {
      await f.close();
    }
  });
}
