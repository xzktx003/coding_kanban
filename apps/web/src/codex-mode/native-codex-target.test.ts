import { beforeEach, expect, it } from "vitest";
import {
  matchesNativeCodexTarget,
  useNativeCodexTargetStore,
} from "./native-codex-target";

beforeEach(() => useNativeCodexTargetStore.getState().clear());

it("only routes a matching Session thread and project to the selected native column", () => {
  const target = {
    threadId: "019aabcd-1234-7890-abcd-0123456789ab",
    cwd: "/workspace/project",
    column: 2,
  };
  useNativeCodexTargetStore.getState().select(target);

  expect(
    matchesNativeCodexTarget(
      useNativeCodexTargetStore.getState().target,
      target.threadId,
      target.cwd,
    ),
  ).toBe(true);
  expect(matchesNativeCodexTarget(target, "another-thread", target.cwd)).toBe(
    false,
  );
  expect(
    matchesNativeCodexTarget(target, target.threadId, "/other/project"),
  ).toBe(false);
  expect(matchesNativeCodexTarget(null, target.threadId, target.cwd)).toBe(
    false,
  );
});

it("does not retain a native target after clearing it", () => {
  useNativeCodexTargetStore.getState().select({
    threadId: "019aabcd-1234-7890-abcd-0123456789ab",
    cwd: "/workspace/project",
    column: 1,
  });
  useNativeCodexTargetStore.getState().clear();
  expect(useNativeCodexTargetStore.getState().target).toBeNull();
});
