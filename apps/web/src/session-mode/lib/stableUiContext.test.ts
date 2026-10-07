import { expect, it, vi } from "vitest";
import { stableUiContext } from "./stableUiContext";
it("keeps provider identity across hot module evaluations without sharing unrelated contexts", () => {
  const data: Record<string, unknown> = {},
    create = vi.fn(() => ({ identity: Symbol() }));
  const before = stableUiContext("sidebar", create, data),
    after = stableUiContext("sidebar", create, data);
  expect(after).toBe(before);
  expect(create).toHaveBeenCalledOnce();
  expect(stableUiContext("another", create, data)).not.toBe(before);
});
it("keeps independently loaded production contexts isolated", () => {
  const create = () => ({ identity: Symbol() });
  expect(stableUiContext("sidebar", create)).not.toBe(
    stableUiContext("sidebar", create),
  );
  expect(stableUiContext("sidebar", create, {})).not.toBe(
    stableUiContext("sidebar", create, {}),
  );
});
