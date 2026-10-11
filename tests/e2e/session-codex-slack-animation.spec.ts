import { expect, test, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { setup } from "./session-composer-v2-fixture";
import { renderNativeMarkdownReference } from "./session-native-markdown-reference";

const reference = process.env.CODEX_NATIVE_REFERENCE_URL;
async function sample(page: Page, selector: string) {
  return page.evaluate(async (selector) => {
    const node = document.querySelector(selector)!;
    const start = performance.now(),
      frames: { time: number; height: number }[] = [];
    let commit: number | null = null;
    const observer = new MutationObserver(() => {
      if (commit === null && node.querySelector("h3"))
        commit = performance.now() - start;
    });
    observer.observe(node, { childList: true, subtree: true });
    (window as any).resolveSlackContent();
    await new Promise<void>((resolve) => {
      const frame = () => {
        frames.push({
          time: performance.now() - start,
          height: node.getBoundingClientRect().height,
        });
        if (performance.now() - start < 400) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
    observer.disconnect();
    return { frames, commit };
  }, selector);
}
test("Slack late content uses the original 300ms height transition in a real browser", async ({
  page,
}, info) => {
  test.skip(!reference, "Set original native reference URL");
  test.setTimeout(90000);
  await page.setViewportSize({ width: 700, height: 900 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const f = await setup(page, false),
    native = await page.context().newPage();
  const href = "https://team.slack.com/team/U123",
    title = "Alice Chen",
    description = "Infrastructure engineering";
  try {
    await native.setViewportSize({ width: 700, height: 900 });
    await native.emulateMedia({ reducedMotion: "no-preference" });
    await renderNativeMarkdownReference(
      native,
      reference!,
      "ready",
      "dark",
      700,
    );
    await native.evaluate(
      async ({ href, title, description }) => {
        const S = await import(
          /* @vite-ignore */ "./native/assets/app-initial-e98b9eaef8e3.js"
        );
        S.Wb();
        const w = window as any,
          R = w.nativeModules.React;
        document.getElementById("root")!.style.cssText =
          "width:360px;padding:0;margin:16px";
        const render = (data: unknown) =>
          w.renderNativeElement(S._, {
            children: R.createElement(S.Ub, { href, data }),
          });
        render(null);
        w.resolveSlackContent = () =>
          render({ status: "ready", title, description });
      },
      { href, title, description },
    );
    await page.evaluate(
      async ({ href, title, description }) => {
        const module = (path: string) =>
          import(
            performance
              .getEntriesByType("resource")
              .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
          );
        const rm = await import(
            (window as any).__sessionFixtureDependency("react.js")
          ),
          dm = await import(
            (window as any).__sessionFixtureDependency("react-dom_client.js")
          );
        const R = rm.default ?? rm,
          { createRoot } = dm.default ?? dm;
        const { NativeSlackPreview, NativeSlackPreviewHost } = await module(
          "/src/session-mode/components/codex/presentation/NativeSlackPreview.tsx",
        );
        const container = document.createElement("div");
        container.style.cssText =
          "position:fixed;left:16px;top:16px;z-index:100";
        document.querySelector(".session-mode")!.append(container);
        const host = {
          identity: () => "isolated-animation-fixture",
          read: () =>
            new Promise((resolve) => {
              (window as any).resolveSlackContent = () =>
                resolve({
                  content: [
                    {
                      type: "text",
                      text: JSON.stringify({
                        result: `User ID: U123\nReal Name: ${title}\nTitle: ${description}`,
                      }),
                    },
                  ],
                });
            }),
        };
        createRoot(container).render(
          R.createElement(
            NativeSlackPreviewHost.Provider,
            { value: host },
            R.createElement(
              NativeSlackPreview,
              { href },
              R.createElement("a", { href }, "Slack animation"),
            ),
          ),
        );
      },
      { href, title, description },
    );
    await page
      .getByRole("link", { name: "Slack animation", exact: true })
      .focus();
    await expect(
      page.getByRole("status").filter({ hasText: "正在加载预览" }),
    ).toBeVisible();
    await expect(
      native.getByRole("status").filter({ hasText: "正在加载预览" }),
    ).toBeAttached();
    const [productCapture, originalCapture] = await Promise.all([
      sample(page, ".codex-native-slack-body"),
      sample(native, '[class~="w-90"] > div:last-child'),
    ]);
    const product = productCapture.frames,
      original = originalCapture.frames;
    await writeFile(
      info.outputPath("height-timeline.json"),
      JSON.stringify(
        {
          original: originalCapture,
          product: productCapture,
          boundary: "Controlled delayed fields; no real MCP request.",
        },
        null,
        2,
      ),
    );
    for (const frames of [product, original]) {
      const final = frames.at(-1)!.height;
      expect(
        frames.some((frame) => frame.height > 0 && frame.height < final - 1),
      ).toBe(true);
      expect(frames.find((frame) => frame.time >= 340)!.height).toBeCloseTo(
        final,
        1,
      );
    }
    expect(product.at(-1)!.height).toBeCloseTo(original.at(-1)!.height, 2);
    for (const time of [60, 120, 180, 240]) {
      const at = (capture: typeof productCapture) => {
        expect(capture.commit).not.toBeNull();
        const t = capture.commit! + time,
          frames = capture.frames;
        const before = frames.findLast((frame) => frame.time <= t)!,
          after = frames.find((frame) => frame.time >= t)!;
        expect(before).toBeTruthy();
        expect(after).toBeTruthy();
        const fraction =
          before.time === after.time
            ? 0
            : (t - before.time) / (after.time - before.time);
        return before.height + (after.height - before.height) * fraction;
      };
      // The reference directly rerenders, while the product receives a Promise.
      // Preserve handoff latency separately and compare the same animation phase.
      expect(Math.abs(at(productCapture) - at(originalCapture))).toBeLessThan(
        12,
      );
    }
    await page.screenshot({ path: info.outputPath("product-expanded.png") });
    await native.screenshot({ path: info.outputPath("native-expanded.png") });
    expect(f.errors).toEqual([]);
    expect(f.calls).toEqual([]);
  } finally {
    await native.close();
    await f.close();
  }
});
