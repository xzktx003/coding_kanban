# tmux Display Name and Sidebar Marker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every tmux card title equal the real tmux session name and add a subtle `tmux` metadata label to focus-view sidebar cards.

**Architecture:** Canonicalize tmux display names at backend producer and persistence boundaries while retaining `tmux:` only for internal IDs. Reuse the existing structured `transportRef.tmuxSession` field for frontend transport labeling, so the UI never parses title strings.

**Tech Stack:** TypeScript, Fastify, React, Node test runner, Playwright, pnpm.

---

## File Map

- Create `apps/server/src/services/tmux-display-name.ts`: pure legacy-title normalizer.
- Create `apps/server/src/services/tmux-display-name.test.ts`: canonicalization and custom-title protection.
- Modify `apps/server/src/services/session-state-store.ts`: normalize legacy persisted tmux titles while parsing.
- Modify `apps/server/src/services/session-state-store.test.ts`: prove persisted migration.
- Modify `apps/server/src/services/local-tmux-adapter.ts`: emit real names from local/remote discovery and remove the visible preview prefix.
- Modify `apps/server/src/services/local-tmux-adapter.test.ts`: prove local and remote discovery naming.
- Modify `apps/server/src/services/agent-scanner.ts`: emit real session names from directory scans.
- Modify `apps/server/src/services/agent-scanner.test.ts`: prove local scan naming.
- Modify `apps/server/src/routes/agent-sessions.ts`: canonicalize discovered-add titles from `tmuxSession`.
- Modify `apps/server/src/routes/agent-sessions.tmux-add.test.ts`: prove stale client labels cannot reintroduce prefixes.
- Modify `apps/web/src/components/FocusSidebarSessionCard.tsx`: render the selected subtle metadata label.
- Modify `apps/web/src/app.css`: style the label without competing with monitor numbers or state badges.
- Modify `apps/web/src/components/AgentFocusView.test.ts`: prove tmux/non-tmux sidebar rendering.
- Modify `tests/e2e/terminal-preview.spec.ts`: verify title, sidebar label, pane index, and active association together.
- Modify `docs/func_list.md`, `docs/project-overview.md`, `docs/debug_list.md`, and `memories/repo/debug_list.md`: document behavior and regression.

### Task 1: Pure legacy-title normalization and persisted migration

**Files:**
- Create: `apps/server/src/services/tmux-display-name.ts`
- Create: `apps/server/src/services/tmux-display-name.test.ts`
- Modify: `apps/server/src/services/session-state-store.ts`
- Test: `apps/server/src/services/session-state-store.test.ts`

- [ ] **Step 1: Write failing tests for the exact legacy formats**

Create `tmux-display-name.test.ts` with these cases:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalTmuxDisplayName,
  normalizeTmuxDisplayName,
} from "./tmux-display-name.js";

test("uses the real tmux session name for every new title", () => {
  assert.equal(canonicalTmuxDisplayName("dev"), "dev");
  assert.equal(canonicalTmuxDisplayName("a+b"), "a+b");
});

test("normalizes system-generated tmux titles to the real session name", () => {
  assert.equal(normalizeTmuxDisplayName("tmux:dev", "dev"), "dev");
  assert.equal(normalizeTmuxDisplayName("tmux:dev (bash)", "dev"), "dev");
  assert.equal(
    normalizeTmuxDisplayName("tmux:dev/bash (远程: repo)", "dev"),
    "dev",
  );
});

test("preserves custom, non-tmux, and lookalike titles", () => {
  assert.equal(normalizeTmuxDisplayName("Development", "dev"), "Development");
  assert.equal(normalizeTmuxDisplayName("tmux:other", "dev"), "tmux:other");
  assert.equal(normalizeTmuxDisplayName("tmux:dev custom", "dev"), "tmux:dev custom");
  assert.equal(normalizeTmuxDisplayName("tmux:a+b", "a+b"), "a+b");
  assert.equal(normalizeTmuxDisplayName("plain", undefined), "plain");
});
```

Append a store test that writes a persisted tmux session with
`displayName: "tmux:tmux-managed (bash)"`, loads it, and expects
`displayName === "tmux-managed"`. Include a second record with a custom title
and expect it to remain unchanged.

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
pnpm --filter server exec tsx --test \
  src/services/tmux-display-name.test.ts \
  src/services/session-state-store.test.ts
```

Expected: FAIL because `tmux-display-name.ts` does not exist and persisted
records retain the legacy title.

- [ ] **Step 3: Implement the pure normalizer**

Create:

```ts
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function canonicalTmuxDisplayName(tmuxSession: string): string {
  return tmuxSession;
}

export function normalizeTmuxDisplayName(
  displayName: string,
  tmuxSession?: string,
): string {
  if (!tmuxSession) {
    return displayName;
  }

  const escapedSession = escapeRegExp(tmuxSession);
  const generatedPatterns = [
    new RegExp(`^tmux:${escapedSession}$`),
    new RegExp(`^tmux:${escapedSession} \\([^\\r\\n]+\\)$`),
    new RegExp(
      `^tmux:${escapedSession}/[^\\r\\n]+ \\(远程: [^\\r\\n]+\\)$`,
    ),
  ];

  return generatedPatterns.some((pattern) => pattern.test(displayName))
    ? tmuxSession
    : displayName;
}
```

Import the helper in `session-state-store.ts`. After parsing
`transportRef.tmuxSession`, set:

```ts
displayName: normalizeTmuxDisplayName(
  value.displayName,
  transport?.tmuxSession,
),
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command.

Expected: all title-normalizer and session-store tests pass.

- [ ] **Step 5: Commit**

```bash
git add \
  apps/server/src/services/tmux-display-name.ts \
  apps/server/src/services/tmux-display-name.test.ts \
  apps/server/src/services/session-state-store.ts \
  apps/server/src/services/session-state-store.test.ts
git commit -m "fix: normalize legacy tmux display names"
```

### Task 2: Canonical names at every backend producer

**Files:**
- Modify: `apps/server/src/services/local-tmux-adapter.ts`
- Test: `apps/server/src/services/local-tmux-adapter.test.ts`
- Modify: `apps/server/src/services/tmux-display-name.ts`
- Modify: `apps/server/src/services/agent-scanner.ts`
- Test: `apps/server/src/services/agent-scanner.test.ts`
- Modify: `apps/server/src/routes/agent-sessions.ts`
- Test: `apps/server/src/routes/agent-sessions.tmux-add.test.ts`

- [ ] **Step 1: Add failing discovery tests**

In `local-tmux-adapter.test.ts`, stub the adapter command boundaries and assert
real titles:

```ts
test("local tmux discovery exposes the real session name", async () => {
  const adapter = new LocalTmuxAdapter(new AgentSessionRegistry());
  (adapter as unknown as {
    runTmux(args: string[]): Promise<{ stdout: string; stderr: string }>;
  }).runTmux = async (args) => ({
    stdout: args.includes("list-panes")
      ? "dev\t0\t1\t1\t%1\tbash\t/work/dev"
      : "",
    stderr: "",
  });

  const result = await adapter.discover();
  assert.equal(result.items[0]?.displayName, "dev");
  assert.doesNotMatch(result.items[0]?.outputPreview ?? "", /^tmux:/);
  assert.equal(result.items[0]?.transportRef?.runtimeId, "tmux:dev");
});

test("remote tmux discovery exposes the real session name", async () => {
  const adapter = new LocalTmuxAdapter(new AgentSessionRegistry());
  (adapter as unknown as {
    runRemoteCommand(): Promise<string>;
  }).runRemoteCommand = async () =>
    "remote-dev\t0\t1\t1\t%2\tbash\t/work/remote-dev";

  const result = await adapter.discoverRemote({ host: "remote-a" });
  assert.equal(result.items[0]?.displayName, "remote-dev");
  assert.doesNotMatch(result.items[0]?.outputPreview ?? "", /^tmux:/);
  assert.equal(
    result.items[0]?.transportRef?.runtimeId,
    "tmux:remote-a:remote-dev",
  );
});
```

Update the existing real local scan test in `agent-scanner.test.ts` to assert
that the tmux result title equals its `tmuxSession`.

In `agent-sessions.tmux-add.test.ts`, send a detached add payload with
`displayName: "tmux:<session> (bash)"` and expect the response title to equal
`tmuxSession`.

- [ ] **Step 2: Run focused backend tests and verify RED**

Run:

```bash
pnpm --filter server exec tsx --test \
  src/services/local-tmux-adapter.test.ts \
  src/services/agent-scanner.test.ts \
  src/routes/agent-sessions.tmux-add.test.ts
```

Expected: discovery and route assertions receive prefixed or concatenated
titles.

- [ ] **Step 3: Implement canonical producer output**

In `local-tmux-adapter.ts`:

```ts
function buildTmuxStatusPreview(sessionInfo: TmuxSessionInfo): string {
  const stateLabel =
    sessionInfo.interactionState === "running" ? "连接中" : "detached";
  return `${sessionInfo.sessionName} · ${sessionInfo.currentCommand} · ${stateLabel}`;
}
```

Set both local and remote discovery records to:

```ts
displayName: sessionInfo.sessionName,
```

Import and use `canonicalTmuxDisplayName()` in both `scanLocalTmux()` and
`scanRemoteTmux()`:

```ts
displayName: canonicalTmuxDisplayName(session),
```

Keep `agentKind`, `workingDirectory`, `tmuxSession`, `tmuxPane`, and
`sshTarget` unchanged.

Use the same helper for local and remote dedicated discovery:

```ts
displayName: canonicalTmuxDisplayName(sessionInfo.sessionName),
```

In `/api/agent-discovery/tmux/add`, define:

```ts
const canonicalDisplayName = canonicalTmuxDisplayName(tmuxSession);
```

Pass `canonicalDisplayName` to running local/remote PTY launch inputs and the
detached registry record instead of the request `displayName`. Retain the
request field in the API input type for compatibility. This shared helper is
the single title contract used by local scanner, remote scanner, local
discovery, remote discovery, and the add route.

- [ ] **Step 4: Run focused backend tests and verify GREEN**

Run the Step 2 command.

Expected: all focused adapter, scanner, and route tests pass.

- [ ] **Step 5: Commit**

```bash
git add \
  apps/server/src/services/tmux-display-name.ts \
  apps/server/src/services/local-tmux-adapter.ts \
  apps/server/src/services/local-tmux-adapter.test.ts \
  apps/server/src/services/agent-scanner.ts \
  apps/server/src/services/agent-scanner.test.ts \
  apps/server/src/routes/agent-sessions.ts \
  apps/server/src/routes/agent-sessions.tmux-add.test.ts
git commit -m "fix: keep tmux titles canonical"
```

### Task 3: Add the subtle tmux label to focus sidebar cards

**Files:**
- Modify: `apps/web/src/components/FocusSidebarSessionCard.tsx`
- Modify: `apps/web/src/app.css`
- Test: `apps/web/src/components/AgentFocusView.test.ts`
- Test: `tests/e2e/terminal-preview.spec.ts`

- [ ] **Step 1: Write the failing component and E2E tests**

Extend the test session factory to accept overrides, create one tmux session
and one direct session, then assert:

```ts
const tmuxSession = makeSession("session-1", "dev", {
  transportRef: { tmuxSession: "dev", runtimeId: "tmux:dev" },
});
const directSession = makeSession("session-2", "shell");

assert.match(markup, />dev</);
assert.doesNotMatch(markup, />tmux:dev</);
assert.equal(
  (markup.match(/class="focus-sidebar-transport-tag"/g) ?? []).length,
  1,
);
assert.match(markup, /aria-label="tmux 会话"/);
assert.match(markup, /data-monitor-index="1"/);
```

Update the mocked tmux session in
`links sidebar cards to monitor panes without moving monitored sessions` to
use `displayName: "alpha"` and `transportRef.tmuxSession: "alpha"`. Assert:

```ts
await expect(alphaCard.locator(".focus-sidebar-card-name")).toHaveText("alpha");
await expect(
  alphaCard.locator(".focus-sidebar-transport-tag"),
).toHaveText("tmux");
await expect(alphaCard).toHaveAttribute("data-monitor-index", "1");
```

Keep the existing yellow-border CSS comparison and no-move pane assertions.

- [ ] **Step 2: Run the component and E2E tests and verify RED**

Run:

```bash
pnpm --filter web exec tsx --test \
  src/components/AgentFocusView.test.ts
SERVER_BIND_HOST=127.0.0.1 \
SERVER_PORT=4430 \
PORT=4430 \
WEB_HOST=127.0.0.1 \
WEB_PORT=8510 \
WEB_BACKEND_HOST=127.0.0.1 \
WEB_BACKEND_PORT=4430 \
WEB_HTTPS=0 \
PLAYWRIGHT_FRONTEND_PROTOCOL=http \
PLAYWRIGHT_FRONTEND_HOST=127.0.0.1 \
PLAYWRIGHT_FRONTEND_PORT=8510 \
PLAYWRIGHT_BASE_URL=http://127.0.0.1:8510 \
pnpm exec playwright test tests/e2e/terminal-preview.spec.ts \
  --grep "links sidebar cards to monitor panes"
```

Expected: both FAIL because no `focus-sidebar-transport-tag` is rendered.

- [ ] **Step 3: Implement the selected visual option A**

In `FocusSidebarSessionCard.tsx`, derive:

```ts
const isTmuxManaged = Boolean(session.transportRef?.tmuxSession);
```

Immediately after `focus-sidebar-card-name`, render:

```tsx
{isTmuxManaged && (
  <span
    aria-label="tmux 会话"
    className="focus-sidebar-transport-tag"
    title="tmux 会话"
  >
    tmux
  </span>
)}
```

Add low-emphasis CSS:

```css
.focus-sidebar-transport-tag {
  flex: 0 0 auto;
  padding: 1px 4px;
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.025);
  color: rgba(244, 241, 234, 0.42);
  font-size: 8px;
  line-height: 1.2;
  text-transform: lowercase;
}
```

- [ ] **Step 4: Run focused component, E2E, and full web tests**

Run:

```bash
pnpm --filter web exec tsx --test \
  src/components/AgentFocusView.test.ts
SERVER_BIND_HOST=127.0.0.1 \
SERVER_PORT=4430 \
PORT=4430 \
WEB_HOST=127.0.0.1 \
WEB_PORT=8510 \
WEB_BACKEND_HOST=127.0.0.1 \
WEB_BACKEND_PORT=4430 \
WEB_HTTPS=0 \
PLAYWRIGHT_FRONTEND_PROTOCOL=http \
PLAYWRIGHT_FRONTEND_HOST=127.0.0.1 \
PLAYWRIGHT_FRONTEND_PORT=8510 \
PLAYWRIGHT_BASE_URL=http://127.0.0.1:8510 \
pnpm exec playwright test tests/e2e/terminal-preview.spec.ts \
  --grep "links sidebar cards to monitor panes"
pnpm --filter web test
```

Expected: the component test, focused E2E test, and full web suite pass.

- [ ] **Step 5: Commit**

```bash
git add \
  apps/web/src/components/FocusSidebarSessionCard.tsx \
  apps/web/src/components/AgentFocusView.test.ts \
  apps/web/src/app.css \
  tests/e2e/terminal-preview.spec.ts
git commit -m "feat: mark tmux sessions in focus sidebar"
```

### Task 4: Documentation and full verification

**Files:**
- Modify: `docs/func_list.md`
- Modify: `docs/project-overview.md`
- Modify: `docs/debug_list.md`
- Modify: `memories/repo/debug_list.md`

- [ ] **Step 1: Update reader-facing documentation**

Document these exact points:

- `docs/func_list.md`: tmux titles equal real session names; grid and focus
  sidebar use separate metadata tags.
- `docs/project-overview.md`: `displayName` is a business title, while tmux
  transport stays in `transportRef`.
- `docs/debug_list.md`: symptom, root cause, canonicalization fix, and tests.
- `memories/repo/debug_list.md`: one concise mirror entry.

- [ ] **Step 2: Format and run all directly related verification**

Run:

```bash
pnpm --filter web exec prettier --write \
  src/components/FocusSidebarSessionCard.tsx \
  src/components/AgentFocusView.test.ts \
  src/app.css \
  ../server/src/services/tmux-display-name.ts \
  ../server/src/services/tmux-display-name.test.ts \
  ../server/src/services/session-state-store.ts \
  ../server/src/services/session-state-store.test.ts \
  ../server/src/services/local-tmux-adapter.ts \
  ../server/src/services/local-tmux-adapter.test.ts \
  ../server/src/services/agent-scanner.ts \
  ../server/src/services/agent-scanner.test.ts \
  ../server/src/routes/agent-sessions.ts \
  ../server/src/routes/agent-sessions.tmux-add.test.ts \
  ../../tests/e2e/terminal-preview.spec.ts \
  ../../docs/func_list.md \
  ../../docs/project-overview.md \
  ../../docs/debug_list.md \
  ../../memories/repo/debug_list.md
pnpm --filter server test
pnpm --filter web test
pnpm check
```

Expected: all directly related server/web tests and builds pass. If the full
server suite exposes a known host-dependent PTY timeout, rerun the focused
files and compare the same test on the pre-feature base commit before
classifying it as baseline.

- [ ] **Step 3: Verify on the LAN-bound development service**

Start:

```bash
SERVER_BIND_HOST=0.0.0.0 \
SERVER_PUBLIC_HOST=10.30.0.24 \
SERVER_PORT=4430 \
PORT=4430 \
WEB_HOST=0.0.0.0 \
WEB_PORT=8510 \
WEB_BACKEND_HOST=127.0.0.1 \
WEB_BACKEND_PORT=4430 \
WEB_HTTPS=0 \
pnpm dev
```

Verify:

```bash
curl --fail http://10.30.0.24:8510/
curl --fail http://10.30.0.24:4430/api/health
PLAYWRIGHT_SKIP_WEBSERVER=1 \
PLAYWRIGHT_BASE_URL=http://10.30.0.24:8510 \
pnpm exec playwright test tests/e2e/terminal-preview.spec.ts \
  --grep "links sidebar cards to monitor panes"
```

Expected: both HTTP requests succeed and the focused E2E test passes through
the LAN URL. Stop only the development process started by this task.

- [ ] **Step 4: Run repository hygiene checks**

```bash
git diff --check
git check-ignore -v .env
if git check-ignore -q .env.example; then exit 1; fi
git status -sb
```

Expected: no whitespace errors, `.env` is ignored, `.env.example` is
trackable, and only intended files are modified.

- [ ] **Step 5: Commit documentation**

```bash
git add \
  docs/func_list.md \
  docs/project-overview.md \
  docs/debug_list.md \
  memories/repo/debug_list.md
git commit -m "docs: document canonical tmux titles"
```
