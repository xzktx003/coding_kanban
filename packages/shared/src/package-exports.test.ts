import assert from "node:assert/strict";
import test from "node:test";
import * as packageRoot from "@agent-orchestrator/shared";

const coldEntryModules = [
  "session-tabs",
  "session-projects",
  "session-followups",
  "session-subagents",
  "composer-context",
  "codex-chat-projection",
  "codex-mcp-auth",
  "codex-mcp-version",
] as const;

for (const name of coldEntryModules) {
  test(`the declared ${name} subpath shares every runtime value with the existing root API`, async () => {
    const leaf: Record<string, unknown> = await import(
      `@agent-orchestrator/shared/${name}`
    );
    assert.ok(Object.keys(leaf).length > 0);
    for (const [key, value] of Object.entries(leaf)) {
      assert.ok(
        Object.hasOwn(packageRoot, key),
        `${name}.${key} remains public`,
      );
      assert.equal(
        value,
        Reflect.get(packageRoot, key),
        `${name}.${key} must retain function, constant and weak-cache identity`,
      );
    }
  });
}
