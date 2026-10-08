import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import { useFollowedSessionStates } from "./useFollowedSessionStates";
import { useAgentCenterStore } from "../stores/useAgentCenterStore";
import {
  useCodexStore,
  useApprovalStore,
  usePermissionsStore,
  useRequestUserInputStore,
  useElicitationStore,
} from "../components/codex/stores";
import { useCCStore } from "../stores/cc";
import { useSessionAttentionStore } from "../stores/useSessionAttentionStore";
import { useSubagentStore } from "../features/subagents/store";
it("counts asynchronous questions separately without making a running session blocked",()=>{
  useCodexStore.setState({events:{a:[{method:"item/completed",params:{threadId:"a",turnId:"t",item:{type:"agentMessage",id:"q",text:"question",questions:[{title:"环境？"}]}}} as any]}});
  const {result}=renderHook(()=>useFollowedSessionStates("ready"));
  expect(result.current.counts.pending).toBe(0);
  expect(result.current.counts.running).toBe(1);
  expect(result.current.questionCount).toBe(1);
  act(() => useCodexStore.getState().addEvent("a", {method:"turn/started",params:{threadId:"a",turn:{id:"next-turn",status:"inProgress",items:[]}}} as any));
  expect(result.current.questionCount).toBe(0);
  expect(result.current.counts.running).toBe(1);
});
beforeEach(() => {
  useSubagentStore.setState({ nodes: {}, families: {} });
  useAgentCenterStore.setState({
    cards: [
      { kind: "codex", id: "a" },
      { kind: "codex", id: "b" },
      { kind: "cc", id: "c" },
    ],
    sharedTabsInitialized: true,
  });
  useCodexStore.setState({
    threads: [],
    threadStatusMap: {
      a: { type: "active", activeFlags: [] },
      b: { type: "idle" },
    },
    turnTimingMap: {},
  });
  useCCStore.setState({
    sessionLoadingMap: { c: false },
    sessionMessagesMap: { c: [] },
  });
  useApprovalStore.setState({ pendingApprovals: [], currentApproval: null });
  usePermissionsStore.setState({ pendingRequests: [] });
  useRequestUserInputStore.setState({
    pendingRequests: [],
    currentRequest: null,
  });
  useElicitationStore.setState({ pendingRequests: [] });
  useSessionAttentionStore.setState({ receipts: {} });
});
it("aggregates child execution and requests once per followed family after parent completion", () => {
  useSubagentStore.getState().apply("b", { threads: ["child", "grand"].map((id, index) => ({ id, parentThreadId: index ? "child" : "b", status: { type: "active" } })), complete: true, errors: [], checkedAt: 1 }, 0);
  const { result } = renderHook(() => useFollowedSessionStates("ready"));
  expect(result.current.counts.running).toBe(2);
  act(() => useRequestUserInputStore.setState({ pendingRequests: [{ threadId: "grand", turnId: "child-turn", itemId: "q", requestId: "r", questions: [{ id: "one", question: "Continue?" }] }] }));
  expect(result.current.counts.running).toBe(1);
  expect(result.current.counts.pending).toBe(1);
  expect(result.current.questionCount).toBe(1);
  act(() => useCodexStore.getState().addEvent("b", { method: "turn/completed", params: { threadId: "b", turn: { id: "parent", status: "completed", items: [] } } } as any));
  expect(result.current.counts.pending).toBe(1);
});
it("known parent states do not imply complete aggregate counts when family discovery failed", () => {
  useSubagentStore.setState({ families: { b: { complete: false, checkedAt: 1, error: "offline" } } });
  const { result } = renderHook(() => useFollowedSessionStates("ready"));
  expect(result.current.rows.find(r => r.card.id === "b")?.state).toBe("idle");
  expect(result.current.complete).toBe(false);
});
it("counts only followed sessions and gives pending requests priority over running", () => {
  const { result } = renderHook(() => useFollowedSessionStates("ready"));
  expect(result.current.counts.running).toBe(1);
  act(() =>
    useApprovalStore.setState({
      pendingApprovals: [
        {
          type: "fileChange",
          requestId: 1,
          threadId: "b",
          turnId: "t",
          itemId: "i",
          reason: null,
          grantRoot: null,
          startedAtMs: 0,
        },
        {
          type: "fileChange",
          requestId: 2,
          threadId: "outside",
          turnId: "t",
          itemId: "i",
          reason: null,
          grantRoot: null,
          startedAtMs: 0,
        },
      ],
    }),
  );
  expect(result.current.counts.pending).toBe(1);
  expect(result.current.rows.map((r) => r.state)).toEqual([
    "running",
    "pending",
    "idle",
  ]);
  act(() =>
    usePermissionsStore.setState({
      pendingRequests: [
        {
          requestId: 3,
          threadId: "a",
          turnId: "t",
          itemId: "i",
          permissions: { network: null, fileSystem: null },
          reason: null,
          environmentId: null,
          startedAtMs: 0,
          cwd: "/a",
        },
      ],
    }),
  );
  expect(result.current.counts.running).toBe(0);
  expect(result.current.counts.pending).toBe(2);
});
it("keeps unknown and offline separate from a confirmed empty pending set", () => {
  useCodexStore.setState({ threadStatusMap: {}, threads: [] });
  const { result, rerender } = renderHook(
    ({ status }) => useFollowedSessionStates(status),
    { initialProps: { status: "ready" as "ready" | "offline" } },
  );
  expect(result.current.counts.unknown).toBe(2);
  expect(result.current.complete).toBe(false);
  rerender({ status: "offline" });
  expect(result.current.counts.unknown).toBe(3);
  expect(result.current.counts.idle).toBe(0);
});
it("updates unread and Claude permission state without opening or adding sessions", () => {
  const { result } = renderHook(() => useFollowedSessionStates("ready"));
  act(() =>
    useSessionAttentionStore.getState().complete("codex", "b", "reply"),
  );
  expect(result.current.rows.find((r) => r.card.id === "b")?.state).toBe(
    "unread",
  );
  act(() =>
    useCCStore.setState({
      sessionMessagesMap: {
        c: [{ type: "permission_request", resolved: false } as any],
      },
    }),
  );
  expect(result.current.rows.find((r) => r.card.id === "c")?.state).toBe(
    "pending",
  );
  expect(useAgentCenterStore.getState().cards).toHaveLength(3);
});
