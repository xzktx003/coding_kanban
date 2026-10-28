import type { AgentSessionRecord } from "@agent-orchestrator/shared";
import {
  getAttentionGroup,
  sortSessionsByAttention,
} from "../sessionGroups";

function session(
  overrides: Partial<AgentSessionRecord> & { id: string },
): AgentSessionRecord {
  const { id, ...rest } = overrides;
  const base: Record<string, unknown> = {
    displayName: id,
    kind: "codex",
    interactionState: "idle",
    hasUnreadCompletion: false,
    lastOutputAt: undefined,
    lastHeartbeatAt: undefined,
    lastRefreshedAt: undefined,
    taskSummaryUpdatedAt: undefined,
    outputPreview: "",
    projectName: null,
    gitBranch: null,
    gitChangedFiles: null,
    gitAddedLines: null,
    gitDeletedLines: null,
    agentKind: "codex",
    workingDirectory: "/tmp",
    repositoryRoot: null,
    hostId: null,
    connectionState: "online",
    hidden: false,
    lastAgentMessageSummary: null,
    lastUserMessageSummary: null,
    sshTarget: null,
  };
  return { id, ...base, ...rest } as unknown as AgentSessionRecord;
}

describe("getAttentionGroup", () => {
  it("maps awaiting_input to response", () => {
    expect(getAttentionGroup(session({ id: "a", interactionState: "awaiting_input" }))).toBe("response");
  });
  it("maps unread completion to review", () => {
    expect(getAttentionGroup(session({ id: "b", hasUnreadCompletion: true }))).toBe("review");
  });
  it("maps running to executing", () => {
    expect(getAttentionGroup(session({ id: "c", interactionState: "running" }))).toBe("executing");
  });
  it("maps idle to ready", () => {
    expect(getAttentionGroup(session({ id: "d", interactionState: "idle" }))).toBe("ready");
  });
});

describe("sortSessionsByAttention", () => {
  it("orders by attention: response > review > executing > ready", () => {
    const ready = session({ id: "ready", interactionState: "idle" });
    const executing = session({ id: "exec", interactionState: "running" });
    const review = session({ id: "review", hasUnreadCompletion: true });
    const response = session({ id: "resp", interactionState: "awaiting_input" });

    const sorted = sortSessionsByAttention([ready, executing, review, response]).map(
      (s) => s.id,
    );
    expect(sorted).toEqual(["resp", "review", "exec", "ready"]);
  });

  it("is stable within the same group", () => {
    const a = session({ id: "a", interactionState: "idle" });
    const b = session({ id: "b", interactionState: "idle" });
    const sorted = sortSessionsByAttention([b, a]).map((s) => s.id);
    expect(sorted).toEqual(["b", "a"]);
  });
});
