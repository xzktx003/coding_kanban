import assert from "node:assert/strict";
import test from "node:test";

import type {
  AgentSessionRecord,
  ListAgentSessionsResponse,
} from "@agent-orchestrator/shared";

import {
  AgentCompletionFeishuNotifier,
  ScriptFeishuCompletionSender,
  type FeishuCompletionEvent,
  type FeishuCompletionObservation,
} from "./agent-completion-feishu-notifier.js";

function makeSession(
  interactionState: AgentSessionRecord["interactionState"],
): AgentSessionRecord {
  return {
    id: "session-1",
    workspaceId: "default",
    sourceType: "local",
    agentKind: "codex",
    displayName: "已经运行的 Codex",
    workingDirectory: "/workspace/existing-project",
    connectionState: "online",
    interactionState,
    lastAgentMessageSummary: "实现已经完成",
    transportRef: { tmuxSession: "existing-task" },
  };
}

class SnapshotSource {
  #listener: ((snapshot: ListAgentSessionsResponse) => void) | null = null;

  constructor(private snapshot: ListAgentSessionsResponse) {}

  subscribe(listener: (snapshot: ListAgentSessionsResponse) => void) {
    this.#listener = listener;
    listener(this.snapshot);
    return () => {
      this.#listener = null;
    };
  }

  emit(interactionState: AgentSessionRecord["interactionState"]): void {
    this.emitSession(makeSession(interactionState));
  }

  emitSession(session: AgentSessionRecord): void {
    this.snapshot = {
      ...this.snapshot,
      items: [session],
      updatedAt: new Date().toISOString(),
    };
    this.#listener?.(this.snapshot);
  }
}

test("notifies when an already-running Kanban session completes after the switch is enabled", async () => {
  const source = new SnapshotSource({
    items: [makeSession("running")],
    activeAgentSessionId: "session-1",
    updatedAt: "2026-09-01T10:00:00.000Z",
  });
  const sent: FeishuCompletionEvent[] = [];
  let enabled = true;
  const notifier = new AgentCompletionFeishuNotifier({
    source,
    settings: {
      get: () => ({ configured: true, destinationType: "user", enabled }),
    },
    sender: {
      send: async (event) => {
        sent.push(event);
      },
    },
  });
  const stop = notifier.start();

  try {
    source.emit("idle");
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0], {
      sessionId: "session-1",
      displayName: "已经运行的 Codex",
      agentKind: "codex",
      workingDirectory: "/workspace/existing-project",
      summary: "实现已经完成",
      completedAt: sent[0]?.completedAt,
    });

    source.emit("idle");
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(sent.length, 1);

    source.emit("running");
    enabled = false;
    source.emit("idle");
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(sent.length, 1);

    source.emit("running");
    enabled = true;
    source.emit("exited");
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(sent.length, 2);
  } finally {
    stop();
  }
});

test("replaces the card summary with the complete resolved Codex output", async () => {
  const source = new SnapshotSource({
    items: [makeSession("running")],
    activeAgentSessionId: "session-1",
    updatedAt: "2026-09-01T10:00:00.000Z",
  });
  const completeOutput = `完成结果：\n\n${"完整输出内容".repeat(120)}`;
  const sent: FeishuCompletionEvent[] = [];
  const stop = new AgentCompletionFeishuNotifier({
    source,
    settings: {
      get: () => ({
        configured: true,
        destinationType: "user",
        enabled: true,
      }),
    },
    contentResolver: {
      resolve: async () => completeOutput,
    },
    sender: {
      send: async (event) => {
        sent.push(event);
      },
    },
  }).start();

  try {
    source.emit("idle");
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.summary, completeOutput);
    assert.equal(sent[0]?.agentKind, "codex");
  } finally {
    stop();
  }
});

test("notifies every structured Codex turn even when the terminal never becomes idle between turns", async () => {
  const source = new SnapshotSource({
    items: [
      {
        ...makeSession("running"),
        lastOutputAt: "2026-09-01T10:00:00.000Z",
      },
    ],
    activeAgentSessionId: "session-1",
    updatedAt: "2026-09-01T10:00:00.000Z",
  });
  let completion = {
    completionId: "turn-existing",
    content: "服务启动前已经完成的回答",
    completedAt: new Date(Date.now() - 60_000).toISOString(),
  };
  const sent: FeishuCompletionEvent[] = [];
  const stop = new AgentCompletionFeishuNotifier({
    source,
    settings: {
      get: () => ({
        configured: true,
        destinationType: "user",
        enabled: true,
      }),
    },
    contentResolver: {
      resolve: async () => completion.content,
      inspectLatestCompletion: async () => completion,
    },
    structuredCompletionProbeDelayMs: 0,
    structuredCompletionProbeIntervalMs: 0,
    sender: {
      send: async (event) => {
        sent.push(event);
      },
    },
  }).start();

  try {
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(sent.length, 0);

    completion = {
      completionId: "turn-one",
      content: "第一条完整回答",
      completedAt: "2026-09-01T10:00:05.000Z",
    };
    source.emitSession({
      ...makeSession("running"),
      lastOutputAt: "2026-09-01T10:00:05.000Z",
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 10));

    completion = {
      completionId: "turn-two",
      content: "第二条完整回答",
      completedAt: "2026-09-01T10:00:08.000Z",
    };
    source.emitSession({
      ...makeSession("running"),
      lastOutputAt: "2026-09-01T10:00:08.000Z",
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 10));

    assert.deepEqual(
      sent.map((event) => ({
        summary: event.summary,
        completedAt: event.completedAt,
        completionId: event.completionId,
      })),
      [
        {
          summary: "第一条完整回答",
          completedAt: "2026-09-01T10:00:05.000Z",
          completionId: "turn-one",
        },
        {
          summary: "第二条完整回答",
          completedAt: "2026-09-01T10:00:08.000Z",
          completionId: "turn-two",
        },
      ],
    );

    source.emit("idle");
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    assert.equal(sent.length, 2);
  } finally {
    stop();
  }
});

test("suppresses Goal continuation completions until the Goal reaches its final turn", async () => {
  const source = new SnapshotSource({
    items: [
      {
        ...makeSession("running"),
        lastOutputAt: "2026-09-01T10:00:00.000Z",
      },
    ],
    activeAgentSessionId: "session-1",
    updatedAt: "2026-09-01T10:00:00.000Z",
  });
  let completion = {
    completionId: "turn-existing",
    content: "启动前的回答",
    completedAt: "2026-09-01T09:59:00.000Z",
    shouldNotify: true,
  };
  const sent: FeishuCompletionEvent[] = [];
  const stop = new AgentCompletionFeishuNotifier({
    source,
    settings: {
      get: () => ({
        configured: true,
        destinationType: "user",
        enabled: true,
      }),
    },
    contentResolver: {
      resolve: async () => completion.content,
      inspectLatestCompletion: async () => completion,
    },
    structuredCompletionProbeDelayMs: 0,
    structuredCompletionProbeIntervalMs: 0,
    sender: {
      send: async (event) => {
        sent.push(event);
      },
    },
  }).start();

  try {
    await new Promise<void>((resolve) => setImmediate(resolve));

    completion = {
      completionId: "turn-goal-intermediate",
      content: "Goal 阶段结果",
      completedAt: "2026-09-01T10:00:05.000Z",
      shouldNotify: false,
    };
    source.emitSession({
      ...makeSession("running"),
      lastOutputAt: "2026-09-01T10:00:05.000Z",
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    source.emit("idle");
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    assert.equal(sent.length, 0);

    completion = {
      completionId: "turn-goal-final",
      content: "Goal 最终结果",
      completedAt: "2026-09-01T10:00:10.000Z",
      shouldNotify: true,
    };
    source.emitSession({
      ...makeSession("running"),
      lastOutputAt: "2026-09-01T10:00:10.000Z",
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 10));

    assert.deepEqual(
      sent.map((event) => ({
        completionId: event.completionId,
        summary: event.summary,
      })),
      [{ completionId: "turn-goal-final", summary: "Goal 最终结果" }],
    );
  } finally {
    stop();
  }
});

test("does not fall back to a card summary while the next turn source is pending", async () => {
  const source = new SnapshotSource({
    items: [
      {
        ...makeSession("running"),
        lastOutputAt: "2026-09-01T10:00:00.000Z",
      },
    ],
    activeAgentSessionId: "session-1",
    updatedAt: "2026-09-01T10:00:00.000Z",
  });
  let completion: FeishuCompletionObservation = {
    completionId: "turn-existing",
    content: "启动前的回答",
    completedAt: "2026-09-01T09:59:00.000Z",
  };
  const sent: FeishuCompletionEvent[] = [];
  const stop = new AgentCompletionFeishuNotifier({
    source,
    settings: {
      get: () => ({
        configured: true,
        destinationType: "user",
        enabled: true,
      }),
    },
    contentResolver: {
      resolve: async () => "不应发送的卡片降级摘要",
      inspectLatestCompletion: async () => completion,
    },
    structuredCompletionProbeDelayMs: 0,
    structuredCompletionProbeIntervalMs: 0,
    sender: {
      send: async (event) => {
        sent.push(event);
      },
    },
  }).start();

  try {
    await new Promise<void>((resolve) => setImmediate(resolve));

    completion = {
      completionId: "turn-one",
      content: "来源尚未落盘的回答",
      completedAt: "2026-09-01T10:00:05.000Z",
      shouldNotify: false,
      pendingContinuationSource: true,
    };
    source.emitSession({
      ...makeSession("running"),
      lastOutputAt: "2026-09-01T10:00:05.000Z",
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    source.emit("idle");
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    assert.equal(sent.length, 0);

    completion = {
      completionId: "turn-one",
      content: "人工追问前的真实完成回答",
      completedAt: "2026-09-01T10:00:05.000Z",
      shouldNotify: true,
    };
    source.emitSession({
      ...makeSession("running"),
      lastOutputAt: "2026-09-01T10:00:06.000Z",
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 10));

    assert.deepEqual(
      sent.map((event) => ({
        completionId: event.completionId,
        summary: event.summary,
      })),
      [
        {
          completionId: "turn-one",
          summary: "人工追问前的真实完成回答",
        },
      ],
    );
  } finally {
    stop();
  }
});

test("does not notify for an idle session present in the initial snapshot", async () => {
  const source = new SnapshotSource({
    items: [makeSession("idle")],
    activeAgentSessionId: "session-1",
    updatedAt: "2026-09-01T10:00:00.000Z",
  });
  let sends = 0;
  const stop = new AgentCompletionFeishuNotifier({
    source,
    settings: {
      get: () => ({
        configured: true,
        destinationType: "user",
        enabled: true,
      }),
    },
    sender: {
      send: async () => {
        sends += 1;
      },
    },
  }).start();

  await new Promise<void>((resolve) => setImmediate(resolve));
  stop();
  assert.equal(sends, 0);
});

test("does not treat restoration of a previously idle session as new work", async () => {
  const restoredSnapshot: ListAgentSessionsResponse = {
    items: [makeSession("idle")],
    activeAgentSessionId: "session-1",
    updatedAt: "2026-09-01T10:00:00.000Z",
  };
  const source = new SnapshotSource({
    ...restoredSnapshot,
    items: [makeSession("detached")],
  });
  const sent: FeishuCompletionEvent[] = [];
  const stop = new AgentCompletionFeishuNotifier({
    source,
    restoredSnapshot,
    settings: {
      get: () => ({
        configured: true,
        destinationType: "user",
        enabled: true,
      }),
    },
    sender: {
      send: async (event) => {
        sent.push(event);
      },
    },
  }).start();

  try {
    source.emit("running");
    source.emit("idle");
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(sent.length, 0);

    source.emit("running");
    source.emit("idle");
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(sent.length, 1);
  } finally {
    stop();
  }
});

test("keeps a session armed when it was already running before restoration", async () => {
  const restoredSnapshot: ListAgentSessionsResponse = {
    items: [makeSession("running")],
    activeAgentSessionId: "session-1",
    updatedAt: "2026-09-01T10:00:00.000Z",
  };
  const source = new SnapshotSource({
    ...restoredSnapshot,
    items: [makeSession("detached")],
  });
  let sends = 0;
  const stop = new AgentCompletionFeishuNotifier({
    source,
    restoredSnapshot,
    settings: {
      get: () => ({
        configured: true,
        destinationType: "user",
        enabled: true,
      }),
    },
    sender: {
      send: async () => {
        sends += 1;
      },
    },
  }).start();

  try {
    source.emit("running");
    source.emit("idle");
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(sends, 1);
  } finally {
    stop();
  }
});

test("script sender uses a fixed executable and Kanban delivery mode without a shell", async () => {
  const calls: Array<{
    binary: string;
    args: string[];
    options: { timeout: number };
  }> = [];
  const sender = new ScriptFeishuCompletionSender({
    nodeBinary: "/usr/bin/node",
    scriptPath: "/workspace/scripts/codex-feishu-notify.mjs",
    fallbackWorkingDirectory: "/workspace/coding_kanban",
    runCommand: async (binary, args, options) => {
      calls.push({ binary, args, options });
      return {
        stdout: JSON.stringify({
          status: "sent",
          messages: [{ messageId: "om_notice", chatId: "oc_private" }],
        }),
      };
    },
  });

  const delivery = await sender.send({
    sessionId: "session-1",
    displayName: "现有任务",
    agentKind: "codex",
    workingDirectory: "/workspace/project-a",
    summary: "已经完成",
    completedAt: "2026-09-01T10:30:00.000Z",
    completionId: "turn-structured-1",
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.binary, "/usr/bin/node");
  assert.equal(calls[0]?.args[0], "/workspace/scripts/codex-feishu-notify.mjs");
  assert.equal(calls[0]?.args[1], "--kanban");
  assert.deepEqual(JSON.parse(calls[0]?.args[2] ?? ""), {
    type: "agent-turn-complete",
    "thread-id": "kanban-session-1",
    "turn-id": "turn-structured-1",
    cwd: "/workspace/project-a",
    "agent-kind": "codex",
    "display-name": "现有任务",
    "last-assistant-message": "已经完成",
  });
  assert.equal(calls[0]?.options.timeout, 300_000);
  assert.deepEqual(delivery, {
    messages: [{ messageId: "om_notice", chatId: "oc_private" }],
  });
});

test("script sender hides notification content when the child process fails", async () => {
  const sender = new ScriptFeishuCompletionSender({
    nodeBinary: "/usr/bin/node",
    scriptPath: "/workspace/scripts/codex-feishu-notify.mjs",
    fallbackWorkingDirectory: "/workspace/coding_kanban",
    runCommand: async () => {
      throw new Error(
        "Command failed with private summary and /workspace/private-project",
      );
    },
  });

  await assert.rejects(
    sender.send({
      sessionId: "session-1",
      displayName: "现有任务",
      agentKind: "codex",
      workingDirectory: "/workspace/private-project",
      summary: "private summary",
      completedAt: "2026-09-01T10:30:00.000Z",
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "Feishu notification delivery failed");
      assert.doesNotMatch(error.message, /private|workspace/);
      return true;
    },
  );
});
