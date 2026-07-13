# Remote Session Launch Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reject remote sessions with unusable directories or missing executables before creating a card, and display the actionable server error in the new-session dialog.

**Architecture:** Add a focused server service that builds and executes a bounded SSH preflight using the existing SSH argument and interactive-shell helpers. Inject it into the route layer so the route awaits validation before calling the synchronous PTY launcher; keep the existing registry exit handling unchanged because it already retains the session, terminal output, and exit summary.

**Tech Stack:** TypeScript, Fastify, Node `execFile`, React, Node test runner, pnpm workspace.

## Global Constraints

- No new dependencies.
- No host, username, port, credential, or machine-specific path may be hardcoded.
- SSH must be invoked with an argument array, not a concatenated local shell command.
- Supported agent names must be allowlisted before inclusion in a remote command.
- Preflight must be bounded by SSH connection timeout, process timeout, and output size.
- Existing unrelated worktree changes must remain untouched.

---

### Task 1: Remote Launch Preflight Service

**Files:**

- Create: `apps/server/src/services/remote-launch-preflight.ts`
- Create: `apps/server/src/services/remote-launch-preflight.test.ts`

**Interfaces:**

- Consumes: `LaunchSshPtyInput`, `buildSshArgs`, `buildInteractiveShellCommand`, and `quoteForPosixShell`.
- Produces: `RemoteLaunchPreflight` with `check(input: LaunchSshPtyInput): Promise<void>` and exported pure command/result classification helpers for unit tests.

- [ ] **Step 1: Write failing tests for command construction and result classification**

Cover a quoted working directory, shell sessions, supported agent kinds, tmux mode, unsupported agent kinds, missing directory, missing agent, missing tmux, SSH failure, timeout, and success. Assert exact Chinese messages for user-actionable failures.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm --filter server exec tsx --test src/services/remote-launch-preflight.test.ts`

Expected: FAIL because `remote-launch-preflight.ts` does not exist.

- [ ] **Step 3: Implement the minimal preflight service**

Use marker exit codes inside an interactive-shell command. Execute `ssh` via promisified `execFile` with `buildSshArgs(..., { batchMode: true, connectTimeoutSeconds: 8, remoteCommand })`, a 12-second timeout, and bounded buffer. Translate marker output and process failures into `RemoteLaunchPreflightError` with stable codes and sanitized Chinese messages.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `pnpm --filter server exec tsx --test src/services/remote-launch-preflight.test.ts`

Expected: all preflight tests pass.

### Task 2: Gate The SSH PTY Launch Route

**Files:**

- Modify: `apps/server/src/app.ts`
- Modify: `apps/server/src/routes/agent-sessions.ts`
- Create: `apps/server/src/routes/agent-sessions.remote-preflight.test.ts`

**Interfaces:**

- Consumes: `RemoteLaunchPreflight.check` from Task 1.
- Produces: `POST /api/agent-launch/ssh-pty` returning `400` for typed environment failures, `502` for SSH/preflight transport failures, and `201` only after successful preflight and PTY registration.

- [ ] **Step 1: Write failing route tests**

Inject a fake preflight into `buildServer`. Assert a rejected preflight returns the expected status/message and leaves `registry.list()` empty; assert successful preflight reaches session launch using a bounded fake or shell-safe fixture.

- [ ] **Step 2: Run the route test and verify RED**

Run: `pnpm --filter server exec tsx --test src/routes/agent-sessions.remote-preflight.test.ts`

Expected: FAIL because server construction and route registration do not accept a preflight dependency.

- [ ] **Step 3: Implement dependency injection and route error mapping**

Extend `BuildServerOptions` and `AgentSessionRoutesOptions` with a preflight interface, instantiate the production service by default, await `check(request.body)` before `launchRemote`, and return `{ error, code }` with the classified HTTP status.

- [ ] **Step 4: Run route and service tests and verify GREEN**

Run: `pnpm --filter server exec tsx --test src/services/remote-launch-preflight.test.ts src/routes/agent-sessions.remote-preflight.test.ts`

Expected: all tests pass.

### Task 3: Display The Backend Launch Error

**Files:**

- Modify: `apps/web/src/components/NewSessionDialog.tsx`
- Create or modify: `apps/web/src/components/NewSessionDialog.test.tsx` or the nearest existing pure helper test.

**Interfaces:**

- Consumes: `launchSshPtyAgent` rejection message already parsed by `apps/web/src/lib/api.ts`.
- Produces: dialog status text `创建失败：<backend message>` while leaving the dialog open.

- [ ] **Step 1: Write a failing test for error-message formatting**

Extract a small pure formatter only if the component test infrastructure cannot render the dialog. Assert an `Error("远程服务器未找到 claude...")` preserves that message and an unknown rejection falls back to the session name.

- [ ] **Step 2: Run the focused web test and verify RED**

Run: `pnpm --filter web exec tsx --test <focused-test-path>`

Expected: FAIL because the current catch block always emits `创建失败: <name>`.

- [ ] **Step 3: Implement minimal error propagation**

Change the catch block to use `error instanceof Error ? error.message : name`, preserve the open dialog, and use consistent Chinese punctuation.

- [ ] **Step 4: Run the focused web test and verify GREEN**

Run: `pnpm --filter web exec tsx --test <focused-test-path>`

Expected: all focused tests pass.

### Task 4: Documentation And Verification

**Files:**

- Modify: `docs/func_list.md`
- Modify: `docs/debug_list.md`
- Modify: `memories/repo/debug_list.md`

**Interfaces:**

- Consumes: verified behavior from Tasks 1-3.
- Produces: reader-facing feature and bug records describing preflight failures and retained exit diagnostics.

- [ ] **Step 1: Update required documentation**

Add concise entries for remote launch preflight and the fixed immediate-exit symptom, including root cause and recovery guidance.

- [ ] **Step 2: Run formatting and static checks**

Run: `pnpm --filter server format`, `pnpm --filter web format`, then inspect the diff to ensure formatting touched only task files.

Run: `pnpm check`

Expected: shared, server, and web builds succeed.

- [ ] **Step 3: Run relevant and full tests**

Run: `pnpm --filter server test`, `pnpm --filter web test`, and `pnpm test`.

Expected: zero test failures.

- [ ] **Step 4: Validate configuration hygiene**

Run: `git check-ignore -v .env .env.example`, `git diff --check`, and inspect `git status --short`.

Expected: `.env` is ignored, `.env.example` is not ignored, no whitespace errors exist, and unrelated pre-existing changes remain untouched.
