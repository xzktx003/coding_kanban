# Hot Update And Session Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect local application source updates, let the user apply them without losing the board workspace, and restore managed tmux sessions after frontend/backend reloads.

**Architecture:** A backend Git fingerprint service exposes the current source revision, while a file-backed session catalog restores stable registry ids after restart. The frontend polls the version endpoint, persists terminal workspace state, displays an explicit update action, and reconnects only offline tmux-backed sessions. New sessions default to managed tmux.

**Tech Stack:** TypeScript, React 19, Vite, Fastify, Node test runner, Playwright, tmux, pnpm workspace.

---

### Task 1: Shared Update And Restore Contracts

**Files:**

- Modify: `packages/shared/src/index.ts`

- [ ] Add `AppVersionResponse`, `RestoreManagedSessionsResponse`, and restore-result item types.
- [ ] Run `pnpm --filter @agent-orchestrator/shared build`.

### Task 2: Source Revision Service

**Files:**

- Create: `apps/server/src/services/app-version-service.test.ts`
- Create: `apps/server/src/services/app-version-service.ts`

- [ ] Write failing tests using a temporary Git repository.
- [ ] Verify the fingerprint changes for tracked edits, untracked files, commits, and branch switches.
- [ ] Implement bounded `execFile` Git calls, hashing, caching, and degraded fallback.
- [ ] Run the focused test until green.

### Task 3: Persistent Session Catalog

**Files:**

- Create: `apps/server/src/services/session-state-store.test.ts`
- Create: `apps/server/src/services/session-state-store.ts`
- Modify: `apps/server/src/services/agent-session-registry.test.ts`
- Modify: `apps/server/src/services/agent-session-registry.ts`

- [ ] Write failing tests for projection, malformed files, stable-id restore, offline tmux state, and direct-session manual state.
- [ ] Implement versioned validation and atomic file writes.
- [ ] Add registry snapshot restoration without reusing process ids.
- [ ] Run focused tests until green.

### Task 4: Backend Routes And Startup Wiring

**Files:**

- Create: `apps/server/src/routes/app-update.test.ts`
- Create: `apps/server/src/routes/app-update.ts`
- Modify: `apps/server/src/app.ts`
- Modify: `apps/server/src/index.ts`
- Modify: `apps/server/src/routes/agent-sessions.ts`
- Modify: `apps/server/src/config/server-runtime-config.ts`
- Modify: `apps/server/src/config/server-runtime-config.test.ts`

- [ ] Write failing route tests for app version and managed restore.
- [ ] Extract the existing reconnect operation into a reusable bounded helper.
- [ ] Add `GET /api/app-version` and `POST /api/agent-sessions/restore-managed`.
- [ ] Wire the file store only from the production entry point so tests never read the user's runtime file.
- [ ] Run route and configuration tests until green.

### Task 5: Browser Update State And Workspace Persistence

**Files:**

- Create: `apps/web/src/lib/app-update.test.ts`
- Create: `apps/web/src/lib/app-update.ts`
- Create: `apps/web/src/lib/terminal-workspace-state.test.ts`
- Create: `apps/web/src/lib/terminal-workspace-state.ts`
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/components/AgentFocusView.tsx`

- [ ] Write failing pure tests for accepted revisions, one-shot reload intent, state migration, invalid slots, and stable slot restoration.
- [ ] Implement polling/storage helpers and terminal workspace persistence.
- [ ] Wire the focus view to restore mode, slots, active input slot, and closed slots.
- [ ] Run focused web tests until green.

### Task 6: Update And Restore UI

**Files:**

- Create: `apps/web/src/components/AppUpdateBanner.test.ts`
- Create: `apps/web/src/components/AppUpdateBanner.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/app.css`

- [ ] Write a failing component test for the update and restore states.
- [ ] Add version polling, explicit `更新并恢复`, visible restore progress, and failure details.
- [ ] Automatically invoke managed restore once per backend runtime when offline tmux cards exist.
- [ ] Run focused web tests until green.

### Task 7: Managed Tmux Default

**Files:**

- Modify: `apps/web/src/components/NewSessionDialog.test.ts`
- Modify: `apps/web/src/components/NewSessionDialog.tsx`

- [ ] Add a failing test that tmux is the selected default.
- [ ] Change initial/reset state and clarify persistent/direct labels.
- [ ] Run the focused component test until green.

### Task 8: First-Restart Migration

**Files:**

- Create: `scripts/capture-session-state.test.mjs`
- Create: `scripts/capture-session-state.mjs`
- Modify: `scripts/restart-dev.test.mjs`
- Modify: `scripts/restart-dev.sh`
- Modify: `.env.example`

- [ ] Write failing script tests for validation, atomic output, and pre-stop ordering.
- [ ] Capture the current backend snapshot before any process is stopped.
- [ ] Pass `SESSION_STATE_PATH` and source-root configuration to the new backend.
- [ ] Run script tests until green.

### Task 9: Documentation

**Files:**

- Modify: `docs/func_list.md`
- Modify: `docs/project-overview.md`

- [ ] Document update detection, explicit apply behavior, managed restore, direct-session limits, state path, and isolated verification.

### Task 10: Isolated End-To-End Verification

**Files:**

- Create: `tests/e2e/hot-update-session-restore.spec.ts`
- Create or modify: isolated test helpers under `tests/e2e/`

- [ ] Start a separate backend and frontend on test-only ports.
- [ ] Use a temporary Git root, session-state file, runtime directory, and unique tmux socket wrapper.
- [ ] Create two managed sessions and select a split layout.
- [ ] Change the temporary source revision and restart only the isolated backend.
- [ ] Apply the update in the browser.
- [ ] Verify both cards, focus mode, slot placement, active input ownership, and terminal reconnection.
- [ ] Tear down only isolated processes, files, and tmux socket.

### Task 11: Completion Audit

- [ ] Run focused red-green tests.
- [ ] Run `pnpm check`.
- [ ] Run `pnpm test`.
- [ ] Run the isolated Playwright scenario.
- [ ] Run `git diff --check`.
- [ ] Run `git check-ignore -v .env .env.example .dev-runtime`.
- [ ] Review the complete diff for credentials, machine paths, destructive behavior, and unrelated changes.
