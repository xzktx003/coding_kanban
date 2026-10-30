import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { setup } from "./session-composer-v2-fixture";
import { composerAction } from "./session-composer-actions";
import { liveStream } from "./session-sse-fixture";

for (const width of [1440, 393])
  test(`closed expanded editor and feedback UI stay outside startup at ${width}px`, async ({
    page,
    baseURL,
  }, info) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width, height: 852 });
    const seen: string[] = [];
    page.on("request", (request) => seen.push(new URL(request.url()).pathname));
    const rich =
      "/src/session-mode/components/codex/composer/v2/RichDraftEditor.tsx";
    const form =
      "/src/session-mode/components/codex/composer/NativeFeedbackDialog.tsx";
    const report =
      "/src/session-mode/features/native-feedback/FeedbackUploadReport.tsx";
    const reportIcons =
      "/src/session-mode/features/native-feedback/ReportIcons.tsx";
    const stream = await liveStream(page, baseURL!);
    let richRelease: (() => void) | undefined,
      formRelease: (() => void) | undefined,
      reportRelease: (() => void) | undefined,
      uploadRelease: (() => void) | undefined;
    const fixture = await setup(page, false);
    let uploads = 0,
      preflights = 0;
    await page.route("**/api/session/api/codex/feedback/preflight", (route) => {
      preflights++;
      return route.fulfill({
        json: {
          reason: null,
          runtimeInstance: "closed-ui-fixture",
          provenance: {
            config: "fresh",
            requirements: "fresh",
            account: "native",
            workspace: "fresh",
          },
        },
      });
    });
    await page.route(
      "**/api/session/api/codex/feedback/upload",
      async (route) => {
        uploads++;
        await new Promise<void>((resolve) => {
          uploadRelease = resolve;
        });
        await route.fulfill({ json: { threadId: "closed-ui-result" } });
      },
    );
    try {
      const editor = page
        .locator(".session-codex-composer [contenteditable=true]")
        .first();
      await expect(editor).toBeVisible();
      const cold = seen.filter((path) =>
        [rich, form, report, reportIcons].includes(path),
      );
      expect(
        cold,
        "Closed optional editors/forms/report icons must not load with the actual composer",
      ).toEqual([]);
      await editor.fill("边界保留草稿");
      await page.route(`**${rich}*`, async (route) => {
        await new Promise<void>((resolve) => {
          richRelease = resolve;
        });
        await route.continue();
      });
      await composerAction(page, "展开编辑");
      await expect.poll(() => Boolean(richRelease)).toBe(true);
      await page.getByRole("button", { name: "取消打开", exact: true }).click();
      richRelease!();
      await expect(
        page.getByRole("dialog", { name: "展开编辑", exact: true }),
      ).toHaveCount(0);
      await expect(editor).toHaveText("边界保留草稿");
      await composerAction(page, "展开编辑");
      const expanded = page.getByRole("dialog", {
        name: "展开编辑",
        exact: true,
      });
      await expect(
        expanded.getByRole("textbox", { name: "正文段落 1", exact: true }),
      ).toHaveValue("边界保留草稿");
      await expanded
        .getByRole("button", { name: "返回并保留草稿", exact: true })
        .click();
      await page.route(`**${form}*`, async (route) => {
        await new Promise<void>((resolve) => {
          formRelease = resolve;
        });
        await route.continue();
      });
      const openFeedback = async () => {
        await editor.fill("边界保留草稿 /feedback");
        await page
          .locator('[data-composer-suggestions="commands"]')
          .getByRole("option", { name: /\/feedback/ })
          .click();
      };
      await openFeedback();
      await expect.poll(() => Boolean(formRelease)).toBe(true);
      stream.emit(1, {
        method: "account/updated",
        params: { authMode: "apiKey", planType: null },
      });
      await expect(
        page.getByText("正在加载反馈表单", { exact: true }),
      ).toHaveCount(0);
      formRelease!();
      await expect(
        page.getByRole("dialog", { name: "提交反馈", exact: true }),
      ).toHaveCount(0);
      await expect(editor).toContainText("边界保留草稿");
      await openFeedback();
      await expect(
        page.getByRole("dialog", { name: "提交反馈", exact: true }),
      ).toBeVisible();
      await page.getByRole("radio", { name: "错误", exact: true }).click();
      await page
        .getByRole("textbox", { name: "填写详情（必填）", exact: true })
        .fill("Captured details");
      await page.route(`**${report}*`, async (route) => {
        await new Promise<void>((resolve) => {
          reportRelease = resolve;
        });
        await route.continue();
      });
      await page.getByRole("button", { name: "提交", exact: true }).click();
      await expect
        .poll(() => Boolean(reportRelease) && Boolean(uploadRelease))
        .toBe(true);
      await page.getByRole("button", { name: "取消打开", exact: true }).click();
      reportRelease!();
      uploadRelease!();
      await expect(
        page.getByRole("dialog", { name: "反馈已提交", exact: true }),
      ).toHaveCount(0);
      const reopen = page.getByRole("button", {
        name: "查看上传内容",
        exact: true,
      });
      await expect(reopen).toHaveCount(1);
      await reopen.click();
      await expect(
        page.getByRole("dialog", { name: "反馈已提交", exact: true }),
      ).toBeVisible();
      expect(uploads).toBe(1);
      expect(preflights).toBe(3);
      for (const module of [rich, form, report])
        expect(seen.filter((path) => path === module)).toHaveLength(1);
      await writeFile(
        info.outputPath("closed-ui-modules.json"),
        JSON.stringify(
          {
            width,
            cold,
            modules: seen.filter((path) =>
              [rich, form, report, reportIcons].includes(path),
            ),
            uploads,
            preflights,
            oldFormRevokedBeforeModuleArrival: true,
            draftPreserved: true,
            boundary:
              "Actual optional-module network boundaries and UI gestures; only preflight/upload HTTP use isolated fixtures.",
          },
          null,
          2,
        ),
      );
    } finally {
      richRelease?.();
      formRelease?.();
      reportRelease?.();
      uploadRelease?.();
      await fixture.close();
      await stream.close();
    }
  });
