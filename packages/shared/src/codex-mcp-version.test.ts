import assert from "node:assert/strict";
import test from "node:test";
import { mcpOAuthThreadIdSupported } from "./codex-mcp-version.ts";
test("thread OAuth capability follows native alpha26 boundary and rejects unknown versions", () => {
  for (const v of [
    null,
    "unknown",
    "codex_cli_rs/0.142.0",
    "codex_cli_rs/0.143.0-alpha.25",
  ])
    assert.equal(mcpOAuthThreadIdSupported(v), false);
  for (const v of [
    "codex_cli_rs/0.143.0-alpha.26 (Linux)",
    "codex_cli_rs/0.143.0",
    "0.144.0",
  ])
    assert.equal(mcpOAuthThreadIdSupported(v), true);
});
