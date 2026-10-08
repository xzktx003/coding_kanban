import { expect, it } from "vitest";
import { pendingFamilies } from "./pending";
it("groups child requests by followed parent and deduplicates complete identities", () => {
  const nodes: any = {
    a: { thread: { id: "a" }, parentId: "root" },
    b: { thread: { id: "b" }, parentId: "a" },
  };
  const a = { threadId: "a", requestId: 1, turnId: "ta", itemId: "ia" };
  const b = { threadId: "b", requestId: 1, turnId: "tb", itemId: "ib" };
  const group = pendingFamilies(
    nodes,
    ["root", "other"],
    [a, a, b, { ...a, threadId: "foreign" }],
  );
  expect(group).toEqual([{ root: "root", requests: [a, b] }]);
});
