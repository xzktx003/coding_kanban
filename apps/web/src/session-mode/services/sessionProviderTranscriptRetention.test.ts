import { beforeEach, afterEach, expect, it, vi } from "vitest";
import {
  collectProviderTranscriptCandidates,
  releaseProviderTranscript,
} from "./sessionProviderTranscriptRetention";
import { useCCStore } from "../stores/cc/ccStore";
import { useAcpStore } from "../stores/useAcpStore";
import { useAgentCenterStore } from "../stores/useAgentCenterStore";
import {
  useProviderTranscriptStore,
  providerTranscriptKey,
  trackProviderTranscript,
  retainProviderTranscript,
} from "./sessionProviderTranscriptState";
import { planWarmTranscriptRetention } from "./sessionWarmRetention";
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(100_000);
  useProviderTranscriptStore.setState({ entries: {} });
  useAgentCenterStore.setState({
    cards: [{ kind: "cc", id: "cc-one", cwd: "/fixture" } as any],
    sharedTabsInitialized: true,
    detachedCard: null,
  });
  useCCStore.setState({
    activeSessionId: "cc-one",
    messages: [],
    sessionMessagesMap: {},
    sessionLoadingMap: {},
  });
  useAcpStore.getState().reset();
  useAcpStore.setState({
    agentId: "agent",
    connectionId: "connection",
    sessionId: "acp-one",
  });
});
afterEach(() => vi.useRealTimers());
it("charges CC and ACP canonical bodies into the same warm plan and retains permissions/status when reclaimed", () => {
  useCCStore
    .getState()
    .setMessages([
      {
        type: "assistant",
        uuid: "reply",
        message: { content: [{ type: "text", text: "x".repeat(1000) }] },
      } as any,
    ]);
  useCCStore
    .getState()
    .addMessageToSession("cc-one", {
      type: "permission_request",
      requestId: "permission",
      sessionId: "cc-one",
      toolName: "Read",
      toolInput: { path: "/source" },
    });
  useAcpStore
    .getState()
    .setEntries([
      {
        id: "acp-1-0",
        role: "agent",
        text: "y".repeat(1000),
        historySourceId: 1,
      },
    ]);
  const ids = [
    providerTranscriptKey("cc", "cc-one"),
    providerTranscriptKey("acp", "acp-one", "agent", "connection"),
  ];
  ids.forEach((id, index) =>
    trackProviderTranscript(
      id,
      index ? "acp" : "cc",
      index ? "acp-one" : "cc-one",
    ),
  );
  vi.advanceTimersByTime(60_001);
  const candidates = collectProviderTranscriptCandidates();
  expect(candidates).toHaveLength(2);
  expect(candidates.every((row) => row.bytes > 1000 && row.expired)).toBe(true);
  const plan = planWarmTranscriptRetention(candidates, {
    now: Date.now(),
    pressure: true,
  });
  expect(plan.evict).toHaveLength(2);
  plan.evict.forEach(releaseProviderTranscript);
  expect(useCCStore.getState().sessionMessagesMap["cc-one"]).toEqual([
    expect.objectContaining({
      type: "permission_request",
      requestId: "permission",
    }),
  ]);
  expect(useAcpStore.getState().entries).toEqual([]);
  expect(
    ids.every(
      (id) => useProviderTranscriptStore.getState().entries[id].dormant,
    ),
  ).toBe(true);
  useCCStore
    .getState()
    .addMessageToSession("cc-one", {
      type: "assistant",
      uuid: "late",
      message: { content: [{ type: "text", text: "must not refill" }] },
    } as any);
  expect(useCCStore.getState().messages).toHaveLength(1);
});
it("never reclaims a visible provider or an optimistic ACP message whose persistence receipt is unknown", () => {
  const cc = providerTranscriptKey("cc", "cc-one"),
    acp = providerTranscriptKey("acp", "acp-one", "agent", "connection");
  const release = retainProviderTranscript(cc, "cc", "cc-one");
  trackProviderTranscript(acp, "acp", "acp-one");
  useAcpStore
    .getState()
    .setEntries([
      {
        id: "optimistic",
        role: "user",
        text: "question",
        clientMessageId: "pending",
      },
    ]);
  vi.advanceTimersByTime(65_000);
  const plan = planWarmTranscriptRetention(
    collectProviderTranscriptCandidates(),
    { now: Date.now(), pressure: true },
  );
  expect(plan.evict).toEqual([]);
  release();
});
