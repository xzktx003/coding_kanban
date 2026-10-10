import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import { RunningTurnChanges } from "./RunningTurnChanges";
import { useCodexStore } from "../stores/useCodexStore";
import { useSavedTurnReviewStore } from "@session/stores/useSavedTurnReviewStore";
const diff =
  "diff --git a/file.py b/file.py\n--- a/file.py\n+++ b/file.py\n@@ -115 +115,2 @@\n-old\n+new\n+more\n";
beforeEach(() => {
  useSavedTurnReviewStore.getState().close();
  useCodexStore.setState({
    threads: [{ id: "a", cwd: "/a", status: { type: "active" } }] as any,
    turnTimingMap: {
      a: {
        turnId: "turn",
        status: "inProgress",
        startedAtMs: 1,
        durationMs: null,
      },
    },
    events: {
      a: [
        {
          method: "turn/diff/updated",
          params: { threadId: "a", turnId: "turn", diff },
        },
      ],
    },
  });
});
it("running file count and changes open the same owner's saved diff above the detached composer", () => {
  const { container } = render(<RunningTurnChanges threadId="a" />);
  fireEvent.click(screen.getByRole("button", { name: /1 个文件已更改/ }));
  expect(useSavedTurnReviewStore.getState().target).toMatchObject({
    threadId: "a",
    turnId: "turn",
    cwd: "/a",
    batches: [],
    changes: [{ diff, addedCount: 2, removedCount: 1 }],
  });
  act(() =>
    useCodexStore.setState({
      turnTimingMap: {
        a: {
          turnId: "turn",
          status: "completed",
          startedAtMs: 1,
          durationMs: 20,
        },
      },
    }),
  );
  expect(container.childElementCount).toBe(0);
});
it("a foreign turn diff never appears as current running changes", () => {
  useCodexStore.setState({
    events: {
      a: [
        {
          method: "turn/diff/updated",
          params: { threadId: "b", turnId: "turn", diff },
        },
      ],
    },
  });
  expect(
    render(<RunningTurnChanges threadId="a" />).container.childElementCount,
  ).toBe(0);
});
