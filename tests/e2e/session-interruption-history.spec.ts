import { expect, test } from "@playwright/test";
import { setup } from "./session-composer-v2-fixture";

test("refresh keeps an interrupted turn separate from a later completed reply", async ({
  page,
}) => {
  await page.setViewportSize({ width: 393, height: 852 });
  const oldTurn = {
    id: "interrupted-turn",
    status: "interrupted",
    startedAt: 1,
    completedAt: 2,
    durationMs: 1200,
    error: null,
    items: [
      {
        type: "userMessage",
        id: "interrupted-user",
        content: [{ type: "text", text: "旧请求", text_elements: [] }],
      },
      {
        type: "agentMessage",
        id: "interrupted-partial",
        text: "旧轮次的部分输出",
        phase: "commentary",
      },
    ],
  };
  const laterTurn = {
    id: "completed-turn",
    status: "completed",
    startedAt: 3,
    completedAt: 4,
    durationMs: 900,
    error: null,
    items: [
      {
        type: "userMessage",
        id: "later-user",
        content: [{ type: "text", text: "你好", text_elements: [] }],
      },
      {
        type: "agentMessage",
        id: "later-answer",
        text: "你好，我在。",
        phase: "final_answer",
      },
    ],
  };
  const f = await setup(page, false, async (fixture) => {
    fixture.threads[0].turns = [oldTurn, laterTurn] as never[];
  });
  try {
    const interrupted = page.getByLabel("该轮已中断");
    await expect(interrupted).toBeVisible();
    await expect(interrupted).toHaveAttribute(
      "title",
      "仅表示本轮的历史结束状态；刷新只读取历史，后续回答会显示为新的轮次。",
    );
    await expect(page.getByText("你好，我在。", { exact: true })).toBeVisible();

    await page.reload({ waitUntil: "domcontentloaded" });

    await expect(page.getByLabel("该轮已中断")).toBeVisible();
    await expect(page.getByText("你好，我在。", { exact: true })).toBeVisible();
    expect(f.calls).toEqual([]);
    expect(
      f.fixture.calls.filter((call) =>
        /\/(?:turn\/(?:start|interrupt)|thread\/(?:start|resume|unsubscribe))$/.test(
          call.path,
        ),
      ),
    ).toEqual([]);
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});
