import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (s: string) => s }),
}));
import { useServerNotificationHandler } from "../../components/codex/hooks/useServerNotificationHandler";
import { useCodexStore } from "../../components/codex/stores/useCodexStore";
import { useAgentSettingsStore } from "../../stores/useAgentSettingsStore";
import { useAcpStore } from "../../stores/useAcpStore";
import { useLayoutStore } from "../../stores/useLayoutStore";
import { QuestionComposer } from "./QuestionComposer";
import { useAsyncQuestionStore } from "./store";
const question = (id = "q", threadId = "a", turnId = "t") =>
  ({
    method: "item/completed",
    params: {
      threadId,
      turnId,
      completedAtMs: 1,
      item: {
        type: "agentMessage",
        id,
        text: "问题",
        questions: [{ title: "选择环境", options: ["隔离", "真实"] }],
      },
    },
  }) as any;
function handler() {
  return renderHook(() =>
    useServerNotificationHandler(
      {
        isCodexThreadActiveRef: { current: true },
        taskCompleteBeepModeRef: { current: "never" },
        preventSleepDuringTasksRef: { current: false },
      },
      async () => {},
    ),
  ).result;
}
beforeEach(() => {
  useCodexStore.setState({
    currentThreadId: "a",
    currentTurnId: "t",
    historyLoadedMap: { a: true },
    events: { a: [] },
    turnTimingMap: {
      a: {
        turnId: "t",
        status: "inProgress",
        startedAtMs: 1,
        durationMs: null,
      },
    },
  });
  useAsyncQuestionStore.setState({ sessions: {} });
  useAgentSettingsStore.setState({ selectedAgent: "codex" });
  useAcpStore.setState({ active: false });
  useLayoutStore.setState({ view: "agent" });
});
afterEach(cleanup);
it("automatically opens a live current-turn question, once; collapse and stream replay never reopen it", () => {
  const receive = handler();
  render(
    <div className="session-mode">
      <QuestionComposer threadId="a">
        <div>普通输入区</div>
      </QuestionComposer>
    </div>,
  );
  act(() => receive.current(question()));
  expect(screen.getByRole("region", { name: "回答 Codex 问题" })).toBeTruthy();
  expect(
    screen.getAllByRole("radio").every((r) => !(r as HTMLInputElement).checked),
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "收起" }));
  act(() => receive.current(question()));
  expect(screen.queryByRole("region")).toBeNull();
  expect(screen.getByText("普通输入区")).toBeTruthy();
  act(() => useCodexStore.setState({ events: { a: [] } }));
  act(() => receive.current(question()));
  expect(screen.queryByRole("region")).toBeNull();
  act(() => receive.current(question("second")));
  expect(screen.getByRole("region")).toBeTruthy();
});
it("does not replace the question being answered with a later batch", () => {
  const receive = handler();
  act(() => receive.current(question()));
  act(() => receive.current(question("second")));
  expect(useAsyncQuestionStore.getState().sessions.a.openId).toContain('"q"');
});
it("keeps the panel passive during initial history loading and while another agent is selected", () => {
  const receive = handler();
  useCodexStore.setState({ historyLoadedMap: {} });
  act(() => receive.current(question("loading")));
  expect(useAsyncQuestionStore.getState().sessions.a?.openId).toBeUndefined();
  useCodexStore.setState({ historyLoadedMap: { a: true } });
  useAgentSettingsStore.setState({ selectedAgent: "cc" });
  act(() => receive.current(question("claude-visible")));
  expect(useAsyncQuestionStore.getState().sessions.a?.openId).toBeUndefined();
});
it("does not auto-open historical hydration, an old turn, another session, or a hidden mode", () => {
  const receive = handler();
  render(
    <div className="session-mode">
      <QuestionComposer threadId="a">
        <div>普通输入区</div>
      </QuestionComposer>
    </div>,
  );
  act(() => useCodexStore.setState({ events: { a: [question()] } }));
  act(() => receive.current(question()));
  act(() => receive.current(question("old", "a", "old-turn")));
  act(() => receive.current(question("other", "b")));
  expect(screen.queryByRole("region")).toBeNull();
  document.querySelector<HTMLElement>(".session-mode")!.hidden = true;
  act(() => receive.current(question("hidden")));
  expect(useAsyncQuestionStore.getState().sessions.a?.openId).toBeUndefined();
});
