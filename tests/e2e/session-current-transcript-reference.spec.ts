import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

const reference = process.env.CODEX_CURRENT_TRANSCRIPT_REFERENCE_URL;
test.afterEach(async ({ page }, info) => {
  if (info.status === info.expectedStatus) return;
  await info.attach("native-errors", { body: JSON.stringify(await page.evaluate(() => (window as any).nativeErrors).catch(() => [])), contentType: "application/json" });
});

for (const width of [700, 390]) for (const theme of ["dark", "light"]) {
  test(`current quota notice matches original geometry and icon (${width} ${theme})`, async ({ page }, info) => {
    test.skip(!reference, "An explicit current pinned read-only LAN reference is required");
    await page.setViewportSize({ width, height: 844 });
    const native = await page.context().newPage();
    await native.setViewportSize({ width, height: 844 });
    await native.route("**/*", route => new URL(route.request().url()).origin === new URL(reference!).origin ? route.continue() : route.abort());
    await native.goto(reference!, { waitUntil: "domcontentloaded" });
    await native.waitForFunction(() => (window as any).nativeTranscriptLoaded);
    const foreground = theme === "dark" ? "#ccc" : "#3b3b3b";
    const background = theme === "dark" ? "#20211d" : "#fff";
    await native.evaluate(({ foreground, background, width }) => {
      document.documentElement.style.setProperty("--vscode-foreground", foreground);
      document.documentElement.style.setProperty("--vscode-editor-background", background);
      document.body.style.background = background; document.body.style.color = foreground;
      document.getElementById("root")!.style.width = `${Math.min(648, width - 2)}px`;
      (window as any).renderNativeTranscriptItem({ type: "generated-image", id: "quota", src: null, status: "failed", failure: { type: "usageLimitExceeded", limitId: "image_gen", resetsAt: null } });
    }, { foreground, background, width });
    await expect(native.locator("#root")).toContainText("图像创建上限");
    await installSessionUxFixture(page, 1);
    await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
    await seedSessionUx(page, 1);
    await page.evaluate(async theme => {
      const load = (path: string) => import(performance.getEntriesByType("resource").findLast(entry => new URL(entry.name).pathname === path)?.name ?? path);
      const [{ useCodexStore }, { useAgentCenterStore }, { useThemeStore }, { useLayoutStore }] = await Promise.all([load("/src/session-mode/components/codex/stores/index.ts"), load("/src/session-mode/stores/useAgentCenterStore.ts"), load("/src/session-mode/stores/settings/useThemeStore.ts"), load("/src/session-mode/stores/useLayoutStore.ts")]);
      useThemeStore.getState().setTheme(theme);
      useLayoutStore.setState({ isSidebarOpen: false, isRightPanelOpen: false });
      useCodexStore.setState({ events: { "ux-0": [{ method: "item/completed", params: { threadId: "ux-0", turnId: "quota-turn", item: { type: "imageGeneration", id: "quota", status: "failed", result: "", revisedPrompt: null, transcriptMetadataOnly: true, failure: { type: "usageLimitExceeded", limitId: "image_gen", resetsAt: null } } } }] }, historyLoadedMap: { "ux-0": true } });
      useAgentCenterStore.getState().addAgentCard({ kind: "codex", id: "ux-0", cwd: "/fixture/项目/very-long-project-path-for-ui-regression", preview: "quota" });
    }, theme);
    const actual = page.locator('[data-image-quota-failure="quota"]');
    await expect(actual).toBeVisible();
    await native.evaluate(width => { const root = document.getElementById("root")!; root.style.maxWidth = "none"; root.style.width = `${width + 32}px`; }, await actual.evaluate(node => node.getBoundingClientRect().width));
    const measure = (node: Element) => {
      const css = getComputedStyle(node), box = node.getBoundingClientRect(), icon = node.querySelector("svg")!, iconBox = icon.getBoundingClientRect();
      return { text: node.textContent?.trim(), width: box.width, height: box.height, font: css.fontSize, line: css.lineHeight, family: css.fontFamily.split(",")[0], color: css.color, gap: css.gap, padding: css.padding, icon: { width: iconBox.width, height: iconBox.height, viewBox: icon.getAttribute("viewBox"), paths: [...icon.querySelectorAll("path")].map(path => path.getAttribute("d")) } };
    };
    const original = await native.locator("#root > div > div").evaluate(measure);
    const candidate = await actual.evaluate(measure);
    await writeFile(info.outputPath("paired-quota.json"), JSON.stringify({ width, theme, original, candidate }, null, 2));
    await native.screenshot({ path: info.outputPath("original.png") });
    await page.screenshot({ path: info.outputPath("candidate.png") });
    expect(candidate).toEqual(original);
    expect(await native.evaluate(() => (window as any).nativeErrors)).toEqual([]);
    await native.close();
  });
}
test("pinned current original renderer can display a quota result without a live native client", async ({ page }, info) => {
  test.skip(!reference, "An explicit current pinned read-only LAN reference is required");
  await page.route("**/*", route => new URL(route.request().url()).origin === new URL(reference!).origin ? route.continue() : route.abort());
  await page.goto(reference!, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => (window as any).nativeTranscriptLoaded);
  await page.evaluate(() => (window as any).renderNativeTranscriptItem({ type: "generated-image", id: "quota", src: null, status: "failed", failure: { type: "usageLimitExceeded", limitId: "image_gen", resetsAt: null } }));
  await expect(page.locator("#root")).toContainText("图像创建上限");
  await writeFile(info.outputPath("native-metrics.json"), JSON.stringify(await page.locator("#root").evaluate(root => ({
    html: root.innerHTML,
    rows: [...root.querySelectorAll("div,span,svg")].map(node => { const css = getComputedStyle(node), rect = node.getBoundingClientRect(); return { tag: node.tagName, class: node.getAttribute("class"), width: rect.width, height: rect.height, font: css.fontSize, line: css.lineHeight, family: css.fontFamily, color: css.color, gap: css.gap, display: css.display, margin: css.margin, padding: css.padding, before: getComputedStyle(node, "::before").backgroundColor }; }),
    svg: root.querySelector("svg")?.outerHTML,
  })), null, 2));
  await info.attach("native-body", { body: await page.locator("#root").innerText(), contentType: "text/plain" });
  await info.attach("native-css", { body: JSON.stringify(await page.locator("#root").evaluate(root => [...root.querySelectorAll("*")].filter(node => node.children.length === 0 && node.textContent).map(node => { const css = getComputedStyle(node); return { tag: node.tagName, class: node.className, text: node.textContent, font: css.fontSize, line: css.lineHeight, family: css.fontFamily, color: css.color, margin: css.margin, padding: css.padding }; })), null, 2), contentType: "application/json" });
  await info.attach("native-errors", { body: JSON.stringify(await page.evaluate(() => (window as any).nativeErrors)), contentType: "application/json" });
  await page.screenshot({ path: info.outputPath("native-quota.png") });
});
