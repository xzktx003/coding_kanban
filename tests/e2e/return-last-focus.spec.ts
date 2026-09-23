import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

declare const process: {
  cwd(): string;
  env: Record<string, string | undefined>;
};

const backendBaseUrl = process.env.PLAYWRIGHT_BACKEND_URL ?? "";
const FOCUS_VIEW_KEY = "focus-view-state";

test.use({ ignoreHTTPSErrors: true });
test.setTimeout(90_000);

function backendPath(p: string): string {
  if (!backendBaseUrl) {
    return p;
  }
  return new URL(p, backendBaseUrl).toString();
}

test("returning to the grid keeps 返回上次 across a reload", async ({
  page,
  request,
}) => {
  const displayName = `return-focus-${Date.now()}`;
  const launch = await request.post(backendPath("/api/agent-launch/pty"), {
    data: {
      workspaceId: "default",
      displayName,
      agentKind: "shell",
      workingDirectory: process.cwd(),
      command: "",
    },
  });
  expect(launch.ok(), await launch.text()).toBeTruthy();

  await page.goto("/");
  const card = page.locator(".grid-card", {
    has: page.locator(".grid-card-name", { hasText: displayName }),
  });
  await expect(card).toBeVisible({ timeout: 15_000 });
  await card.dblclick();
  await expect(page.locator(".focus-main-name")).toContainText(displayName);

  await page.getByRole("button", { name: "返回宫格" }).click();
  await expect(page.getByTestId("return-last-focus")).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("return-last-focus")).toBeVisible();
  const stored = await page.evaluate(
    (key) => window.localStorage.getItem(key),
    FOCUS_VIEW_KEY,
  );
  expect(stored).toContain('"viewMode":"grid"');
  expect(stored).toContain('"focusedId":');

  await page.getByTestId("return-last-focus").click();
  await expect(page.locator(".focus-main-name")).toContainText(displayName);
});
