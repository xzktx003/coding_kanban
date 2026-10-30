import { expect, test, type Page } from "@playwright/test";
import { installSessionUxFixture } from "./session-ux-fixture";
import { liveStream } from "./session-sse-fixture";

const streams = new WeakMap<Page, Awaited<ReturnType<typeof liveStream>>>();
test.afterEach(async ({ page }) => {
  await streams.get(page)?.close();
});

async function mountCommands(page: Page, caller: "native" | "legacy") {
  await installSessionUxFixture(page, 1);
  streams.set(
    page,
    await liveStream(page, test.info().project.use.baseURL as string),
  );
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  await page
    .locator(".session-codex-composer [contenteditable=true]")
    .first()
    .waitFor();
  await page.evaluate(async (caller) => {
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
    const React = react.default ?? react,
      { createRoot } = dom.default ?? dom;
    const { NativeActivityGroup } = await load(
      "/src/session-mode/components/codex/items/NativeActivityGroup.tsx",
    );
    const { CommandActionSummaryItem } = await load(
      "/src/session-mode/components/codex/items/CommandActionSummaryItem.tsx",
    );
    const { buildThreadRows } = await load(
      "/src/session-mode/components/codex/thread/threadRows.ts",
    );
    const { groupThreadActivities } = await load(
      "/src/session-mode/components/codex/thread/activityRows.ts",
    );
    const { TranscriptDetailVisibility } = await load(
      "/src/session-mode/components/codex/hooks/transcriptDetailVisibility.ts",
    );
    const { RowStateContext } = await load(
      "/src/session-mode/components/codex/thread/rowState.ts",
    );
    const actions = [
      {
        type: "read",
        command: "cat a.ts",
        name: "a.ts",
        path: "/fixture/a.ts",
      },
      {
        type: "search",
        command: "rg target",
        query: "target",
        path: "/fixture",
      },
      { type: "listFiles", command: "ls /fixture", path: "/fixture" },
      { type: "unknown", command: "echo fixture" },
    ];
    const sources = actions.map((_action, i) => ({
      threadId: "detail-thread",
      turnId: "detail-turn",
      commandItemId: `detail-${i}`,
      cwd: "/fixture",
      status: "completed",
      aggregatedOutput: null,
      exitCode: 0,
      durationMs: 1,
      transcriptMetadataOnly: true,
    }));
    const events = actions.map((action, i) => ({
      method: "item/completed",
      params: {
        threadId: "detail-thread",
        turnId: "detail-turn",
        item: {
          type: "commandExecution",
          id: `detail-${i}`,
          command: action.command,
          commandActions: [action],
          cwd: "/fixture",
          status: "completed",
          aggregatedOutput: null,
          exitCode: 0,
          durationMs: 1,
          transcriptMetadataOnly: true,
        },
      },
    }));
    events.push({
      method: "turn/completed",
      params: {
        threadId: "detail-thread",
        turn: {
          id: "detail-turn",
          status: "completed",
          items: [],
          error: null,
        },
      },
    } as any);
    const group = groupThreadActivities(buildThreadRows(events), events).find(
      (row: any) => row.activity,
    ).activity;
    const cache = new Map();
    function Harness() {
      const [visible, setVisible] = React.useState(true);
      (window as any).__commandDetailsVisible = setVisible;
      return React.createElement(
        TranscriptDetailVisibility.Provider,
        { value: visible },
        React.createElement(
          RowStateContext.Provider,
          { value: cache },
          caller === "native"
            ? React.createElement(NativeActivityGroup, { group })
            : React.createElement(CommandActionSummaryItem, {
                actions,
                actionSources: sources,
                completed: true,
              }),
        ),
      );
    }
    const host = document.createElement("div");
    host.id = "command-detail-fixture";
    host.className = "session-mode codex-presentation";
    host.style.cssText =
      "position:fixed;z-index:100;inset:80px 12px 12px;overflow:auto;padding:16px;background:var(--codex-surface,#20211d)";
    document.querySelector(".session-mode")!.append(host);
    const root = createRoot(host);
    (window as any).__commandDetailsUnmount = () => {
      root.unmount();
      host.remove();
    };
    root.render(
      React.createElement(React.StrictMode, null, React.createElement(Harness)),
    );
  }, caller);
  await page
    .locator(
      caller === "native"
        ? "#command-detail-fixture .codex-native-activity-disclosure"
        : "#command-detail-fixture .codex-activity-header",
    )
    .click();
}

for (const caller of ["native", "legacy"] as const) {
  test(`${caller} command callers load read/search/list/shell only on explicit activation`, async ({
    page,
  }, info) => {
    const errors: string[] = [],
      requests: any[] = [];
    const largeOutput = `OUTPUT_detail-0\n${"large tool body line\n".repeat(1800)}`;
    page.on("pageerror", (error) => errors.push(error.message));
    await mountCommands(page, caller);
    await page.route("**/api/**/thread/item-detail", async (route) => {
      const body = route.request().postDataJSON();
      requests.push(body);
      await route.fulfill({
        json: {
          ...body,
          item: {
            type: "commandExecution",
            id: body.itemId,
            command: "full native command",
            cwd: "/fixture",
            status: "completed",
            aggregatedOutput:
              body.itemId === "detail-0"
                ? `\u001b[31m${largeOutput}\u001b[0m`
                : `\u001b[31mOUTPUT_${body.itemId}\u001b[0m`,
            exitCode: 0,
            durationMs: 2,
          },
        },
      });
    });
    const fixture = page.locator("#command-detail-fixture");
    await expect(
      fixture.locator("[data-transcript-details-unloaded]"),
    ).toHaveCount(0);
    expect(requests).toEqual([]);
    await fixture.getByRole("link", { name: "a.ts" }).focus();
    await page.keyboard.press("Tab");
    const outputButton = fixture
      .getByRole("button", { name: "查看命令输出" })
      .first();
    await expect(outputButton).toBeFocused();
    await expect(outputButton).toHaveCSS("outline-style", "solid");
    await expect(outputButton).toHaveCSS("outline-width", "2px");
    for (let i = 0; i < 4; i++) {
      const row = fixture.locator(`[data-command-id="detail-${i}"]`);
      const toggle = row.locator(
        i < 3 ? ".codex-exploration-output" : ".codex-command-summary",
      );
      await toggle.click();
      await expect(row.locator(".codex-command-output-content")).toContainText(
        `OUTPUT_detail-${i}`,
      );
      if (i === 0)
        await expect
          .poll(() =>
            row.locator(".codex-command-output-content").evaluate(
              (el) => el.textContent?.length ?? 0,
            ),
          )
          .toBeGreaterThan(30_000);
      expect(requests.at(-1)).toEqual({
        threadId: "detail-thread",
        turnId: "detail-turn",
        itemId: `detail-${i}`,
        expectedType: "commandExecution",
      });
      expect(requests.length).toBe(i + 1);
      await expect(row.locator(".ansi-red-fg")).toHaveCSS(
        "color",
        "rgb(255, 102, 102)",
      );
      if (i === 0)
        await expect(row.getByRole("link", { name: "a.ts" })).toBeVisible();
      await toggle.click();
      await expect(row.locator(".codex-command-output-content")).toHaveCount(0);
    }
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await fixture.screenshot({
        path: info.outputPath(`commands-${width}.png`),
      });
    }
    expect(errors).toEqual([]);
    await page.evaluate(() => (window as any).__commandDetailsUnmount());
  });
}

test("released selected output stays unloaded on return and busy failures need manual retry", async ({
  page,
}) => {
  await mountCommands(page, "native");
  let requests = 0;
  await page.route("**/api/**/thread/item-detail", async (route) => {
    requests++;
    if (requests === 1)
      return route.fulfill({ status: 429, json: { error: "DETAIL_BUSY" } });
    const body = route.request().postDataJSON();
    await route.fulfill({
      json: {
        ...body,
        item: {
          type: "commandExecution",
          id: body.itemId,
          command: "fixture",
          cwd: "/fixture",
          status: "completed",
          aggregatedOutput: "RELEASE_THIS_OUTPUT",
          exitCode: 0,
          durationMs: 1,
        },
      },
    });
  });
  const row = page.locator(
    '#command-detail-fixture [data-command-id="detail-0"]',
  );
  await row.getByRole("button", { name: "查看命令输出" }).click();
  await expect(row).toContainText("其他详情正在读取");
  expect(requests).toBe(1);
  await row.locator("[data-command-detail-load]").click();
  await expect(row).toContainText("RELEASE_THIS_OUTPUT");
  await page.evaluate(() => (window as any).__commandDetailsVisible(false));
  await expect(row).not.toContainText("RELEASE_THIS_OUTPUT");
  await page.evaluate(() => (window as any).__commandDetailsVisible(true));
  await expect(row).toContainText("详情未载入");
  expect(requests).toBe(2);
  await row.locator("[data-command-detail-load]").click();
  await expect(row).toContainText("RELEASE_THIS_OUTPUT");
  expect(requests).toBe(3);
  await page.evaluate(() => (window as any).__commandDetailsUnmount());
});

test("touch exploration output has a 44 pixel target", async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: test.info().project.use.baseURL as string,
    ignoreHTTPSErrors: true,
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  try {
    await mountCommands(page, "native");
    const button = page
      .locator("#command-detail-fixture .codex-exploration-output")
      .first();
    const bounds = await button.boundingBox();
    expect(bounds?.width).toBeGreaterThanOrEqual(44);
    expect(bounds?.height).toBeGreaterThanOrEqual(44);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  } finally {
    await streams.get(page)?.close();
    await context.close();
  }
});
