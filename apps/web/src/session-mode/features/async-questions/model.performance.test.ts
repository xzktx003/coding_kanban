import { expect, test, vi } from "vitest";
import { latestQuestionTurn } from "./model";

test("unchanged history is indexed once across status and composer consumers", () => {
  const iterator = vi.fn(function* () {
    for (let i = 0; i < 10000; i++)
      yield {
        method: "item/completed",
        params: { threadId: "a", turnId: `turn-${i}` },
      };
  });
  const history: readonly unknown[] = Object.assign([], {
    [Symbol.iterator]: iterator,
  });
  for (let i = 0; i < 30; i++)
    expect(latestQuestionTurn(history, "a")).toBe("turn-9999");
  expect(iterator).toHaveBeenCalledOnce();
  expect(latestQuestionTurn(history, "a", "native-current")).toBe(
    "native-current",
  );
  expect(iterator).toHaveBeenCalledOnce();
});

test("a new immutable snapshot updates the index without letting old-turn replay retire the latest", () => {
  const first = {
    method: "item/completed",
    params: { threadId: "a", turnId: "old" },
  };
  const initial = [first];
  expect(latestQuestionTurn(initial, "a")).toBe("old");
  const next = [
    ...initial,
    { method: "turn/started", params: { threadId: "a", turn: { id: "new" } } },
    first,
  ];
  expect(latestQuestionTurn(next, "a")).toBe("new");
  expect(latestQuestionTurn(initial, "a")).toBe("old");
});
