import { beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({
  turnSteer: vi.fn(),
  turnStart: vi.fn(),
  threadResume: vi.fn(),
}));
vi.mock("../../services/codexService", () => ({ codexService: api }));
import { useCodexStore } from "../../components/codex/stores/useCodexStore";
import { useAsyncQuestionStore } from "./store";
import { collectQuestions, encodeReplies, questionId } from "./model";
import { sendAnswers, reconcileAnswers } from "./service";
import { SessionApiError } from "../../services/apiAdapt/shared";
const q = {
  method: "item/completed",
  params: {
    threadId: "a",
    turnId: "t",
    item: {
      type: "agentMessage",
      id: "q",
      text: "选择",
      questions: [{ title: "选择", options: ["A", "B"] }],
    },
  },
} as any;
const timing = {
  turnId: "t",
  status: "inProgress",
  startedAtMs: 1,
  durationMs: null,
} as const;
beforeEach(() => {
  vi.resetAllMocks();
  useCodexStore.setState({
    events: { a: [q] },
    currentThreadId: "a",
    turnTimingMap: { a: timing },
    threadStatusMap: {},
  });
  useAsyncQuestionStore.setState({ sessions: {} });
  const questions = collectQuestions([q], "a");
  useAsyncQuestionStore.getState().open("a", questions);
  useAsyncQuestionStore.getState().edit("a", questions[0], "A");
});
it("steers the captured thread once and never clears another session's drafts", async () => {
  let resolve!: () => void;
  api.turnSteer.mockImplementation(
    () =>
      new Promise<void>((r) => {
        resolve = r;
      }),
  );
  const a = sendAnswers("a", "q", "t");
  await sendAnswers("a", "q", "t");
  useCodexStore.setState({ currentThreadId: "b" });
  useAsyncQuestionStore.getState().patch("b", { error: "keep" });
  resolve();
  await a;
  expect(api.turnSteer).toHaveBeenCalledTimes(1);
  expect(api.turnSteer.mock.calls[0].slice(0, 2)).toEqual(["a", "t"]);
  expect(api.turnStart).not.toHaveBeenCalled();
  expect(useAsyncQuestionStore.getState().sessions.b.error).toBe("keep");
});
it("requires a fresh explicit continue after the original turn ends", async () => {
  useCodexStore.setState({
    turnTimingMap: { a: { ...timing, status: "completed" } },
  });
  await sendAnswers("a", "q", "t");
  expect(api.turnStart).not.toHaveBeenCalled();
  expect(api.turnSteer).not.toHaveBeenCalled();
  await sendAnswers("a", "q", null);
  expect(api.turnStart).toHaveBeenCalledTimes(1);
});
it("does not retry an unknown delivery; reconciles its actual echo before unlocking", async () => {
  api.turnSteer.mockRejectedValue(new TypeError("Failed to fetch"));
  await sendAnswers("a", "q", "t");
  await sendAnswers("a", "q", "t");
  expect(api.turnSteer).toHaveBeenCalledTimes(1);
  expect(useAsyncQuestionStore.getState().sessions.a.uncertain).toHaveLength(1);
  api.threadResume.mockImplementation(async () => {
    useCodexStore.getState().addEvent("a", {
      method: "item/completed",
      params: {
        threadId: "a",
        turnId: "t",
        completedAtMs: 1,
        item: {
          type: "userMessage",
          id: "r",
          clientId:
            useAsyncQuestionStore.getState().sessions.a.uncertainClientId ??
            null,
          content: [
            {
              type: "text",
              text: encodeReplies([
                {
                  questionItemId: questionId("q", 0),
                  question: "选择",
                  answer: "A",
                },
              ]),
              text_elements: [],
            },
          ],
        },
      },
    });
  });
  await reconcileAnswers("a");
  expect(useAsyncQuestionStore.getState().sessions.a.uncertain).toBeUndefined();
  expect(api.turnSteer).toHaveBeenCalledTimes(1);
});
it("does not send removed questions after a rollback", async () => {
  useCodexStore.setState({ events: { a: [] } });
  await sendAnswers("a", "q", "t");
  expect(api.turnSteer).not.toHaveBeenCalled();
});
it("keeps retry available after a native JSON-RPC rejection wrapped in HTTP 500, without auto-continuing", async () => {
  api.turnSteer.mockRejectedValueOnce(
    new SessionApiError(
      'Request failed: {"code":-32600,"message":"turn is no longer active"}',
      500,
    ),
  );
  await sendAnswers("a", "q", "t");
  expect(useAsyncQuestionStore.getState().sessions.a.uncertain).toBeUndefined();
  expect(useAsyncQuestionStore.getState().sessions.a.error).toContain(
    "回答未发送",
  );
  expect(api.turnStart).not.toHaveBeenCalled();
  api.turnSteer.mockResolvedValueOnce({ turnId: "t" });
  await sendAnswers("a", "q", "t");
  expect(api.turnSteer).toHaveBeenCalledTimes(2);
});
