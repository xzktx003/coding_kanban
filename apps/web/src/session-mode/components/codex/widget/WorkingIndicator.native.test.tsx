import { render } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import { WorkingIndicator } from "./WorkingIndicator";
import { useCodexStore } from "../stores/useCodexStore";
beforeEach(() =>
  useCodexStore.setState({
    events: {},
    turnTimingMap: {},
    threadStatusMap: {},
  }),
);
it.each([undefined, NaN, Infinity, -1])(
  "unknown or invalid completed duration %s never displays a fake elapsed time",
  (durationMs) => {
    const { container } = render(
      <WorkingIndicator
        turnTiming={
          {
            turnId: "t",
            status: "completed",
            startedAtMs: 0,
            durationMs,
          } as any
        }
      />,
    );
    expect(container.childElementCount).toBe(0);
  },
);
it("a legacy completion missing duration preserves an earlier verified duration", () => {
  const event = (durationMs?: number) =>
    ({
      method: "turn/completed",
      params: {
        threadId: "a",
        turn: { id: "t", status: "completed", items: [], durationMs },
      },
    }) as any;
  useCodexStore.getState().addEvent("a", event(1200));
  useCodexStore.getState().addEvent("a", event());
  expect(useCodexStore.getState().turnTimingMap.a.durationMs).toBe(1200);
});
