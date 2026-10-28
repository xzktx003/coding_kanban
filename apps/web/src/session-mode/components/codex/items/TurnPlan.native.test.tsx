import { render } from "@testing-library/react";
import { expect, it } from "vitest";
import { TurnPlan } from "./TurnPlan";

/**
 * Codex 26.51007.21434 renders a plan step in `sites-end-resource-733bd1c6da06.js`
 * as `flex items-start gap-2` holding exactly two columns:
 *
 *   <div className="flex flex-shrink-0 items-start gap-0.5">
 *     <StatusGlyph status=… />
 *     <span className="text-size-chat leading-4">{index}.</span>   // `{index}.`
 *   </div>
 *   <span className={cn("text-size-chat flex-1 leading-4",
 *                       status === "completed" && "line-through")}>{step}</span>
 *
 * So the step number is a plain `N.` text prefix beside the glyph — not a digit
 * printed inside the glyph — and a completed step is marked by `line-through`
 * alone, with no per-status recolouring or font-weight change.
 *
 * `TurnPlanStep` is `{ step, status }` with no identity field, so two steps may
 * carry identical text; keying rows by that text makes React reuse the wrong row
 * when one of them changes status.
 */
const steps = [
  { step: "读取配置", status: "completed" as const },
  { step: "运行测试", status: "inProgress" as const },
  { step: "读取配置", status: "pending" as const },
];

it("numbers plan steps with the official text prefix", () => {
  const view = render(<TurnPlan plan={steps} explanation={null} />);
  const prefixes = Array.from(
    view.container.querySelectorAll("[data-plan-step-index]"),
  ).map((node) => node.textContent);
  expect(prefixes).toEqual(["1.", "2.", "3."]);
});

it("marks only completed steps, by strikethrough alone", () => {
  const view = render(<TurnPlan plan={steps} explanation={null} />);
  const labels = Array.from(
    view.container.querySelectorAll("[data-plan-step-label]"),
  );
  expect(labels.map((n) => n.textContent)).toEqual([
    "读取配置",
    "运行测试",
    "读取配置",
  ]);
  expect(labels.map((n) => n.className.includes("line-through"))).toEqual([
    true,
    false,
    false,
  ]);
  // Official keeps one text style for every status; colour must not encode it.
  for (const label of labels) {
    expect(label.className).not.toContain("text-muted-foreground");
    expect(label.className).not.toContain("font-semibold");
  }
});

it("keeps duplicate step text on distinct rows", () => {
  const view = render(<TurnPlan plan={steps} explanation={null} />);
  // Two steps read "读取配置"; both must survive as separate rows.
  expect(view.container.querySelectorAll("[data-plan-step]").length).toBe(3);
});

it("uses theme tokens rather than hardcoded palette colours", () => {
  const view = render(<TurnPlan plan={steps} explanation={null} />);
  const markup = view.container.innerHTML;
  // emerald-500/blue-600 ignore the host VS Code theme the tokens mirror.
  expect(markup).not.toContain("emerald-500");
  expect(markup).not.toContain("blue-600");
});
