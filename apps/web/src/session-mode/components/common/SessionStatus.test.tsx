import { render, screen, act } from "@testing-library/react";
import { beforeEach, expect, test } from "vitest";
import { SessionStatus } from "./SessionStatus";
import { useCodexStore } from "../codex/stores";
import { useSessionAttentionStore } from "../../stores/useSessionAttentionStore";
beforeEach(() => {
  useCodexStore.setState({ threadStatusMap: {}, turnTimingMap: {} });
  useSessionAttentionStore.setState({ receipts: {} });
});
test("ordinary list rows have no dot; only unread and exceptional states get a trailing marker", () => {
  const { container } = render(<SessionStatus kind="codex" id="a" compact />);
  expect(container.childElementCount).toBe(0);
  act(() =>
    useCodexStore.setState({
      threadStatusMap: { a: { type: "active", activeFlags: [] } },
    }),
  );
  expect(screen.getByLabelText("运行中")).toBeTruthy();
  expect(container.querySelector(".session-status-spin")).toBeTruthy();
  expect(container.querySelector(".session-status-dot")).toBeNull();
  act(() => useCodexStore.setState({ threadStatusMap: {} }));
  act(() =>
    useSessionAttentionStore.getState().complete("codex", "a", "reply"),
  );
  expect(screen.getByRole("img", { name: "有新的回复未读" })).toBeTruthy();
  act(() => useSessionAttentionStore.getState().read("codex", "a", "reply"));
  expect(container.childElementCount).toBe(0);
  act(() =>
    useCodexStore.setState({
      threadStatusMap: {
        a: { type: "active", activeFlags: ["waitingOnApproval"] },
      },
    }),
  );
  expect(screen.getByRole("img", { name: "待处理" })).toBeTruthy();
});
