# Hot Update And Session Restore Design

## Problem

Coding Kanban already receives frontend module updates from Vite, but it does
not expose a coherent application-version boundary. A source edit or branch
checkout can update the frontend, restart the backend, or do both. The browser
cannot currently tell the user that the loaded page and the running source tree
have diverged.

The browser persists part of its layout, while the backend session registry is
in memory. A backend restart therefore drops every card from the registry.
tmux-backed agent processes usually survive, but the board does not remember
enough metadata to reconnect them. Direct PTY processes cannot be preserved
across a backend restart.

## Goals

- Detect local source edits, commits, pulls, and branch checkouts without
  polling or mutating a remote Git repository.
- Show a non-disruptive update prompt instead of refreshing while the user is
  typing.
- Save the current board and focus workspace before the user applies an update.
- Restore all persisted cards after a backend restart.
- Automatically reconnect sessions whose managed tmux process still exists.
- Preserve focus mode, focused session, monitor layout, slot assignments,
  active input slot, closed slots, groups, and existing side-panel state.
- Make newly created sessions use managed tmux by default while retaining an
  explicit direct-process option.
- Preserve the currently running installation during development and run all
  runtime tests on separate ports, a separate state file, and a separate tmux
  socket.

## Non-Goals

- Automatically fetching remote branches or contacting a Git remote.
- Restarting the developer's current frontend or backend.
- Recreating a missing tmux session by rerunning its original command.
- Pretending a direct PTY process survived a backend restart.
- Persisting terminal scrollback indefinitely. tmux remains the durable source
  for terminal history.

## Version Detection

The backend exposes `GET /api/app-version`. The response contains a process
runtime id, start time, current Git branch/head metadata, and a source revision
fingerprint.

The fingerprint is computed from the configured source root using:

1. the current Git `HEAD`;
2. the tracked working-tree diff against `HEAD`;
3. untracked, non-ignored file paths plus bounded file metadata.

Git is executed with `execFile` argument arrays in a fixed repository
directory. The endpoint accepts no path or command input. Results are cached
briefly so browser polling does not continuously run Git.

The frontend polls the endpoint. It stores the last accepted source revision in
browser storage. A different revision shows a fixed update prompt. A backend
process restart alone does not create a false update if the source revision is
unchanged.

Clicking `更新并恢复` records the current revision as accepted, marks the next
page load as a restore load, and calls `window.location.reload()`. The prompt
never reloads automatically.

## Session Persistence

The production server receives a file-backed session-state store. Its path is
resolved from `SESSION_STATE_PATH`; the default is
`.dev-runtime/agent-sessions.json`, which is git ignored.

The store persists a versioned projection of the registry snapshot. It keeps
stable session ids, display metadata, hidden state, tags, working directory,
agent kind, tmux identifiers, SSH target, remote command, and active session id.
It excludes terminal output and ephemeral process ids.

On startup, the registry restores the same stable ids. Every restored session is
initially offline:

- tmux-backed sessions become detached and eligible for managed restore;
- direct sessions become exited and display that manual recovery is required.

Malformed or unsupported state files are ignored without preventing server
startup. Writes are atomic and create parent directories with user-only
permissions where supported.

Before `restart-dev.sh` stops an older backend, it captures
`/api/agent-sessions` into the same state file. This migrates the currently
running pre-feature registry into the new persistence format during the user's
first manual restart.

## Managed Restore

`POST /api/agent-sessions/restore-managed` attempts to reconnect every offline
tmux-backed card. It reuses the existing reconnect path and never creates a
missing tmux session. Results identify restored, already connected, failed, and
manual-only sessions.

After initial data load, the frontend visibly enters a history-restore state and
calls this endpoint once per backend runtime when offline managed sessions
exist. Multiple browser tabs are safe because the backend skips sessions that
already have a live PTY handle.

Direct sessions remain visible as exited cards with their previous metadata.
The existing explicit reconnect action is the only path that may launch a new
process.

## Browser Workspace Restore

A versioned terminal-workspace record in `localStorage` stores:

- monitor layout mode;
- slot-to-session assignments;
- active input slot;
- intentionally closed slots.

The existing focus, group, file-browser, side-panel, and top-bar stores remain
the owners of their state. Stable backend session ids allow these records to
survive a backend restart. Invalid or missing session ids are removed during
normalization.

## New Session Default

The new-session dialog defaults to managed tmux for local and SSH targets. The
UI labels it as the recommended persistent mode and explains that direct mode
cannot preserve the original PTY through an application update. Direct mode
remains available for deliberate one-off use.

## Error And Security Rules

- Do not run Git through a shell or accept a source path from an HTTP request.
- Do not persist terminal output, credentials, tokens, or key contents.
- Treat the session-state file as local runtime data and keep it git ignored.
- Validate restored JSON and every session field before placing it in the
  registry.
- Restore only existing tmux sessions. Never recreate one from saved command
  text.
- Present restore progress and failures in the UI.
- Do not stop, signal, or reuse the developer's current frontend/backend during
  automated testing.

## Test Strategy

- Unit-test Git fingerprint changes, cache behavior, and Git-unavailable
  fallback.
- Unit-test session-state projection, validation, atomic persistence, and
  registry restoration with stable ids.
- Route-test app-version and managed restore behavior with injected services.
- Unit-test frontend update-state transitions and terminal-workspace storage.
- Component-test that new sessions default to managed tmux.
- Script-test that `restart-dev.sh` captures session state before stopping
  processes.
- Run an isolated Playwright scenario on different ports, with a temporary Git
  source root, temporary state file, and a tmux wrapper using a unique socket.
  The scenario creates managed sessions, chooses a split layout, changes the
  source fingerprint, restarts only the isolated backend, applies the update,
  and verifies session cards and terminal layout return.

## Acceptance Criteria

- A source edit or local branch/head change produces an update prompt without
  interrupting terminal input.
- Clicking the prompt reloads once and does not loop.
- Managed tmux sessions and their cards survive an isolated backend restart.
- Focus and multi-pane placement return after reload.
- Direct sessions are retained as manual-recovery cards and are not relaunched
  automatically.
- Newly created sessions default to managed tmux.
- The current user frontend/backend are not stopped or modified by tests.
- Shared, server, web, script, and isolated end-to-end verification pass.
