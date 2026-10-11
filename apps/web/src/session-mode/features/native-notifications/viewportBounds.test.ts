import { expect, it } from "vitest";
import { createViewportBounds } from "./viewportBounds";
it("keeps original registration order when updating an earlier boundary and restores it on remove", () => {
  const state = createViewportBounds();
  const a = { top: 10, left: 20, right: 30, bottom: 40 };
  const b = { top: 50, left: 60, right: 70, bottom: 80 };
  state.boundary("a", a);
  state.boundary("b", b);
  state.boundary("a", { ...a, top: 11 });
  expect(state.getSnapshot().bounds).toBe(b);
  state.boundary("b", null);
  expect(state.getSnapshot().bounds).toEqual({ ...a, top: 11 });
  state.boundary("a", null);
  expect(state.getSnapshot()).toEqual({ bounds: null });
});
it("does not notify unchanged geometry or unknown removals", () => {
  const state = createViewportBounds();
  let updates = 0;
  const stop = state.subscribe(() => updates++);
  const bounds = { top: 10, left: 20, right: 30, bottom: 40 };
  state.boundary("scope", bounds);
  const before = updates;
  state.boundary("scope", { ...bounds });
  state.boundary("absent", null);
  expect(updates).toBe(before);
  state.boundary("scope", null);
  expect(updates).toBe(before + 1);
  stop();
});
