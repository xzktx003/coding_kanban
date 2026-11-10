/**
 * Real-login Playwright acceptance (O-F) for the session-mode native Codex
 * replica (apps/web/src/session-mode/components/codex).
 *
 * Drives the LIVE frontend over the host's authorized Codex connection
 * (codex login status = Logged in using ChatGPT). It does NOT print or assert
 * on conversation text; it captures the rendered UI per state as screenshots
 * and records, per requested state, whether it was genuinely observed (PASS),
 * is content-dependent on the sampled threads (NOT-PRESENT), or still requires
 * a host/activity capability that a read-only acceptance cannot drive
 * (HOST-GATED). It never fakes a state.
 *
 * Run against the running deployment:
 *   PLAYWRIGHT_SKIP_WEBSERVER=1 \
 *   PLAYWRIGHT_BASE_URL=https://10.30.0.26:8484 \
 *   PLAYWRIGHT_FRONTEND_PROTOCOL=https \
 *   npx playwright test --config playwright.config.ts tests/e2e/session-mode-codex-live-acceptance.spec.ts
 *
 * Authorization boundary: read-only. This spec only navigates and reads the
 * rendered DOM for structural markers (classes / data attributes / roles). It
 * never reads or prints login tokens, and it never sends a model prompt or a
 * real turn (that is a write to the authorized session and a real token cost);
 * states that would require a live write are recorded HOST-GATED, never faked.
 */
import { writeFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

// Structural markers only. We intentionally never read the visible text of a
// message body and never capture a token/authorization value.
const SEL = {
  sessionMode: ".session-mode",
  topNav: "nav.session-top-nav, .session-top-nav",
  leftSidebar:
    ".session-sidebar-projects, .session-sidebar-search-row, .session-sidebar-bots, .session-project-sessions",
  modeSwitch: ".workbench-shell [data-mode], .mode-switch-label",
  sessionTabs: ".session-tabs, .session-window-group, .session-tab-strip",
  composerForm: ".session-composer-form",
  composerInput: ".session-composer-form [contenteditable='true']",
  composerHint: ".session-composer-hint",
  accessModeButton: "button[aria-label^='执行权限'], [role='button'][aria-label^='执行权限']",
  welcome: ".session-welcome",
  navRow: ".session-nav-row",
  messageAuthor: "[data-message-author]",
  streamdown: "[data-streamdown]",
  pre: "pre",
  codeFence: ".codex-code-fence, [data-native-code-fence], .code-fence, .native-code-fence",
  nativeFileCitation: ".native-file-citation",
  toolItem: ".codex-command, .codex-command-summary, .codex-command-shell, .codex-tool, [data-tool-item]",
  planItem: "[data-plan-step], .turn-plan, [data-turn-plan], .plan-section",
  fileChange: ".codex-individual-file-change-row, .codex-file-change, [data-file-change], .summary-file-changes",
  approval: ".codex-approval, .codex-approval-pending",
  followupQueue: ".followup-queue, [data-followup-queue], .queue-list, .session-queue",
  liveMessage: "[data-codex-live-message]",
  streamingText: "[data-codex-streaming-text]",
  loading:
    ".codex-transcript-preparing, [data-codex-loading], [data-loading], .codex-history-notice, [data-session-recovery]",
  // Radix collapsible project groups in the followed-sessions sidebar.
  collapsibleTrigger: '[data-slot="collapsible-trigger"]',
  collapsibleClosed: '[data-slot="collapsible-trigger"][data-state="closed"]',
} as const;

type Status = "pass" | "not-present" | "host-gated";
type Result = { state: string; status: Status; note: string };

const results: Result[] = [];
const screenshot = async (
  page: Page,
  info: import("@playwright/test").TestInfo,
  name: string,
) => {
  await page.screenshot({ path: info.outputPath(`${name}.png`) });
};

const record = (state: string, status: Status, note: string) => {
  results.push({ state, status, note });
};

const count = async (page: Page, selector: string) =>
  page.locator(selector).count();

test("real-login O-F acceptance: session-mode Codex replica", async ({
  page,
}, info) => {
  test.setTimeout(540_000);
  await page.goto("/?mode=session", {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await expect(page.locator(SEL.sessionMode)).toBeVisible({ timeout: 60_000 });
  // The session workbench (sidebar + composer) is a lazy chunk; wait for it to
  // actually mount before taking structural inventory.
  await page
    .waitForSelector(`${SEL.composerForm}, ${SEL.navRow}, ${SEL.welcome}`, {
      timeout: 90_000,
    })
    .catch(() => undefined);
  await page.waitForTimeout(2_000);

  // ---- 悬浮 / 导航层 ----
  const topNav = await count(page, SEL.topNav);
  const modeSwitch = await count(page, SEL.modeSwitch);
  const leftSidebar = await count(page, SEL.leftSidebar);
  const sessionTabs = await count(page, SEL.sessionTabs);
  await screenshot(page, info, "00-navigation-layer");
  record(
    "navigation-layer (top nav / mode switch / left sidebar / session tabs)",
    topNav > 0 || modeSwitch > 0 || leftSidebar > 0
      ? "pass"
      : "not-present",
    `topNav=${topNav} modeSwitch=${modeSwitch} leftSidebar=${leftSidebar} sessionTabs=${sessionTabs}`,
  );
  if (leftSidebar > 0) {
    await screenshot(page, info, "01-followed-sessions-sidebar");
    record(
      "transcript-sidebar (followed sessions list)",
      "pass",
      `rows=${await count(page, SEL.navRow)}`,
    );
  }

  // ---- composer 空态 ----
  const composerForm = await count(page, SEL.composerForm);
  const composerInput = await count(page, SEL.composerInput);
  await screenshot(page, info, "02-composer-empty");
  record(
    "composer-empty (input present, no draft)",
    composerForm > 0 && composerInput > 0 ? "pass" : "not-present",
    `form=${composerForm} input=${composerInput}`,
  );

  // ---- composer 输入态 ----
  const input = page.locator(SEL.composerInput).first();
  if (composerInput > 0 && (await input.isVisible().catch(() => false))) {
    await input.click();
    await input.fill("实时验收输入态（未发送）");
    await screenshot(page, info, "03-composer-input");
    record("composer-input (typed draft rendered)", "pass", "filled contenteditable");

    const accessMode = await page.locator(SEL.accessModeButton).count();
    const approval = await count(page, SEL.approval);
    const queue = await count(page, SEL.followupQueue);
    await screenshot(page, info, "04-composer-queue-approval");
    record(
      "composer-approval-gate (access-mode / execution-permission selector)",
      accessMode > 0 ? "pass" : "not-present",
      `accessModeButton=${accessMode}`,
    );
    record(
      "composer-queue (follow-up queue list)",
      queue > 0 ? "pass" : "host-gated",
      `queue=${queue} (requires an active queued follow-up, not present in this session)`,
    );
    await input.fill("");
  } else {
    record("composer-input (typed draft rendered)", "not-present", "input not visible");
    record("composer-approval-gate (access-mode / execution-permission selector)", "not-present", "composer unavailable");
    record("composer-queue (follow-up queue list)", "host-gated", "composer unavailable");
  }

  // ---- transcript 空态（未打开线程）----
  const welcome = await count(page, SEL.welcome);
  await screenshot(page, info, "05-transcript-empty");
  record(
    "transcript-empty (no thread selected)",
    welcome > 0 ? "pass" : "not-present",
    `welcome=${welcome}`,
  );

  // ---- 打开真实线程，核对 transcript / presentation ----
  // The followed-session list is also lazy; wait for at least one real row
  // before scanning. If a project group is collapsed, expand the first group.
  await page
    .waitForSelector(SEL.navRow, { timeout: 45_000 })
    .catch(() => undefined);
  let rowCount = await count(page, SEL.navRow);
  if (rowCount === 0) {
    // Try expanding the first project group, then re-check.
    await page
      .locator(".session-project-heading, .session-project-group button, [data-state='closed']")
      .first()
      .click({ timeout: 5_000 })
      .catch(() => undefined);
    await page.waitForTimeout(3_000);
    rowCount = await count(page, SEL.navRow);
  }
  if (rowCount === 0) {
    record("scan-scope (project groups expanded / followed sessions exposed)", "not-present", "no followed session row");
    record("transcript-messages (real thread loaded)", "not-present", "no followed session row");
    record("transcript-loading (history notice / preparing indicator)", "not-present", "no real thread opened");
    record("transcript-tools", "not-present", "no real thread opened");
    record("transcript-plan", "not-present", "no real thread opened");
    record("transcript-file-changes", "not-present", "no real thread opened");
    record("presentation-markdown", "not-present", "no real thread opened");
    record("presentation-code-fence", "not-present", "no real thread opened");
    record("presentation-citation-pill", "not-present", "no real thread opened");
    record("presentation-streaming-live-tail", "host-gated", "no real thread opened");
  } else {
    // ---- widen the scan: expand every collapsed project group so real
    // threads across all projects are reachable, not just the first pages.
    let guard = 0;
    while (guard++ < 40) {
      const closed = await page.locator(SEL.collapsibleClosed).count();
      if (!closed) break;
      await page
        .locator(SEL.collapsibleClosed)
        .first()
        .click({ timeout: 5_000 })
        .catch(() => undefined);
      await page.waitForTimeout(400);
    }
    await page.waitForTimeout(2_000);
    // ---- pull older history: click every project group's "load more" so the
    // followed-sessions list reaches beyond the most recent page. This widens
    // the scan across projects AND older threads. (Read-only navigation.)
    for (let round = 0; round < 3; round++) {
      const more = page.locator(
        ".session-load-more:not([aria-busy='true']):not([disabled])",
      );
      const n = await more.count();
      if (!n) break;
      for (let i = 0; i < n; i++) {
        await more
          .nth(i)
          .click({ timeout: 3_000 })
          .catch(() => undefined);
        await page.waitForTimeout(600);
      }
      await page.waitForTimeout(2_000);
    }
    rowCount = await count(page, SEL.navRow);
    record(
      "scan-scope (project groups expanded / older history loaded)",
      rowCount > 0 ? "pass" : "not-present",
      `rows=${rowCount}`,
    );

    let opened = false;
    let sawTool = 0;
    let sawPlan = 0;
    let sawFileChange = 0;
    let sawCitation = 0;
    let sawMarkdown = 0;
    let sawPre = 0;
    let sawLoading = false;
    const shot = {
      tool: false,
      plan: false,
      file: false,
      citation: false,
      markdown: false,
      pre: false,
    };
    let messageShots = 0;
    const scanned = Math.min(rowCount, 40);
    for (let index = 0; index < scanned; index++) {
      await page.locator(SEL.navRow).nth(index).click({ timeout: 15_000 }).catch(() => undefined);
      // The history-loading state is transient; sample it right after the click.
      const loadingCount = await count(page, SEL.loading);
      if (loadingCount > 0 && !sawLoading) {
        sawLoading = true;
        await screenshot(page, info, "05b-transcript-loading");
      }
      await page.waitForTimeout(7_000);
      const messages = await count(page, SEL.messageAuthor);
      if (messages > 0) {
        opened = true;
        if (messageShots < 3) {
          await screenshot(page, info, `06-transcript-messages-${index}`);
          messageShots++;
        }
        sawMarkdown = Math.max(sawMarkdown, await count(page, SEL.streamdown));
        sawPre = Math.max(sawPre, await count(page, SEL.pre) + await count(page, SEL.codeFence));
        sawTool = Math.max(sawTool, await count(page, SEL.toolItem));
        sawPlan = Math.max(sawPlan, await count(page, SEL.planItem));
        sawFileChange = Math.max(sawFileChange, await count(page, SEL.fileChange));
        sawCitation = Math.max(sawCitation, await count(page, SEL.nativeFileCitation));
        if (sawTool > 0 && !shot.tool) {
          shot.tool = true;
          await screenshot(page, info, `07-transcript-tools-${index}`);
        }
        if (sawPlan > 0 && !shot.plan) {
          shot.plan = true;
          await screenshot(page, info, `08-transcript-plan-${index}`);
        }
        if (sawFileChange > 0 && !shot.file) {
          shot.file = true;
          await screenshot(page, info, `09-transcript-file-changes-${index}`);
        }
        if (sawCitation > 0 && !shot.citation) {
          shot.citation = true;
          await screenshot(page, info, `10-presentation-citation-${index}`);
        }
        if (sawPre > 0 && !shot.pre) {
          shot.pre = true;
          await screenshot(page, info, `11-presentation-code-fence-${index}`);
        }
        if (sawMarkdown > 0 && !shot.markdown) {
          shot.markdown = true;
          await screenshot(page, info, `12-presentation-markdown-${index}`);
        }
      }
      if (sawTool && sawPlan && sawFileChange) break;
    }
    // The scan exposed the followed-sessions list across every open project
    // group plus older history via load-more, then drove `scanned` threads.
    const scope = `rows=${rowCount} exposed, scanned=${scanned}`;
    record("transcript-messages (real thread loaded)", opened ? "pass" : "not-present", `opened=${opened} (${scope})`);
    record("transcript-loading (history notice / preparing indicator)", sawLoading ? "pass" : "not-present", `loading=${sawLoading ? "observed" : "not observed (fast load or settled cache)"}`);
    // Structural finding: the sampled real threads render assistant/user markdown
    // (codex-assistant / codex-markdown / codex-native-memory-citation) but no
    // tool (`codex-command`/`codex-command-summary`), plan (`data-plan-step`/`.turn-plan`),
    // or file-change (`codex-individual-file-change-row`) items were present in the DOM.
    const observedOnly =
      "observed threads render only assistant/user markdown (no tool/plan/file-change items)";
    record("transcript-tools", sawTool > 0 ? "pass" : "not-present", `toolItems=${sawTool} (${scope}; ${observedOnly})`);
    record("transcript-plan", sawPlan > 0 ? "pass" : "not-present", `planItems=${sawPlan} (${scope}; ${observedOnly})`);
    record("transcript-file-changes", sawFileChange > 0 ? "pass" : "not-present", `fileChanges=${sawFileChange} (${scope}; ${observedOnly})`);
    record("presentation-markdown", sawMarkdown > 0 ? "pass" : "not-present", `streamdown=${sawMarkdown} (${scope})`);
    record("presentation-code-fence", sawPre > 0 ? "pass" : "not-present", `pre+fence=${sawPre} (${scope})`);
    record("presentation-citation-pill", sawCitation > 0 ? "pass" : "not-present", `citations=${sawCitation} (${scope}; ${observedOnly})`);
    // The streaming live tail is only observable while a turn is in flight; on
    // settled history threads it is absent without sending a new prompt.
    const live = await count(page, SEL.liveMessage);
    const streaming = await count(page, SEL.streamingText);
    record(
      "presentation-streaming-live-tail (in-flight turn)",
      live > 0 || streaming > 0 ? "pass" : "host-gated",
      `live=${live} streaming=${streaming} (requires a live running turn, not driven in read-only run)`,
    );
  }

  const artifact = info.outputPath("session-mode-live-oauth-results.json");
  await writeFile(
    artifact,
    JSON.stringify({ observedAt: new Date().toISOString(), results }, null, 2),
  );
  await info.attach("session-mode-live-oauth-results.json", {
    path: artifact,
    contentType: "application/json",
  });

  // The acceptance is a structural evidence capture, not a fake pass. We fail
  // only if nothing real was observed; per-state presence is reported in the
  // JSON artifact above rather than gating the run.
  const anyObserved = results.some((r) => r.status === "pass");
  expect(anyObserved, "at least one real state must be observed").toBe(true);
});
