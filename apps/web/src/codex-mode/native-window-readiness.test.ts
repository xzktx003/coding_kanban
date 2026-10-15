import { expect, it } from "vitest";
import { isNativeWindowReady } from "./native-window-readiness";
const id = "019aabcd-1234-7890-abcd-000000000003";
const rendered = {
  ready: true,
  conversationId: null,
  hasComposer: true,
  composerEmpty: true,
  userInteracted: false,
};
it("does not accept a blank or different thread as the requested history", () => {
  expect(isNativeWindowReady(id, rendered)).toBe(false);
  expect(
    isNativeWindowReady(id, {
      ...rendered,
      conversationId: id.replace(/3$/, "4"),
    }),
  ).toBe(false);
  expect(isNativeWindowReady(id, { ...rendered, conversationId: id })).toBe(
    true,
  );
});
it("keeps native onboarding visible without claiming an input composer exists", () => {
  expect(isNativeWindowReady(id, { ...rendered, hasComposer: false, onboarding: true })).toBe(true);
  expect(isNativeWindowReady(id, { ...rendered, onboarding: true })).toBe(false);
  expect(isNativeWindowReady(id, { ...rendered, hasComposer: false, onboarding: true, conversationId: id.replace(/3$/, "4") })).toBe(false);
  expect(
    isNativeWindowReady(`new:${id}`, { ...rendered, hasComposer: false }),
  ).toBe(true);
  expect(isNativeWindowReady(`new:${id}`, { ...rendered, ready: false })).toBe(
    false,
  );
});
