import { expect, it } from "vitest";
import type { ServerNotification } from "@session/bindings";
import { normalizeQuestionEvents } from "./model";

it("restores questions at their original turn boundary rather than after newer replies", () => {
  const question = {
    id: "old-question",
    type: "agentMessage",
    text: "",
    questions: [{ title: "Old question" }],
  };
  const events = [
    {
      method: "turn/completed",
      params: {
        threadId: "root",
        turn: { id: "old", status: "completed", items: [question] },
      },
    },
    {
      method: "item/completed",
      params: {
        threadId: "root",
        turnId: "new",
        item: { id: "latest", type: "agentMessage", text: "Latest reply" },
      },
    },
  ] as ServerNotification[];
  const original = structuredClone(events);
  const normalized = normalizeQuestionEvents(events);
  expect(
    normalized
      .filter((e) => e.method === "item/completed")
      .map((e) => e.params.item.id),
  ).toEqual(["old-question", "latest"]);
  expect(normalizeQuestionEvents(normalized)).toEqual(normalized);
  expect(events).toEqual(original);
});
it("uses native snapshot item order inside a long partially retained turn", () => {
  const question = {
    id: "q",
    type: "agentMessage",
    text: "",
    questions: [{ title: "Earlier question" }],
  };
  const latest = { id: "latest", type: "agentMessage", text: "Latest reply" };
  const events = [
    {
      method: "item/completed",
      params: { threadId: "root", turnId: "same", item: latest },
    },
    {
      method: "turn/completed",
      params: {
        threadId: "root",
        turn: { id: "same", status: "inProgress", items: [question, latest] },
      },
    },
  ] as ServerNotification[];
  expect(
    normalizeQuestionEvents(events)
      .filter((e) => e.method === "item/completed")
      .map((e) => e.params.item.id),
  ).toEqual(["q", "latest"]);
});
