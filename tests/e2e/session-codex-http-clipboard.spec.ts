import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { setup } from "./session-composer-v2-fixture";

const code = "exact source";
const table = "| Name | Value |\n| --- | --- |\n| first | `a\\|b` |";
for (const width of [390, 700]) {
  test.describe(`LAN HTTP ${width}`, () => {
    test.use({
      viewport: { width, height: 900 },
      hasTouch: width === 390,
      isMobile: width === 390,
    });
    test("loads sessions and transfers real copy-event text and rich data", async ({
      page,
      baseURL,
    }, info) => {
      test.setTimeout(60000);
      test.skip(
        !baseURL?.startsWith("http:"),
        "This regression requires nonsecure LAN HTTP",
      );
      const f = await setup(page, false);
      try {
        f.fixture.threads[0].turns = [
          {
            id: "http",
            status: "completed",
            items: [
              {
                type: "agentMessage",
                id: "http-md",
                phase: "final_answer",
                text: "```text\n" + code + "\n```\n\n" + table,
              },
            ],
          },
        ] as never;
        await page.reload({ waitUntil: "domcontentloaded" });
        expect(
          await page.evaluate(() => ({
            secure: isSecureContext,
            uuid: typeof crypto.randomUUID,
            clipboard: typeof navigator.clipboard,
          })),
        ).toEqual({ secure: false, uuid: "undefined", clipboard: "undefined" });
        await page.evaluate(() => {
          (window as any).httpCopies = [];
          // Observe the real event after the application supplies the payload.
          // No Clipboard API or execCommand substitute is installed.
          window.addEventListener("copy", (e) =>
            (window as any).httpCopies.push({
              plain: e.clipboardData?.getData("text/plain"),
              html: e.clipboardData?.getData("text/html"),
              prevented: e.defaultPrevented,
            }),
          );
        });
        const fence = page.locator(".codex-native-code-fence");
        await fence.getByRole("button", { name: "复制", exact: true }).click();
        await expect(
          fence.getByRole("button", { name: "已复制", exact: true }),
        ).toBeVisible();
        await page.screenshot({
          path: info.outputPath(`http-code-copied-${width}.png`),
        });
        const tableView = page.locator(".codex-native-table");
        await tableView.hover();
        await tableView
          .getByRole("button", { name: "复制表格", exact: true })
          .click();
        await expect(
          tableView.getByRole("button", { name: "已复制", exact: true }),
        ).toBeVisible();
        await page.screenshot({
          path: info.outputPath(`http-table-copied-${width}.png`),
        });
        const copies = await page.evaluate(() => (window as any).httpCopies);
        await writeFile(
          info.outputPath("http-copy-events.json"),
          JSON.stringify(copies, null, 2),
        );
        expect(copies).toHaveLength(2);
        expect(copies[0]).toEqual({ plain: code, html: "", prevented: true });
        expect(copies[1].plain).toBe(table);
        expect(copies[1].html).toContain('<code dir="ltr">a|b</code>');
        expect(copies[1].html).not.toMatch(/class=|data-|复制|button/);
        expect(copies[1].prevented).toBe(true);
        const replyCopy = page.locator(".codex-assistant .codex-native-copy");
        await replyCopy.click();
        await expect(replyCopy).toHaveAttribute("aria-label", "已复制");
        await page.screenshot({
          path: info.outputPath(`http-reply-copied-${width}.png`),
        });
        const reply = await page.evaluate(() => (window as any).httpCopies[2]);
        expect(reply.plain).toContain("```text\n" + code + "\n```");
        expect(reply.html).toContain(
          `<pre dir="ltr"><code>${code}</code></pre>`,
        );
        expect(reply.html).toContain("<table>");
        expect(reply.html).not.toMatch(/class=|onclick=|Copy code|复制代码/);
        expect(reply.prevented).toBe(true);
        expect(f.errors).toEqual([]);
        expect(f.calls).toEqual([]);
      } finally {
        await f.close();
      }
    });
  });
}
