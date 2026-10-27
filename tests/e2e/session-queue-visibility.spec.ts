import { expect, test, type Page } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

async function prepare(page: Page) {
  const fixture = await installSessionUxFixture(page, 1);
  const reads: number[] = [];
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    // Stable fixture stream; reconnect loops are tested separately. Visibility
    // is explicit so headless tabs do not depend on the window manager.
    class Stream {
      onopen: (() => void) | null = null;
      onmessage = null;
      onerror = null;
      closed = false;
      constructor() { setTimeout(() => { if (!this.closed) this.onopen?.(); }, 30); }
      close() { this.closed = true; }
    }
    (window as any).EventSource = Stream;
    (window as any).__fixtureHidden = false;
    Object.defineProperty(document, "hidden", { configurable: true, get: () => (window as any).__fixtureHidden });
  });
  await page.route("**/api/session/followups?**", route => {
    if (new URL(route.request().url()).searchParams.get("threadId") === "ux-0") reads.push(Date.now());
    return route.fulfill({ json: { revision: 1, items: [], paused: null } });
  });
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  await page.locator(".session-native-composer").waitFor();
  await seedSessionUx(page, 1);
  await page.locator(".session-nav-row[role=button]").filter({ hasText: "中文会话 0 " }).first().click();
  await expect(page.locator('[role=tab][data-tab-key="codex:ux-0"]')).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => reads.length).toBeGreaterThan(0);
  return { fixture, reads, errors };
}
async function hidden(page: Page, value: boolean) {
  await page.evaluate(value => {
    (window as any).__fixtureHidden = value;
    document.dispatchEvent(new Event("visibilitychange"));
  }, value);
}
function noMutations(calls: Array<{ path: string }>) {
  expect(calls.filter(call => /\/(turn\/(start|steer|interrupt)|followups\/(submit|stop|change))$/.test(call.path))).toEqual([]);
}

test("a hidden page stops queue reads while another page stays current, then resumes without sending", async ({ context, page }) => {
  test.setTimeout(60000);
  const other = await context.newPage();
  const a = await prepare(page);
  const b = await prepare(other);
  const input = page.locator(".session-agent-view [contenteditable=true]");
  await input.fill("保留当前草稿");
  await hidden(page, true);
  await page.waitForTimeout(100);
  const beforeA = a.reads.length;
  const beforeB = b.reads.length;
  await page.waitForTimeout(4500);
  expect(a.reads.length).toBe(beforeA);
  expect(b.reads.length).toBeGreaterThan(beforeB);
  await hidden(page, false);
  await expect.poll(() => a.reads.length, { timeout: 2500 }).toBeGreaterThan(beforeA);
  await expect(input).toHaveText("保留当前草稿");
  noMutations([...a.fixture.calls, ...b.fixture.calls]);
  expect([...a.errors, ...b.errors]).toEqual([]);
  await other.close();
});

test("switching workbench modes preserves the composer but removes its fast queue polling", async ({ page }) => {
  test.setTimeout(60000);
  const { reads, errors, fixture } = await prepare(page);
  const input = page.locator(".session-agent-view [contenteditable=true]");
  await input.fill("切换模式后继续编辑");
  await page.locator('.session-mode .workbench-mode-switch [data-choice="terminal"]').click();
  await expect(page.locator(".session-mode")).toHaveAttribute("hidden", "");
  await page.waitForTimeout(100);
  const before = reads.length;
  await page.waitForTimeout(4500);
  // Background followed-session metadata has its own 5s/30s cadence. At most
  // one read can belong to it here; the old composer added three extra reads.
  expect(reads.length - before).toBeLessThanOrEqual(1);
  await page.locator('.workbench-terminal .workbench-mode-switch [data-choice="session"]').click();
  await expect(page.locator(".session-mode")).not.toHaveAttribute("hidden", "");
  await expect.poll(() => reads.length, { timeout: 2500 }).toBeGreaterThan(before);
  await expect(input).toHaveText("切换模式后继续编辑");
  noMutations(fixture.calls);
  expect(errors).toEqual([]);
});
