import { expect, test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { installSessionUxFixture } from "./session-ux-fixture";

/**
 * End-to-end acceptance for the Claude renderer aligned with the official
 * Claude Code VS Code extension 2.1.311.
 *
 * Seeds a synthetic Claude transcript into the mounted store and asserts the
 * rendered DOM against the behaviors extracted from the official webview.
 * No real Claude task is sent and no user settings are written.
 *
 * Ground truth: docs/designs/claude-render-alignment/
 */

const output = resolve(".dev-runtime/claude-render-alignment-20261027");

const SESSION = "claude-align-e2e";

/** Mirrors the official VS Code host variables so token fallbacks are exercised. */
async function applyTheme(page: Page, dark: boolean) {
  await page.evaluate((dark) => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.documentElement.classList.toggle("dark", dark);
    for (const element of document.querySelectorAll<HTMLElement>(
      ".session-mode",
    )) {
      element.classList.toggle("dark", dark);
      element.classList.toggle("light", !dark);
      element.style.setProperty("color-scheme", dark ? "dark" : "light");
    }
    const tokens: Record<string, string> = {
      "--vscode-editor-background": dark ? "#20211d" : "#ffffff",
      "--vscode-sideBar-background": dark ? "#282a23" : "#f5f5f3",
      "--vscode-foreground": dark ? "#cccccc" : "#3b3b3b",
      "--vscode-descriptionForeground": dark ? "#858585" : "#717171",
      "--vscode-textLink-foreground": dark ? "#a9c5de" : "#006ab1",
      "--vscode-chat-font-size": "13px",
      "--vscode-diffEditor-insertedLineBackground": dark
        ? "#2ea04326"
        : "#e6ffec",
      "--vscode-diffEditor-removedLineBackground": dark
        ? "#f8514926"
        : "#ffebe9",
    };
    for (const [name, value] of Object.entries(tokens))
      document.documentElement.style.setProperty(name, value);
    document.body.style.background =
      tokens["--vscode-editor-background"] ?? "#ffffff";
  }, dark);
}

/**
 * Seeds one assistant message whose content covers the cards this suite
 * asserts. Everything is synthetic: no Agent is started and no task is sent.
 */
async function seedClaudeTranscript(page: Page) {
  await page.evaluate(async (session) => {
    // Resolve the already-mounted module instance so the test writes to the
    // same store the app reads. A Vite HMR update invalidates the cached
    // `?t=` URL, so fall back to the bare path rather than failing the run.
    const mounted = async (path: string) => {
      const cached = performance
        .getEntriesByType("resource")
        .findLast((entry) => new URL(entry.name).pathname === path)?.name;
      if (cached)
        try {
          return await import(cached);
        } catch {
          /* stale after HMR; fall through to the canonical path */
        }
      return import(path);
    };
    const { useAgentSettingsStore } = await mounted(
      "/src/session-mode/stores/useAgentSettingsStore.ts",
    );
    const { useAgentCenterStore } = await mounted(
      "/src/session-mode/stores/useAgentCenterStore.ts",
    );
    const { useCCStore } = await mounted("/src/session-mode/stores/cc/index.ts");

    for (const card of useAgentCenterStore.getState().cards)
      useAgentCenterStore.getState().removeCard(card);
    useAgentCenterStore.setState({
      cards: [],
      currentAgentCardId: null,
      cardsViewMode: "solo",
    });
    useAgentSettingsStore.setState({ selectedAgent: "cc" });

    const toolUse = (id: string, name: string, input: unknown) => ({
      type: "tool_use",
      id,
      name,
      input,
    });

    const messages = [
      {
        type: "assistant",
        uuid: "m-1",
        message: {
          id: "m-1",
          role: "assistant",
          content: [
            { type: "text", text: "Checking the project layout." },
            toolUse("t-read", "Read", {
              file_path: "/project/src/app.ts",
              offset: 9,
              limit: 20,
            }),
            toolUse("t-bash", "Bash", {
              command: "pnpm vitest run",
              description: "Run the unit suite",
            }),
            toolUse("t-grep", "Grep", {
              pattern: "TODO",
              path: "src",
              glob: "*.ts",
            }),
            toolUse("t-edit", "Edit", {
              file_path: "/project/src/app.ts",
              old_string: "const a = 1;\nconst b = 2;",
              new_string: "const a = 1;\nconst b = 3;\nconst c = 4;",
            }),
            toolUse("t-todo", "TodoWrite", {
              todos: [
                { content: "Audit the renderer", status: "completed" },
                { content: "Wire the cards", status: "in_progress" },
                { content: "Run acceptance", status: "pending" },
              ],
            }),
            toolUse("t-skill", "Skill", { skill: "/code-review" }),
            toolUse("t-plan", "ExitPlanMode", { plan: "Do the work" }),
            toolUse("t-mcp", "mcp__github__search_issues", {
              query: "is:open label:bug",
            }),
            toolUse("t-unknown", "SomeFutureTool", { alpha: 1 }),
            // hidden = true: this card must not appear at all.
            toolUse("t-toolsearch", "ToolSearch", { query: "notebook" }),
          ],
        },
      },
      {
        type: "user",
        uuid: "m-2",
        content: [
          {
            type: "tool_result",
            tool_use_id: "t-grep",
            content: "src/a.ts:3: TODO\nsrc/b.ts:9: TODO",
          },
          { type: "tool_result", tool_use_id: "t-edit", content: "ok" },
          {
            type: "tool_result",
            tool_use_id: "t-plan",
            content: "approved",
          },
        ],
      },
    ];

    useCCStore.setState({
      activeSessionId: session,
      messages,
      sessionMessagesMap: { [session]: messages },
      sessionLoadingMap: {},
      isLoading: false,
    });

    // The transcript pane follows the focused workspace card, so the session
    // needs a card whose id matches it before anything renders.
    useAgentCenterStore
      .getState()
      .addAgentCard(
        { kind: "cc", id: session, preview: "Claude 渲染对齐回归" },
        { activate: true },
      );
  }, SESSION);
  // Let the transcript paint before asserting.
  await page.waitForFunction(
    () => !!document.querySelector(".claude-tool-card"),
    undefined,
    { timeout: 15_000 },
  );
}

async function openClaudeSession(page: Page) {
  await installSessionUxFixture(page, 1);
  await page.goto("/?mode=session");
  await page.waitForSelector(".session-mode", { timeout: 30_000 });
  await seedClaudeTranscript(page);
}

test.beforeAll(async () => {
  await mkdir(output, { recursive: true });
});

test("Claude tool cards render with the official structure and text", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await openClaudeSession(page);

  const cards = page.locator(".claude-tool-card");
  await expect(cards.first()).toBeVisible();

  // Read, Grep and Glob fold into collapsed "Explored" groups. The seeded
  // transcript interleaves them with Bash and Edit, so there is more than one
  // group; each has to be opened before its rows can be asserted.
  const explored = page.getByRole("button", { name: /Explored/ });
  const exploredCount = await explored.count();
  expect(exploredCount).toBeGreaterThan(0);
  for (let i = 0; i < exploredCount; i++) await explored.nth(i).click();

  // Read: header-only, with its line range, and no body chrome.
  const read = cards.filter({ hasText: "(lines 10-29)" }).first();
  await expect(read).toContainText("app.ts");
  expect(await read.locator(".claude-tool-body").count()).toBe(0);

  // Bash: name plus the plaintext description style, and the command as IN.
  const bash = cards.filter({ hasText: "Run the unit suite" }).first();
  await expect(
    bash.locator(".claude-tool-name-text-secondary-plaintext"),
  ).toHaveText("Run the unit suite");
  await expect(bash).toContainText("pnpm vitest run");

  // Grep: qualifiers in the header, counted summary in the body.
  const grep = cards.filter({ hasText: "TODO" }).first();
  await expect(grep.locator(".claude-tool-name-text-secondary")).toHaveText(
    '"TODO" (in src, glob: *.ts)',
  );
  await expect(grep.locator(".claude-secondary-line")).toHaveText(
    "2 lines of output",
  );

  // Edit: the line-delta summary.
  await expect(
    cards.filter({ hasText: "Added 3 lines, removed 2 lines" }).first(),
  ).toBeVisible();

  // Skill: trailing " skill" label.
  const skill = cards.filter({ hasText: "code-review" }).first();
  await expect(skill.locator(".claude-tool-name-text-secondary")).toHaveText(
    " skill",
  );

  // Plan mode: the official curly apostrophe, and the approved status.
  const plan = cards.filter({ hasText: "Plan" }).first();
  await expect(plan).toContainText("Claude’s Plan");
  await expect(
    cards.filter({ hasText: "User approved the plan" }).first(),
  ).toBeVisible();

  // MCP: humanized server name.
  await expect(
    cards.filter({ hasText: "GitHub [search_issues]" }).first(),
  ).toBeVisible();

  // Unknown tool: the raw name is kept verbatim.
  await expect(
    cards.filter({ hasText: "SomeFutureTool" }).first(),
  ).toBeVisible();

  // ToolSearch is hidden entirely.
  await expect(page.locator("text=Search tools")).toHaveCount(0);

  await page.screenshot({
    path: resolve(output, "tool-cards-light.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("TodoWrite renders disabled checkboxes with an indeterminate state", async ({
  page,
}) => {
  await openClaudeSession(page);
  const todos = page.locator(".claude-todo-item");
  await expect(todos).toHaveCount(3);

  const states = await page
    .locator('.claude-todo-item input[type="checkbox"]')
    .evaluateAll((nodes) =>
      (nodes as HTMLInputElement[]).map((node) => ({
        checked: node.checked,
        indeterminate: node.indeterminate,
        disabled: node.disabled,
      })),
    );
  expect(states).toEqual([
    { checked: true, indeterminate: false, disabled: true },
    { checked: false, indeterminate: true, disabled: true },
    { checked: false, indeterminate: false, disabled: true },
  ]);
});

test("big tool content is keyboard-activatable, small content is inert", async ({
  page,
}) => {
  await openClaudeSession(page);
  await page.evaluate(async (session) => {
    // Resolve the already-mounted module instance so the test writes to the
    // same store the app reads. A Vite HMR update invalidates the cached
    // `?t=` URL, so fall back to the bare path rather than failing the run.
    const mounted = async (path: string) => {
      const cached = performance
        .getEntriesByType("resource")
        .findLast((entry) => new URL(entry.name).pathname === path)?.name;
      if (cached)
        try {
          return await import(cached);
        } catch {
          /* stale after HMR; fall through to the canonical path */
        }
      return import(path);
    };
    const { useCCStore } = await mounted("/src/session-mode/stores/cc/index.ts");
    const messages = [
      {
        type: "assistant",
        uuid: "big-1",
        message: {
          id: "big-1",
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "t-small",
              name: "SmallDump",
              input: { a: 1 },
            },
            {
              type: "tool_use",
              id: "t-big",
              name: "BigDump",
              input: { blob: "x".repeat(400) },
            },
          ],
        },
      },
    ];
    useCCStore.setState({
      activeSessionId: session,
      messages,
      sessionMessagesMap: { [session]: messages },
      isLoading: false,
    });
  }, SESSION);

  // Waiting for ".claude-tool-card" alone would pass on the cards the first
  // seed already painted, letting the assertions race a stale DOM. Wait for
  // this seed's own content instead.
  const small = page.locator(".claude-tool-card", { hasText: "SmallDump" });
  const big = page.locator(".claude-tool-card", { hasText: "BigDump" });
  await expect(small).toBeVisible();
  await expect(big).toBeVisible();

  // Under the 250-char / 3-line threshold the region must not be focusable.
  await expect(
    small.locator(".claude-tool-body-row-content").first(),
  ).not.toHaveAttribute("tabindex", "0");

  // Over it, the region is focusable and carries the official aria hint.
  const bigRegion = big.locator(".claude-tool-body-row-content").first();
  await expect(bigRegion).toHaveAttribute("tabindex", "0");
  await expect(bigRegion).toHaveAttribute(
    "aria-description",
    "Press Enter to open the full text in an editor tab",
  );
});

test("Claude tokens resolve in both themes and stay off the Codex namespace", async ({
  page,
}) => {
  await openClaudeSession(page);

  for (const dark of [false, true]) {
    await applyTheme(page, dark);
    const resolved = await page.evaluate(() => {
      const node = document.querySelector(".claude-presentation");
      if (!node) return null;
      const style = getComputedStyle(node);
      const read = (name: string) => style.getPropertyValue(name).trim();
      return {
        surface: read("--claude-surface"),
        text: read("--claude-text"),
        chatSize: read("--claude-chat-size"),
        insertedLine: read("--claude-diff-inserted-line"),
        insertedText: read("--claude-diff-inserted-text"),
        insertedGutter: read("--claude-diff-inserted-gutter"),
        ansiRed: read("--claude-ansi-red"),
        // A Claude container must not define Codex tokens.
        codexText: read("--codex-text"),
      };
    });

    expect(resolved, `theme dark=${dark}`).not.toBeNull();
    // Every asserted token must actually resolve to a value.
    expect(resolved!.surface, `surface dark=${dark}`).not.toBe("");
    expect(resolved!.text, `text dark=${dark}`).not.toBe("");
    expect(resolved!.ansiRed, `ansi dark=${dark}`).not.toBe("");
    // The chat size fallback is pinned so transcript spacing cannot drift.
    expect(resolved!.chatSize, `chat size dark=${dark}`).toBe("13px");
    // Diff keeps line, text and gutter as three distinct values.
    expect(resolved!.insertedLine).not.toBe("");
    expect(resolved!.insertedText).not.toBe("");
    expect(resolved!.insertedGutter).not.toBe("");
    expect(resolved!.insertedLine).not.toBe(resolved!.insertedText);
    // Codex tokens are not inherited into the Claude container.
    expect(resolved!.codexText, `codex leak dark=${dark}`).toBe("");

    await page.screenshot({
      path: resolve(output, `tokens-${dark ? "dark" : "light"}.png`),
      fullPage: true,
    });
  }
});

test("the transcript holds up at phone width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openClaudeSession(page);

  const overflow = await page.evaluate(
    () =>
      document.scrollingElement!.scrollWidth -
      document.scrollingElement!.clientWidth,
  );
  // No horizontal page scroll at phone width.
  expect(overflow).toBeLessThanOrEqual(1);

  await expect(page.locator(".claude-tool-card").first()).toBeVisible();
  await page.screenshot({
    path: resolve(output, "phone-390.png"),
    fullPage: true,
  });
});

test.afterAll(async () => {
  await writeFile(
    resolve(output, "README.md"),
    [
      "# Claude render alignment acceptance",
      "",
      "Synthetic Claude transcripts seeded into the mounted store.",
      "No Agent was started, no task was sent, no user settings were written.",
      "",
      "Ground truth: docs/designs/claude-render-alignment/",
      "",
    ].join("\n"),
    "utf8",
  );
});
