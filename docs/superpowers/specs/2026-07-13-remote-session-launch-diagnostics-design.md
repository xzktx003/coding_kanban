# Remote Session Launch Diagnostics Design

## Problem

The remote-session launch endpoint can return `201` after spawning `ssh`, even
when the remote working directory, selected agent command, or `tmux` command is
not usable. The spawned process then exits immediately. The board currently
shows this as a terminal card that closes or becomes exited without explaining
the actionable remote failure.

The observed host confirms the boundary: SSH authentication and PTY allocation
succeed, while command execution is the remaining failure surface. The fix must
be host-independent and must not encode addresses, usernames, ports, paths, or
credentials in source.

## Goals

- Validate the selected remote directory and required executable before launch.
- Return a structured, user-readable launch error instead of creating a session
  that is known to fail.
- Preserve terminal output and the exit code when a process fails after launch.
- Keep successful local, direct SSH, and SSH-plus-tmux behavior unchanged.
- Cover the behavior with red-green regression tests and update repository
  feature and bug documentation.

## Non-Goals

- Installing or configuring agents on the remote host.
- Modifying remote shell profiles or SSH configuration.
- Adding host-specific fallback paths.
- Automatically retrying commands or changing the selected agent.

## Design

### Remote preflight

The server owns preflight because it already owns SSH command construction and
can evaluate the remote environment consistently. Before spawning the long-lived
SSH PTY, it runs one bounded, non-interactive SSH helper command that checks:

1. The requested working directory can be entered.
2. The selected agent is resolvable from an interactive user shell environment.
3. `tmux` is resolvable when tmux launch mode is requested.

The helper uses existing SSH argument builders and shell quoting utilities. It
must not interpolate unchecked host, path, or command values into local shell
execution. Agent names are selected from the existing application-supported
allowlist rather than accepted as arbitrary commands.

The preflight result has a stable error code and a Chinese user-facing message,
for example:

- `REMOTE_DIRECTORY_UNAVAILABLE`: `远程目录不存在或无法访问：<path>`
- `REMOTE_AGENT_UNAVAILABLE`: `远程服务器未找到 <agent>，请先安装或配置交互式 shell PATH`
- `REMOTE_TMUX_UNAVAILABLE`: `远程服务器未安装 tmux，无法使用 tmux 启动模式`
- `REMOTE_PREFLIGHT_FAILED`: includes a sanitized SSH diagnostic when the
  connection-level helper itself fails.

The launch route completes preflight before registering a session. Failed
preflight returns a non-2xx response and no terminal card is created. The web
dialog keeps its existing status area open and displays the server message.

### Post-launch exit diagnostics

Some failures occur only after a successful preflight. The PTY runtime therefore
retains the normalized terminal output already captured by its session handle
and records the real SSH exit code when `onExit` fires. The session remains in
the registry with `interactionState: "exited"`; it is not silently deleted.
The existing terminal view can continue to render its scrollback, allowing the
user to see the final remote error. The card status must expose the exit code
where the current session status UI supports exited metadata.

No automatic restart is added in this change. Existing reconnect/restart actions
remain the explicit recovery path so potentially destructive remote commands are
never retried implicitly.

## Data Flow

1. The dialog submits the selected host, directory, agent, and launch mode.
2. The server validates the request and performs remote preflight over SSH.
3. On failure, the server returns a typed error and the dialog displays it.
4. On success, the server spawns the SSH PTY and registers the session as today.
5. If the PTY later exits, the registry records its exit code and keeps captured
   output available to the terminal card.

## Error And Security Rules

- Use `execFile`/argument arrays and existing `buildSshArgs`; never invoke a local
  shell with a concatenated SSH command.
- Quote remote directory values with the existing POSIX shell quote helper.
- Restrict executable checks to supported agent kinds plus `tmux`.
- Bound preflight runtime and output size.
- Do not expose credentials, identity-file contents, environment dumps, or full
  local command lines in API errors.
- Do not hardcode `10.30.0.24` or any machine-specific value.

## Test Strategy

- Unit-test preflight command construction for direct and tmux launches.
- Unit-test classification of missing directory, missing agent, missing tmux,
  SSH failure, timeout, and success.
- Route/runtime-test that failed preflight does not register or spawn a session.
- Web-test that the new-session dialog retains and displays the backend error.
- Regression-test that a post-launch exit retains the session, output, and exit
  code.
- Run directly affected tests, frontend and backend type checks, lint, and the
  repository's relevant check command.

## Acceptance Criteria

- Selecting an unavailable remote directory produces a specific dialog error and
  creates no card.
- Selecting an unavailable remote agent produces a specific dialog error and
  creates no card.
- Selecting tmux mode without remote tmux produces a specific dialog error and
  creates no card.
- A valid remote launch behaves as before.
- A process that exits after launch leaves a diagnosable exited session with its
  terminal output and exit code available.
- No unrelated workspace changes or sensitive data are committed.
