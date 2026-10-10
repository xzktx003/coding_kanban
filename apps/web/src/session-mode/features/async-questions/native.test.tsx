import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({
  turnStart: vi.fn(),
  turnSteer: vi.fn(),
  loadThreadHistory: vi.fn(),
}));
vi.mock("../../services/codexService", () => ({ codexService: api }));
import { useCodexStore } from "../../components/codex/stores/useCodexStore";
import { useAsyncQuestionStore } from "./store";
import { collectQuestions } from "./model";
import { QuestionComposer } from "./QuestionComposer";
import { sendAnswers } from "./service";
const event = (turnId = "t") =>
  ({
    method: "item/completed",
    params: {
      threadId: "a",
      turnId,
      item: {
        type: "agentMessage",
        id: "same-source",
        text: "",
        questions: [
          { title: "Choose", options: ["A", "B"] },
          { title: "Details" },
        ],
      },
    },
  }) as any;
beforeEach(() => {
  vi.clearAllMocks();
  useAsyncQuestionStore.setState({ sessions: {} });
  useCodexStore.setState({
    currentThreadId: "a",
    events: { a: [event()] },
    currentTurnId: "t",
    turnTimingMap: {
      a: {
        turnId: "t",
        status: "inProgress",
        startedAtMs: 1,
        durationMs: null,
      },
    },
    threadStatusMap: {},
  });
});
it("retires an already opened question when a later turn starts and refuses sending its draft", async () => {
  const questions = collectQuestions([event()], "a");
  useAsyncQuestionStore.getState().open("a", questions);
  useAsyncQuestionStore.getState().edit("a", questions[0], "A");
  render(
    <QuestionComposer threadId="a">
      <div>original composer</div>
    </QuestionComposer>,
  );
  expect(screen.getByRole("region")).toBeTruthy();
  act(() =>
    useCodexStore.setState({
      currentTurnId: "new",
      turnTimingMap: {
        a: {
          turnId: "new",
          status: "inProgress",
          startedAtMs: 2,
          durationMs: null,
        },
      },
    }),
  );
  expect(screen.queryByRole("region")).toBeNull();
  await sendAnswers("a", "same-source", "new");
  expect(api.turnSteer).not.toHaveBeenCalled();
});
it("new source instances with a repeated source id cannot inherit another turn's answers", () => {
  const old = collectQuestions([event()], "a");
  const store = useAsyncQuestionStore.getState();
  store.open("a", old);
  store.edit("a", old[0], "old draft");
  const next = collectQuestions([event("new")], "a");
  store.open("a", next);
  expect(
    useAsyncQuestionStore.getState().sessions.a.drafts[next[0].id].text,
  ).toBe("");
});
it("an old in-flight answer cannot overwrite a new source instance draft or close its panel", async () => {
  let resolve!: () => void;
  api.turnSteer.mockImplementation(
    () =>
      new Promise<void>((r) => {
        resolve = r;
      }),
  );
  const old = collectQuestions([event()], "a");
  const store = useAsyncQuestionStore.getState();
  store.open("a", old);
  store.edit("a", old[0], "old submitted");
  const sent = sendAnswers("a", "same-source", "t", "t");
  useCodexStore.setState({
    events: { a: [event("new")] },
    currentTurnId: "new",
    turnTimingMap: {
      a: {
        turnId: "new",
        status: "inProgress",
        startedAtMs: 2,
        durationMs: null,
      },
    },
  });
  const next = collectQuestions([event("new")], "a");
  store.open("a", next);
  store.edit("a", next[0], "new draft");
  resolve();
  await sent;
  expect(
    useAsyncQuestionStore.getState().sessions.a.drafts[next[0].id].text,
  ).toBe("new draft");
  expect(useAsyncQuestionStore.getState().sessions.a.openId).toBe(next[0].id);
});
it("uses native numbered choices and delayed navigation, while Escape only closes", async () => {
  const questions = collectQuestions([event()], "a");
  useAsyncQuestionStore.getState().open("a", questions);
  render(
    <QuestionComposer threadId="a">
      <div>original composer</div>
    </QuestionComposer>,
  );
  fireEvent.keyDown(screen.getByRole("region"), { key: "2" });
  await new Promise((r) => setTimeout(r, 200));
  expect(screen.getByText("Details")).toBeTruthy();
  fireEvent.keyDown(screen.getByRole("region"), { key: "Escape" });
  expect(screen.queryByRole("region")).toBeNull();
  expect(api.turnSteer).not.toHaveBeenCalled();
});
