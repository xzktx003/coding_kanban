import { expect, it } from "vitest";
import {
  cleanMarkdown,
  exportThreadMarkdown,
  findThreadMatches,
  makeThreadUrl,
  readThreadLink,
  captureTurnSource,
} from "./model";
import type { WorkflowMessage } from "./model";
const rows: WorkflowMessage[] = [
  {
    rowId: "row:u",
    itemId: "u",
    turnId: "t1",
    role: "user",
    text: "Search café 中文",
  },
  {
    rowId: "row:a",
    itemId: "a",
    turnId: "t1",
    role: "assistant",
    text: "Result `café` citeturn2search0",
    completed: true,
  },
  {
    rowId: "row:p",
    itemId: "p",
    turnId: "t2",
    role: "plan",
    text: "# Plan\n\n- Search again",
    completed: true,
  },
  {
    rowId: "row:s",
    itemId: "s",
    turnId: "t2",
    role: "summary",
    text: "Public summary",
    completed: true,
  },
  {
    rowId: "row:pending",
    itemId: "pending",
    turnId: "t3",
    role: "assistant",
    text: "Partial answer",
    completed: false,
  },
];
it("search uses stable message anchors, all matches and literal case-insensitive Unicode text", () => {
  expect(
    findThreadMatches(rows, "CAFÉ").map((m) => [
      m.rowId,
      m.itemId,
      m.turnId,
      m.offset,
    ]),
  ).toEqual([
    ["row:u", "u", "t1", 7],
    ["row:a", "a", "t1", 8],
  ]);
  expect(findThreadMatches(rows, "[")).toEqual([]);
  expect(
    findThreadMatches([{ ...rows[0], text: "one ONE one" }], "one"),
  ).toHaveLength(3);
  expect(findThreadMatches(rows, " ")).toEqual([]);
});
it("native search includes visible users and completed final replies, excluding plan, summary and live/commentary output", () => {
  const sources = rows.map((row) => ({ ...row, text: "same" }));
  sources.push({
    ...sources[1],
    rowId: "commentary",
    phase: "commentary",
  } as WorkflowMessage);
  expect(
    findThreadMatches(sources, "same").map((match) => [
      match.rowId,
      match.occurrence,
    ]),
  ).toEqual([
    ["row:u", 0],
    ["row:a", 0],
  ]);
  expect(
    findThreadMatches([{ ...rows[0], text: "same SAME same" }], "same").map(
      (match) => match.occurrence,
    ),
  ).toEqual([0, 1, 2]);
});
it("malformed or conflicting turn links fail rather than silently opening another boundary", () => {
  for (const query of [
    "turn=",
    "turn=%00",
    "turn=" + "x".repeat(513),
    "turn=a&turn=b",
    "thread=a&thread=b",
  ])
    expect(
      readThreadLink("https://lan.invalid/?mode=session&thread=a&" + query),
    ).toBeNull();
});
it("exports source Markdown with no UI controls, citation tokens, raw reasoning or incomplete answer", () => {
  const md = exportThreadMarkdown(rows, "Review #1");
  expect(md).toContain("# Review #1\n");
  expect(md).toContain("## User\n\nSearch café 中文");
  expect(md).toContain("Result `café`");
  expect(md).toContain("# Plan\n\n- Search again");
  expect(md).not.toMatch(/Copy|引用|Public summary|Partial answer|cite/);
  expect(
    cleanMarkdown(
      "before\r\n\r\n<oai-mem-citation>\nprivate\n</oai-mem-citation>\n",
    ),
  ).toBe("before");
  expect(
    cleanMarkdown("```html\n<oai-mem-citation>literal</oai-mem-citation>\n```"),
  ).toContain("literal");
});
it("copy thread link keeps origin and path without propagating unrelated query params or credentials", () => {
  const url = makeThreadUrl(
    "https://user:secret@lan.example:8443/?token=secret&mode=terminal#old",
    "thread /中文",
    "t2",
  );
  expect(url).toBe(
    "https://lan.example:8443/?mode=session&thread=thread+%2F%E4%B8%AD%E6%96%87&turn=t2",
  );
  expect(readThreadLink(url)).toEqual({
    threadId: "thread /中文",
    turnId: "t2",
  });
  expect(
    readThreadLink("https://lan.example/?mode=terminal&thread=x"),
  ).toBeNull();
});
it("captures immutable chosen completed turn for an explicit native action", () => {
  const source = captureTurnSource("thread", rows[1]);
  expect(Object.isFrozen(source)).toBe(true);
  expect(source).toMatchObject({
    threadId: "thread",
    turnId: "t1",
    rowId: "row:a",
  });
  expect(() => captureTurnSource("thread", rows[4])).toThrow(/完成/);
});
