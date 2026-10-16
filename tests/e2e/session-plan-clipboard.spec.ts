import { expect, test, type Page } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

const source =
  "# 计划\n\n先看范围，再改代码。\n\n保留原始标记 citeturn0search0\n";
async function setup(page: Page) {
  const fixture = await installSessionUxFixture(page, 1);
  fixture.threads[0].turns = [
    {
      id: "plan-copy-turn",
      status: "completed",
      startedAt: 1,
      completedAt: 2,
      durationMs: 1000,
      error: null,
      items: [{ type: "plan", id: "plan-copy", text: source }],
    } as any,
  ];
  await page.goto("/?mode=session");
  await page
    .locator(".session-agent-view [contenteditable=true]")
    .first()
    .waitFor();
  await seedSessionUx(page, 1);
  await page.evaluate(async () => {
    const path = "/src/session-mode/stores/useAgentCenterStore.ts";
    const { useAgentCenterStore } = await import(
      performance
        .getEntriesByType("resource")
        .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
    );
    useAgentCenterStore
      .getState()
      .addAgentCard(
        {
          kind: "codex",
          id: "ux-0",
          cwd: "/fixture/项目/very-long-project-path-for-ui-regression",
          preview: "计划复制",
        },
        { activate: true },
      );
  });
  const tab = page.locator('[data-tab-key="codex:ux-0"]').first();
  await tab.click({ position: { x: 20, y: 12 } });
  const plan = page.locator(".codex-plan");
  await expect(plan).toContainText("先看范围，再改代码。");
  return { fixture, plan };
}

test("plan copy uses the HTTP fallback and preserves raw source and the unsent composer draft", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const { fixture, plan } = await setup(page);
  const editor = page
    .locator(".session-codex-composer [contenteditable=true]")
    .first();
  await editor.fill("这条草稿保持未发送");
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    (window as any).__planClipboard = { calls: 0, text: "" };
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: (command: string) => {
        if (command !== "copy") throw new Error("Unexpected command");
        (window as any).__planClipboard.calls++;
        (window as any).__planClipboard.text =
          document.querySelector("textarea")?.value;
        return true;
      },
    });
  });
  await plan.getByRole("button", { name: "复制计划", exact: true }).click();
  await expect(
    plan.getByRole("button", { name: "已复制", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => (window as any).__planClipboard)).toEqual({
    calls: 1,
    text: source,
  });
  await expect(editor).toHaveText("这条草稿保持未发送");
  expect(
    fixture.calls.filter((call) =>
      /\/(?:turn\/start|followups\/submit)$/.test(call.path),
    ),
  ).toEqual([]);
  expect(errors).toEqual([]);
});

test("a pending plan copy is single-flight, reports rejection and keeps native copied feedback for two seconds", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const { plan } = await setup(page);
  await page.evaluate(() => {
    const probe = ((window as any).__planClipboard = {
      calls: 0,
      reject: undefined,
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: () => {
          probe.calls++;
          if (probe.calls > 1) return Promise.resolve();
          return new Promise<void>((_, reject) => {
            probe.reject = () => reject(new Error("Clipboard denied"));
          });
        },
      },
    });
  });
  const button = plan.getByRole("button", { name: "复制计划", exact: true });
  await button.click();
  await expect(button).toHaveAttribute("aria-busy", "true");
  await button.evaluate((node) => (node as HTMLButtonElement).click());
  expect(await page.evaluate(() => (window as any).__planClipboard.calls)).toBe(
    1,
  );
  await page.evaluate(() => (window as any).__planClipboard.reject());
  await expect(
    page.getByText("无法复制到剪贴板", { exact: true }),
  ).toBeVisible();
  await expect(button).not.toHaveAttribute("aria-busy");
  await button.click();
  const copied = plan.getByRole("button", { name: "已复制", exact: true });
  await expect(copied).toBeVisible();
  await copied.click();
  expect(await page.evaluate(() => (window as any).__planClipboard.calls)).toBe(
    2,
  );
  await page.waitForTimeout(1500);
  await expect(copied).toBeVisible();
  await page.screenshot({ path: info.outputPath("plan-copy-feedback.png") });
  await expect(button).toBeVisible({ timeout: 1500 });
  expect(errors).toEqual([]);
});
