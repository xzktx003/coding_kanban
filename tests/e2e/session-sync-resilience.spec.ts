import { expect, test } from "@playwright/test";
import { installSessionUxFixture } from "./session-ux-fixture";
import { liveStream } from "./session-sse-fixture";
import { readFile, writeFile } from "node:fs/promises";

for (const width of [1440, 393])
  test(`transient metadata failures stay compact and recover without changing input at ${width}px`, async ({
    page,
    baseURL,
  }, info) => {
    await page.setViewportSize({ width, height: 852 });
    const fixture = await installSessionUxFixture(page, 0);
    const stream = await liveStream(page, baseURL!);
    let failReads = false,
      failures = 0;
    await page.route("**/api/session/tabs", (route) => {
      if (failReads && route.request().method() === "GET") {
        failures++;
        return route.fulfill({
          status: 503,
          json: { error: "isolated list read failure" },
        });
      }
      return route.fallback();
    });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    try {
      await page.goto("/?mode=session");
      const editor = page
        .locator(".session-mode [contenteditable=true]")
        .first();
      await expect(editor).toBeVisible();
      await expect.poll(stream.connections).toBeGreaterThan(0);
      await expect(page.locator(".session-top-nav")).toHaveAttribute(
        "data-connection-state",
        "ready",
      );
      await editor.fill("Keep typing during metadata retries");
      await page.clock.install();
      failReads = true;
      await expect
        .poll(async () => {
          await page.clock.runFor(300);
          return failures;
        })
        .toBe(1);
      const trigger = page.getByRole("button", {
        name: /同步待重试.*关注列表读取重试中/,
      });
      await expect(trigger).toBeVisible();
      await expect(trigger).toHaveAttribute("aria-expanded", "false");
      await expect(
        page.getByText("修改已保存在本机，连接恢复后自动同步。", {
          exact: true,
        }),
      ).toHaveCount(0);
      expect(await editor.evaluate((el) => document.activeElement === el)).toBe(
        true,
      );
      await expect(page.locator(".session-top-nav")).toHaveAttribute(
        "data-connection-state",
        "ready",
      );
      await page.screenshot({
        path: info.outputPath("compact-read-retry.png"),
      });
      await trigger.click();
      await expect(
        page.getByText("关注列表读取暂不可用", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("服务返回 HTTP 503", { exact: true }),
      ).toBeVisible();
      const downloading = page.waitForEvent("download");
      await page
        .getByRole("button", { name: "导出连接诊断", exact: true })
        .click();
      const download = await downloading;
      expect(download.suggestedFilename()).toBe(
        "kanban-connection-diagnostics.json",
      );
      const diagnosticText = await readFile((await download.path())!, "utf8");
      const diagnostic = JSON.parse(diagnosticText);
      expect(Object.keys(diagnostic.channels).sort()).toEqual([
        "events",
        "health",
        "projects",
        "tabs",
      ]);
      expect(diagnostic.channels.tabs.failure.status).toBe(503);
      expect(diagnostic.channels.tabs.pending).toBe(0);
      expect(diagnosticText.length).toBeLessThan(16000);
      expect(diagnosticText).not.toContain(
        "Keep typing during metadata retries",
      );
      await page
        .getByRole("button", { name: "收起同步详情", exact: true })
        .click();
      failReads = false;
      await page.clock.runFor(5100);
      await expect(trigger).toBeHidden();
      failReads = true;
      await expect
        .poll(async () => {
          await page.clock.runFor(300);
          return failures;
        })
        .toBe(2);
      await expect(trigger).toHaveAttribute("aria-expanded", "false");
      failReads = false;
      await trigger.click();
      await page.getByRole("button", { name: "立即同步", exact: true }).click();
      await expect(trigger).toBeHidden();
      await expect(editor).toHaveText("Keep typing during metadata retries");
      // An intermittent failure can recover before a person opens its detail.
      // The permanent menu entry still exports the last fixed metadata record.
      await page.getByRole("button", { name: "更多功能", exact: true }).click();
      const recoveredDownload = page.waitForEvent("download");
      await page
        .getByRole("menuitem", { name: "导出连接诊断", exact: true })
        .click();
      const recoveredText = await readFile(
        (await (await recoveredDownload).path())!,
        "utf8",
      );
      const recovered = JSON.parse(recoveredText);
      expect(recovered.channels.tabs.failure).toBeNull();
      expect(recovered.channels.tabs.lastFailure.status).toBe(503);
      expect(recovered.channels.tabs.totalFailures).toBe(2);
      expect(recoveredText).not.toContain(
        "Keep typing during metadata retries",
      );
      expect(errors).toEqual([]);
      expect(
        fixture.calls.filter((c) =>
          /\/turn\/(start|interrupt)|\/thread\/resume|\/followups\/submit/.test(
            c.path,
          ),
        ),
      ).toEqual([]);
      await writeFile(
        info.outputPath("sync-evidence.json"),
        JSON.stringify(
          {
            failures,
            errors,
            nativeEventSource: true,
            noTaskWrites: true,
            draftPreserved: true,
          },
          null,
          2,
        ),
      );
    } finally {
      await page.close();
      await stream.close();
    }
  });
