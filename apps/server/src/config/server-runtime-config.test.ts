import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_TERMINAL_REGISTRY_OUTPUT_ENTRIES,
  DEFAULT_TERMINAL_SCROLLBACK_BYTES,
  DEFAULT_TERMINAL_TMUX_CAPTURE_LINES,
  resolveServerRuntimeConfig,
  resolveServerStorageRuntimeConfig,
  resolveTerminalHistoryRuntimeConfig,
} from "./server-runtime-config.js";

test("uses repo defaults when HOST and SERVER_PORT are unset", () => {
  assert.deepEqual(resolveServerRuntimeConfig({}), {
    host: "0.0.0.0",
    port: 4000,
    terminalRegistryOutputEntries: DEFAULT_TERMINAL_REGISTRY_OUTPUT_ENTRIES,
    terminalScrollbackBytes: DEFAULT_TERMINAL_SCROLLBACK_BYTES,
    terminalTmuxCaptureLines: DEFAULT_TERMINAL_TMUX_CAPTURE_LINES,
  });
});

test("keeps explicit HOST and SERVER_PORT values", () => {
  assert.deepEqual(
    resolveServerRuntimeConfig({
      HOST: "127.0.0.1",
      SERVER_PORT: "4300",
    }),
    {
      host: "127.0.0.1",
      port: 4300,
      terminalRegistryOutputEntries: DEFAULT_TERMINAL_REGISTRY_OUTPUT_ENTRIES,
      terminalScrollbackBytes: DEFAULT_TERMINAL_SCROLLBACK_BYTES,
      terminalTmuxCaptureLines: DEFAULT_TERMINAL_TMUX_CAPTURE_LINES,
    },
  );
});

test("keeps explicit terminal history config values", () => {
  assert.deepEqual(
    resolveTerminalHistoryRuntimeConfig({
      TERMINAL_REGISTRY_OUTPUT_ENTRIES: "1200",
      TERMINAL_SCROLLBACK_BYTES: "8388608",
      TERMINAL_TMUX_CAPTURE_LINES: "8000",
    }),
    {
      terminalRegistryOutputEntries: 1200,
      terminalScrollbackBytes: 8388608,
      terminalTmuxCaptureLines: 8000,
    },
  );
});

test("rejects invalid terminal history config values", () => {
  assert.throws(
    () =>
      resolveTerminalHistoryRuntimeConfig({
        TERMINAL_SCROLLBACK_BYTES: "0",
      }),
    /TERMINAL_SCROLLBACK_BYTES must be a positive integer/,
  );
  assert.throws(
    () =>
      resolveTerminalHistoryRuntimeConfig({
        TERMINAL_TMUX_CAPTURE_LINES: "3.14",
      }),
    /TERMINAL_TMUX_CAPTURE_LINES must be a positive integer/,
  );
  assert.throws(
    () =>
      resolveTerminalHistoryRuntimeConfig({
        TERMINAL_REGISTRY_OUTPUT_ENTRIES: "abc",
      }),
    /TERMINAL_REGISTRY_OUTPUT_ENTRIES must be a positive integer/,
  );
});

test("rejects invalid SERVER_PORT values", () => {
  assert.throws(
    () => resolveServerRuntimeConfig({ SERVER_PORT: "0" }),
    /SERVER_PORT must be a positive integer between 1 and 65535/,
  );
  assert.throws(
    () => resolveServerRuntimeConfig({ SERVER_PORT: "-1" }),
    /SERVER_PORT must be a positive integer between 1 and 65535/,
  );
  assert.throws(
    () => resolveServerRuntimeConfig({ SERVER_PORT: "3.14" }),
    /SERVER_PORT must be a positive integer between 1 and 65535/,
  );
  assert.throws(
    () => resolveServerRuntimeConfig({ SERVER_PORT: "abc" }),
    /SERVER_PORT must be a positive integer between 1 and 65535/,
  );
  assert.throws(
    () => resolveServerRuntimeConfig({ SERVER_PORT: "65536" }),
    /SERVER_PORT must be a positive integer between 1 and 65535/,
  );
  assert.throws(
    () => resolveServerRuntimeConfig({ SERVER_PORT: "70000" }),
    /SERVER_PORT must be a positive integer between 1 and 65535/,
  );
});

test("rejects conda-style platform triplet as HOST", () => {
  assert.throws(
    () => resolveServerRuntimeConfig({ HOST: "x86_64-conda-linux-gnu" }),
    /does not look like a valid IP or hostname/,
  );
  assert.throws(
    () => resolveServerRuntimeConfig({ HOST: "aarch64-conda_cos7-linux-gnu" }),
    /does not look like a valid IP or hostname/,
  );
});

test("SERVER_BIND_HOST takes precedence over HOST", () => {
  const config = resolveServerRuntimeConfig({
    SERVER_BIND_HOST: "0.0.0.0",
    HOST: "x86_64-conda-linux-gnu",
  });
  assert.equal(config.host, "0.0.0.0");
});

test("resolves source and session-state paths from the repository root", () => {
  assert.deepEqual(resolveServerStorageRuntimeConfig({}, "/repo"), {
    appSourceRoot: "/repo",
    sessionStatePath: "/repo/.dev-runtime/agent-sessions.json",
  });

  assert.deepEqual(
    resolveServerStorageRuntimeConfig(
      {
        APP_SOURCE_ROOT: "/tmp/source",
        SESSION_STATE_PATH: "runtime/test-sessions.json",
      },
      "/repo",
    ),
    {
      appSourceRoot: "/tmp/source",
      sessionStatePath: "/repo/runtime/test-sessions.json",
    },
  );
});
