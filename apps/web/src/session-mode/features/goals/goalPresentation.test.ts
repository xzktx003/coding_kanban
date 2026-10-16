import { expect, it } from "vitest";
import type { ThreadGoal } from "@session/bindings/v2";
import {
  goalCounter,
  goalDuration,
  goalNextStatus,
  goalStrings,
  goalTextFromPrompt,
} from "./goalPresentation";

const goal: ThreadGoal = {
  threadId: "goal-owner",
  objective: "可衡量的成果",
  status: "active",
  tokenBudget: null,
  tokensUsed: 12500,
  timeUsedSeconds: 61,
  createdAt: 1,
  updatedAt: 100,
};

it("recognizes the native inline Goal command without treating a similar word as a command", () => {
  expect(goalTextFromPrompt(" /goal \n measurable outcome ")).toBe(
    "measurable outcome",
  );
  expect(goalTextFromPrompt("/goal")).toBe("");
  expect(goalTextFromPrompt("/goals outcome")).toBeNull();
  expect(goalTextFromPrompt("explain /goal outcome")).toBeNull();
});

it("uses all six VS Code goal summaries and the native resume boundary", () => {
  const zh = goalStrings("zh-CN");
  expect(Object.values(zh.status)).toEqual([
    "进行中的目标",
    "已暂停的目标",
    "目标已停滞",
    "目标使用受限",
    "目标受限",
    "已达成目标",
  ]);
  expect(
    [
      "active",
      "paused",
      "blocked",
      "usageLimited",
      "budgetLimited",
      "complete",
    ].map((status) => goalNextStatus(status as ThreadGoal["status"])),
  ).toEqual(["paused", "active", "active", "active", null, null]);
});

it("only advances elapsed time for an active goal and clamps a future timestamp", () => {
  expect(goalCounter(goal, 103_999, "en")).toBe("1m 4s");
  expect(goalCounter({ ...goal, status: "paused" }, 200_000, "en")).toBe(
    "1m 1s",
  );
  expect(goalCounter({ ...goal, timeUsedSeconds: 0 }, 99_000, "en")).toBe("0s");
  expect(goalDuration(86400_000 + 3600_000 + 60_000)).toBe("1d 1h 1m");
  expect(goalDuration(3600_000)).toBe("1h");
});

it("matches the native counter choice and Intl compact token formatting", () => {
  const budgeted = { ...goal, tokenBudget: 100000 };
  for (const locale of ["en", "zh-CN", "de", "ja"]) {
    const format = new Intl.NumberFormat(locale, {
      notation: "compact",
      maximumFractionDigits: 1,
    });
    const tokens = `${format.format(12500)} / ${format.format(100000)}`;
    expect(goalCounter(budgeted, 100_000, locale)).toBe(tokens);
    expect(
      goalCounter({ ...budgeted, status: "budgetLimited" }, 200_000, locale),
    ).toBe(tokens);
    for (const status of [
      "paused",
      "blocked",
      "usageLimited",
      "complete",
    ] as const)
      expect(goalCounter({ ...budgeted, status }, 200_000, locale)).toBe(
        "1m 1s",
      );
  }
});
