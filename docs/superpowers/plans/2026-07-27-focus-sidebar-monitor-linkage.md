# Focus Sidebar Monitor Linkage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep every visible session in the existing focus sidebar groups and show a synchronized pane number and current-input highlight on sidebar cards that correspond to large monitor panes.

**Architecture:** Keep `terminalSlots` and `activeSlotId` as the only source of monitor-placement truth in `AgentFocusView`. Derive per-session monitor metadata for presentation, pass it to `FocusSidebarSessionCard`, and route clicks on already-placed sessions to pane activation while preserving the existing replacement behavior for unplaced sessions. No server, API, WebSocket, persistence, or shared-type changes are required.

**Tech Stack:** React 19, TypeScript, CSS, Node test runner with server rendering, Playwright, pnpm.

---

## File Map

- Modify `apps/web/src/components/AgentFocusView.tsx`: derive sidebar monitor placement, render all visible sessions in existing groups, and distinguish activation from replacement on card clicks.
- Modify `apps/web/src/components/FocusSidebarSessionCard.tsx`: render optional pane index and expose accessible current-monitor state.
- Modify `apps/web/src/app.css`: style normal numbered cards and the synchronized yellow current-input card.
- Modify `apps/web/src/components/AgentFocusView.test.ts`: add component-level red/green coverage and update sidebar-count assumptions.
- Modify `tests/e2e/terminal-preview.spec.ts`: prove live pane/card linkage and click semantics in a browser.
- Modify `docs/func_list.md`: add the feature to the functional inventory.
- Modify `docs/project-overview.md`: document the frontend-only derived-state boundary.

### Task 1: Component contract for all-session sidebar linkage

**Files:**

- Modify: `apps/web/src/components/AgentFocusView.test.ts`
- Modify: `tests/e2e/terminal-preview.spec.ts`
- Modify: `apps/web/src/components/AgentFocusView.tsx`
- Modify: `apps/web/src/components/FocusSidebarSessionCard.tsx`
- Modify: `apps/web/src/app.css`

- [ ] **Step 1: Write the failing server-rendered component test**

Add a helper that extracts a sidebar card's opening tag:

```ts
function getSidebarCardTag(markup: string, sessionId: string): string {
  const match = markup.match(
    new RegExp(`<div[^>]*data-session-id="${sessionId}"[^>]*>`),
  );
  assert.ok(match, `missing sidebar card for ${sessionId}`);
  return match[0];
}
```

Add this test under `describe("AgentFocusView", ...)`:

```ts
it("links every monitored pane to the matching card in the existing sidebar groups", () => {
  installLocalStorageStub("dual");
  const sessions = [
    makeSession("session-1", "Alpha"),
    makeSession("session-2", "Beta"),
    makeSession("session-3", "Gamma"),
  ];

  const markup = renderToStaticMarkup(
    createElement(AgentFocusView, {
      focusedSession: sessions[0],
      sessions,
      onExit: () => {},
      onDeleteSession: () => {},
      onHideSession: () => {},
      onReconnect: () => {},
      onSwitchFocus: () => {},
    }),
  );

  const firstCard = getSidebarCardTag(markup, "session-1");
  const secondCard = getSidebarCardTag(markup, "session-2");
  const unmonitoredCard = getSidebarCardTag(markup, "session-3");

  assert.match(markup, />全部会话</);
  assert.match(firstCard, /data-monitor-index="1"/);
  assert.match(firstCard, /data-active-monitor-session="true"/);
  assert.match(firstCard, /aria-current="true"/);
  assert.match(secondCard, /data-monitor-index="2"/);
  assert.doesNotMatch(secondCard, /data-active-monitor-session/);
  assert.doesNotMatch(unmonitoredCard, /data-monitor-index/);
  assert.equal(
    (markup.match(/aria-label="对应第 [12] 个监控窗格"/g) ?? []).length,
    2,
  );
});
```

- [ ] **Step 2: Run the test and verify the red state**

Run:

```bash
pnpm --filter web exec tsx --test src/components/AgentFocusView.test.ts
```

Expected: FAIL because `session-1` and `session-2` are still removed from the sidebar.

- [ ] **Step 3: Write the failing Playwright interaction scenario**

Add a scenario named `links sidebar cards to monitor panes without moving monitored sessions` that creates Alpha, Beta, and Gamma; opens Alpha; selects the dual layout; and then asserts:

```ts
const firstPane = page.locator(
  '[data-terminal-pane-slot="terminal-monitor-slot-1"]',
);
const secondPane = page.locator(
  '[data-terminal-pane-slot="terminal-monitor-slot-2"]',
);
const alphaCard = page.locator('[data-session-id="alpha-session"]');
const betaCard = page.locator('[data-session-id="beta-session"]');
const gammaCard = page.locator('[data-session-id="gamma-session"]');

await expect(alphaCard).toHaveAttribute("data-monitor-index", "1");
await expect(alphaCard).toHaveAttribute(
  "data-active-monitor-session",
  "true",
);
await expect(betaCard).toHaveAttribute("data-monitor-index", "2");
await expect(gammaCard).not.toHaveAttribute("data-monitor-index", /.+/);

await betaCard.click();
await expect(secondPane).toHaveAttribute("data-active-terminal-pane", "true");
await expect(betaCard).toHaveAttribute(
  "data-active-monitor-session",
  "true",
);
await expect(firstPane).toHaveAttribute(
  "data-terminal-pane-session",
  "alpha-session",
);
await expect(secondPane).toHaveAttribute(
  "data-terminal-pane-session",
  "beta-session",
);

await gammaCard.click();
await expect(firstPane).toHaveAttribute(
  "data-terminal-pane-session",
  "alpha-session",
);
await expect(secondPane).toHaveAttribute(
  "data-terminal-pane-session",
  "gamma-session",
);
await expect(gammaCard).toHaveAttribute("data-monitor-index", "2");
await expect(gammaCard).toHaveAttribute(
  "data-active-monitor-session",
  "true",
);
await expect(betaCard).not.toHaveAttribute("data-monitor-index", /.+/);
```

- [ ] **Step 4: Run the interaction test and verify the red state**

Run:

```bash
pnpm exec playwright test tests/e2e/terminal-preview.spec.ts --grep "links sidebar cards to monitor panes"
```

Expected: FAIL because the Alpha and Beta cards are absent from the old sidebar.

- [ ] **Step 5: Add optional monitor metadata to the sidebar card**

Extend `FocusSidebarSessionCardProps` and the component parameters:

```ts
monitorIndex?: number;
isActiveMonitor?: boolean;
```

Change the card root and header to expose semantics and render the badge:

```tsx
<div
  aria-current={isActiveMonitor ? "true" : undefined}
  className={`focus-sidebar-card card-${session.interactionState}${monitorIndex ? " focus-sidebar-card--monitored" : ""}${isActiveMonitor ? " focus-sidebar-card--monitor-active" : ""}`}
  data-active-monitor-session={isActiveMonitor ? "true" : undefined}
  data-monitor-index={monitorIndex}
  data-session-id={session.id}
  ...
>
  <div className="focus-sidebar-card-header">
    <div className="focus-sidebar-card-identity">
      {monitorIndex && (
        <span
          aria-label={`对应第 ${monitorIndex} 个监控窗格`}
          className="focus-sidebar-monitor-index"
        >
          {monitorIndex}
        </span>
      )}
      <span className="focus-sidebar-card-name">{session.displayName}</span>
    </div>
    ...
  </div>
</div>
```

- [ ] **Step 6: Derive placement metadata and render all visible sessions**

In `AgentFocusView`, keep `otherSessions` for replacement logic and add:

```ts
const sidebarSessions = visibleSessions;
const sessionMonitorPlacementById = useMemo(() => {
  return new Map(
    terminalSlots.flatMap((slot, index) =>
      slot.sessionId
        ? [[slot.sessionId, { slotId: slot.id, monitorIndex: index + 1 }] as const]
        : [],
    ),
  );
}, [terminalSlots]);
```

Base filtering, grouping, scroll counts, sidebar visibility, search visibility, and card rendering on `sidebarSessions`. Keep `otherSessions` unchanged for `findFirstTerminalMonitorReplacementSession`. Change the title to `全部会话`.

For each card:

```tsx
const placement = sessionMonitorPlacementById.get(session.id);

<FocusSidebarSessionCard
  ...
  monitorIndex={placement?.monitorIndex}
  isActiveMonitor={placement?.slotId === safeActiveSlotId}
/>
```

- [ ] **Step 7: Preserve layout when a numbered card is clicked**

Start `handleSidebarSwitchFocus` with:

```ts
const existingSlot = terminalSlots.find(
  (slot) => slot.sessionId === sessionId,
);
if (existingSlot) {
  activateSlot(existingSlot);
  return;
}
```

Leave the existing unmonitored replacement path unchanged.

- [ ] **Step 8: Add synchronized card styles**

Add focused CSS:

```css
.focus-sidebar-card--monitored {
  border-color: rgba(255, 255, 255, 0.18);
}

.focus-sidebar-card--monitor-active {
  border-color: rgba(255, 152, 0, 0.95);
  box-shadow:
    0 0 0 2px rgba(255, 152, 0, 0.38),
    0 12px 28px rgba(255, 111, 0, 0.18),
    inset 0 0 0 1px rgba(255, 213, 128, 0.18);
}

.focus-sidebar-card--monitor-active .focus-sidebar-card-header {
  border-bottom-color: rgba(255, 152, 0, 0.34);
  background: linear-gradient(
    90deg,
    rgba(255, 152, 0, 0.2),
    rgba(255, 152, 0, 0.05)
  );
}

.focus-sidebar-card-identity {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
}

.focus-sidebar-card-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.focus-sidebar-monitor-index {
  display: inline-flex;
  width: 18px;
  height: 18px;
  flex: 0 0 18px;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.1);
  color: rgba(244, 241, 234, 0.8);
  font-size: 10px;
  font-weight: 700;
}

.focus-sidebar-card--monitor-active .focus-sidebar-monitor-index {
  background: #ff9800;
  color: #1a1206;
  box-shadow: 0 0 0 2px rgba(255, 152, 0, 0.24);
}
```

- [ ] **Step 9: Run the focused component suite and verify green**

Run:

```bash
pnpm --filter web exec tsx --test src/components/AgentFocusView.test.ts
```

Expected: all `AgentFocusView` tests PASS after updating old counts from “other sessions” to “all sessions”.

- [ ] **Step 10: Run the focused browser scenario and verify green**

Run:

```bash
pnpm exec playwright test tests/e2e/terminal-preview.spec.ts --grep "links sidebar cards to monitor panes"
```

Expected: 1 passed; pane session ids remain stable when Beta is clicked and only the active pane is replaced when Gamma is clicked.

- [ ] **Step 11: Commit the component and interaction contract**

```bash
git add apps/web/src/components/AgentFocusView.test.ts tests/e2e/terminal-preview.spec.ts apps/web/src/components/AgentFocusView.tsx apps/web/src/components/FocusSidebarSessionCard.tsx apps/web/src/app.css
git commit -m "feat: link focus sidebar cards to monitor panes"
```

### Task 2: Browser regression coverage

**Files:**

- Modify: `tests/e2e/terminal-preview.spec.ts`

- [ ] **Step 1: Run all terminal-preview browser regressions**

Run:

```bash
pnpm exec playwright test tests/e2e/terminal-preview.spec.ts
```

Expected: all tests PASS, after updating assertions that intentionally counted only unmonitored sidebar cards.

- [ ] **Step 2: Commit any count assertions changed for the all-session sidebar**

```bash
git add tests/e2e/terminal-preview.spec.ts
git commit -m "test: update focus sidebar regression expectations"
```

### Task 3: Functional documentation and complete verification

**Files:**

- Modify: `docs/func_list.md`
- Modify: `docs/project-overview.md`

- [ ] **Step 1: Update the functional inventory**

Extend the focus-view section in `docs/func_list.md` to state:

```md
- 聚焦视图右侧现有分组列表会保留全部可见会话；已进入大屏布局的会话小卡显示对应的 1-based 窗格编号，当前输入窗格与对应小卡同步显示黄色高亮。点击带编号小卡只切换当前输入，不移动分屏；点击未编号小卡继续替换当前输入窗格。
```

- [ ] **Step 2: Document the frontend-only boundary**

Add to the focus-view architecture in `docs/project-overview.md`:

```md
右侧会话小卡与大屏窗格的编号、当前输入高亮完全由前端 `terminalSlots` 和 `activeSlotId` 派生；小卡仍遵循现有分组与搜索规则，不新增后端字段、接口或 WebSocket 事件。
```

- [ ] **Step 3: Format the changed frontend files**

Run:

```bash
pnpm exec prettier --write apps/web/src/components/AgentFocusView.tsx apps/web/src/components/FocusSidebarSessionCard.tsx apps/web/src/components/AgentFocusView.test.ts apps/web/src/app.css tests/e2e/terminal-preview.spec.ts docs/func_list.md docs/project-overview.md
```

Expected: exit 0.

- [ ] **Step 4: Run focused and full verification**

Run:

```bash
pnpm --filter web exec tsx --test src/components/AgentFocusView.test.ts
pnpm --filter web test
pnpm test
pnpm check
git diff --check
git check-ignore -v .env .env.example
```

Expected:

- Focused and full tests report zero failures.
- Shared, server, and web builds exit 0.
- `git diff --check` prints nothing.
- `.env` matches an ignore rule and `.env.example` is not ignored; because `git check-ignore` exits non-zero for an intentionally unignored file, inspect both lines rather than using only the combined exit code.

- [ ] **Step 5: Run LAN-visible browser verification**

Run the focused browser scenario with the Playwright Vite service explicitly bound to every interface:

```bash
PLAYWRIGHT_FRONTEND_HOST=0.0.0.0 pnpm exec playwright test tests/e2e/terminal-preview.spec.ts --grep "links sidebar cards to monitor panes"
```

Then resolve the current `bond0` IPv4 address and the configured web protocol/port from live host state, probe that exact address with `curl --fail --insecure`, and record it in the handoff. Do not write the resolved machine-specific address into source files.

- [ ] **Step 6: Review the final scope**

Run:

```bash
git status -sb
git diff --stat HEAD~2
git diff --check
git log -4 --oneline
```

Confirm only the planned frontend, test, and documentation files changed; no credentials, `.env`, backend files, shared types, or unrelated worktree content are included.

- [ ] **Step 7: Commit documentation and any formatting-only adjustments**

```bash
git add docs/func_list.md docs/project-overview.md
git commit -m "docs: describe focus monitor card linkage"
```
