import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

declare const process: {
  cwd(): string;
  env: Record<string, string | undefined>;
};

const backendBaseUrl = process.env.PLAYWRIGHT_BACKEND_URL ?? "";
const SESSION_GROUPS_KEY = "coding-kanban-session-groups-v1";
const DRAG_MIME = "application/x-coding-kanban-terminal-session";

test.use({ ignoreHTTPSErrors: true });
test.setTimeout(120_000);

function backendPath(p: string): string {
  if (!backendBaseUrl) {
    return p;
  }
  return new URL(p, backendBaseUrl).toString();
}

async function launchShell(
  request: APIRequestContext,
  displayName: string,
): Promise<string> {
  const response = await request.post(backendPath("/api/agent-launch/pty"), {
    data: {
      workspaceId: "default",
      displayName,
      agentKind: "shell",
      workingDirectory: process.cwd(),
      command: "",
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return ((await response.json()) as { id: string }).id;
}

test("group arrangement reorders by dragging titles and renames the page", async ({
  page,
  request,
}) => {
  const stamp = Date.now();
  const groupName = `拖拽组${stamp}`;
  const firstName = `group-drag-a-${stamp}`;
  const secondName = `group-drag-b-${stamp}`;
  const firstId = await launchShell(request, firstName);
  const secondId = await launchShell(request, secondName);

  await page.addInitScript(
    ([key, group, first, second]) => {
      window.localStorage.setItem(
        key,
        JSON.stringify({
          groups: [{ id: "group-drag", name: group }],
          assignments: {
            [`session:${first}`]: "group-drag",
            [`session:${second}`]: "group-drag",
          },
          collapsedGroupIds: [],
        }),
      );
    },
    [SESSION_GROUPS_KEY, groupName, firstId, secondId] as const,
  );

  await page.goto("/");
  const card = page.locator(".grid-card", {
    has: page.locator(".grid-card-name", { hasText: firstName }),
  });
  await expect(card).toBeVisible({ timeout: 15_000 });
  await card.dblclick();
  await expect(page.locator(".focus-main-name")).toContainText(firstName);

  const pageTab = page.getByTestId("focus-page-tab-terminal-monitor-page-1");
  await pageTab.click();
  const arrangement = page.getByTestId("focus-page-arrangement-group-drag");
  await expect(arrangement).toBeVisible();
  await arrangement.dispatchEvent("mousedown");
  await arrangement.click();

  await expect(pageTab).toHaveText(groupName);
  await expect(page.locator("[data-terminal-arrangement]")).toHaveAttribute(
    "data-terminal-arrangement",
    "group",
  );

  const orderBefore = await page
    .locator(".focus-terminal-pane:visible")
    .evaluateAll((panes) =>
      panes.map((pane) => pane.getAttribute("data-terminal-pane-session")),
    );
  expect(orderBefore).toEqual([firstId, secondId]);

  await page.evaluate(
    ({ sourceSessionId, targetSessionId, mime }) => {
      const source = document.querySelector(
        `[data-terminal-pane-session="${sourceSessionId}"] .focus-terminal-pane-header`,
      );
      const target = document.querySelector(
        `[data-terminal-pane-session="${targetSessionId}"]`,
      );
      if (!source || !target) {
        throw new Error("pane missing");
      }

      const dataTransfer = new DataTransfer();
      dataTransfer.effectAllowed = "move";

      source.dispatchEvent(
        new DragEvent("dragstart", { bubbles: true, dataTransfer }),
      );
      target.dispatchEvent(
        new DragEvent("dragover", { bubbles: true, dataTransfer }),
      );
      target.dispatchEvent(
        new DragEvent("drop", { bubbles: true, dataTransfer }),
      );
    },
    { sourceSessionId: firstId, targetSessionId: secondId, mime: DRAG_MIME },
  );

  await expect
    .poll(() =>
      page.locator(".focus-terminal-pane:visible").evaluateAll((panes) =>
        panes.map((pane) => pane.getAttribute("data-terminal-pane-session")),
      ),
    )
    .toEqual([secondId, firstId]);
  await expect(
    page.locator('[data-active-terminal-pane="true"]'),
  ).toHaveAttribute("data-terminal-pane-session", firstId);
});
