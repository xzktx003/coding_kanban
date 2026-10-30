import { expect, test } from "@playwright/test";
import { setup } from "./session-composer-v2-fixture";

test.use({
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  },
  permissions: ["microphone"],
});
import { observeNativeCapture, released } from "./session-dictation-fixture";

for (const width of [1440, 393])
  test(`native browser dictation retries the same recording and keeps its owner at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 852 });
    await observeNativeCapture(page);
    const f = await setup(page, false);
    const recordings: unknown[] = [];
    await page.route("**/api/dictation/transcribe", async (route) => {
      recordings.push(route.request().postDataJSON());
      await route.fulfill(
        recordings.length === 1
          ? {
              status: 503,
              json: { error: "isolated transcription temporarily unavailable" },
            }
          : { json: { text: "本次听写内容" } },
      );
    });
    try {
      const editor = page
        .locator('.session-codex-composer [contenteditable="true"]')
        .first();
      await editor.fill("原始草稿");
      await page.getByRole("button", { name: "听写", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "停止听写", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "结束听写并发送", exact: true }),
      ).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(() => (window as any).__dictationCapture.frames),
        )
        .toBeGreaterThan(0);
      await page.getByRole("button", { name: "停止听写", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "重试转写", exact: true }),
      ).toBeVisible();
      await released(page);
      expect(recordings).toHaveLength(1);
      expect(
        Buffer.from((recordings[0] as any).data, "base64").byteLength,
      ).toBeGreaterThan(128);
      await page.getByRole("button", { name: "重试转写", exact: true }).click();
      await expect(editor).toHaveText("原始草稿 本次听写内容");
      expect(recordings).toHaveLength(2);
      expect(recordings[1]).toEqual(recordings[0]);
      expect(
        await page.evaluate(
          () => (window as any).__dictationCapture.streams.length,
        ),
      ).toBe(1);
      await expect(
        page.getByRole("button", { name: "听写", exact: true }),
      ).toBeVisible();
      expect(f.calls).toEqual([]);
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });

test("finish-and-send captures the transcript once for the visible owner", async ({
  page,
}) => {
  await observeNativeCapture(page);
  const f = await setup(page, false);
  let transcriptions = 0;
  await page.route("**/api/dictation/transcribe", async (route) => {
    transcriptions++;
    await route.fulfill({ json: { text: "听写后发送" } });
  });
  try {
    const editor = page
      .locator('.session-codex-composer [contenteditable="true"]')
      .first();
    await editor.fill("原需求");
    await page.getByRole("button", { name: "听写", exact: true }).click();
    const send = page.getByRole("button", {
      name: "结束听写并发送",
      exact: true,
    });
    await expect(send).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => (window as any).__dictationCapture.frames),
      )
      .toBeGreaterThan(0);
    await send.click();
    await expect
      .poll(async () => (await f.queue.get("ux-0")).items.length)
      .toBe(1);
    await f.queue.tick();
    await expect
      .poll(() => f.calls.filter((call) => call.method === "turn/start").length)
      .toBe(1);
    const submitted = f.calls.find((call) => call.method === "turn/start")!;
    expect(submitted.params.threadId).toBe("ux-0");
    expect(submitted.params.input[0].text).toBe("原需求 听写后发送");
    expect(transcriptions).toBe(1);
    await released(page);
    await expect(editor).toHaveText("");
    expect(f.errors).toEqual([]);
  } catch (error) {
    console.info(
      "dictation-failure",
      JSON.stringify(
        await page.evaluate(() => ({
          text: document.body.innerText,
          failure: (window as any).__dictationCapture?.failure,
        })),
      ),
    );
    throw error;
  } finally {
    await f.close();
  }
});
