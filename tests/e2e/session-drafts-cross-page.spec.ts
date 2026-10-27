import { expect, test, type Page } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

const editor = (page: Page) => page.locator(".session-agent-view [contenteditable=true]");
const owner = JSON.stringify(["codex", "", "session", "ux-0"]);
const key = `kanban.session.text-drafts.entry.${encodeURIComponent(owner)}`;

async function open(page: Page) {
  await page.goto("/api/health");
  await page.waitForTimeout(2500);
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  await editor(page).waitFor();
  await seedSessionUx(page, 1);
  await page.locator(".session-nav-row[role=button]").filter({ hasText: "中文会话 0 " }).first().click();
  await expect(page.locator('[role=tab][data-tab-key="codex:ux-0"]')).toHaveAttribute("aria-selected", "true");
}

for (const sameText of [false, true]) {
  test(`a delayed send acknowledgement preserves another page's ${sameText ? "identical but independently edited" : "new"} draft after reload`, async ({ context, page }) => {
    test.setTimeout(90000);
    const b = await context.newPage();
    const errors: string[] = [];
    for (const p of [page, b]) p.on("pageerror", error => { errors.push(error.message); console.error("PAGE_ERROR", error.message); });
    const aFixture = await installSessionUxFixture(page, 1);
    const bFixture = await installSessionUxFixture(b, 1);
    let finish: (() => Promise<void>) | undefined;
    let sends = 0;
    await page.route("**/api/session/followups/submit", async route => {
      sends++;
      const message = route.request().postDataJSON();
      await new Promise<void>(resolve => {
        finish = async () => {
          await route.fulfill({ json: { revision: 1, paused: null, items: [{ ...message, status: "sent", createdAt: Date.now(), turnId: "fixture-completed" }] } });
          resolve();
        };
      });
    });
    await open(page);
    await open(b);
    const submitted = "A submitted words";
    const newer = sameText ? submitted : "B unsent new words";
    await editor(page).fill(submitted);
    await editor(page).press("Enter");
    await expect.poll(() => !!finish).toBe(true);
    await editor(b).fill(newer);
    const before = await b.evaluate(key => JSON.parse(localStorage.getItem(key)!), key);
    const targetBefore = await b.locator(".session-native-composer").getAttribute("data-owner-thread");
    await finish!();
    await expect(editor(page)).toHaveText(newer);
    await expect(editor(b)).toHaveText(newer);
    expect(await b.evaluate(key => JSON.parse(localStorage.getItem(key)!), key)).toEqual(before);
    expect(await b.locator(".session-native-composer").getAttribute("data-owner-thread")).toBe(targetBefore);
    await b.reload({ waitUntil: "domcontentloaded" });
    await expect(editor(b)).toHaveText(newer);
    expect(sends).toBe(1);
    expect(bFixture.calls.some(call => call.path.endsWith("/followups/submit"))).toBe(false);
    expect([...aFixture.calls, ...bFixture.calls].filter(call => /\/turn\/(start|steer|interrupt)$/.test(call.path))).toEqual([]);
    expect(errors).toEqual([]);
    await b.close();
  });
}
