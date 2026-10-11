import { expect, it } from "vitest";
import { stepReasoningEffort } from "./cycleReasoningEffort";

const options = ["low", "medium", "high"] as const;

it("cycles through catalog efforts and wraps", () => {
  expect(stepReasoningEffort([...options], "medium", 1, true)).toBe("high");
  expect(stepReasoningEffort([...options], "high", 1, true)).toBe("low");
});

it("raises and lowers without passing the ends", () => {
  expect(stepReasoningEffort([...options], "high", 1, false)).toBe("high");
  expect(stepReasoningEffort([...options], "low", -1, false)).toBe("low");
  expect(stepReasoningEffort([...options], "medium", -1, false)).toBe("low");
});
