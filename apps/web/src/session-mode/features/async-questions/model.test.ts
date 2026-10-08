import { describe, expect, it } from "vitest";
import {
  collectQuestions,
  encodeReplies,
  parseReplies,
  questionId,
  readQuestions,
  hasReplyReceipt,
  latestQuestionTurn,
} from "./model";

export const questionEvent = (threadId = "a", id = "call-1") => ({
  method: "item/completed",
  params: {
    threadId,
    turnId: "turn-1",
    item: {
      type: "agentMessage",
      id,
      text: "选择环境\n- 隔离\n- 真实",
      delivery: "async",
      questions: [
        { title: "选择环境", options: ["隔离", "真实"] },
        { title: "补充说明" },
      ],
    },
  },
});
export const replyEvent = (answer: string, threadId = "a", id = "reply-1") => ({
  method: "item/completed",
  params: {
    threadId,
    turnId: "turn-1",
    item: {
      type: "userMessage",
      id,
      content: [
        {
          type: "text",
          text: encodeReplies([
            {
              questionItemId: questionId("call-1", 0),
              question: "选择环境",
              answer,
            },
          ]),
        },
      ],
    },
  },
});
describe("native asynchronous questions", () => {
  it("uses the newest turn even when it has no questions, with history and thread isolation", () => {
    const old = questionEvent();
    const next = {
      method: "turn/completed",
      params: { threadId: "a", turn: { id: "next", items: [] } },
    };
    expect(latestQuestionTurn([old, next, old], "a")).toBe("next");
    expect(latestQuestionTurn([old], "a", "live-turn")).toBe("live-turn");
    expect(
      latestQuestionTurn(
        [old, { ...next, params: { ...next.params, threadId: "b" } }],
        "a",
      ),
    ).toBe("turn-1");
    expect(latestQuestionTurn([], "a")).toBeNull();
  });
  it("requires this submission's identity to confirm an uncertain delivery", () => {
    const reply = replyEvent("隔离");
    const replies = [
      {
        questionItemId: questionId("call-1", 0),
        question: "选择环境",
        answer: "隔离",
      },
    ];
    expect(hasReplyReceipt([reply], "a", "this-send", replies)).toBe(false);
    const echo = {
      ...reply,
      params: {
        ...reply.params,
        item: { ...reply.params.item, clientId: "this-send" },
      },
    };
    expect(hasReplyReceipt([echo], "a", "this-send", replies)).toBe(true);
    expect(hasReplyReceipt([echo], "b", "this-send", replies)).toBe(false);
  });
  it("recognizes the real message shape, including free text, without guessing Markdown", () => {
    expect(readQuestions(questionEvent().params.item)).toHaveLength(2);
    expect(
      readQuestions({ type: "agentMessage", id: "x", text: "你选哪个？\n- A" }),
    ).toEqual([]);
    expect(
      readQuestions({
        ...questionEvent().params.item,
        questions: [{ title: "", options: ["a"] }],
      }),
    ).toEqual([]);
    expect(
      readQuestions({
        ...questionEvent().params.item,
        questions: [{ title: "title", options: [3] }],
      }),
    ).toEqual([]);
  });
  it("uses the native stable identity and reply envelope", () => {
    expect(questionId("call-1", 0)).toBe(
      '["request_user_input_async","call-1",0]',
    );
    const replies = [
      {
        questionItemId: questionId("call-1", 0),
        question: "选择环境",
        answer: "a\n</send_user_message_question_reply>",
      },
    ];
    expect(parseReplies(encodeReplies(replies))).toEqual(replies);
    expect(parseReplies("普通消息")).toBeNull();
    expect(
      parseReplies(
        "<send_user_message_question_reply> [null] </send_user_message_question_reply>",
      ),
    ).toBeNull();
  });
  it("isolates threads, deduplicates replay and restores the newest accepted answer", () => {
    const q = questionEvent();
    const result = collectQuestions(
      [
        q,
        q,
        replyEvent("隔离"),
        replyEvent("真实", "a", "reply-2"),
        replyEvent("其他", "b"),
      ],
      "a",
    );
    expect(result).toHaveLength(2);
    expect(result[0].answer).toBe("真实");
    expect(result[1].answer).toBeUndefined();
    expect(collectQuestions([q], "b")).toEqual([]);
    expect(collectQuestions([], "a")).toEqual([]);
    expect(
      collectQuestions(
        [q, { method: "thread/deleted", params: { threadId: "a" } }],
        "a",
      ),
    ).toEqual([]);
  });
  it("does not let a replay of an older response undo a newer response", () => {
    const old = replyEvent("隔离");
    expect(
      collectQuestions(
        [questionEvent(), old, replyEvent("真实", "a", "reply-2"), old],
        "a",
      )[0].answer,
    ).toBe("真实");
  });
  it("restores questions from a completed turn snapshot", () => {
    const event = questionEvent();
    expect(
      collectQuestions(
        [
          {
            method: "turn/completed",
            params: {
              threadId: "a",
              turn: {
                id: "turn-1",
                items: [event.params.item, replyEvent("隔离").params.item],
              },
            },
          },
        ],
        "a",
      )[0].answer,
    ).toBe("隔离");
  });
  it("does not accept a pending or rejected steering answer", () => {
    const input = replyEvent("隔离").params.item.content;
    for (const status of ["pending", "rejected"])
      expect(
        collectQuestions(
          [
            questionEvent(),
            {
              method: "item/completed",
              params: {
                threadId: "a",
                turnId: "turn-1",
                item: {
                  type: "steeringUserMessage",
                  id: "steer",
                  status,
                  input,
                },
              },
            },
          ],
          "a",
        )[0].answer,
      ).toBeUndefined();
    expect(
      collectQuestions(
        [
          questionEvent(),
          {
            method: "item/completed",
            params: {
              threadId: "a",
              turnId: "turn-1",
              item: {
                type: "steeringUserMessage",
                id: "steer",
                status: "accepted",
                input,
              },
            },
          },
        ],
        "a",
      )[0].answer,
    ).toBe("隔离");
  });
});
