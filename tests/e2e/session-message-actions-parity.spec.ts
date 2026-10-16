import { expect, test, type Locator, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";
import { probeMessageClipboardRetention } from "./session-message-copy-retention";

const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 20 10"><use xlink:href="#shape"/><script>window.svgMustStayInert = true</script></svg>';
const svgSource = `Before\n\n\`\`\`svg\n${svg}\n\`\`\`\n\nAfter`;
const longSource =
  Array.from(
    { length: 32 },
    (_, i) => `第 ${i + 1} 段用户原文，窄屏也按实际换行测量。`,
  ).join("\n\n") +
  "\n\n[Needle-tail](https://example.test/tail)\n\n```text\nexact code at tail\n```";
const pixel =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=";

async function setup(page: Page, source = longSource) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const fixture = await installSessionUxFixture(page, 1);
  fixture.threads[0].turns = [
    {
      id: "message-actions-turn",
      status: "completed",
      startedAt: 1,
      completedAt: 2,
      durationMs: 1000,
      error: null,
      items: [
        {
          type: "userMessage",
          id: "user-actions",
          content: [
            { type: "image", url: pixel },
            { type: "text", text: source, text_elements: [] },
          ],
        },
        {
          type: "agentMessage",
          id: "assistant-actions",
          text: svgSource,
          phase: "final_answer",
        },
      ],
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
    useAgentCenterStore.getState().addAgentCard(
      {
        kind: "codex",
        id: "ux-0",
        cwd: "/fixture/项目/very-long-project-path-for-ui-regression",
        preview: "消息操作",
      },
      { activate: true },
    );
  });
  await page
    .locator('[data-tab-key="codex:ux-0"]')
    .first()
    .click({ position: { x: 20, y: 12 } });
  const user = page
    .locator('.codex-native-user[data-owner-thread="ux-0"]')
    .first();
  await expect(user).toContainText(
    source === longSource ? "第 1 段用户原文" : "Before",
  );
  return { fixture, user, errors };
}

async function isolateClipboard(page: Page, rich = true) {
  await page.evaluate((rich) => {
    const captures: Array<{ text: string; html?: string }> = [];
    (window as any).__messageClipboard = captures;
    if (rich) {
      Object.defineProperty(window, "ClipboardItem", {
        configurable: true,
        value: class {
          constructor(public data: Record<string, Blob>) {}
          getType(type: string) {
            return Promise.resolve(this.data[type]);
          }
        },
      });
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          write: async (items: any[]) => {
            captures.push({
              text: await (await items[0].getType("text/plain")).text(),
              html: await (await items[0].getType("text/html")).text(),
            });
          },
        },
      });
    } else {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: undefined,
      });
      Object.defineProperty(document, "execCommand", {
        configurable: true,
        value: (command: string) => {
          if (command !== "copy") throw new Error("Unexpected fixture command");
          const values: Record<string, string> = {};
          const event = new Event("copy", { cancelable: true });
          Object.defineProperty(event, "clipboardData", {
            value: {
              setData: (type: string, value: string) => {
                values[type] = value;
              },
            },
          });
          document.dispatchEvent(event);
          captures.push({
            text: values["text/plain"],
            html: values["text/html"],
          });
          return true;
        },
      });
    }
  }, rich);
}
async function copy(page: Page, owner: Locator, label: string) {
  const button = owner.locator(`button[aria-label="${label}"]`);
  await page.locator('[data-codex-transcript-shell="ux-0"]').hover();
  await page.mouse.wheel(0, -1200);
  await owner.hover();
  await expect(button).toBeVisible();
  await button.focus();
  await expect(button).toBeVisible();
  const before = await page.evaluate(
    () => (window as any).__messageClipboard.length,
  );
  await button.click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__messageClipboard.length))
    .toBe(before + 1);
  return page.evaluate(
    () =>
      (window as any).__messageClipboard.at(-1) as {
        text: string;
        html: string;
      },
  );
}

for (const viewport of [
  { width: 1280, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`user disclosure matches native body and button line heights at ${viewport.width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize(viewport);
    const { user, errors } = await setup(page);
    const more = user.getByRole("button", { name: "显示更多", exact: true });
    const records = [];
    for (const font of [13, 15]) {
      // Match the explicit host font inputs used by the unchanged native v/gt
      // fixture; no computed-style or layout API is replaced.
      await user.evaluate((element, font) => {
        (element as HTMLElement).style.setProperty(
          "--codex-chat-size",
          `${font}px`,
        );
      }, font);
      await expect(more).toHaveAttribute("aria-expanded", "false");
      await expect
        .poll(() =>
          user
            .locator('[data-native-user-message-collapsed="true"]')
            .evaluate((element) => element.getBoundingClientRect().height),
        )
        .toBe(Math.ceil(font * 1.625 * 19));
      const metrics = await user.evaluate((element) => {
        const describe = (selector: string) => {
          const node = element.querySelector(selector)!;
          const style = getComputedStyle(node);
          return {
            font: Number.parseFloat(style.fontSize),
            line: Number.parseFloat(style.lineHeight),
            height: node.getBoundingClientRect().height,
            gap: style.gap,
            marginTop: style.marginTop,
          };
        };
        return {
          body: describe(".codex-native-user-message-text"),
          clip: describe('[data-native-user-message-collapsed="true"]'),
          ellipsis: describe("[data-native-user-message-ellipsis]"),
          button: describe(".codex-native-user-message-disclosure"),
        };
      });
      records.push({ font, ...metrics });
      const path = info.outputPath("native-user-message-font-geometry.json");
      writeFileSync(path, JSON.stringify(records, null, 2));
      expect(metrics.body.font).toBe(font);
      expect(metrics.body.line).toBe(font * 1.625);
      expect(metrics.clip.height).toBe(Math.ceil(font * 1.625 * 19));
      expect(metrics.ellipsis.height).toBe(font * 1.625);
      expect(metrics.button.font).toBe(font);
      expect(metrics.button.line).toBe(font * 1.5);
      expect(metrics.button.height).toBe(font * 1.5);
      expect(metrics.button.gap).toBe("4px");
      expect(metrics.button.marginTop).toBe("6px");
    }
    await info.attach("native-user-message-font-geometry", {
      path: info.outputPath("native-user-message-font-geometry.json"),
      contentType: "application/json",
    });
    expect(errors).toEqual([]);
  });

  test(`user message keeps native 20-line disclosure, full copy and reachable controls at ${viewport.width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize(viewport);
    const { fixture, user, errors } = await setup(page);
    await isolateClipboard(page);
    const more = user.getByRole("button", { name: "显示更多", exact: true });
    await expect(more).toHaveAttribute("aria-expanded", "false");
    const clip = user.locator('[data-native-user-message-collapsed="true"]');
    const tail = user.locator('a[href="https://example.test/tail"]');
    await expect(tail).toHaveAttribute("inert", "");
    const geometry = await clip.evaluate((element) => ({
      height: element.getBoundingClientRect().height,
      line: Number.parseFloat(getComputedStyle(element).lineHeight),
      full: element.scrollHeight,
    }));
    expect(geometry.height).toBe(Math.ceil(geometry.line * 19));
    expect(geometry.full).toBeGreaterThan(geometry.line * 20 + 1);
    await expect(
      user.locator("[data-native-user-message-ellipsis]"),
    ).toHaveText("…");
    expect(
      await user
        .getByRole("img", { name: "Uploaded 1" })
        .evaluate(
          (element) =>
            element.closest('[data-native-user-message-collapsed="true"]') ===
            null,
        ),
    ).toBe(true);
    const payload = await copy(page, user, "复制消息");
    expect(payload.text).toContain("Needle-tail");
    expect(payload.text).toContain("exact code at tail");
    expect(payload.text).not.toContain("显示更多");
    expect(payload.html).toContain('href="https://example.test/tail"');
    await more.focus();
    await page.keyboard.press("Enter");
    const less = user.getByRole("button", { name: "收起", exact: true });
    await expect(less).toHaveAttribute("aria-expanded", "true");
    await expect(tail).not.toHaveAttribute("inert");
    await expect(less).toBeFocused();
    await page.keyboard.press("Space");
    await expect(more).toHaveAttribute("aria-expanded", "false");
    await expect(tail).toHaveAttribute("inert", "");
    await page.screenshot({
      path: info.outputPath(`user-message-${viewport.width}.png`),
    });
    expect(
      fixture.calls.filter((call) =>
        /\/(?:turn\/start|followups\/submit|thread\/rollback)$/.test(call.path),
      ),
    ).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test("SVG previews preserve exact user plain source and assistant rich code without executing SVG script", async ({
  page,
}) => {
  const { fixture, user, errors } = await setup(page, svgSource);
  await isolateClipboard(page);
  const userPayload = await copy(page, user, "复制消息");
  expect(userPayload.text).toContain(svg);
  const assistant = page
    .locator('.codex-assistant[data-owner-thread="ux-0"]')
    .first();
  const assistantPayload = await copy(page, assistant, "复制回复");
  expect(assistantPayload.text).toBe(svgSource);
  for (const payload of [userPayload, assistantPayload]) {
    const parsed = await page.evaluate((html) => {
      const root = document.createElement("div");
      root.innerHTML = html;
      return {
        code: root.querySelector("pre code")?.textContent,
        active: root.querySelector("svg, script") !== null,
      };
    }, payload.html);
    expect(parsed).toEqual({ code: svg, active: false });
  }
  expect(
    await page.evaluate(() => (window as any).svgMustStayInert),
  ).toBeUndefined();
  expect(
    fixture.calls.filter((call) =>
      /\/(?:turn\/start|followups\/submit)$/.test(call.path),
    ),
  ).toEqual([]);
  expect(errors).toEqual([]);
});

test("collapsed full message copy keeps raw tail with HTTP fallback and preserves composer selection", async ({
  page,
}) => {
  const { user, errors } = await setup(page);
  const editor = page
    .locator('.session-codex-composer [contenteditable="true"]')
    .first();
  await editor.fill("未发送草稿及选区");
  await isolateClipboard(page, false);
  await editor.evaluate((element) => {
    element.focus();
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  });
  // Dispatch the same native click without replacing the fixture's text selection.
  await user
    .locator('button[aria-label="复制消息"]')
    .evaluate((element) => (element as HTMLButtonElement).click());
  await expect
    .poll(() => page.evaluate(() => (window as any).__messageClipboard.length))
    .toBe(1);
  const payload = await page.evaluate(
    () => (window as any).__messageClipboard[0],
  );
  expect(payload.text).toContain("Needle-tail");
  expect(payload.html).toContain("exact code at tail");
  await expect(editor).toBeFocused();
  await expect(editor).toHaveText("未发送草稿及选区");
  expect(await page.evaluate(() => document.getSelection()?.toString())).toBe(
    "未发送草稿及选区",
  );
  expect(errors).toEqual([]);
});

test("the actual conversation search reveals clipped matches and mode hiding restores managed focus", async ({
  page,
}) => {
  const { fixture, user, errors } = await setup(page);
  await page.route("**/api/codex/thread/search-occurrences", (route) =>
    route.fulfill({
      json: {
        data: [
          {
            turnId: "message-actions-turn",
            itemId: "user-actions",
            snippet: "Needle-tail",
            snippetMatchRange: { start: 0, end: 11 },
            turnCursor: null,
          },
        ],
        nextCursor: null,
      },
    }),
  );
  const tail = user.locator('a[href="https://example.test/tail"]');
  await expect(tail).toHaveAttribute("inert", "");
  await page
    .locator('.session-codex-composer [contenteditable="true"]')
    .first()
    .focus();
  await page.keyboard.press("Control+f");
  await page.getByRole("textbox", { name: "搜索会话正文" }).fill("Needle-tail");
  await page.locator(".codex-thread-search-results button").first().click();
  await expect(
    user.getByRole("button", { name: "收起", exact: true }),
  ).toBeVisible();
  await expect(tail).not.toHaveAttribute("inert");
  await expect
    .poll(() =>
      page.evaluate(() =>
        Array.from(
          (CSS as any).highlights.get("codex-thread-search-active") ?? [],
        ).map((range: Range) => range.toString()),
      ),
    )
    .toEqual(["Needle-tail"]);
  await page.getByRole("button", { name: "关闭搜索", exact: true }).click();
  await user.getByRole("button", { name: "收起", exact: true }).click();
  await expect(tail).toHaveAttribute("inert", "");
  const captured = await tail.elementHandle();
  await page.getByRole("button", { name: "终端", exact: true }).first().click();
  await expect
    .poll(() => captured!.evaluate((element) => element.hasAttribute("inert")))
    .toBe(false);
  await expect
    .poll(() =>
      captured!.evaluate((element) => element.hasAttribute("aria-hidden")),
    )
    .toBe(false);
  await page.getByRole("button", { name: "会话", exact: true }).first().click();
  await expect(
    user.getByRole("button", { name: "显示更多", exact: true }),
  ).toBeVisible();
  await expect(tail).toHaveAttribute("inert", "");
  expect(
    fixture.calls.filter((call) =>
      /\/(?:turn\/start|followups\/submit|thread\/rollback)$/.test(call.path),
    ),
  ).toEqual([]);
  expect(errors).toEqual([]);
});

test("unmounted plan and whole-message copies release bodies while native clipboard writes stay pending", async ({
  page,
  browserName,
}, info) => {
  test.skip(browserName !== "chromium", "Requires actual V8 heap snapshots");
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const fixture = await installSessionUxFixture(page, 0);
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  await page.locator(".session-mode [contenteditable=true]").first().waitFor();
  await seedSessionUx(page, 0);
  // Actual original red: round2 messages/copy-retention-red-results.json.
  // Each pending view kept its 262KB body; uncopied controls were collected.
  const result = await probeMessageClipboardRetention(page);
  const evidencePath = info.outputPath(
    "pending-message-clipboard-v8-payloads.json",
  );
  writeFileSync(evidencePath, JSON.stringify(result, null, 2));
  await info.attach("pending-message-clipboard-v8-payloads", {
    path: evidencePath,
    contentType: "application/json",
  });
  expect(result.writes).toEqual({ write: 2, writeText: 1, item: 2 });
  for (const key of Object.keys(result.markers)) {
    expect(result.mountedBodies[key], `${key} real mounted source`).toEqual({
      length: result.payloadSize,
      marker: true,
    });
    expect(
      result.mounted.payloads[key],
      `${key} measurement precondition`,
    ).toBeGreaterThan(0);
    expect(result.afterUnmount.payloads[key], `${key} after unmount`).toBe(0);
  }
  expect(
    fixture.calls.filter((call) =>
      /\/(?:turn\/start|followups\/submit|thread\/rollback)$/.test(call.path),
    ),
  ).toEqual([]);
  expect(errors).toEqual([]);
});
