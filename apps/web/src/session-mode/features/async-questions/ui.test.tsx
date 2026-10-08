import {
  act,
  fireEvent,
  render,
  screen,
  cleanup,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({
  turnSteer: vi.fn(),
  turnStart: vi.fn(),
  loadThreadHistory: vi.fn(),
}));
vi.mock("../../services/codexService", () => ({ codexService: api }));
vi.mock("../../hooks/useSessionTabs", () => ({
  useSessionTabActions: () => ({ selectTab: vi.fn() }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (s: string) => s }),
}));
import { EventItem } from "../../components/codex/items/EventItem";
import { useCodexStore } from "../../components/codex/stores/useCodexStore";
import { useAsyncQuestionStore } from "./store";
import { QuestionComposer } from "./QuestionComposer";
const event = {
  method: "item/completed",
  params: {
    threadId: "a",
    turnId: "t",
    item: {
      type: "agentMessage",
      id: "q",
      text: "选择环境\n- 隔离",
      questions: [
        { title: "选择环境", options: ["隔离", "真实"] },
        { title: "补充" },
      ],
    },
  },
} as any;
beforeEach(() => {
  vi.clearAllMocks();
  useCodexStore.setState({
    currentThreadId: "a",
    events: { a: [event] },
    turnTimingMap: {
      a: {
        turnId: "t",
        status: "inProgress",
        durationMs: null,
        startedAtMs: 1,
      },
    },
    threadStatusMap: {},
  });
  useAsyncQuestionStore.setState({ sessions: {} });
});
afterEach(cleanup);
it("stops reminding about old questions when a new turn starts, while keeping history", () => {
  render(
    <>
      <EventItem event={event} />
      <QuestionComposer threadId="a">
        <div>ordinary composer</div>
      </QuestionComposer>
    </>,
  );
  expect(
    screen.getByRole("button", { name: /有 2 个问题待回答/ }),
  ).toBeTruthy();
  act(() =>
    useCodexStore.getState().addEvent("a", {
      method: "turn/started",
      params: {
        threadId: "a",
        turn: { id: "new-turn", status: "inProgress", items: [] },
      },
    } as any),
  );
  expect(
    screen.queryByRole("button", { name: /有 .* 个问题待回答/ }),
  ).toBeNull();
  expect(screen.getByText("选择环境")).toBeTruthy();
  act(() =>
    useCodexStore.getState().addEvent("a", {
      ...event,
      params: {
        ...event.params,
        turnId: "new-turn",
        item: {
          ...event.params.item,
          id: "new-question",
          questions: [{ title: "新问题" }],
        },
      },
    }),
  );
  expect(
    screen.getByRole("button", { name: /有 1 个问题待回答/ }),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /有 1 个问题待回答/ }));
  expect(
    screen.getByRole("region", { name: "回答 Codex 问题" }).textContent,
  ).toContain("新问题");
});
it("keeps the latest completed turn answerable until a subsequent turn starts", () => {
  act(() =>
    useCodexStore.setState({
      turnTimingMap: {
        a: { turnId: "t", status: "completed", startedAtMs: 1, durationMs: 1 },
      },
    }),
  );
  render(
    <QuestionComposer threadId="a">
      <div>ordinary composer</div>
    </QuestionComposer>,
  );
  expect(
    screen.getByRole("button", { name: /有 2 个问题待回答/ }),
  ).toBeTruthy();
});
it("renders structured async questions as an answer entry, not a Markdown-only message", () => {
  render(<EventItem event={event} />);
  expect(screen.getByRole("button", { name: "回答问题" })).toBeTruthy();
  expect(screen.getByText("选择环境")).toBeTruthy();
});
it("opens on demand, never preselects or submits on selection, and preserves drafts when collapsed", async () => {
  render(
    <QuestionComposer threadId="a">
      <div>ordinary composer</div>
    </QuestionComposer>,
  );
  expect(screen.queryByRole("region")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /有 2 个问题待回答/ }));
  expect(
    screen.getAllByRole("radio").every((r) => !(r as HTMLInputElement).checked),
  ).toBe(true);
  fireEvent.click(screen.getByRole("radio", { name: "隔离" }));
  expect(api.turnSteer).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "下一题" }));
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "保留草稿" },
  });
  fireEvent.click(screen.getByRole("button", { name: "收起" }));
  expect(screen.getByText("ordinary composer")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /有 2 个问题待回答/ }));
  expect(
    (screen.getByRole("radio", { name: "隔离" }) as HTMLInputElement).checked,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "下一题" }));
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
    "保留草稿",
  );
  fireEvent.click(screen.getByRole("button", { name: "提交回答" }));
  await waitFor(() => expect(api.turnSteer).toHaveBeenCalledTimes(1));
  expect(api.turnStart).not.toHaveBeenCalled();
});
it("skipping all questions sends nothing; switching threads never exposes the other draft", () => {
  const view = render(
    <QuestionComposer threadId="a">
      <div>ordinary composer</div>
    </QuestionComposer>,
  );
  fireEvent.click(screen.getByRole("button", { name: /有 2 个问题待回答/ }));
  fireEvent.click(screen.getByRole("button", { name: "跳过" }));
  fireEvent.click(screen.getByRole("button", { name: "跳过" }));
  expect(screen.queryByRole("region")).toBeNull();
  expect(screen.queryByRole("button", { name: /待回答/ })).toBeNull();
  view.rerender(
    <QuestionComposer threadId="b">
      <div>other composer</div>
    </QuestionComposer>,
  );
  expect(screen.getByText("other composer")).toBeTruthy();
  expect(api.turnSteer).not.toHaveBeenCalled();
});
it("marks remote answer changes without overwriting edits and closes removed questions", () => {
  render(
    <QuestionComposer threadId="a">
      <div>ordinary composer</div>
    </QuestionComposer>,
  );
  fireEvent.click(screen.getByRole("button", { name: /有 2 个问题待回答/ }));
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "本地编辑" },
  });
  act(() =>
    useCodexStore.getState().addEvent("a", {
      method: "item/completed",
      params: {
        threadId: "a",
        turnId: "t",
        completedAtMs: 1,
        item: {
          type: "userMessage",
          id: "remote",
          clientId: null,
          content: [
            {
              type: "text",
              text: '<send_user_message_question_reply>\n[{"questionItemId":"[\\"request_user_input_async\\",\\"q\\",0]","question":"选择环境","answer":"真实"}]\n</send_user_message_question_reply>',
              text_elements: [],
            },
          ],
        },
      },
    }),
  );
  expect(screen.getByRole("status").textContent).toContain("已有新回答");
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
    "本地编辑",
  );
  act(() => useCodexStore.setState({ events: { a: [] } }));
  expect(screen.queryByRole("region")).toBeNull();
});

it("compact question overlay preserves the original editor node and returns its draft unchanged", () => {
  render(
    <QuestionComposer compact threadId="a">
      <textarea aria-label="original draft" defaultValue="keep this draft" />
    </QuestionComposer>,
  );
  const input = screen.getByRole("textbox", { name: "original draft" });
  const questions = [
    {
      id: '["request_user_input_async","q",0]',
      sourceId: "q",
      title: "选择环境",
      options: ["隔离", "真实"],
      threadId: "a",
      turnId: "t",
    },
    {
      id: '["request_user_input_async","q",1]',
      sourceId: "q",
      title: "补充",
      options: [],
      threadId: "a",
      turnId: "t",
    },
  ];
  act(() =>
    useAsyncQuestionStore.getState().open("a", questions, questions[0].id),
  );
  expect(screen.getByRole("region", { name: "回答 Codex 问题" })).toBeTruthy();
  expect(input.closest("[inert]")).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "收起" }));
  expect(screen.getByRole("textbox", { name: "original draft" })).toBe(input);
  expect((input as HTMLTextAreaElement).value).toBe("keep this draft");
  expect(input.closest("[inert]")).toBeNull();
  expect(api.turnSteer).not.toHaveBeenCalled();
  expect(api.turnStart).not.toHaveBeenCalled();
});
