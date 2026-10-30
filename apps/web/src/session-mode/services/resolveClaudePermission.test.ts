import { expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock("./apiAdapt/cc", () => ({ ccResolvePermission: api.resolve }));
import { resolveClaudePermission } from "./resolveClaudePermission";
import { useCCStore } from "../stores/cc";
it("an approval response after switching sessions patches the captured request only", async () => {
  let release!: () => void;
  api.resolve.mockImplementation(
    () => new Promise<void>((resolve) => (release = resolve)),
  );
  const first = {
    type: "permission_request" as const,
    requestId: "first",
    sessionId: "a",
    toolName: "Bash",
    toolInput: {},
    executionId: "turn-a",
    recoveryRuntimeInstance: "runtime",
  };
  const second = {
    ...first,
    requestId: "second",
    sessionId: "b",
    executionId: "turn-b",
  };
  useCCStore.setState({
    activeSessionId: "a",
    messages: [first],
    sessionMessagesMap: { a: [first], b: [second] },
  });
  const pending = resolveClaudePermission("first", "allow");
  useCCStore.getState().switchToSession("b");
  release();
  await pending;
  expect(useCCStore.getState().messages[0]).toEqual(second);
  expect(useCCStore.getState().sessionMessagesMap.a[0]).toMatchObject({
    requestId: "first",
    resolved: "allow",
  });
});
