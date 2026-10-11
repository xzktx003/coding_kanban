import { expect, test, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { setup } from "./session-composer-v2-fixture";

for (const width of [390, 700]) {
  test(`short viewport keeps a wheel-revealed Codex link under the pointer (${width})`, async ({
    page,
  }, info) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width, height: 360 });
    const f = await setup(page, false);
    try {
      await installShortReply(page, f);
      const editor = page
        .locator(".session-codex-composer [contenteditable=true]")
        .first();
      await editor.fill("Unsent draft stays with this session");
      const link = page
        .locator(".codex-markdown")
        .getByRole("link", { name: "Readable link", exact: true });
      await expect(link).toBeAttached();
      const view = page
        .locator('[data-slot="scroll-area-viewport"]')
        .filter({ has: link });
      await expect(view).toBeVisible();
      const box = (await view.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, -600);
      await expect
        .poll(() =>
          link.evaluate((e) => {
            const r = e.getBoundingClientRect();
            const v = e
              .closest('[data-slot="scroll-area-viewport"]')!
              .getBoundingClientRect();
            return r.top >= v.top && r.bottom <= v.bottom;
          }),
        )
        .toBe(true);
      const before = (await link.boundingBox())!;
      const x = before.x + before.width / 2,
        y = before.y + before.height / 2;
      await page.mouse.move(x, y);
      await expect(page.getByRole("tooltip").locator("h3")).toHaveText(
        "Readable link",
      );
      const frames = await link.evaluate(
        async (e, { x, y }) => {
          const start = performance.now(),
            frames: {
              time: number;
              y: number;
              hit: boolean;
              scrollTop: number;
            }[] = [];
          const view = e.closest('[data-slot="scroll-area-viewport"]')!;
          await new Promise<void>((resolve) => {
            const sample = () => {
              const r = e.getBoundingClientRect();
              frames.push({
                time: performance.now() - start,
                y: r.y,
                hit: e.contains(document.elementFromPoint(x, y)),
                scrollTop: view.scrollTop,
              });
              if (performance.now() - start < 800)
                requestAnimationFrame(sample);
              else resolve();
            };
            requestAnimationFrame(sample);
          });
          return frames;
        },
        { x, y },
      );
      await writeFile(
        info.outputPath("pointer-and-scroll.json"),
        JSON.stringify(
          {
            before,
            viewport: box,
            frames,
            boundary:
              "Real mouse and wheel; controlled short preview fields, no native/MCP command.",
          },
          null,
          2,
        ),
      );
      await page.screenshot({
        path: info.outputPath("short-viewport-hover.png"),
      });
      expect(frames.every((f) => f.hit)).toBe(true);
      expect(
        Math.max(...frames.map((f) => f.y)) -
          Math.min(...frames.map((f) => f.y)),
      ).toBeLessThan(1);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("tooltip")).toHaveCount(0);
      await expect(editor).toHaveText("Unsent draft stays with this session");
      expect(
        f.fixture.calls.filter((c) =>
          /\/turn\/(start|steer|interrupt)|\/thread\/resume|\/stop$/.test(
            c.path,
          ),
        ),
      ).toEqual([]);
      expect(f.calls).toEqual([]);
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });
}

async function installShortReply(
  page: Page,
  f: Awaited<ReturnType<typeof setup>>,
) {
  await page.route(
    "**/api/session/api/codex/website-preview/capabilities",
    (r) => r.fulfill({ json: { supported: true } }),
  );
  await page.route("**/api/session/api/codex/website-preview", (r) =>
    r.fulfill({
      json: {
        status: "ready",
        title: "Readable link",
        description: "Keep the captured reader and draft.",
      },
    }),
  );
  await page.route("https://t0.gstatic.com/**", (r) =>
    r.fulfill({ status: 404, body: "Isolated favicon" }),
  );
  f.fixture.threads[0].turns = [
    {
      id: "short",
      status: "completed",
      items: [
        {
          type: "agentMessage",
          id: "short-message",
          text: "[Readable link](https://example.com/readable)",
          phase: "final_answer",
        },
      ],
    },
  ] as never;
  await page.reload();
}

for (const width of [390, 700]) {
  test(`short viewport distinguishes automatic scroll from reader wheel (${width})`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 360 });
    const f = await setup(page, false);
    try {
      await installShortReply(page, f);
      const link = page
        .locator(".codex-markdown")
        .getByRole("link", { name: "Readable link", exact: true });
      await expect(link).toBeAttached();
      const view = page
        .locator('[data-slot="scroll-area-viewport"]')
        .filter({ has: link });
      await expect
        .poll(() => view.evaluate((e) => e.scrollTop))
        .toBeGreaterThan(4);
      const result = await link.evaluate(async (e) => {
        const view = e.closest('[data-slot="scroll-area-viewport"]')!;
        const before = { y: e.getBoundingClientRect().y, top: view.scrollTop };
        e.scrollIntoView({ block: "center", behavior: "instant" });
        const automatic = {
          y: e.getBoundingClientRect().y,
          top: view.scrollTop,
        };
        const frames: { y: number; top: number }[] = [];
        const start = performance.now();
        await new Promise<void>((resolve) => {
          const sample = () => {
            frames.push({
              y: e.getBoundingClientRect().y,
              top: view.scrollTop,
            });
            if (performance.now() - start < 500) requestAnimationFrame(sample);
            else resolve();
          };
          requestAnimationFrame(sample);
        });
        return { before, automatic, frames };
      });
      await writeFile(
        info.outputPath("automatic-scroll.json"),
        JSON.stringify(result, null, 2),
      );
      expect(result.automatic.top).toBeLessThan(result.before.top - 4);
      expect(result.frames.at(-1)!.top).toBeCloseTo(result.before.top, 0);
      expect(result.frames.at(-1)!.y).toBeLessThan(result.automatic.y - 4);
      expect(f.calls).toEqual([]);
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });
}
