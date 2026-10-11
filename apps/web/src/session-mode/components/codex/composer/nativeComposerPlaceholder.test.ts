import { expect, it } from "vitest";
import { nativeComposerPlaceholder } from "./nativeComposerPlaceholder";

it("uses native local task and follow-up placeholders", () => {
  expect(nativeComposerPlaceholder({ threadId: null })).toBe(
    "可向 Codex 询问任何问题。输入 @ 使用插件或提及文件",
  );
  expect(nativeComposerPlaceholder({ threadId: "existing" })).toBe(
    "提出后续变更要求",
  );
});

it("keeps goal and plan modes explicit ahead of the local follow-up", () => {
  expect(nativeComposerPlaceholder({ threadId: "existing", plan: true })).toBe(
    "描述你的任务以生成计划…",
  );
  expect(
    nativeComposerPlaceholder({ threadId: "existing", plan: true, goal: true }),
  ).toBe("描述你的目标，定义可衡量的成果，以获得最佳效果");
});

it("uses a selected empty local thread as a follow-up without timing metadata", () => {
  expect(nativeComposerPlaceholder({ threadId: "existing-empty" })).toBe(
    "提出后续变更要求",
  );
});
