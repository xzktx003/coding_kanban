import { projectCodexChatValue } from "@agent-orchestrator/shared";
import { beforeEach, expect, it } from "vitest";
import type { ServerNotification } from "@session/bindings";
import { buildThreadRows } from "@session/components/codex/thread/threadRows";
import { useCodexStore } from "@session/components/codex/stores/useCodexStore";
import {
  isToolTranscriptEvent,
  withoutToolTranscriptEvents,
} from "./codexTranscriptVisibility";

const event = (method: string, params: unknown = {}): ServerNotification =>
  ({ method, params }) as ServerNotification;

const turn = (items: unknown[], status = "completed") => ({
  id: "turn",
  items,
  itemsView: { type: "complete" },
  status,
  error: null,
  startedAt: 1,
  completedAt: 2,
  durationMs: 1,
});

const thread = (turns: unknown[]) => ({
  id: "thread",
  extra: null,
  sessionId: "session",
  forkedFromId: null,
  parentThreadId: null,
  preview: "run it",
  ephemeral: false,
  isPinned: false,
  historyMode: "full",
  modelProvider: "openai",
  createdAt: 1,
  updatedAt: 2,
  recencyAt: 2,
  status: { type: "idle" },
  path: null,
  cwd: "/repo",
  cliVersion: "test",
  source: "codex",
  canAcceptDirectInput: true,
  threadSource: null,
  agentNickname: null,
  agentRole: null,
  gitInfo: null,
  name: null,
  turns,
});

const itemEvent = (
  method: "item/started" | "item/completed",
  item: unknown,
): ServerNotification =>
  event(method, { threadId: "thread", turnId: "turn", item });

const userMessage = {
  type: "userMessage",
  id: "user",
  clientId: "client",
  content: [{ type: "text", text: "run it", text_elements: [] }],
};

const agentMessage = {
  type: "agentMessage",
  id: "answer",
  text: "done",
  phase: null,
  memoryCitation: null,
};

const reasoning = {
  type: "reasoning",
  id: "reasoning",
  summary: ["checked"],
  content: ["details"],
};

const plan = { type: "plan", id: "plan", text: "1. Test\n2. Fix" };

const commandExecution = {
  type: "commandExecution",
  id: "cmd",
  pluginId: null,
  scriptPath: null,
  command: "pnpm test",
  cwd: "/tmp/project",
  processId: null,
  source: "model",
  status: "completed",
  commandActions: [{ type: "unknown", command: "pnpm test" }],
  aggregatedOutput: "large output",
  exitCode: 0,
  durationMs: 10,
};

const fileChange = {
  type: "fileChange",
  id: "patch",
  changes: [{ path: "app.ts", kind: "update" }],
  status: "applied",
};

const mcpToolCall = {
  type: "mcpToolCall",
  id: "mcp",
  server: "github",
  tool: "search",
  status: "completed",
  arguments: { q: "memory leak" },
  appContext: null,
  pluginId: null,
  result: { content: "large result" },
  error: null,
  durationMs: 10,
};

const dynamicToolCall = {
  type: "dynamicToolCall",
  id: "dynamic",
  namespace: "web",
  tool: "open",
  arguments: { ref_id: "page" },
  status: "completed",
  contentItems: [{ type: "text", text: "large result" }],
  success: true,
  durationMs: 10,
};

const collabAgentToolCall = {
  type: "collabAgentToolCall",
  id: "collab",
  tool: "spawn_agent",
  status: "completed",
  senderThreadId: "thread",
  receiverThreadIds: ["child"],
  prompt: "inspect",
  model: null,
  reasoningEffort: null,
  agentsStates: {},
};

const subAgentActivity = {
  type: "subAgentActivity",
  id: "subagent",
  kind: "message",
  agentThreadId: "child",
  agentPath: "/root/child",
};

const webSearch = {
  type: "webSearch",
  id: "web",
  query: "codex memory",
  status: "completed",
};

const imageGeneration = {
  type: "imageGeneration",
  id: "image",
  prompt: "diagram",
  status: "completed",
};

beforeEach(() =>
  useCodexStore.setState({
    events: {},
    streamingAgentMessages: {},
    commandStatusMap: {},
    commandDurationMap: {},
    turnTimingMap: {},
    currentTurnId: null,
  }),
);

it("classifies tool transcript events while preserving chat, reasoning, warnings, errors and turn lifecycle", () => {
  const hidden = [
    itemEvent("item/started", commandExecution),
    itemEvent("item/completed", fileChange),
    itemEvent("item/completed", mcpToolCall),
    itemEvent("item/completed", dynamicToolCall),
    itemEvent("item/completed", webSearch),
    itemEvent("item/completed", imageGeneration),
    itemEvent("item/completed", collabAgentToolCall),
    itemEvent("item/completed", subAgentActivity),
    event("item/commandExecution/outputDelta", {
      threadId: "thread",
      turnId: "turn",
      itemId: "cmd",
      delta: "chunk",
    }),
    event("item/fileChange/outputDelta", {
      threadId: "thread",
      turnId: "turn",
      itemId: "patch",
      delta: "patch",
    }),
    event("item/fileChange/patchUpdated", {
      threadId: "thread",
      turnId: "turn",
      itemId: "patch",
      patch: "diff",
    }),
    event("item/mcpToolCall/progress", {
      threadId: "thread",
      turnId: "turn",
      itemId: "mcp",
      message: "working",
    }),
    event("turn/diff/updated", {
      threadId: "thread",
      turnId: "turn",
      diff: "diff",
    }),
  ];

  const visible = [
    itemEvent("item/started", userMessage),
    itemEvent("item/completed", agentMessage),
    itemEvent("item/completed", reasoning),
    itemEvent("item/completed", plan),
    event("item/agentMessage/delta", {
      threadId: "thread",
      turnId: "turn",
      itemId: "answer",
      delta: "done",
    }),
    event("item/reasoning/textDelta", {
      threadId: "thread",
      turnId: "turn",
      itemId: "reasoning",
      contentIndex: 0,
      delta: "details",
    }),
    event("item/plan/delta", {
      threadId: "thread",
      turnId: "turn",
      itemId: "plan",
      delta: "1. Test",
    }),
    event("warning", { message: "keep warning" }),
    event("error", {
      threadId: "thread",
      turnId: "turn",
      message: "keep error",
      willRetry: false,
    }),
    event("turn/started", { threadId: "thread", turn: turn([userMessage]) }),
    event("turn/completed", {
      threadId: "thread",
      turn: turn([userMessage, agentMessage]),
    }),
  ];

  expect(hidden.map(isToolTranscriptEvent)).toEqual(hidden.map(() => true));
  expect(visible.map(isToolTranscriptEvent)).toEqual(visible.map(() => false));
});

it("projects tool items nested in turn snapshots and preserves safe identities", () => {
  const changed = [
    event("turn/started", {
      threadId: "thread",
      turn: turn([userMessage, commandExecution, dynamicToolCall]),
    }),
    event("turn/completed", {
      threadId: "thread",
      turn: turn([commandExecution, agentMessage, fileChange, mcpToolCall]),
    }),
  ];

  const filtered = withoutToolTranscriptEvents(changed);

  expect(filtered).not.toBe(changed);
  expect(filtered).toHaveLength(2);
  expect(filtered[0].method).toBe("turn/started");
  expect(filtered[1].method).toBe("turn/completed");
  expect((filtered[0] as any).params).not.toBe((changed[0] as any).params);
  expect((filtered[0] as any).params.turn).not.toBe(
    (changed[0] as any).params.turn,
  );
  expect((filtered[0] as any).params.turn.items.map((item: any) => item.id)).toEqual(["user", "cmd", "dynamic"]);
  expect((filtered[0] as any).params.turn.items[1].aggregatedOutput).toBeNull();
  expect((filtered[0] as any).params.turn.items[2].arguments).toBeNull();
  expect((filtered[1] as any).params.turn.items.map((item: any) => item.id)).toEqual(["cmd", "answer", "patch", "mcp"]);
  expect(JSON.stringify(filtered)).not.toContain("large output");
  expect(JSON.stringify(filtered)).not.toContain("large result");
  expect((filtered[1] as any).params.turn.status).toBe("completed");
  expect((filtered[1] as any).params.turn.durationMs).toBe(1);

  const unchanged = [
    itemEvent("item/started", userMessage),
    itemEvent("item/completed", agentMessage),
    event("warning", { message: "keep" }),
  ];
  expect(withoutToolTranscriptEvents(unchanged)).toBe(unchanged);
  expect(withoutToolTranscriptEvents(filtered)).toBe(filtered);
});

it("projects nested tool history without dropping lifecycle metadata", () => {
  const snapshot = [
    event("thread/started", {
      thread: thread([
        turn([userMessage, commandExecution, mcpToolCall]),
        turn([dynamicToolCall, agentMessage, subAgentActivity]),
      ]),
    }),
  ];

  const filtered = withoutToolTranscriptEvents(snapshot);

  expect(filtered).not.toBe(snapshot);
  expect(filtered[0].method).toBe("thread/started");
  expect((filtered[0] as any).params.thread).not.toBe(
    (snapshot[0] as any).params.thread,
  );
  expect((filtered[0] as any).params.thread.turns[0].items.map((item: any) => item.id)).toEqual(["user", "cmd", "mcp"]);
  expect((filtered[0] as any).params.thread.turns[1].items.map((item: any) => item.id)).toEqual(["dynamic", "answer", "subagent"]);
  expect(JSON.stringify(filtered)).not.toContain("large output");
  expect(JSON.stringify(filtered)).not.toContain("large result");
  expect((filtered[0] as any).params.thread.name).toBe(null);
});

it("stores bounded tool metadata and true command status without output bursts", () => {
  useCodexStore
    .getState()
    .addEvent("thread", itemEvent("item/started", commandExecution));
  useCodexStore
    .getState()
    .addEvent("thread", itemEvent("item/completed", commandExecution));
  useCodexStore.getState().addEvent(
    "thread",
    event("item/commandExecution/outputDelta", {
      threadId: "thread",
      turnId: "turn",
      itemId: "cmd",
      delta: "output",
    }),
  );

  let state = useCodexStore.getState();
  expect(state.events.thread).toHaveLength(1);
  expect((state.events.thread[0] as any).params.item.aggregatedOutput).toBeNull();
  expect(state.commandStatusMap.cmd).toBe("completed");
  expect(state.commandDurationMap.cmd).toBe(10);

  useCodexStore.getState().addEvent(
    "thread",
    event("turn/completed", {
      threadId: "thread",
      turn: turn([commandExecution, agentMessage, fileChange]),
    }),
  );

  state = useCodexStore.getState();
  expect(
    state.events.thread.some(
      (stored) =>
        (stored as any).params?.item &&
        [
          "commandExecution",
          "fileChange",
          "mcpToolCall",
          "dynamicToolCall",
          "webSearch",
          "imageGeneration",
          "collabAgentToolCall",
          "subAgentActivity",
        ].includes((stored as any).params.item.type),
    ),
  ).toBe(true);
  expect(JSON.stringify(state.events.thread)).not.toContain("large output");
  const completedTurn = state.events.thread.find(
    (stored) => stored.method === "turn/completed",
  );
  const finalAgent = state.events.thread.find(
    (stored) =>
      stored.method === "item/completed" &&
      (stored.params as any).item.type === "agentMessage",
  );
  expect((finalAgent as any).params.item.text).toBe("done");
  expect((completedTurn as any).params.turn.items).toEqual([]);
  expect((completedTurn as any).params.turn.durationMs).toBe(1);
  expect(state.turnTimingMap.thread?.status).toBe("completed");
});

it("renders safe native tool rows while preserving the user and final answer", () => {
  const rows = buildThreadRows(withoutToolTranscriptEvents([
    itemEvent("item/started", userMessage),
    itemEvent("item/started", commandExecution),
    itemEvent("item/completed", commandExecution),
    itemEvent("item/completed", mcpToolCall),
    itemEvent("item/completed", collabAgentToolCall),
    event("item/commandExecution/outputDelta", {
      threadId: "thread",
      turnId: "turn",
      itemId: "cmd",
      delta: "output",
    }),
    event("turn/completed", {
      threadId: "thread",
      turn: turn([
        userMessage,
        commandExecution,
        mcpToolCall,
        collabAgentToolCall,
        agentMessage,
      ]),
    }),
    itemEvent("item/completed", agentMessage),
  ]));

  expect(rows.map((row) => row.item.kind)).toContain("cmdGroup");
  expect(
    rows.some(
      (row) =>
        row.item.kind === "event" &&
        ["item/started", "item/completed"].includes(row.item.event.method) &&
        [
          "commandExecution",
          "fileChange",
          "mcpToolCall",
          "dynamicToolCall",
          "webSearch",
          "imageGeneration",
          "collabAgentToolCall",
          "subAgentActivity",
        ].includes((row.item.event.params as any).item?.type),
    ),
  ).toBe(true);
  expect(
    rows.some(
      (row) =>
        row.item.kind === "event" &&
        row.item.event.method === "item/started" &&
        (row.item.event.params as any).item.type === "userMessage",
    ),
  ).toBe(true);
  expect(
    rows.some(
      (row) =>
        row.item.kind === "event" &&
        row.item.event.method === "item/completed" &&
        (row.item.event.params as any).item.type === "agentMessage",
    ),
  ).toBe(true);
});


it("retains only bounded metadata for native tool cards and public Hook statistics", () => {
  const secret = "private-body".repeat(100_000);
  const source = [
    itemEvent("item/completed", { ...commandExecution, aggregatedOutput: secret }),
    itemEvent("item/completed", { ...mcpToolCall, arguments: { secret }, result: { content: secret } }),
    event("hook/completed", { threadId: "thread", turnId: "turn", run: { id: "hook", eventName: "Stop", source: "project", status: "completed", entries: [{ kind: "context", text: secret }, { kind: "warning", text: "public warning" }], durationMs: "10" } }),
    itemEvent("item/completed", { ...reasoning, content: [secret] }),
  ];
  const projected = withoutToolTranscriptEvents(source);
  expect(projected).toHaveLength(4);
  expect((projected[0] as any).params.item.commandActions).toHaveLength(1);
  expect((projected[0] as any).params.item.aggregatedOutput).toBeNull();
  expect((projected[1] as any).params.item.arguments).toBeNull();
  expect((projected[1] as any).params.item.result).toBeNull();
  expect((projected[2] as any).params.run.entries).toEqual([{ kind: "warning", text: "public warning" }]);
  expect((projected[3] as any).params.item.content).toEqual([]);
  expect(JSON.stringify(projected)).not.toContain(secret);
  expect(JSON.stringify(projected).length).toBeLessThan(12_000);
  expect(withoutToolTranscriptEvents(projected)).toBe(projected);
});


it("bounds malicious metadata arrays and copies short previews without leaking raw arguments", () => {
  const secret = "private-body".repeat(200_000);
  const original = itemEvent("item/completed", { ...commandExecution,
    command: secret, aggregatedOutput: secret,
    commandActions: Array.from({ length: 100 }, () => ({ type: "read", command: secret, name: secret, path: "/repo/a.ts", privateExtra: secret })),
    unexpected: { content: secret },
  });
  const projected = withoutToolTranscriptEvents([original])[0] as any;
  expect(projected.params.item.commandActions.length).toBeLessThanOrEqual(16);
  expect(projected.params.item.command.length).toBeLessThanOrEqual(1024);
  expect(projected.params.item.aggregatedOutput).toBeNull();
  expect(projected.params.item.unexpected).toBeUndefined();
  expect(JSON.stringify(projected).length * 2).toBeLessThan(64 * 1024);
  expect(JSON.stringify(projected)).not.toContain("privateExtra");
  expect(projectCodexChatValue(JSON.parse(JSON.stringify(projected)))).toEqual(projected);
});

it("retains only native dynamic target identities and explicit booleans", () => {
  const privateText = "private-body".repeat(200_000);
  for (const [tool, safe] of [
    ["read_thread", { threadId: "target" }],
    ["send_message_to_thread", { threadId: "target" }],
    ["set_thread_archived", { threadId: "target", archived: false }],
    ["set_thread_pinned", { threadId: "target", pinned: false }],
    ["move_thread_to_sidebar_section", { sectionId: null }],
    ["write_settings", { config: {} }],
  ] as const) {
    const original = itemEvent("item/completed", { ...dynamicToolCall, namespace: "codex_app", tool,
      arguments: { ...safe, text: privateText, raw: privateText },
      contentItems: [{ type: "inputText", text: privateText }],
    });
    const projected = withoutToolTranscriptEvents([original])[0] as any;
    expect(projected.params.item.arguments).toEqual(safe);
    expect(projected.params.item.contentItems).toEqual([]);
    expect(projected.params.item.status).toBe("completed");
    expect(projected.params.item.success).toBe(true);
    expect(JSON.stringify(projected)).not.toContain(privateText);
    expect(withoutToolTranscriptEvents([projected])[0]).toBe(projected);
    const decoded = JSON.parse(JSON.stringify(projected));
    expect(projectCodexChatValue(decoded)).toBe(decoded);
  }
  const invalid = itemEvent("item/completed", { ...dynamicToolCall, namespace: "codex_app", tool: "read_thread", arguments: { threadId: privateText } });
  expect((withoutToolTranscriptEvents([invalid])[0] as any).params.item.arguments).toBeNull();
});
