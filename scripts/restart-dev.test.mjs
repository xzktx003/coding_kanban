import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const script = readFileSync(
  new URL("./restart-dev.sh", import.meta.url),
  "utf8",
);

test("restart-dev defaults to the LAN-facing 8484 frontend port", () => {
  assert.match(script, /WEB_PORT="\$\{WEB_PORT:-8484\}"/);
});

test("restart-dev defaults to HTTPS for the frontend dev server", () => {
  assert.match(script, /WEB_HTTPS="\$\{WEB_HTTPS:-1\}"/);
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

test("restart-dev passes backend proxy settings to the frontend dev server", () => {
  assert.match(script, /WEB_BACKEND_HOST="\$SERVER_PUBLIC_HOST"/);
  assert.match(script, /WEB_BACKEND_PORT="\$SERVER_PORT"/);
});

test("restart-dev does not fall back to HOST env var for server bind address", () => {
  assert.match(script, /SERVER_BIND_HOST="\$\{SERVER_BIND_HOST:-0\.0\.0\.0\}"/);
  assert.doesNotMatch(
    script,
    /SERVER_BIND_HOST="\$\{SERVER_BIND_HOST:-\$\{HOST/,
  );
});
