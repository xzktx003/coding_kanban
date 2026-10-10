import { expect, it } from "vitest";
import {
  nativeDynamicToolLabel,
  nativeDynamicToolCompletedSummaryKey,
} from "./nativeDynamicToolSemantics";
it("uses the original default tool-name fallback and actual completed-specific aliases", () => {
  expect(
    nativeDynamicToolLabel({
      tool: "inspect_repository",
      status: "inProgress",
    }),
  ).toBe("Inspect repository");
  expect(
    nativeDynamicToolLabel({
      namespace: "functions",
      tool: "automation_update",
      status: "completed",
    }),
  ).toBe("Scheduled task updated");
  expect(
    nativeDynamicToolLabel({
      namespace: "functions",
      tool: "automation_update",
      status: "inProgress",
    }),
  ).toBe("Updating scheduled task");
});
it("uses native completed and following states for first-party success and failure", () => {
  const item = {
    namespace: "codex_app",
    tool: "create_thread",
    status: "completed",
  };
  expect(nativeDynamicToolLabel(item, "en")).toBe("Created chat");
  expect(nativeDynamicToolLabel(item, "en", false)).toBe("created chat");
  expect(nativeDynamicToolLabel({ ...item, success: false }, "en")).toBe(
    "Couldn’t create chat",
  );
  expect(nativeDynamicToolLabel({ ...item, success: false }, "en", false)).toBe(
    "couldn’t create chat",
  );
  expect(nativeDynamicToolLabel(item, "zh", false)).toBe("已创建聊天");
  expect(
    nativeDynamicToolLabel({ ...item, status: "inProgress" }, "en", false),
  ).toBe("Creating chat");
});
it("honors native Ft's null namespace descriptor fallback without granting target capabilities", () => {
  for (const namespace of [null, undefined]) {
    const item = { namespace, tool: "read_thread", status: "completed" };
    expect(nativeDynamicToolLabel(item, "en")).toBe("Read chat");
    expect(nativeDynamicToolLabel(item, "en", false)).toBe("read chat");
  }
});
it("keeps native foreign-tool following wording without a first-party alias", () => {
  expect(
    nativeDynamicToolLabel(
      { namespace: "functions", tool: "read_thread", status: "completed" },
      "en",
      false,
    ),
  ).toBe("read thread");
  expect(
    nativeDynamicToolLabel(
      {
        namespace: "functions",
        tool: "automation_update",
        status: "completed",
      },
      "en",
      false,
    ),
  ).toBe("scheduled task updated");
  expect(
    nativeDynamicToolLabel(
      {
        namespace: "functions",
        tool: "read_thread_terminal",
        status: "completed",
      },
      "en",
      false,
    ),
  ).toBe("read chat terminal");
  expect(
    nativeDynamicToolLabel(
      { tool: "pia_slackbot_dm", status: "completed" },
      "en",
      false,
    ),
  ).toBe("Pia Slackbot DM");
});
it("keys completed summaries by namespace and actual native presentation state", () => {
  const item = {
    namespace: "codex_app",
    tool: "read_thread",
    status: "completed",
    arguments: { threadId: "a" },
  };
  expect(nativeDynamicToolCompletedSummaryKey(item)).toBe(
    "codex_app:read_thread::read_thread:completed",
  );
  expect(
    nativeDynamicToolCompletedSummaryKey({
      ...item,
      arguments: { threadId: "b" },
    }),
  ).toBe(nativeDynamicToolCompletedSummaryKey(item));
  expect(
    nativeDynamicToolCompletedSummaryKey({ ...item, success: false }),
  ).toBe("codex_app:read_thread::read_thread:failed");
  expect(
    nativeDynamicToolCompletedSummaryKey({ ...item, namespace: "functions" }),
  ).toBe("functions:read_thread::");
  expect(
    nativeDynamicToolCompletedSummaryKey({ ...item, namespace: null }),
  ).toBe("null:read_thread::read_thread:completed");
});
it("preserves native archive, pin, sidebar, and pending worktree presentation keys", () => {
  const item = { namespace: "codex_app", status: "completed" };
  expect(
    nativeDynamicToolCompletedSummaryKey({
      ...item,
      tool: "set_thread_archived",
      arguments: { archived: false },
    }),
  ).toBe("codex_app:set_thread_archived::restore_chat:completed");
  expect(
    nativeDynamicToolCompletedSummaryKey({
      ...item,
      tool: "set_thread_pinned",
      arguments: { pinned: false },
    }),
  ).toBe("codex_app:set_thread_pinned::unpin_chat:completed");
  expect(
    nativeDynamicToolCompletedSummaryKey({
      ...item,
      tool: "move_thread_to_sidebar_section",
      arguments: { sectionId: "pinned" },
    }),
  ).toBe("codex_app:move_thread_to_sidebar_section::pin_chat:completed");
  expect(
    nativeDynamicToolCompletedSummaryKey({
      ...item,
      tool: "move_project_to_sidebar_section",
      arguments: { sectionId: null },
    }),
  ).toBe("codex_app:move_project_to_sidebar_section::unpin_project:completed");
  expect(
    nativeDynamicToolCompletedSummaryKey({
      ...item,
      tool: "create_worktree",
      contentItems: [{ type: "inputText", text: '{"type":"pending"}' }],
    }),
  ).toBe("codex_app:create_worktree::create_worktree:pending");
  expect(
    nativeDynamicToolCompletedSummaryKey({
      ...item,
      tool: "write_settings",
      arguments: { config: {} },
    }),
  ).toBe("codex_app:write_settings::write_settings:completed");
});
it("uses only original schema-valid handoff identities rather than guessing targets", () => {
  const item = {
    namespace: "codex_app",
    status: "completed",
    tool: "handoff_thread",
  };
  expect(
    nativeDynamicToolCompletedSummaryKey({
      ...item,
      arguments: { threadId: "a", destinationHostId: "remote" },
    }),
  ).toBe('codex_app:handoff_thread:["a","remote"]:handoff_thread:completed');
  expect(
    nativeDynamicToolCompletedSummaryKey({
      ...item,
      arguments: { threadId: "a", destinationHostId: "" },
    }),
  ).toBe("codex_app:handoff_thread::handoff_thread:completed");
  expect(
    nativeDynamicToolCompletedSummaryKey({
      ...item,
      tool: "get_handoff_status",
      arguments: { operationId: "op-1" },
    }),
  ).toBe("codex_app:get_handoff_status:op-1:get_handoff_status:completed");
  expect(
    nativeDynamicToolCompletedSummaryKey({
      ...item,
      namespace: "foreign",
      arguments: { threadId: "a" },
    }),
  ).toBe("foreign:handoff_thread::");
});
