import { beforeEach, expect, it } from "vitest";
import { threadWorkflowActions, useThreadWorkflowActions } from "./actions";
beforeEach(() =>
  useThreadWorkflowActions.setState({ panels: {}, requests: {} }),
);
it("captures requested thread and atomically consumes exports once across duplicate views", () => {
  threadWorkflowActions.request("original", "export");
  const request = useThreadWorkflowActions.getState().requests.original;
  expect(request).toMatchObject({ threadId: "original", action: "export" });
  expect(useThreadWorkflowActions.getState().requests.other).toBeUndefined();
  expect(threadWorkflowActions.consume(request)).toBe(true);
  expect(threadWorkflowActions.consume(request)).toBe(false);
});
it("search panels are per thread; close is local and passive tab switching cannot focus an input", () => {
  threadWorkflowActions.request("original", "search");
  threadWorkflowActions.request("other", "users");
  expect(useThreadWorkflowActions.getState().panels).toEqual({
    original: "search",
    other: "users",
  });
  threadWorkflowActions.close("original");
  expect(useThreadWorkflowActions.getState().panels).toEqual({
    other: "users",
  });
});
