import { expect, test } from "@playwright/test";
import { setup } from "./session-composer-v2-fixture";

const text = "但最近的 5 bit 对比需要区分：\n\n| 用途 | 实际使用的数据 |\n|---|---|\n| Torch 敏感度对齐 | 上述 v02 语料，829 个窗口；已验证 8 张权重 |\n| 最近混合分配的敏感度 | 直接读取 GGUF-Tool-Suite 发布的 `iq1_kt` KLD 表 |\n| GPTQ 量化校准 | v02 语料前 8 个合格段落，每段最多 512 个字符 |\n| 最终 PPL 评估 | 独立的 `wiki.test.raw`，128×512-token 窗口 |\n\n~~旧结论~~ 可查看：[校准语料](src/corpus.py:12)。";

for (const width of [390, 1440]) {
  test(`Codex tables retain rows, formatting and mobile scrolling at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const f = await setup(page, false);
    try {
      f.fixture.threads[0].turns = [{ id: "table-turn", status: "completed", items: [{ type: "agentMessage", id: "table-message", text, phase: "final" }] }] as never;
      await page.reload({ waitUntil: "domcontentloaded" });
      const table = page.locator(".codex-assistant table").first();
      await expect(table).toBeVisible();
      await expect(table.locator("thead th")).toHaveCount(2);
      await expect(table.locator("tbody tr")).toHaveCount(4);
      await expect(table.locator("code")).toHaveText(["iq1_kt", "wiki.test.raw"]);
      await expect(page.locator(".codex-assistant del")).toHaveText("旧结论");
      await expect(page.getByRole("link", { name: "校准语料", exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(f.errors).toEqual([]);
      await page.screenshot({ path: test.info().outputPath(`table-${width}.png`) });
    } finally { await f.close(); }
  });
}
