import { expect, test, type Page } from "@playwright/test";
import { installSessionUxFixture } from "./session-ux-fixture";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  ignoreHTTPSErrors: true,
});
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const image = (name: string) => ({ name, mimeType: "image/png", buffer: png });
test.afterEach(async ({ page }, info) => {
  if (info.status === info.expectedStatus || page.isClosed()) return;
  const diagnostic = await page
    .evaluate(async () => {
      const path = "/src/session-mode/components/common/useImageAttachments.ts";
      const { useAttachmentDraftStore } = await import(
        performance
          .getEntriesByType("resource")
          .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
      );
      const { drafts, errors } = useAttachmentDraftStore.getState();
      return {
        errors,
        attachments: Object.values(drafts)
          .flat()
          .map((item) => ({
            name: item.name,
            status: item.status,
            error: item.error,
            fileSize: item.file?.size,
          })),
      };
    })
    .catch((error) => ({ diagnosticError: String(error) }));
  const file = info.outputPath("attachment-failure-diagnostic.json");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(diagnostic, null, 2));
  await info.attach("attachment-failure-diagnostic", {
    path: file,
    contentType: "application/json",
  });
});
async function setup(page: Page, kind: "codex" | "cc" = "codex") {
  const fixture = await installSessionUxFixture(page, 2);
  const cards = fixture.threads.map((thread) => ({
    kind,
    id: thread.id,
    cwd: thread.cwd,
    preview: `${kind} ${thread.id}`,
  }));
  await page.route("**/api/session/tabs", (route) =>
    route.fulfill({
      json: { cards, initialized: true, revision: 1, sequence: 0 },
    }),
  );
  await page.route("**/api/**/cc/session-messages", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route("**/api/**/cc/sessions?*", (route) =>
    route.fulfill({ json: { sessions: [], total: 0 } }),
  );
  await page.addInitScript(
    ({ cards, kind }) => {
      if (localStorage.getItem("mobile-input-fixture-seeded")) return;
      localStorage.setItem("mobile-input-fixture-seeded", "1");
      localStorage.setItem(
        "kanban.session.agent-center-store",
        JSON.stringify({
          version: 5,
          state: {
            cards,
            currentAgentCardId: "ux-0",
            currentAgentCardKind: kind,
            cardsViewMode: "solo",
            sharedTabsInitialized: true,
          },
        }),
      );
      localStorage.setItem(
        "kanban.session.layout-storage",
        JSON.stringify({
          version: 0,
          state: {
            isSidebarOpen: false,
            isRightPanelOpen: false,
            view: "agent",
          },
        }),
      );
    },
    { cards, kind },
  );
  await page.goto("/?mode=session");
  const input = page.locator(
    kind === "codex"
      ? ".session-agent-view [contenteditable=true]"
      : ".session-agent-view textarea:visible",
  );
  await expect(input).toBeVisible();
  return { fixture, input };
}
async function switchTab(page: Page, kind: string, id: string) {
  const tab = page.locator(`[role=tab][data-tab-key="${kind}:${id}"]`);
  await tab.tap({ position: { x: 20, y: 12 } });
  await expect(tab).toHaveAttribute("aria-selected", "true");
}
async function expectNoInputFocus(page: Page) {
  await page.waitForTimeout(200);
  expect(
    await page.evaluate(
      () =>
        document.activeElement?.matches(
          "[contenteditable=true], textarea, input:not([type=file])",
        ) ?? false,
    ),
  ).toBe(false);
}

test("desktop tab changes continue focusing the composer", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1000 },
    hasTouch: false,
    isMobile: false,
    ignoreHTTPSErrors: true,
  });
  try {
    const page = await context.newPage();
    const { input } = await setup(page);
    await expect(input).toBeFocused();
    await page.locator('[role=tab][data-tab-key="codex:ux-1"]').click();
    await expect(input).toBeFocused();
    await input.fill("桌面草稿");
    await page.locator('[role=tab][data-tab-key="codex:ux-0"]').click();
    await expect(input).toBeFocused();
  } finally {
    await context.close();
  }
});

test("touch tab changes restore different drafts without focusing an editor, including landscape and editor remounts", async ({
  page,
}) => {
  const { input } = await setup(page);
  await input.fill("A 的草稿");
  await switchTab(page, "codex", "ux-1");
  await expectNoInputFocus(page);
  await expect(input).toHaveText("");
  await input.fill("B 的另一份草稿");
  await switchTab(page, "codex", "ux-0");
  await expect(input).toHaveText("A 的草稿");
  await expectNoInputFocus(page);
  await input.tap();
  await expect(input).toBeFocused();
  await page.setViewportSize({ width: 844, height: 390 });
  await switchTab(page, "codex", "ux-1");
  await expect(input).toHaveText("B 的另一份草稿");
  await expectNoInputFocus(page);
  await page.reload();
  await expect(input).toHaveText("B 的另一份草稿");
  await expectNoInputFocus(page);
});

for (const kind of ["codex", "cc"] as const)
  test(`${kind}: plus uploads images immediately, retains their owner during slow uploads and supports retries and reload`, async ({
    page,
  }, info) => {
    test.setTimeout(60000);
    const { input, fixture } = await setup(page, kind);
    let release!: () => Promise<void>;
    let fail = true;
    await page.route("**/api/session/files/upload", async (route) => {
      const { name } = route.request().postDataJSON();
      if (name === "slow.png")
        await new Promise<void>((resolve) => {
          release = async () => {
            await route.fulfill({ json: { path: "/fixture/slow.png" } });
            resolve();
          };
        });
      else if (fail) {
        fail = false;
        await route.fulfill({
          status: 503,
          json: { error: "isolated upload error" },
        });
      } else await route.fulfill({ json: { path: "/fixture/retry.png" } });
    });
    await input.fill("A 图片草稿");
    const height = await page.locator(".session-compact-frame").boundingBox();
    await page
      .getByRole("button", { name: "添加附件与上下文", exact: true })
      .tap();
    const upload = page.getByRole("button", { name: "上传图片", exact: true });
    await expect(upload).toBeInViewport();
    await expect
      .poll(async () => (await upload.boundingBox())!.height)
      .toBeGreaterThanOrEqual(44);
    await page.screenshot({
      path: info.outputPath(`${kind}-menu.png`),
    });
    const chooserReady = page.waitForEvent("filechooser");
    await upload.tap();
    const chooser = await chooserReady;
    expect(await chooser.element().getAttribute("accept")).toBe("image/*");
    expect(chooser.isMultiple()).toBe(true);
    await chooser.setFiles([image("slow.png"), image("retry.png")]);
    await expect.poll(() => !!release).toBe(true);
    const attachments = page.locator(
      ".session-context-chip.is-image, .session-attachment",
    );
    await expect(attachments).toHaveCount(2);
    await expect(attachments.locator("img")).toHaveCount(2);
    await expect(
      attachments
        .filter({ has: page.locator('[aria-label*="上传失败"]') })
        .or(page.locator(".session-attachment[data-state=error]")),
    ).toHaveCount(1);
    expect(
      (await page.locator(".session-compact-frame").boundingBox())?.height,
    ).toBe(height?.height);
    await switchTab(page, kind, "ux-1");
    await expect(attachments).toHaveCount(0);
    await input.fill("B 的独立草稿");
    await release();
    if (kind === "codex") await expect(input).toHaveText("B 的独立草稿");
    else await expect(input).toHaveValue("B 的独立草稿");
    await switchTab(page, kind, "ux-0");
    await expectNoInputFocus(page);
    await expect(attachments).toHaveCount(2);
    // Compact preview exposes retry through its preview panel.
    await page
      .getByRole("button", { name: /预览 retry.png|预览图片 retry.png/ })
      .tap();
    await page
      .getByRole("button", { name: /重试上传|重试/ })
      .last()
      .tap();
    await expect(
      page.locator(
        ".session-context-chip.is-image[data-state=ready], .session-attachment[data-state=ready]",
      ),
    ).toHaveCount(2);
    await page.keyboard.press("Escape");
    await page.reload();
    await expect(attachments).toHaveCount(2);
    expect(
      fixture.calls.filter((call) =>
        /\/turn\/(start|steer|interrupt)|\/thread\/(resume|start)|\/cc\/(send-message|resume-session)|\/followups\/submit/.test(
          call.path,
        ),
      ),
    ).toEqual([]);
    await page.screenshot({
      path: info.outputPath(`${kind}-images.png`),
    });
  });
