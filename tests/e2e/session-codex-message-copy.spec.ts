import { expect, test, type Locator } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { setup } from "./session-composer-v2-fixture";
import { renderNativeMarkdownReference } from "./session-native-markdown-reference";
import { installNativeFeedbackClipboard } from "./session-native-feedback-reference";
const reference = process.env.CODEX_NATIVE_REFERENCE_URL;
const text = "Exact message 中文 🙂";
const glyph = (button: Locator) =>
  button.locator("svg").evaluate((el) => ({
    viewBox: el.getAttribute("viewBox"),
    paths: Array.from(el.querySelectorAll("path")).map((p) => ({
      d: p.getAttribute("d"),
      fill: p.getAttribute("fill"),
      stroke: p.getAttribute("stroke"),
    })),
  }));
for (const width of [390, 700])
  for (const theme of ["dark", "light"]) {
    test(`unchanged native user copy pending, copied glyph, tooltip and reset (${width}, ${theme})`, async ({
      page,
    }, info) => {
      test.skip(!reference, "Requires unchanged original VSIX reference");
      test.setTimeout(90000);
      await page.setViewportSize({ width, height: 900 });
      const native = await page.context().newPage();
      await native.setViewportSize({ width, height: 900 });
      const f = await setup(page, false);
      try {
        f.fixture.threads[0].turns = [
          {
            id: "copy-turn",
            status: "completed",
            items: [
              {
                type: "userMessage",
                id: "copy-user",
                content: [{ type: "text", text, text_elements: [] }],
              },
              {
                type: "agentMessage",
                id: "copy-final",
                phase: "final_answer",
                text: "Final reply",
              },
            ],
          },
        ] as never;
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.evaluate(
          (theme) => (document.documentElement.dataset.theme = theme),
          theme,
        );
        await page.evaluate(() => {
          const w = window as any;
          w.messageWrites = [];
          Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: {
              writeText: (value: string) =>
                new Promise<void>((resolve) => {
                  w.messageWrites.push(value);
                  w.finishMessageCopy = resolve;
                }),
            },
          });
        });
        await renderNativeMarkdownReference(
          native,
          reference!,
          "",
          theme,
          width,
          () => installNativeFeedbackClipboard(native),
        );
        await native.evaluate(async (text) => {
          const m = await import(
            /* @vite-ignore */ "./native-message-reference.js?v=2"
          );
          m.initNativeMessages();
          (window as any).renderNativeElement(m.NativeMessageReference, {
            kind: "user",
            props: {
              message: text,
              threadId: "fixture",
              turnId: "turn",
              isAeonFormatted: false,
              onEditMessage: async () => {},
              copyContentRef: { current: null },
              copyPlainTextFromSource: true,
            },
          });
        }, text);
        const original = native.getByRole("button", {
          name: "复制消息",
          exact: true,
        });
        const copy = page.getByRole("button", {
          name: "复制消息",
          exact: true,
        });
        await original.hover();
        await expect(native.getByRole("tooltip").first()).toContainText(
          "复制消息",
        );
        await copy.hover();
        await expect
          .soft(page.getByRole("tooltip").first())
          .toContainText("复制消息");
        await original.click();
        await copy.click();
        await expect
          .poll(() => native.evaluate(() => (window as any).copyWrites))
          .toEqual([text]);
        await expect
          .poll(() => page.evaluate(() => (window as any).messageWrites))
          .toEqual([text]);
        await original.click();
        await copy.click();
        expect(
          await native.evaluate(() => (window as any).copyWrites.length),
        ).toBe(1);
        expect(
          await page.evaluate(() => (window as any).messageWrites.length),
        ).toBe(1);
        await native.evaluate(() => (window as any).finishCopy());
        await page.evaluate(() => (window as any).finishMessageCopy());
        const nativeCopied = native.getByRole("button", {
          name: "已复制",
          exact: true,
        });
        const copied = page.getByRole("button", {
          name: "已复制",
          exact: true,
        });
        await expect(nativeCopied).toBeVisible();
        await expect(copied).toBeVisible();
        const expected = await glyph(nativeCopied),
          actual = await glyph(copied);
        await writeFile(
          info.outputPath("copied-glyph.json"),
          JSON.stringify({ expected, actual }, null, 2),
        );
        await native.screenshot({ path: info.outputPath("native-copied.png") });
        await page.screenshot({ path: info.outputPath("product-copied.png") });
        expect.soft(actual).toEqual(expected);
        await expect(original).toBeVisible({ timeout: 2500 });
        await expect(copy).toBeVisible({ timeout: 2500 });
        expect(f.errors).toEqual([]);
      } finally {
        await f.close();
        await native.close();
      }
    });
  }

for (const [sample, value] of [
  [
    "rich prose",
    "**Bold 中文**\n\n- First\n- Second `code`\n\n[Link](https://example.com)",
  ],
  ["display math", "\\[\nx^2\n\\]"],
  ["image syntax", "Before ![Preview](https://example.com/native-copy.png)"],
  ["code and table", "```js\nconst x = 1;\n```\n\n|A|B|\n|-|-|\n|one|two|"],
  [
    "math and tasks",
    "Equation \\(x^2\\)\n\n\\[y\\]\n\n3. Third\n4. Fourth\n\n- [x] Done\n- [ ] Pending",
  ],
] as const)
  test(`default user copy preserves the unchanged native rendered plain and rich payloads (${sample})`, async ({
    page,
  }, info) => {
    test.skip(!reference, "Requires unchanged original VSIX reference");
    test.setTimeout(90000);
    const native = await page.context().newPage();
    const f = await setup(page, false);
    for (const target of [page, native])
      await target.route("https://example.com/native-copy.png", (route) =>
        route.fulfill({
          contentType: "image/png",
          body: Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
            "base64",
          ),
        }),
      );
    const observeRich = async (target: typeof page) =>
      target.evaluate(() => {
        const w = window as any;
        w.richWrites = [];
        w.ClipboardItem = class {
          readonly types: string[];
          constructor(readonly data: Record<string, Blob>) {
            this.types = Object.keys(data);
          }
          getType(type: string) {
            return Promise.resolve(this.data[type]);
          }
        };
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: {
            write: async (items: any[]) => {
              for (const item of items) {
                const values: Record<string, string> = {};
                for (const type of item.types)
                  values[type] = await (await item.getType(type)).text();
                w.richWrites.push(values);
              }
            },
            writeText: async (value: string) => {
              w.richWrites.push({ "text/plain": value });
            },
          },
        });
      });
    try {
      f.fixture.threads[0].turns = [
        {
          id: "rich-copy-turn",
          status: "completed",
          items: [
            {
              type: "userMessage",
              id: "rich-user",
              content: [{ type: "text", text: value, text_elements: [] }],
            },
            { type: "agentMessage", id: "rich-answer", text: "Done" },
          ],
        },
      ] as never;
      await page.reload({ waitUntil: "domcontentloaded" });
      await observeRich(page);
      await renderNativeMarkdownReference(
        native,
        reference!,
        "",
        "dark",
        700,
        () => observeRich(native),
      );
      await native.evaluate(async (value) => {
        const m = await import(
          /* @vite-ignore */ "./native-message-reference.js?v=2"
        );
        m.initNativeMessages();
        (window as any).renderNativeElement(m.NativeMessageReference, {
          kind: "user",
          props: {
            message: value,
            threadId: "fixture",
            turnId: "turn",
            isAeonFormatted: false,
            onEditMessage: async () => {},
          },
        });
      }, value);
      if (sample === "math and tasks" || sample === "display math")
        await expect(native.locator(".katex").first()).toBeVisible({
          timeout: 5000,
        });
      await native
        .getByRole("button", { name: "复制消息", exact: true })
        .click();
      await page.bringToFront();
      await page.locator(".codex-native-user").hover();
      await page.getByRole("button", { name: "复制消息", exact: true }).click();
      await expect
        .poll(() => native.evaluate(() => (window as any).richWrites.length))
        .toBe(1);
      await expect
        .poll(() => page.evaluate(() => (window as any).richWrites.length))
        .toBe(1);
      const expected = await native.evaluate(
        () => (window as any).richWrites[0],
      );
      const actual = await page.evaluate(() => (window as any).richWrites[0]);
      const originalMarkup = await native.locator("#root").innerHTML();
      const productMarkup = await page
        .locator(".codex-native-user .codex-markdown")
        .innerHTML();
      await writeFile(
        info.outputPath("default-rich-copy.json"),
        JSON.stringify(
          { expected, actual, originalMarkup, productMarkup },
          null,
          2,
        ),
      );
      expect(actual).toEqual(expected);
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
      await native.close();
    }
  });

test("native assistant copy keeps source plain text, rich HTML and its two-second success state", async ({
  page,
}, info) => {
  test.skip(!reference, "Requires unchanged original VSIX reference");
  test.setTimeout(90000);
  const native = await page.context().newPage();
  const f = await setup(page, false);
  const value = "**Reply 中文**";
  const clipboard = async (target: typeof page) =>
    target.evaluate(() => {
      const w = window as any;
      w.replyWrites = [];
      w.ClipboardItem = class {
        readonly types: string[];
        constructor(readonly data: Record<string, Blob>) {
          this.types = Object.keys(data);
        }
        getType(type: string) {
          return Promise.resolve(this.data[type]);
        }
      };
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          write: async (items: any[]) => {
            for (const item of items) {
              const result: Record<string, string> = {};
              for (const type of item.types)
                result[type] = await (await item.getType(type)).text();
              w.replyWrites.push(result);
            }
            await new Promise<void>((resolve) => {
              w.finishReplyCopy = resolve;
            });
          },
          writeText: async (text: string) => {
            w.replyWrites.push({ "text/plain": text });
            await new Promise<void>((resolve) => {
              w.finishReplyCopy = resolve;
            });
          },
        },
      });
    });
  try {
    f.fixture.threads[0].turns = [
      {
        id: "reply-copy",
        status: "completed",
        items: [
          {
            type: "agentMessage",
            id: "reply",
            text: value,
            phase: "final_answer",
          },
        ],
      },
    ] as never;
    await page.reload({ waitUntil: "domcontentloaded" });
    await clipboard(page);
    await renderNativeMarkdownReference(
      native,
      reference!,
      value,
      "dark",
      700,
      () => clipboard(native),
    );
    await native.evaluate(async (value) => {
      const S = await import(
        /* @vite-ignore */ "./native/assets/app-initial-e98b9eaef8e3.js"
      );
      const body = document.querySelector<HTMLElement>(
        "#root [data-selected-text-overlay-target], #root [data-markdown], #root > div",
      );
      if (!body) throw Error("Original assistant Markdown body unavailable");
      const html = S.Mpt(body)?.htmlText;
      const m = await import(
        /* @vite-ignore */ "./native-message-reference.js?v=2"
      );
      m.initNativeMessages();
      (window as any).renderNativeElement(m.NativeMessageReference, {
        kind: "assistant",
        props: {
          copyText: value,
          getCopyHtml: () => html,
          alwaysShowActions: true,
          threadId: "fixture",
          turnId: "turn",
        },
      });
    }, value);
    const original = native.getByRole("button", { name: "复制", exact: true });
    await original.click();
    await page.bringToFront();
    await page.locator(".codex-assistant").hover();
    await page.getByRole("button", { name: "复制回复", exact: true }).click();
    await expect
      .poll(() => native.evaluate(() => (window as any).replyWrites.length))
      .toBe(1);
    await expect
      .poll(() => page.evaluate(() => (window as any).replyWrites.length))
      .toBe(1);
    const expected = await native.evaluate(
      () => (window as any).replyWrites[0],
    );
    const actual = await page.evaluate(() => (window as any).replyWrites[0]);
    await writeFile(
      info.outputPath("assistant-copy.json"),
      JSON.stringify({ expected, actual }, null, 2),
    );
    expect(actual).toEqual(expected);
    await Promise.all([
      native.evaluate(() => (window as any).finishReplyCopy()),
      page.evaluate(() => (window as any).finishReplyCopy()),
    ]);
    const nativeCopied = native.getByRole("button", {
      name: "已复制",
      exact: true,
    });
    const copied = page.getByRole("button", { name: "已复制", exact: true });
    await expect(nativeCopied).toBeVisible();
    await expect(copied).toBeVisible();
    expect(await glyph(copied)).toEqual(await glyph(nativeCopied));
    await page.waitForTimeout(1700);
    await expect(nativeCopied).toBeVisible();
    await expect(copied).toBeVisible();
    await expect(original).toBeVisible({ timeout: 1000 });
    await expect(
      page.getByRole("button", { name: "复制回复", exact: true }),
    ).toBeVisible({ timeout: 1000 });
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
    await native.close();
  }
});
