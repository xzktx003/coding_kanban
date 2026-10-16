import { expect, test, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { setup } from "./session-composer-v2-fixture";
import { probePendingClipboardRetention } from "./session-command-clipboard-retention";

const output = "\u001b[32mexact command output\u001b[0m\n";
const patch = "@@ -1 +1 @@\n-before\n+after\n\\ No newline at end of file\n";
async function mount(page: Page) {
  const fixture = await setup(page, false);
  await page.evaluate(
    async ({ output, patch }) => {
      const load = (path: string) =>
        import(
          performance
            .getEntriesByType("resource")
            .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
            path
        );
      const react = await import(
        (window as any).__sessionFixtureDependency("react.js")
      );
      const dom = await import(
        (window as any).__sessionFixtureDependency("react-dom_client.js")
      );
      const React = react.default ?? react;
      const { ShellCommand } = await load(
        "/src/session-mode/components/codex/items/ShellCommand.tsx",
      );
      const { IndividualFileChanges } = await load(
        "/src/session-mode/components/codex/items/IndividualFileChanges.tsx",
      );
      const { DiffViewer } = await load(
        "/src/session-mode/features/DiffViewer.tsx",
      );
      const { getChangeCounts, getDiffViewerProps } = await load(
        "/src/session-mode/components/codex/items/fileChangeLogic.ts",
      );
      function Harness() {
        const [currentOutput, setOutput] = React.useState(output);
        (window as any).__commandClipboardOutput = setOutput;
        return React.createElement(
          React.Fragment,
          null,
          React.createElement(ShellCommand, {
            command: "copy-fixture",
            commandItemId: "copy-fixture-command",
            threadId: "clipboard-owner",
            turnId: "clipboard-turn",
            status: "completed",
            aggregatedOutput: currentOutput,
          }),
          React.createElement(IndividualFileChanges, {
            changes: [
              {
                path: "source.ts",
                kind: { type: "update", move_path: null },
                diff: patch,
              },
            ],
            fileChangeMap: { add: "创建", update: "编辑", delete: "删除" },
            getChangeCounts,
            getDiffViewerProps,
          }),
          React.createElement(DiffViewer, {
            native: true,
            presentation: "review",
            displayPath: "/clipboard/source.ts",
            unifiedDiff: patch,
            isCollapsed: false,
            className: "clipboard-review-diff",
          }),
        );
      }
      const host = document.createElement("div");
      host.id = "command-clipboard-fixture";
      host.className = "session-mode codex-presentation";
      host.style.cssText =
        "position:fixed;z-index:100;inset:70px 12px 210px;overflow:auto;padding:16px;background:var(--codex-surface)";
      document.querySelector(".session-mode")!.append(host);
      (dom.default ?? dom)
        .createRoot(host)
        .render(
          React.createElement(
            React.StrictMode,
            null,
            React.createElement(Harness),
          ),
        );
    },
    { output, patch },
  );
  const host = page.locator("#command-clipboard-fixture");
  await host.locator(".codex-command-summary").click();
  return { fixture, host };
}

for (const width of [390, 1440]) {
  test.describe(`command clipboard HTTP ${width}`, () => {
    test.use({
      viewport: { width, height: 1000 },
      hasTouch: width === 390,
      isMobile: width === 390,
    });
    test("transfers real copy events for raw command output and a complete patch", async ({
      page,
      baseURL,
    }, info) => {
      test.skip(
        !baseURL?.startsWith("http:"),
        "This regression requires nonsecure LAN HTTP",
      );
      const { fixture, host } = await mount(page);
      try {
        expect(
          await page.evaluate(() => ({
            secure: isSecureContext,
            clipboard: typeof navigator.clipboard,
          })),
        ).toEqual({ secure: false, clipboard: "undefined" });
        await page.evaluate(() => {
          (window as any).__commandCopies = [];
          window.addEventListener("copy", (event) =>
            (window as any).__commandCopies.push({
              text: event.clipboardData?.getData("text/plain"),
              prevented: event.defaultPrevented,
            }),
          );
        });
        const draft = page
          .locator(".session-codex-composer [contenteditable=true]")
          .first();
        await draft.fill("未发送的草稿保持完整");
        const commandOutput = host.locator(".codex-command-output-wrap");
        if (width > 390) await commandOutput.hover();
        await commandOutput
          .getByRole("button", { name: "复制输出", exact: true })
          .click();
        await expect(
          commandOutput.getByRole("button", { name: "已复制", exact: true }),
        ).toBeVisible();
        await expect(commandOutput.locator("button svg")).toHaveAttribute(
          "viewBox",
          "0 0 17 17",
        );
        await host
          .getByRole("button", { name: "展开或收起 source.ts Diff" })
          .click();
        await host.locator(".codex-chat-file-diff-copy").click();
        await expect(
          host.locator(".codex-chat-file-diff-copy"),
        ).toHaveAttribute("title", "Copied!");
        const inlineCopy = host.locator(".codex-inline-diff-copy");
        await inlineCopy.click();
        await expect(inlineCopy).toHaveAttribute("title", "Copied!");
        await host
          .locator(".clipboard-review-diff")
          .getByRole("button", { name: "文件操作" })
          .click();
        await page
          .getByRole("menuitem", { name: "复制路径", exact: true })
          .click();
        expect(
          await page.evaluate(() => (window as any).__commandCopies),
        ).toEqual([
          { text: output, prevented: true },
          { text: patch, prevented: true },
          { text: patch, prevented: true },
          { text: "/clipboard/source.ts", prevented: true },
        ]);
        await expect(draft).toHaveText("未发送的草稿保持完整");
        await page.screenshot({
          path: info.outputPath(`command-and-patch-copy-${width}.png`),
        });
        expect(fixture.calls).toEqual([]);
        expect(fixture.errors).toEqual([]);
      } finally {
        await fixture.close();
      }
    });
  });
}

test("pending command copies keep their captured output and recover after a visible rejection", async ({
  page,
}, info) => {
  const { fixture, host } = await mount(page);
  try {
    await page.evaluate(() => {
      const probe = ((window as any).__commandPending = {
        calls: [] as string[],
        reject: undefined as undefined | (() => void),
      });
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: (text: string) => {
            probe.calls.push(text);
            return probe.calls.length === 1
              ? new Promise<void>((_done, reject) => {
                  probe.reject = () => reject(new Error("denied"));
                })
              : Promise.resolve();
          },
        },
      });
    });
    const outputBlock = host.locator(".codex-command-output-wrap");
    await outputBlock.hover();
    const button = outputBlock.getByRole("button", {
      name: "复制输出",
      exact: true,
    });
    await button.click();
    await expect(button).toHaveAttribute("aria-busy", "true");
    await button.evaluate((node) => (node as HTMLButtonElement).click());
    expect(
      await page.evaluate(() => (window as any).__commandPending.calls),
    ).toEqual([output]);
    await page.evaluate(() => (window as any).__commandPending.reject());
    await expect(
      page.getByText("无法复制到剪贴板", { exact: true }),
    ).toBeVisible();
    await expect(button).not.toHaveAttribute("aria-busy");
    await button.click();
    const copied = outputBlock.getByRole("button", {
      name: "已复制",
      exact: true,
    });
    await expect(copied).toBeVisible();
    await page.waitForTimeout(1500);
    await expect(copied).toBeVisible();
    await page.screenshot({
      path: info.outputPath("command-copy-feedback.png"),
    });
    await expect(button).toBeVisible({ timeout: 1500 });
    expect(
      await page.evaluate(() => (window as any).__commandPending.calls),
    ).toEqual([output, output]);
    expect(fixture.calls).toEqual([]);
    expect(fixture.errors).toEqual([]);
  } finally {
    await fixture.close();
  }
});

test("unmounted command and diff views release payloads while native clipboard writes remain pending", async ({
  page,
  browserName,
}, info) => {
  test.skip(browserName !== "chromium", "Requires actual V8 heap snapshots");
  test.setTimeout(120_000);
  const fixture = await setup(page, false);
  try {
    // Original red: round2 menus/copy-retention-results.json. All three pending
    // views kept their 262KB source alive; uncopied controls were collected.
    const result = await probePendingClipboardRetention(page);
    const evidencePath = info.outputPath("pending-clipboard-v8-payloads.json");
    writeFileSync(evidencePath, JSON.stringify(result, null, 2));
    await info.attach("pending-clipboard-v8-payloads", {
      path: evidencePath,
      contentType: "application/json",
    });
    expect(result.writes).toBe(3);
    for (const key of Object.keys(result.markers)) {
      expect(
        result.mounted.payloads[key],
        `${key} measurement precondition`,
      ).toBeGreaterThan(0);
      expect(result.afterUnmount.payloads[key], `${key} after unmount`).toBe(0);
    }
    expect(fixture.calls).toEqual([]);
    expect(fixture.errors).toEqual([]);
  } finally {
    await fixture.close();
  }
});
