import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@session/services", () => ({}));
import { useApprovalStore } from "../stores/useApprovalStore";
import { useElicitationStore } from "../stores/useElicitationStore";
import { usePermissionsStore } from "../stores/usePermissionsStore";
import { useRequestUserInputStore } from "../stores/useRequestUserInputStore";
import { useServerNotificationHandler } from "./useServerNotificationHandler";

beforeEach(() => {
  useApprovalStore.setState({ pendingApprovals: [], currentApproval: null });
  useElicitationStore.setState({ pendingRequests: [] });
  usePermissionsStore.setState({ pendingRequests: [] });
  useRequestUserInputStore.setState({
    pendingRequests: [],
    currentRequest: null,
    drafts: {},
  });
});
it("clears resolved prompts for every interaction kind, without disturbing another thread", () => {
  const props = { threadId: "a", requestId: 1, turnId: "turn", itemId: "item" };
  useApprovalStore.setState({
    pendingApprovals: [
      { ...props, type: "fileChange" },
      { ...props, threadId: "b" },
    ] as any,
  });
  useElicitationStore.setState({
    pendingRequests: [props, { ...props, threadId: "b" }] as any,
  });
  usePermissionsStore.setState({
    pendingRequests: [props, { ...props, threadId: "b" }] as any,
  });
  useRequestUserInputStore.getState().addRequest({ ...props, questions: [] });
  useRequestUserInputStore
    .getState()
    .addRequest({ ...props, threadId: "b", questions: [] });
  const { result } = renderHook(() =>
    useServerNotificationHandler(
      {
        isCodexThreadActiveRef: { current: true },
        taskCompleteBeepModeRef: { current: "never" },
        preventSleepDuringTasksRef: { current: false },
      },
      async () => {},
    ),
  );
  act(() =>
    result.current({
      method: "serverRequest/resolved",
      params: { threadId: "a", requestId: 1 },
    }),
  );
  for (const pending of [
    useApprovalStore.getState().pendingApprovals,
    useElicitationStore.getState().pendingRequests,
    usePermissionsStore.getState().pendingRequests,
    useRequestUserInputStore.getState().pendingRequests,
  ]) {
    expect(pending.map((r) => r.threadId)).toEqual(["b"]);
  }
});
