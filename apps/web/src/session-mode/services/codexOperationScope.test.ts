import { expect, it } from "vitest";
import {
  captureCodexOperationScope,
  isCodexOperationScopeCurrent,
} from "./codexOperationScope";
import { useCodexStore } from "../components/codex/stores/useCodexStore";
import { resetGoalCompletionScope } from "./goalCompletionAutoClear";
it("revokes a same-valued account notification without a codexService coordinator", () => {
  const scope = captureCodexOperationScope();
  resetGoalCompletionScope();
  expect(isCodexOperationScopeCurrent(scope)).toBe(false);
});
it("an account ABA transition cannot revalidate a previous operation", () => {
  useCodexStore.setState({ accountNamespace: "operation-scope-a" });
  const scope = captureCodexOperationScope();
  useCodexStore.setState({ accountNamespace: "operation-scope-b" });
  useCodexStore.setState({ accountNamespace: "operation-scope-a" });
  expect(isCodexOperationScopeCurrent(scope)).toBe(false);
});
it("runtime notifications revoke captures without changing current account fields", () => {
  const scope = captureCodexOperationScope();
  window.dispatchEvent(new Event("session-runtime-restarted"));
  expect(isCodexOperationScopeCurrent(scope)).toBe(false);
});
