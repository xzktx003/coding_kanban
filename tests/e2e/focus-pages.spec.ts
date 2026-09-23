import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

declare const process: {
  cwd(): string;
  env: Record<string, string | undefined>;
};

const backendBaseUrl = process.env.PLAYWRIGHT_BACKEND_URL ?? "";
const PAGES_STORAGE_KEY = "terminal-monitor-pages-v1";

test.use({ ignoreHTTPSErrors: true });
test.setTimeout(90_000);

function backendPath(p: string): string {
  if (!backendBaseUrl) {
    return p;
  }
  return new URL(p, backendBaseUrl).toString();
}

async function createShellSessionAndFocus(
  page: Page,
  request: APIRequestContext,
  displayName: string,
): Promise<void> {
  const launchResponse = await request.post(
    backendPath("/api/agent-launch/pty"),
    {
      data: {
        workspaceId: "default",
        displayName,
        agentKind: "shell",
        workingDirectory: process.cwd(),
        command: "",
      },
    },
  );
  expect(launchResponse.ok(), await launchResponse.text()).toBeTruthy();

  await page.goto("/");

  const gridCard = page.locator(".grid-card", {
    has: page.locator(".grid-card-name", { hasText: displayName }),
  });
  await expect(gridCard).toBeVisible({ timeout: 15_000 });
  await gridCard.dblclick();
  await expect(page.locator(".focus-main-name")).toContainText(displayName);
}

test("page tabs stay side by side and the active tab opens its settings", async ({
  page,
  request,
}) => {
  const displayName = `focus-pages-${Date.now()}`;

  await page.addInitScript(
    ([key]) => {
      window.localStorage.setItem(
        key,
        JSON.stringify({
          activePageId: "terminal-monitor-page-2",
          pages: [
            ["terminal-monitor-page-1", "默认"],
            ["terminal-monitor-page-2", "页面 1"],
            ["terminal-monitor-page-3", "页面 2"],
          ].map(([id, name]) => ({
            id,
            name,
            state: {
              mode: "single",
              arrangementMode: "manual",
              arrangementGroupId: null,
              groupSessionOrderByGroupId: {},
              slots: [],
              activeSlotId: "slot-1",
              closedSlotIds: [],
            },
          })),
        }),
      );
    },
    [PAGES_STORAGE_KEY] as const,
  );

  await createShellSessionAndFocus(page, request, displayName);

  const pageBar = page.getByTestId("focus-page-bar");
  await expect(pageBar).toBeVisible();

  const tabIds = [
    "terminal-monitor-page-1",
    "terminal-monitor-page-2",
    "terminal-monitor-page-3",
  ];
  const boxes = [];
  for (const tabId of tabIds) {
    const tab = page.getByTestId(`focus-page-tab-${tabId}`);
    await expect(tab).toBeVisible();
    const box = await tab.boundingBox();
    expect(box, `${tabId} has no bounding box`).not.toBeNull();
    boxes.push(box!);
  }

  for (let index = 1; index < boxes.length; index += 1) {
    expect(boxes[index]!.x).toBeGreaterThan(
      boxes[index - 1]!.x + boxes[index - 1]!.width / 2,
    );
  }

  await page.getByTestId("focus-page-tab-terminal-monitor-page-2").click();
  await expect(
    page.getByTestId("focus-page-settings-terminal-monitor-page-2"),
  ).toBeVisible();
  await expect(
    page.getByTestId("focus-page-rename-terminal-monitor-page-2"),
  ).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(
    page.getByTestId("focus-page-settings-terminal-monitor-page-2"),
  ).toHaveCount(0);
});
