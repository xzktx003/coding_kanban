import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { goalStrings } from "@session/features/goals/goalPresentation";
import { goalDrafts, useGoalDraft } from "./goalDrafts";

function ClearGoal({ owner }: { owner: string }) {
  const { enabled, setEnabled } = useGoalDraft(owner);
  return enabled ? <button type="button" aria-label={goalStrings("zh-CN").cancelDraft} onClick={() => setEnabled(false)}>目标</button> : null;
}

it("clears only the current Chinese goal draft", () => {
  const current = "goal-clear:" + crypto.randomUUID();
  const other = "goal-other:" + crypto.randomUUID();
  goalDrafts.set(current, true);
  goalDrafts.set(other, true);
  render(<><ClearGoal owner={current} /><ClearGoal owner={other} /></>);
  fireEvent.click(screen.getAllByRole("button", { name: "清除目标" })[0]);
  expect(goalDrafts.read(current).enabled).toBe(false);
  expect(goalDrafts.read(other).enabled).toBe(true);
});
