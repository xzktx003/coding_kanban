import assert from "node:assert/strict";
import test from "node:test";
import { classifySubagentThread, subagentParent } from "./session-subagents.ts";

test("native parent identity wins over legacy main source; fork is not a subagent", () => {
  assert.equal(classifySubagentThread({ id: "child", source: "cli", parentThreadId: "root" }), "child");
  assert.equal(classifySubagentThread({ id: "fork", source: "vscode", forkedFromId: "root" } as any), "main");
  for (const source of ["cli", "vscode", "exec", "appServer", { custom: "fixture" }])
    assert.equal(classifySubagentThread({ id: "main", source }), "main");
});

test("a subagent source with missing ancestry is still a child with unknown parent", () => {
  for (const source of [{ subAgent: "review" }, { subAgent: {} }, { subagent: { threadSpawn: {} } }])
    assert.equal(classifySubagentThread({ id: "child", source }), "child");
  assert.equal(subagentParent({ id: "child", source: { subagent: { threadSpawn: { parentThreadId: "root" } } } }), "root");
});

test("missing or malformed identity cannot be promoted to a known main or parent", () => {
  for (const source of [undefined, null, "unknown", "future-source", { custom: 1 }, []])
    assert.equal(classifySubagentThread({ id: "unknown", source }), "unknown");
  assert.equal(subagentParent({ id: "bad", parentThreadId: 17 } as any), null);
  assert.equal(subagentParent({ id: "bad", source: { subAgent: { thread_spawn: { parent_thread_id: {} } } } }), null);
  assert.equal(subagentParent({ id: "bad", parentThreadId: "" }), null);
});
