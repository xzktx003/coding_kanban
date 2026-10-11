# Isolated native Codex host prototype

This dependency-free Node prototype installs the supplied official VSIX into a private extension directory and packages and installs our own companion as a separate VSIX through code-server's installer. The official package is never patched. It runs an independent code-server instance bound to `0.0.0.0`, with explicit ports and separate user data, extensions, project, process home, CLI home and temporary directories.

Run tests with `node --test packages/native-codex-host/test/*.test.mjs` or the package's `test` script. No shared dependency or lockfile changes are needed.

Create a fresh owned `0700` short runtime directory, for example with Node `mkdtemp(join(tmpdir(), 'ck-native-'))`. Unix native IPC path limits are validated before launch. Provide every machine path and port through arguments or corresponding `NATIVE_CODEX_*` environment variables:

```sh
node packages/native-codex-host/launcher.mjs \
  --runtime-root "$NATIVE_CODEX_RUNTIME_ROOT" \
  --code-server "$NATIVE_CODEX_CODE_SERVER" \
  --official-vsix "$NATIVE_CODEX_OFFICIAL_VSIX" \
  --codex-cli "$NATIVE_CODEX_CODEX_CLI" \
  --port "$NATIVE_CODEX_PORT" --broker-port "$NATIVE_CODEX_BROKER_PORT" \
  --user-data-dir "$NATIVE_CODEX_USER_DATA_DIR" \
  --extensions-dir "$NATIVE_CODEX_EXTENSIONS_DIR" \
  --project-dir "$NATIVE_CODEX_PROJECT_DIR" \
  --codex-home "$NATIVE_CODEX_CODEX_HOME" \
  --process-home "$NATIVE_CODEX_PROCESS_HOME" \
  --cert "$NATIVE_CODEX_CERT" --cert-key "$NATIVE_CODEX_CERT_KEY" \
  --password-file "$NATIVE_CODEX_PASSWORD_FILE" \
  --record "$NATIVE_CODEX_RECORD" --create-threads
```

HTTPS is needed for LAN Webview service workers and crypto. Supply a private test certificate/key matching the LAN address; trust it only in the dedicated test browser context. Omitting both certificate options enables HTTP for explicit diagnostic use. Password authentication is required by default. Supply `--password-file` (or `NATIVE_CODEX_PASSWORD_FILE`) pointing to an owned regular `0600` file containing one new prototype password of 16–256 characters. The launcher reads the value locally and writes it only into private runtime `code-server.yaml`; the password does not enter child arguments, stdout/logs, browser extension config or runtime records. Do not reuse host/production account credentials. `--unsafe-no-auth` is an explicit diagnostic escape hatch, mutually exclusive with the password file; it grants full IDE/terminal access and must not be used for continued user trial. No model/login credentials or private project files belong in this prototype. Both configured ports must be unused. Existing listeners are never stopped. The launcher handles signals only for child objects it spawned, with no process discovery or PID-based kill. Once stopped it refuses further preparation and spawns, including after an in-flight installer exits. Existing application/temporary directories must be empty, owned `0700` directories; all generated runtime files and the output record path must be new. Existing auth, sockets, configuration or symlink outputs are rejected. Select a new runtime root and record path for every launch.

`--create-threads` starts the explicit original CLI app-server, initializes it, sends exactly two `thread/start` requests, and terminates that owned fixture server. It sends no model turn, resume, approval or interrupt. The diagnostic `--threads-file /absolute/threads.json` form accepts `{ "threads": [{ "id": "local-thread-uuid" }] }` metadata only; it imports no thread history or login files and cannot reuse a populated CLI home. For usable native fixtures, use `--create-threads`. No login data is imported. The fresh home can show the original logged-out UI.

The launcher writes a credential-free runtime record at the explicit ignored record path, with PIDs, ports, directories, thread IDs, original VSIX SHA-256 and LAN HTTPS URLs. It returns public startup metadata on stdout. `host.log`, `install.log`, `fixture-app-server.log` and `threads.json` stay inside the private runtime directory. Runtime readiness does not prove extension activation: open the LAN URL in a browser, then query the companion.

```sh
node packages/native-codex-host/broker.mjs --record "$NATIVE_CODEX_RECORD" status
node packages/native-codex-host/broker.mjs --record "$NATIVE_CODEX_RECORD" open "$THREAD_ID" 1
```

For a fresh browser profile, press Ctrl/Cmd+Shift+P and choose **Native Codex: Open Two Test Panels**. The contributed fixed command `nativeCodexPrototype.openTwoTestPanels` takes no caller arguments and opens only the two captured allowlisted fixtures in columns 1 and 2. It never sends a model turn or logs in. Command and broker panel opening share one lock.

To open those same two panels when our companion starts, explicitly add `--auto-open-fixtures` to the launcher. This flag defaults to false and is stored as a boolean only in the owned private companion config. It waits for successful official extension activation, captures only the first two distinct configured fixtures, and uses the same fixed opener and lock as the palette command; it accepts no thread IDs or commands as flag arguments. The isolated Codex workbench uses this opt-in. Missing/failed official activation or a failed panel open is reported by companion `GET /status` as `autoOpenFixtures: { enabled, state, error? }`, without automatic retry. Deactivation prevents later panel execution, including the second panel of a pending pair. A second browser instance whose broker port is occupied opens its own panels without forwarding to the first listener. No login, model turn, account credentials or official VSIX changes are introduced.

The local helper reads the private `0600` auth file itself and never prints or passes its bearer secret as an argument. Companion HTTP binds only `127.0.0.1` at the explicit broker port. `GET /status` reports original extension activation and editor tabs. `POST /open` accepts only `{threadId,column}` with an allowlisted lower-case UUID and columns 1–3; it executes the fixed `vscode.openWith` command for `chatgpt.conversationEditor` and the exact `openai-codex://route/local/<id>` URI. No general command or IPC proxy exists. Requests and responses are bounded, and panel openings are serialized. The opening lock is acquired before any body read; rejected concurrent requests cannot release another request's lock. Body reads have a five-second total deadline. An opening command that takes longer than twenty seconds gets an HTTP 504 response; because VS Code commands cannot be cancelled, the lock remains held until the command settles. Closing that response does not start another command. When a prior disconnected browser extension host still holds the fixed broker port, a later instance treats only `EADDRINUSE` as broker-disabled and completes activation. It does not take over the listener, kill a process, choose another port or forward its palette command. Its **Open Two Test Panels** command uses its own VS Code instance. Per-instance `companion-instance-<pid>-<id>.json` diagnostics contain only flags/counts and no token/thread contents; disabled instances do not overwrite the first listener's `companion-ready.json`. Other listen failures still fail activation and dispose that instance's command/server. The broker helper always addresses the first live fixed-port listener, which may belong to a disconnected browser; Helper responses explicitly include `brokerScope: "first-listener-instance"`; upgraded `status.broker` also includes its PID and instance ID. A retained older listener may lack that extra identity metadata. It does not select the currently visible browser. Use the palette command for the current browser's local panels.

The default modern IPC and legacy temporary endpoint are both isolated: `CODEX_HOME` points at the fresh CLI directory; `TMPDIR`, `TMP`, `TEMP` point at a separate private temporary directory. `HOME` and XDG directories are also isolated. Child environments contain only the selected standard locale/path/proxy variables and these private paths, excluding inherited API keys and login tokens.

This is an experimental host. Thread panels and owner discovery need real browser/IPC acceptance; zero-turn fixture creation and unit tests do not prove model execution, attachment handling, approval, cross-version compatibility or memory performance.
