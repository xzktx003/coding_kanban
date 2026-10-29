import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { installSessionUxFixture } from "./session-ux-fixture";
import { liveStream } from "./session-sse-fixture";

test("large completed code fences preserve text without blocking input with grammar detection or expanded spans", async ({
  page,
}, testInfo) => {
  await page.route("**/render-work-probe", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><button id="input">input</button><pre id="output"></pre>',
    }),
  );
  await page.route("**/api/**", (route) => route.fulfill({ json: {} }));
  await page.goto("/render-work-probe");
  const metrics = await page.evaluate(async () => {
    const { nativeFenceHighlight } =
      await import("/src/session-mode/components/codex/presentation/nativeFenceHighlight.ts");
    const render = (code: string, language: string) =>
      new Promise<{ html: string; synchronous: boolean; ms: number }>(
        (resolve) => {
          const start = performance.now();
          const ready = nativeFenceHighlight.highlight(
            { code, language },
            (html: string) =>
              resolve({
                html,
                synchronous: false,
                ms: performance.now() - start,
              }),
          );
          if (ready !== null)
            resolve({
              html: ready,
              synchronous: true,
              ms: performance.now() - start,
            });
        },
      );
    // Warm the actual original grammar registry before timing only the workload.
    const small = await render("const value = 42;", "typescript");
    let clicks = 0;
    document.querySelector("button")!.addEventListener("click", () => clicks++);
    const output = document.querySelector("pre")!;
    const samples = [];
    for (const language of ["", "typescript", ""]) {
      const code =
        Array.from(
          { length: 1600 },
          (_, i) => `const value${i} = {name: "<testing>&", data: [1, 2, 3]};`,
        ).join("\n") + language;
      const start = performance.now();
      const ping = new Promise<number>((resolve) =>
        setTimeout(() => {
          document.querySelector<HTMLButtonElement>("button")!.click();
          resolve(performance.now() - start);
        }, 0),
      );
      const result = await render(code, language);
      output.innerHTML = result.html;
      samples.push({
        language,
        chars: code.length,
        synchronous: result.synchronous,
        highlightMs: result.ms,
        timerLatencyMs: await ping,
        spans: output.querySelectorAll("span").length,
        textPreserved: output.textContent === code,
      });
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
    }
    return {
      smallHighlighted: small.html.includes("hljs-keyword"),
      clicks,
      samples,
    };
  });
  const metricsPath = testInfo.outputPath("render-work-metrics.json");
  await writeFile(metricsPath, JSON.stringify(metrics, null, 2));
  await testInfo.attach("render-work-metrics", {
    path: metricsPath,
    contentType: "application/json",
  });
  expect(metrics.smallHighlighted).toBe(true);
  expect(metrics.clicks).toBe(3);
  for (const sample of metrics.samples) {
    expect(sample.textPreserved).toBe(true);
    expect(sample.synchronous).toBe(true);
    expect(sample.spans).toBe(0);
    expect(sample.timerLatencyMs).toBeLessThan(250);
  }
});

test("a completed large code reply stays readable in the actual session composer without empty review writes", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(60_000);
  await installSessionUxFixture(page, 1);
  await page.addInitScript(() => {
    localStorage.setItem(
      "kanban.session.agent-center-store",
      JSON.stringify({
        version: 5,
        state: {
          cards: [
            {
              kind: "codex",
              id: "ux-0",
              cwd: "/fixture/项目/very-long-project-path-for-ui-regression",
            },
          ],
          currentAgentCardId: "ux-0",
          currentAgentCardKind: "codex",
          cardsViewMode: "solo",
          sharedTabsInitialized: true,
        },
      }),
    );
    localStorage.setItem(
      "kanban.session.layout-storage",
      JSON.stringify({
        version: 0,
        state: { isSidebarOpen: false, isRightPanelOpen: false, view: "agent" },
      }),
    );
    const original = Storage.prototype.setItem;
    (window as any).__reviewWrites = 0;
    Storage.prototype.setItem = function (key, value) {
      if (key === "kanban.session.review-comments")
        (window as any).__reviewWrites++;
      original.call(this, key, value);
    };
  });
  const stream = await liveStream(page, baseURL!);
  try {
    await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
    const composer = page
      .locator('.session-mode [contenteditable="true"]')
      .first();
    await expect(composer).toBeVisible({ timeout: 45_000 });
    await expect.poll(() => stream.connections()).toBeGreaterThan(0);
    const code = Array.from(
      { length: 1600 },
      (_, i) => `const value${i} = {name: "<testing>&", data: [1, 2, 3]};`,
    ).join("\n");
    await page.evaluate(() => {
      (window as any).__reviewWrites = 0;
    });
    stream.emit(1, {
      method: "item/completed",
      params: {
        threadId: "ux-0",
        turnId: "render-work",
        item: {
          type: "agentMessage",
          id: "large-code",
          text: "Completed output\n\n```\n" + code + "\n```",
          phase: null,
          memoryCitation: null,
        },
      },
    });
    const fence = page.locator(
      '.thread-surface [data-markdown-copy="code-block"]',
    );
    await expect(fence).toHaveCount(1);
    const source = fence.locator("pre code");
    await expect(source).toHaveText(code);
    await expect(source.locator("span")).toHaveCount(0);
    await composer.fill("draft remains responsive after completed code");
    await expect(composer).toHaveText(
      "draft remains responsive after completed code",
    );
    expect(await page.evaluate(() => (window as any).__reviewWrites)).toBe(0);
  } finally {
    await stream.close();
  }
});
