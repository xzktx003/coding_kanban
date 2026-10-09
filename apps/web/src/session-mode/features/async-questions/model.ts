import type { ServerNotification } from "../../bindings";
/** Compatibility boundary for newer native items; generated bindings stay untouched. */
export type Question = {
  id: string;
  sourceId: string;
  turnId: string;
  title: string;
  options: string[];
  answer?: string;
};
export type Reply = {
  questionItemId: string;
  question: string;
  answer: string;
};
const START = "<send_user_message_question_reply>";
const END = "</send_user_message_question_reply>";
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
// Event snapshots are immutable. Status summaries and composers share this
// index, so selection/bookkeeping changes never rescan a long transcript.
const latestTurnCache = new WeakMap<
  readonly unknown[],
  Map<string, string | null>
>();

/** Timing wins over late history; on cold reads use the ordered turn history.
 * A finished latest turn is still answerable, but starting the next turn retires
 * its reminders. This does not remove historical questions or their answers. */
export function latestQuestionTurn(
  events: readonly unknown[],
  threadId: string,
  knownTurnId?: string | null,
): string | null {
  if (knownTurnId) return knownTurnId;
  const cached = latestTurnCache.get(events);
  if (cached?.has(threadId)) return cached.get(threadId)!;
  const seen = new Set<string>();
  let latest: string | null = null;
  for (const value of events) {
    const event = record(value),
      params = record(event?.params);
    if (params?.threadId !== threadId) continue;
    const id =
      event?.method === "turn/started" || event?.method === "turn/completed"
        ? record(params.turn)?.id
        : params.turnId;
    if (typeof id === "string" && !seen.has(id)) {
      seen.add(id);
      latest = id;
    }
  }
  const byThread = cached ?? new Map<string, string | null>();
  byThread.set(threadId, latest);
  latestTurnCache.set(events, byThread);
  return latest;
}
export const questionId = (sourceId: string, index: number) =>
  JSON.stringify(["request_user_input_async", sourceId, index]);

export function readQuestions(value: unknown): Omit<Question, "turnId">[] {
  const item = record(value);
  if (
    item?.type !== "agentMessage" ||
    typeof item.id !== "string" ||
    !Array.isArray(item.questions)
  )
    return [];
  const result: Omit<Question, "turnId">[] = [];
  for (const [index, value] of item.questions.entries()) {
    const q = record(value);
    if (
      !q ||
      typeof q.title !== "string" ||
      !q.title.trim() ||
      (q.options != null &&
        (!Array.isArray(q.options) ||
          !q.options.every((o) => typeof o === "string" && o.trim())))
    )
      return [];
    result.push({
      id: questionId(item.id, index),
      sourceId: item.id,
      title: q.title,
      options: (q.options ?? []) as string[],
    });
  }
  return result;
}
export function encodeReplies(replies: Reply[]): string {
  return `${START}\n${JSON.stringify(replies)}\n${END}`;
}
export function parseReplies(text: string): Reply[] | null {
  text = text.trim();
  if (!text.startsWith(START) || !text.endsWith(END)) return null;
  try {
    const parsed: unknown = JSON.parse(text.slice(START.length, -END.length));
    const values = Array.isArray(parsed) ? parsed : [parsed];
    if (
      !values.length ||
      !values.every((v) => {
        const r = record(v);
        return (
          r &&
          typeof r.questionItemId === "string" &&
          typeof r.question === "string" &&
          typeof r.answer === "string"
        );
      })
    )
      return null;
    return values as Reply[];
  } catch {
    return null;
  }
}
export function repliesFromContent(content: unknown): Reply[] | null {
  if (!Array.isArray(content) || content.length !== 1) return null;
  const part = record(content[0]);
  return part?.type === "text" && typeof part.text === "string"
    ? parseReplies(part.text)
    : null;
}

/** Match this exact submission, not an older identical answer or another device. */
export function hasReplyReceipt(
  events: readonly unknown[],
  threadId: string,
  clientId: string,
  replies: Reply[],
): boolean {
  const matches = (value: unknown) => {
    const item = record(value);
    if (
      !item ||
      !(
        (item.type === "userMessage" && item.clientId === clientId) ||
        (item.type === "steeringUserMessage" &&
          item.status === "accepted" &&
          item.clientUserMessageId === clientId)
      )
    )
      return false;
    const accepted = repliesFromContent(
      item.type === "userMessage" ? item.content : item.input,
    );
    return (
      !!accepted &&
      replies.every((r) =>
        accepted.some(
          (a) => a.questionItemId === r.questionItemId && a.answer === r.answer,
        ),
      )
    );
  };
  return events.some((value) => {
    const event = record(value),
      params = record(event?.params);
    if (params?.threadId !== threadId) return false;
    if (event?.method === "item/started" || event?.method === "item/completed")
      return matches(params.item);
    const turn = record(params.turn);
    return (
      event?.method === "turn/completed" &&
      Array.isArray(turn?.items) &&
      turn.items.some(matches)
    );
  });
}

const cache = new WeakMap<readonly unknown[], Map<string, Question[]>>();
export function collectQuestions(
  events: readonly unknown[],
  threadId: string,
): Question[] {
  const cached = cache.get(events)?.get(threadId);
  if (cached) return cached;
  const items = new Map<
    string,
    { item: Record<string, unknown>; turnId: string }
  >();
  const put = (value: unknown, turnId: unknown) => {
    const item = record(value);
    if (!item || typeof item.id !== "string" || typeof turnId !== "string")
      return;
    items.set(JSON.stringify([turnId, item.type, item.id]), { item, turnId });
  };
  for (const value of events) {
    const e = record(value),
      p = record(e?.params);
    if (p?.threadId !== threadId) continue;
    if (e?.method === "thread/deleted") {
      items.clear();
      break;
    }
    if (e?.method === "item/started" || e?.method === "item/completed")
      put(p.item, p.turnId);
    if (e?.method === "turn/completed") {
      const turn = record(p.turn);
      if (Array.isArray(turn?.items))
        for (const item of turn.items) put(item, turn.id);
    }
  }
  const questions = new Map<string, Question>();
  for (const { item, turnId } of items.values())
    for (const q of readQuestions(item)) questions.set(q.id, { ...q, turnId });
  for (const { item } of items.values()) {
    if (
      item.type !== "userMessage" &&
      !(item.type === "steeringUserMessage" && item.status === "accepted")
    )
      continue;
    for (const reply of repliesFromContent(
      item.type === "userMessage" ? item.content : item.input,
    ) ?? []) {
      const q = questions.get(reply.questionItemId);
      if (q && reply.answer.trim()) q.answer = reply.answer;
    }
  }
  const result = [...questions.values()];
  const byThread = cache.get(events) ?? new Map<string, Question[]>();
  byThread.set(threadId, result);
  cache.set(events, byThread);
  return result;
}

/** Replace fallback streamed text with one completed structured question. */
export function normalizeQuestionEvents(
  events: ServerNotification[],
): ServerNotification[] {
  const key = (thread: unknown, turn: unknown, item: unknown) =>
    JSON.stringify([thread, turn, item]);
  const structured = new Map<string, ServerNotification>();
  for (const e of events) {
    if (e.method === "item/completed" && readQuestions(e.params.item).length)
      structured.set(
        key(e.params.threadId, e.params.turnId, e.params.item.id),
        e,
      );
  }
  const extras: ServerNotification[] = [];
  for (const e of events)
    if (e.method === "turn/completed") {
      for (const item of e.params.turn.items)
        if (readQuestions(item).length) {
          const id = key(e.params.threadId, e.params.turn.id, item.id);
          if (!structured.has(id)) {
            const completed: ServerNotification = {
              method: "item/completed",
              params: {
                threadId: e.params.threadId,
                turnId: e.params.turn.id,
                item,
                completedAtMs: 0,
              },
            };
            structured.set(id, completed);
            extras.push(completed);
          }
        }
    }
  if (!structured.size) return events;
  const seen = new Set<string>();
  return [...events, ...extras].filter((e) => {
    if (e.method === "item/agentMessage/delta")
      return !structured.has(
        key(e.params.threadId, e.params.turnId, e.params.itemId),
      );
    if (e.method === "item/completed") {
      const id = key(e.params.threadId, e.params.turnId, e.params.item.id);
      if (structured.has(id)) {
        if (seen.has(id)) return false;
        seen.add(id);
      }
    }
    return true;
  });
}
