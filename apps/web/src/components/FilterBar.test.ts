import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentSessionRecord } from "@agent-orchestrator/shared";
import { matchesSessionFilters, type FilterState } from "./FilterBar";
const base: FilterState = {
  host: null,
  kind: null,
  transport: null,
  dirQuery: "",
  tag: null,
};
const session = {
  id: "s1",
  displayName: "通道剪枝实验",
  agentKind: "codex",
  workingDirectory: "/research/Compression",
  hostId: "local",
  tags: ["实验"],
  transportRef: { tmuxSession: "train" },
} as AgentSessionRecord;
test("overview finds Chinese names, agent type and paths without altering directory-only filtering", () => {
  assert.equal(
    matchesSessionFilters(session, { ...base, query: "通道剪枝" }),
    true,
  );
  assert.equal(
    matchesSessionFilters(session, { ...base, query: " CODEX " }),
    true,
  );
  assert.equal(
    matchesSessionFilters(session, { ...base, query: "compression" }),
    true,
  );
  assert.equal(
    matchesSessionFilters(session, { ...base, dirQuery: "通道剪枝" }),
    false,
  );
  assert.equal(
    matchesSessionFilters(session, {
      ...base,
      query: "通道剪枝",
      kind: "claude",
    }),
    false,
  );
  assert.equal(
    matchesSessionFilters(session, { ...base, query: "不存在" }),
    false,
  );
  assert.equal(
    matchesSessionFilters(session, { ...base, query: "  \n" }),
    true,
  );
});
