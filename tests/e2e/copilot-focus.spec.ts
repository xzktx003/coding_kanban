import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";
import path from "node:path";

declare const process: {
  cwd(): string;
  env: Record<string, string | undefined>;
};

const backendBaseUrl = process.env.PLAYWRIGHT_BACKEND_URL ?? "";

test.use({ ignoreHTTPSErrors: true });
test.setTimeout(90_000);

function backendPath(p: string): string {
  if (!backendBaseUrl) {
    return p;
  }
  return new URL(p, backendBaseUrl).toString();
}

async function findSessionByDisplayName(
  request: APIRequestContext,
  displayName: string,
) {
  const response = await request.get(backendPath("/api/agent-sessions"));
  expect(response.ok()).toBeTruthy();

  const payload = await response.json();
  return payload.items.find(
    (item: { id: string; displayName: string }) =>
      item.displayName === displayName,
  ) as { id: string; displayName: string } | undefined;
}

async function readSessionOutput(
  request: APIRequestContext,
  sessionId: string,
): Promise<string> {
  const response = await request.get(
    backendPath(`/api/agent-sessions/${sessionId}`),
  );
  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  return (payload.outputEntries as Array<{ text: string }>)
    .map((entry) => entry.text)
    .join("\n");
}

async function waitForOutput(
  request: APIRequestContext,
  sessionId: string,
  marker: string,
  timeout = 20000,
) {
  await expect
    .poll(() => readSessionOutput(request, sessionId), { timeout })
    .toContain(marker);
}

async function createShellSessionAndFocus(
  page: Page,
  request: APIRequestContext,
  displayName: string,
): Promise<string> {
  const launchResponse = await request.post(backendPath("/api/agent-launch/pty"), {
    data: {
      workspaceId: "default",
      displayName,
      agentKind: "shell",
      workingDirectory: process.cwd(),
      command: "",
    },
  });
  expect(launchResponse.ok()).toBeTruthy();
  const launchedSession = (await launchResponse.json()) as { id: string };

  await page.goto("/");

  const gridCard = page.locator(".grid-card", {
    has: page.locator(".grid-card-name", { hasText: displayName }),
  });
  await expect(gridCard).toBeVisible({ timeout: 15000 });

  await expect
    .poll(() => findSessionByDisplayName(request, displayName), {
      timeout: 15000,
    })
    .toBeTruthy();
  const sessionId = launchedSession.id;

  await gridCard.dblclick();
  await expect(page.locator(".focus-main-name")).toContainText(displayName);

  const terminal = page.locator(".focus-main .terminal-view-live");
  await expect(terminal).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(() =>
      terminal.evaluate(
        (element) =>
          (
            element as HTMLDivElement & {
              __xterm?: { options?: { disableStdin?: boolean } };
            }
          ).__xterm?.options?.disableStdin ?? true,
      ),
    )
    .toBe(false);

  return sessionId;
}

async function createCodexMockCopilotSessionAndFocus(
  page: Page,
  request: APIRequestContext,
  displayName: string,
): Promise<string> {
  const mockPath = path.join(process.cwd(), "scripts/mock-copilot-cli.mjs");
  const launchResponse = await request.post(backendPath("/api/agent-launch/pty"), {
    data: {
      workspaceId: "default",
      displayName,
      agentKind: "codex",
      workingDirectory: process.cwd(),
      command: `node ${JSON.stringify(mockPath)}`,
    },
  });
  expect(launchResponse.ok()).toBeTruthy();
  const launchedSession = (await launchResponse.json()) as { id: string };

  await page.goto("/");

  const gridCard = page.locator(".grid-card", {
    has: page.locator(".grid-card-name", { hasText: displayName }),
  });
  await expect(gridCard).toBeVisible({ timeout: 15000 });

  await gridCard.dblclick();
  await expect(page.locator(".focus-main-name")).toContainText(displayName);
  await waitForOutput(request, launchedSession.id, "copilot-mock-ready");

  return launchedSession.id;
}

async function dragRangeToValue(
  page: Page,
  slider: Locator,
  value: number,
): Promise<void> {
  const box = await slider.boundingBox();
  if (!box) {
    throw new Error("Range input is not visible");
  }

  const min = Number(await slider.getAttribute("min"));
  const max = Number(await slider.getAttribute("max"));
  const current = Number(await slider.inputValue());
  const valueToX = (nextValue: number) =>
    box.x + (box.width * (nextValue - min)) / (max - min);
  const y = box.y + box.height / 2;

  await page.mouse.move(valueToX(current), y);
  await page.mouse.down();
  await page.mouse.move(valueToX(value), y, { steps: 8 });
  await page.mouse.up();
}

async function startMockCopilotInSession(
  request: APIRequestContext,
  sessionId: string,
) {
  const mockPath = path.join(process.cwd(), "scripts/mock-copilot-cli.mjs");

  await expect
    .poll(() => readSessionOutput(request, sessionId), { timeout: 20000 })
    .toMatch(/(?:[$%#]\s*|\u001b\[\?2004h|➜)/);

  const response = await request.post(
    backendPath(`/api/agent-sessions/${sessionId}/stdin`),
    {
      data: {
        input: `node ${mockPath}\r`,
      },
    },
  );
  expect(response.ok()).toBeTruthy();

  await waitForOutput(request, sessionId, "copilot-mock-ready");
}

test("kanban terminal lets the user type into a Copilot-like TUI immediately after launching it from the terminal", async ({
  page,
  request,
}) => {
  const displayName = `E2E Copilot Startup ${Date.now()}`;
  let sessionId: string | undefined;

  try {
    sessionId = await createShellSessionAndFocus(page, request, displayName);
    await startMockCopilotInSession(request, sessionId);

    await page.keyboard.type("hello");
    await page.keyboard.press("Enter");
    await waitForOutput(request, sessionId, "copilot-mock-line:hello");
  } finally {
    if (sessionId) {
      await request.delete(backendPath(`/api/agent-sessions/${sessionId}`));
    }
  }
});

test("kanban terminal keeps Codex-like TUI input working after dragging the font-size slider", async ({
  page,
  request,
}) => {
  const displayName = `E2E Codex Font Slider ${Date.now()}`;
  let sessionId: string | undefined;

  try {
    sessionId = await createCodexMockCopilotSessionAndFocus(
      page,
      request,
      displayName,
    );

    await page.keyboard.type("before");
    await page.keyboard.press("Enter");
    await waitForOutput(request, sessionId, "copilot-mock-line:before");

    const slider = page.getByTestId("terminal-font-size-slider");
    await expect(slider).toBeVisible();
    await dragRangeToValue(page, slider, 21);

    // No extra terminal click: releasing the range input must restore the
    // active terminal so normal typing still reaches Codex-like TUIs.
    await page.keyboard.type("after");
    await page.keyboard.press("Enter");
    await waitForOutput(request, sessionId, "copilot-mock-line:after");
  } finally {
    if (sessionId) {
      await request.delete(backendPath(`/api/agent-sessions/${sessionId}`));
    }
  }
});

test("kanban terminal keeps Copilot-like TUI input working after the user clicks outside the terminal", async ({
  page,
  request,
}) => {
  const displayName = `E2E Copilot Blur ${Date.now()}`;
  let sessionId: string | undefined;

  try {
    sessionId = await createShellSessionAndFocus(page, request, displayName);
    await startMockCopilotInSession(request, sessionId);

    await page.keyboard.type("first");
    await page.keyboard.press("Enter");
    await waitForOutput(request, sessionId, "copilot-mock-line:first");

    // Click on the terminal container but outside the xterm screen (e.g. on
    // the session name header) to blur the helper textarea. The terminal must
    // reclaim focus automatically so the next keystroke still reaches the
    // Copilot-like TUI.
    await page.locator(".focus-main-name").click();

    await page.keyboard.type("second");
    await page.keyboard.press("Enter");
    await waitForOutput(request, sessionId, "copilot-mock-line:second");
  } finally {
    if (sessionId) {
      await request.delete(backendPath(`/api/agent-sessions/${sessionId}`));
    }
  }
});

test("kanban terminal keeps Copilot-like TUI input working after the user briefly clicks a Kanban UI button", async ({
  page,
  request,
}) => {
  const displayName = `E2E Copilot Button ${Date.now()}`;
  let sessionId: string | undefined;

  try {
    sessionId = await createShellSessionAndFocus(page, request, displayName);
    await startMockCopilotInSession(request, sessionId);

    await page.keyboard.type("before");
    await page.keyboard.press("Enter");
    await waitForOutput(request, sessionId, "copilot-mock-line:before");

    const toggle = page.locator(".focus-header-collapse-btn");
    await expect(toggle).toBeVisible();
    await toggle.click();

    // The terminal must reclaim focus on its own after the button click,
    // otherwise Copilot-like TUIs will drop input because they still see
    // focus-out. No extra clicks or delays — just start typing.
    await page.keyboard.type("after");
    await page.keyboard.press("Enter");
    await waitForOutput(request, sessionId, "copilot-mock-line:after");
  } finally {
    if (sessionId) {
      await request.delete(backendPath(`/api/agent-sessions/${sessionId}`));
    }
  }
});
