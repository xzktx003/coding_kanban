import { projectCodexChatValue } from "@agent-orchestrator/shared";
import { expect, it } from "vitest";
import { nativeDynamicToolTarget } from "./nativeDynamicToolTarget";
const base = {
  namespace: "codex_app",
  tool: "create_thread",
  status: "completed",
  success: true,
  arguments: { threadId: "wrong" },
  contentItems: [
    {
      type: "inputText",
      text: '{"kind":"codex","threadId":" child ","hostId":"local"}',
    },
  ],
};
it("uses the original first public text result for successful completed creation and never guesses from input arguments", () => {
  expect(nativeDynamicToolTarget(base)).toEqual({
    kind: "codex",
    threadId: "child",
    hostId: "local",
  });
  expect(nativeDynamicToolTarget({ ...base, status: "inProgress" })).toBeNull();
  expect(nativeDynamicToolTarget({ ...base, success: null })).toBeNull();
  expect(nativeDynamicToolTarget({ ...base, success: false })).toBeNull();
  expect(
    nativeDynamicToolTarget({
      ...base,
      contentItems: [
        { type: "inputText", text: "invalid" },
        base.contentItems[0],
      ],
    }),
  ).toBeNull();
  expect(
    nativeDynamicToolTarget({ ...base, namespace: "functions" }),
  ).toBeNull();
});
it("retains actual native foreign-host and ChatGPT identity for truthful unavailable routing", () => {
  expect(
    nativeDynamicToolTarget({
      ...base,
      contentItems: [
        { type: "inputText", text: '{"kind":"chatgpt","threadId":"remote"}' },
      ],
    }),
  ).toEqual({ kind: "chatgpt", threadId: "remote" });
  expect(
    nativeDynamicToolTarget({
      ...base,
      contentItems: [
        { type: "inputText", text: '{"threadId":"child","hostId":"other"}' },
      ],
    }),
  ).toEqual({ kind: "codex", threadId: "child", hostId: "other" });
  expect(
    nativeDynamicToolTarget({
      ...base,
      contentItems: [
        { type: "inputText", text: '{"kind":"other","threadId":"child"}' },
      ],
    }),
  ).toBeNull();
});
it("accepts actual read/send target arguments during execution while rejecting other tools or invalid identity", () => {
  for (const tool of ["read_thread", "send_message_to_thread"]) {
    expect(
      nativeDynamicToolTarget({
        ...base,
        tool,
        status: "inProgress",
        success: null,
        arguments: { threadId: "target" },
      }),
    ).toEqual({ kind: "codex", threadId: "target" });
    expect(
      nativeDynamicToolTarget({ ...base, tool, arguments: { threadId: "" } }),
    ).toBeNull();
    expect(
      nativeDynamicToolTarget({
        ...base,
        tool,
        arguments: { threadId: "target\nother" },
      }),
    ).toBeNull();
  }
  expect(
    nativeDynamicToolTarget({ ...base, tool: "set_thread_title" }),
  ).toBeNull();
});


it("retains only verified creation target metadata after raw result projection", () => {
  const original = { ...base, type: "dynamicToolCall", id: "created", arguments: { threadId: "wrong", text: "private argument" },
    contentItems: [{ type: "inputText", text: JSON.stringify({ kind: "codex", threadId: " child ", hostId: "local", privateOutput: "private output" }) }],
  };
  const projected = projectCodexChatValue(original) as any;
  expect(nativeDynamicToolTarget(projected)).toEqual({ kind: "codex", threadId: "child", hostId: "local" });
  expect(projected.contentItems).toEqual([]);
  expect(projected.arguments).toBeNull();
  expect(JSON.stringify(projected)).not.toContain("private output");
  expect(JSON.stringify(projected)).not.toContain("private argument");
  expect(projectCodexChatValue(projected)).toBe(projected);
  const restored = JSON.parse(JSON.stringify(projected));
  expect(projectCodexChatValue(restored)).toBe(restored);
  expect(nativeDynamicToolTarget(restored)).toEqual({ kind: "codex", threadId: "child", hostId: "local" });
  for (const invalid of [
    { ...original, success: false },
    { ...original, status: "inProgress" },
    { ...original, contentItems: [{ type: "inputText", text: "invalid" }] },
    { ...original, contentItems: [{ type: "inputText", text: "x".repeat(65537) }] },
    { ...original, contentItems: [{ type: "inputText", text: '{"kind":"other","threadId":"child"}' }] },
    { ...original, contentItems: [{ type: "inputText", text: '{"threadId":"bad\\nchild"}' }] },
  ]) expect(nativeDynamicToolTarget(projectCodexChatValue(invalid))).toBeNull();
});
