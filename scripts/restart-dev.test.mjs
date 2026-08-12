import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(new URL("./restart-dev.sh", import.meta.url));
const script = readFileSync(scriptPath, "utf8");

function runSourcedScript(body) {
  const tempDir = mkdtempSync(join(tmpdir(), "restart-dev-test-"));
  const fakeRepoPath = join(tempDir, "repo");
  const fakeScriptsPath = join(fakeRepoPath, "scripts");
  const fakeScriptPath = join(fakeScriptsPath, "restart-dev.sh");
  const markerPath = join(fakeRepoPath, "calls.log");

  mkdirSync(fakeScriptsPath, { recursive: true });
  copyFileSync(scriptPath, fakeScriptPath);

  try {
    const result = spawnSync(
      "bash",
      [
        "-c",
        String.raw`
          SCRIPT_UNDER_TEST="$1"
          MARKER_PATH="$2"
          FAKE_REPO="$3"

          set +e
          set +u
          set +o pipefail
          SOURCE_SHELLOPTS_BEFORE="$SHELLOPTS"

          lsof() {
            return 0
          }
          node() {
            return 0
          }
          setsid() {
            printf 'safety-setsid\n' >>"$MARKER_PATH"
            return 0
          }
          curl() {
            return 1
          }
          sleep() {
            return 0
          }
          kill() {
            printf 'safety-kill:%s\n' "$*" >>"$MARKER_PATH"
            return 0
          }

          source "$SCRIPT_UNDER_TEST"
        ` + body,
        "restart-dev-test",
        fakeScriptPath,
        markerPath,
        fakeRepoPath,
      ],
      {
        encoding: "utf8",
        env: { ...process.env },
      },
    );

    assert.equal(result.error, undefined);
    return {
      ...result,
      marker: existsSync(markerPath) ? readFileSync(markerPath, "utf8") : "",
    };
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
}

test("sourcing restart-dev preserves caller shell options", () => {
  const result = runSourcedScript(String.raw`
    printf 'before=%s\nafter=%s\n' \
      "$SOURCE_SHELLOPTS_BEFORE" "$SHELLOPTS"
    [[ "$SHELLOPTS" == "$SOURCE_SHELLOPTS_BEFORE" ]]
  `);

  assert.equal(result.status, 0, result.stderr);
  const [, before, after] =
    /^before=(.*)\nafter=(.*)\n$/.exec(result.stdout) ?? [];
  assert.equal(after, before);
});

test("capture skips node when no backend listener exists", () => {
  const result = runSourcedScript(String.raw`
    SERVER_PORT=45678

    lsof() {
      printf 'lsof:%s\n' "$*" >>"$MARKER_PATH"
    }
    pid_belongs_to_repo() {
      printf 'pid:%s\n' "$1" >>"$MARKER_PATH"
      return 1
    }
    node() {
      printf 'capture\n' >>"$MARKER_PATH"
      return 0
    }

    capture_current_session_state
  `);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /No running repo backend needs migration/);
  assert.equal(result.marker, "lsof:-tiTCP:45678 -sTCP:LISTEN\n");
});

test("capture skips node for foreign-only backend listeners", () => {
  const result = runSourcedScript(String.raw`
    SERVER_PORT=45678

    lsof() {
      printf 'lsof:%s\n' "$*" >>"$MARKER_PATH"
      printf '101\n202\n'
    }
    pid_belongs_to_repo() {
      printf 'pid:%s\n' "$1" >>"$MARKER_PATH"
      return 1
    }
    node() {
      printf 'capture\n' >>"$MARKER_PATH"
      return 0
    }

    capture_current_session_state
  `);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /No running repo backend needs migration/);
  assert.equal(
    result.marker,
    ["lsof:-tiTCP:45678 -sTCP:LISTEN", "pid:101", "pid:202", ""].join("\n"),
  );
});

test("capture succeeds for a repo backend when node captures state", () => {
  const result = runSourcedScript(String.raw`
    SERVER_PORT=45678

    lsof() {
      printf 'lsof:%s\n' "$*" >>"$MARKER_PATH"
      printf '101\n202\n'
    }
    pid_belongs_to_repo() {
      printf 'pid:%s\n' "$1" >>"$MARKER_PATH"
      if [[ "$1" == "202" ]]; then
        return 0
      fi
      return 1
    }
    node() {
      printf 'capture:%s\n' "$*" >>"$MARKER_PATH"
      return 0
    }

    capture_current_session_state
  `);

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /Captured current session registry before restart/,
  );
  assert.match(result.marker, /pid:101\npid:202\n/);
  assert.match(result.marker, /capture:.*capture-session-state\.mjs/);
});

test("capture refuses restart when repo backend state capture fails", () => {
  const result = runSourcedScript(String.raw`
    SERVER_PORT=45678

    lsof() {
      printf '31337\n'
    }
    pid_belongs_to_repo() {
      return 0
    }
    node() {
      printf 'capture:%s\n' "$*" >>"$MARKER_PATH"
      return 1
    }

    capture_current_session_state
  `);

  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /Refusing to restart: active repo backend state could not be migrated/,
  );
  assert.match(result.marker, /capture:.*capture-session-state\.mjs/);
});

test("main exits before kill calls when repo backend capture fails", () => {
  const result = runSourcedScript(String.raw`
    WEB_HTTPS_SAN="DNS:localhost"
    SERVER_PORT=45678

    lsof() {
      printf '31337\n'
    }
    pid_belongs_to_repo() {
      return 0
    }
    node() {
      if [[ "$1" == *"/capture-session-state.mjs" ]]; then
        printf 'capture\n' >>"$MARKER_PATH"
        return 1
      fi
      return 0
    }
    kill_listeners_on_port() {
      printf 'kill-listeners:%s\n' "$*" >>"$MARKER_PATH"
    }
    kill_from_pid_file() {
      printf 'kill-pid-file:%s\n' "$*" >>"$MARKER_PATH"
    }
    setsid() {
      printf 'setsid\n' >>"$MARKER_PATH"
      return 1
    }
    wait_for_http() {
      printf 'wait-http\n' >>"$MARKER_PATH"
      return 1
    }

    main
  `);

  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /Refusing to restart: active repo backend state could not be migrated/,
  );
  assert.equal(result.marker, "capture\n");
});

test("pid-file cleanup rejects non-positive and malformed PIDs", () => {
  const result = runSourcedScript(String.raw`
    PID_FILE="$FAKE_REPO/server.pid"

    kill() {
      printf 'kill:%s\n' "$*" >>"$MARKER_PATH"
      return 0
    }
    sleep() {
      printf 'sleep:%s\n' "$*" >>"$MARKER_PATH"
      return 0
    }

    for value in "0" "01" "-1" "--help" "12x" " 12" ""; do
      printf '%s\n' "$value" >"$PID_FILE"
      kill_from_pid_file backend "$PID_FILE"
    done
  `);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.marker, "");
});

test("listener ownership ignores malformed lsof PID lines", () => {
  const result = runSourcedScript(String.raw`
    lsof() {
      printf 'garbage\n0\n00\n101\n-7\n202x\n303 404\n'
    }
    pid_belongs_to_repo() {
      printf 'pid:%s\n' "$1" >>"$MARKER_PATH"
      return 1
    }

    if has_repo_listener_on_port 45678; then
      exit 9
    fi
  `);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.marker, "pid:101\n");
});

test("port reclaim ignores malformed lsof PID lines before kill", () => {
  const result = runSourcedScript(String.raw`
    LSOF_STATE="$FAKE_REPO/lsof-state"

    lsof() {
      if [[ ! -f "$LSOF_STATE" ]]; then
        : >"$LSOF_STATE"
        printf 'garbage\n0\n00\n101\n-7\n202x\n303 404\n'
      fi
    }
    pid_belongs_to_repo() {
      printf 'pid:%s\n' "$1" >>"$MARKER_PATH"
      return 1
    }
    kill() {
      printf 'kill:%s\n' "$*" >>"$MARKER_PATH"
      return 0
    }
    sleep() {
      return 0
    }

    kill_listeners_on_port backend 45678
  `);

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /Freeing backend port 45678: foreign listeners 101/,
  );
  assert.equal(result.marker, "pid:101\nkill:-- 101\n");
});

test("restart-dev guards main from sourced execution", () => {
  assert.match(script, /main\(\) \{/);
  assert.match(
    script,
    /if \[\[ "\$\{BASH_SOURCE\[0\]\}" == "\$0" \]\]; then\s+main "\$@"\s+fi\s*$/,
  );
  assert.match(
    script,
    /if \[\[ "\$\{BASH_SOURCE\[0\]\}" == "\$0" \]\]; then\s+set -euo pipefail\s+fi/,
  );
});

test("restart-dev defaults to the LAN-facing 8484 frontend port", () => {
  assert.match(script, /WEB_PORT="\$\{WEB_PORT:-8484\}"/);
});

test("restart-dev defaults to HTTPS for the frontend dev server", () => {
  assert.match(script, /WEB_HTTPS="\$\{WEB_HTTPS:-1\}"/);
});

test("restart-dev exposes only a CA that verifies the active frontend certificate", () => {
  assert.match(
    script,
    /openssl verify -CAfile "\$candidate" "\$WEB_HTTPS_CERT"/,
  );
  assert.match(
    script,
    /VITE_DEV_HTTPS_CA_CERT="\$WEB_HTTPS_CA_CERT"/,
  );
});

test("restart-dev detaches dev servers from the invoking shell session", () => {
  assert.match(
    script,
    /setsid env -u VSCODE_IPC_HOOK_CLI[\s\S]+pnpm --dir "\$SERVER_APP_DIR" dev/,
  );
  assert.match(
    script,
    /setsid env -u VSCODE_IPC_HOOK_CLI[\s\S]+pnpm --dir "\$WEB_APP_DIR" exec vite/,
  );
});

test("restart-dev keeps the frontend proxy local by default and configurable", () => {
  assert.match(
    script,
    /WEB_BACKEND_HOST="\$\{WEB_BACKEND_HOST:-127\.0\.0\.1\}"/,
  );
  assert.match(
    script,
    /WEB_BACKEND_PORT="\$\{WEB_BACKEND_PORT:-\$SERVER_PORT\}"/,
  );
  assert.match(script, /WEB_BACKEND_HOST="\$WEB_BACKEND_HOST"/);
  assert.match(script, /WEB_BACKEND_PORT="\$WEB_BACKEND_PORT"/);
});

test("restart-dev does not fall back to HOST env var for server bind address", () => {
  assert.match(script, /SERVER_BIND_HOST="\$\{SERVER_BIND_HOST:-0\.0\.0\.0\}"/);
  assert.doesNotMatch(
    script,
    /SERVER_BIND_HOST="\$\{SERVER_BIND_HOST:-\$\{HOST/,
  );
});

test("restart-dev force reclaims listeners outside this repository", () => {
  assert.match(script, /pid_belongs_to_repo\(\)/);
  assert.match(
    script,
    /Freeing \$\{name\} port \$\{port\}: foreign listeners \$\{foreign_pids\[\*\]\}/,
  );
  assert.match(script, /Force killing \$\{name\} port \$\{port\}/);
  assert.doesNotMatch(script, /Refusing to free/);
  assert.equal(script.match(/local pids=\(\)/g)?.length, 2);
  assert.match(script, /for pid in "\$\{pids\[@\]\}"/);
  assert.match(script, /kill -- "\$\{pids\[@\]\}"/);
  assert.match(script, /kill -9 -- "\$\{pids\[@\]\}"/);
});

test("restart-dev signals only strictly positive pid-file values", () => {
  assert.match(
    script,
    /\[\[ "\$pid" =~ \^\[1-9\]\[0-9\]\*\$ \]\] && kill -0 -- "\$pid"/,
  );
  assert.match(script, /kill -- "\$pid"/);
  assert.match(script, /kill -9 -- "\$pid"/);
});

test("restart-dev checks target ports before stopping pid-file processes", () => {
  assert.match(
    script,
    /kill_listeners_on_port backend "\$SERVER_PORT"\s+kill_listeners_on_port frontend "\$WEB_PORT"\s+kill_from_pid_file backend "\$SERVER_PID_FILE"\s+kill_from_pid_file frontend "\$WEB_PID_FILE"/,
  );
});

test("restart-dev captures the current registry before stopping any process", () => {
  const captureInvocation =
    /^\s*(?:if ! )?capture_current_session_state(?:; then)?\s*$/m.exec(script);
  const stopInvocation =
    /^\s*kill_listeners_on_port backend "\$SERVER_PORT"\s*$/m.exec(script);

  assert.ok(captureInvocation);
  assert.ok(stopInvocation);
  assert.ok(captureInvocation.index < stopInvocation.index);
  assert.match(script, /SESSION_STATE_PATH=/);
  assert.match(script, /capture-session-state\.mjs/);
});

test("restart-dev aborts only when a running repo backend cannot be migrated", () => {
  assert.match(script, /has_repo_listener_on_port\(\)/);
  assert.match(
    script,
    /has_repo_listener_on_port\(\) \{[\s\S]+lsof -tiTCP:"\$\{port\}" -sTCP:LISTEN[\s\S]+pid_belongs_to_repo "\$pid"[\s\S]+return 0[\s\S]+return 1[\s\S]+\}/,
  );
  assert.match(
    script,
    /if ! has_repo_listener_on_port "\$SERVER_PORT"; then[\s\S]+return 0/,
  );
  assert.match(script, /No running repo backend needs migration/);
  assert.match(
    script,
    /Refusing to restart: active repo backend state could not be migrated/,
  );
  assert.match(
    script,
    /if ! capture_current_session_state; then[\s\S]+exit 1[\s\S]+fi/,
  );
});

test("restart-dev passes the session state and source root to the isolated backend process", () => {
  assert.match(
    script,
    /SESSION_STATE_PATH="\$SESSION_STATE_PATH" APP_SOURCE_ROOT="\$APP_SOURCE_ROOT"/,
  );
});
