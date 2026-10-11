import { describe, expect, it } from "vitest";
import type { SubagentNode } from "./model";
import { backgroundAgentRows, backgroundAgentSummary } from "./backgroundSummary";

const node = (id: string, parentId: string, status: string): SubagentNode =>
  ({
    thread: {
      id,
      name: id,
      preview: "",
      parentThreadId: parentId,
      status: { type: status },
      model: "fixture-model",
      turns: [],
    },
    parentId,
    verified: true,
    revision: 1,
  }) as SubagentNode;

describe("background agent summary", () => {
  it("lists only descendants of the open thread", () => {
    const rows = backgroundAgentRows(
      {
        child: node("child", "root", "idle"),
        other: node("other", "elsewhere", "idle"),
      },
      "root",
      {},
    );
    expect(rows).toEqual([
      {
        id: "child",
        title: "child",
        state: "waiting",
        label: "正在等待指示",
        model: "fixture-model",
      },
    ]);
    expect(backgroundAgentSummary(2)).toBe("2 个后台智能体");
    expect(backgroundAgentRows({}, null, {})).toEqual([]);
  });
});
