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

function makeFallbackSession(
  interactionState: AgentSessionRecord["interactionState"],
): AgentSessionRecord {
  return {
    ...makeSession(interactionState),
    agentKind: "shell",
    displayName: "普通 Shell 任务",
    transportRef: { tmuxSession: "existing-task" },
  };
}

function makeNodeTmuxSession(
  interactionState: AgentSessionRecord["interactionState"],
): AgentSessionRecord {
  return {
    ...makeSession(interactionState),
    agentKind: "node",
    agentSessionId: undefined,
    transportRef: { tmuxSession: "existing-task", tmuxPane: "%12" },
  };
}

function makeClaudeSession(
  interactionState: AgentSessionRecord["interactionState"],
): AgentSessionRecord {
  return {
    ...makeSession(interactionState),
    agentKind: "claude",
    displayName: "Claude 任务",
    agentSessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    transportRef: { tmuxSession: "claude-task", tmuxPane: "%9" },
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

test("notifies when an already-running non-Codex session completes after the switch is enabled", async () => {
  const source = new SnapshotSource({
    items: [makeFallbackSession("running")],
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
    source.emitSession(makeFallbackSession("idle"));
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0], {
      sessionId: "session-1",
      displayName: "普通 Shell 任务",
      agentKind: "shell",
      workingDirectory: "/workspace/existing-project",
      summary: "实现已经完成",
      completedAt: sent[0]?.completedAt,
    });

    source.emitSession(makeFallbackSession("idle"));
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(sent.length, 1);

    source.emitSession(makeFallbackSession("running"));
    enabled = false;
    source.emitSession(makeFallbackSession("idle"));
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(sent.length, 1);

    source.emitSession(makeFallbackSession("running"));
    enabled = true;
    source.emitSession(makeFallbackSession("exited"));
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
      inspectLatestCompletion: async () => ({
        completionId: "turn-complete-output",
        content: completeOutput,
        completedAt: "2026-09-01T10:00:01.000Z",
      }),
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

test("does not send a fallback card while a node-labelled tmux Codex is only editing a prompt", async () => {
  const editingSession = (
    interactionState: AgentSessionRecord["interactionState"],
    outputPreview: string,
  ): AgentSessionRecord => ({
    ...makeNodeTmuxSession(interactionState),
    outputPreview,
    lastAgentMessageSummary: undefined,
  });
  const source = new SnapshotSource({
    items: [editingSession("running", "正在编辑第一段提示词")],
    activeAgentSessionId: "session-1",
    updatedAt: "2026-09-02T13:35:00.000Z",
  });
  const sent: FeishuCompletionEvent[] = [];
  let fallbackReads = 0;
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
      inspectLatestCompletion: async () => null,
      resolve: async () => {
        fallbackReads += 1;
        return "不应发送的旧回复或终端摘要";
      },
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
    source.emitSession(editingSession("idle", "正在编辑第一段提示词"));
    await new Promise<void>((resolve) => setImmediate(resolve));
    source.emitSession(editingSession("running", "正在编辑第二段提示词"));
    source.emitSession(editingSession("idle", "正在编辑第二段提示词"));
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.equal(sent.length, 0);
    assert.equal(fallbackReads, 0);
  } finally {
    stop();
  }
});

test("notifies every structured node-labelled Codex turn even when the terminal never becomes idle", async () => {
  const source = new SnapshotSource({
    items: [
      {
        ...makeNodeTmuxSession("running"),
        lastOutputAt: "2026-09-01T10:00:00.000Z",
      },
    ],
    activeAgentSessionId: "session-1",
    updatedAt: "2026-09-01T10:00:00.000Z",
  });
  let completion: FeishuCompletionObservation = {
    completionId: "turn-existing",
    content: "服务启动前已经完成的回答",
    userQuestion: "旧的问题",
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
      userQuestion: "第一条用户问题",
      completedAt: "2026-09-01T10:00:05.000Z",
    };
    source.emitSession({
      ...makeNodeTmuxSession("running"),
      lastOutputAt: "2026-09-01T10:00:05.000Z",
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 10));

    completion = {
      completionId: "turn-two",
      content: "第二条完整回答",
      userQuestion: "第二条用户问题",
      completedAt: "2026-09-01T10:00:08.000Z",
    };
    source.emitSession({
      ...makeNodeTmuxSession("running"),
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

    assert.deepEqual(
      sent.map((event) => event.userQuestion),
      ["第一条用户问题", "第二条用户问题"],
    );
    source.emitSession(makeNodeTmuxSession("idle"));
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    assert.equal(sent.length, 2);
  } finally {
    stop();
  }
});

test("notifies new Claude transcript completions after the restored baseline", async () => {
  const source = new SnapshotSource({
    items: [
      {
        ...makeClaudeSession("running"),
        agentKind: "claude.exe",
        agentSessionId: undefined,
        lastOutputAt: "2026-09-23T10:00:00.000Z",
      },
    ],
    activeAgentSessionId: "session-1",
    updatedAt: "2026-09-23T10:00:00.000Z",
  });
  let completion: FeishuCompletionObservation = {
    transcriptAgentKind: "claude",
    transcriptSessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    completionId: "claude-existing",
    content: "启动前已经完成的 Claude 回复",
    userQuestion: "旧问题",
    completedAt: "2026-09-23T09:59:00.000Z",
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
      resolve: async () => {
        throw new Error("Claude completion should use structured content");
      },
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
      transcriptAgentKind: "claude",
      transcriptSessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      completionId: "claude-new",
      content: "Claude 完整完成内容",
      userQuestion: "新的问题",
      completedAt: "2026-09-23T10:00:05.000Z",
    };
    source.emitSession({
      ...makeClaudeSession("running"),
      agentKind: "claude.exe",
      agentSessionId: undefined,
      lastOutputAt: "2026-09-23T10:00:05.000Z",
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 10));

    assert.deepEqual(
      sent.map((event) => ({
        agentKind: event.agentKind,
        completionId: event.completionId,
        summary: event.summary,
        userQuestion: event.userQuestion,
        codexThreadId: event.codexThreadId,
        transcriptAgentKind: event.transcriptAgentKind,
        transcriptSessionId: event.transcriptSessionId,
        allowLocalFileReferences: event.allowLocalFileReferences,
      })),
      [
        {
          agentKind: "claude",
          completionId: "claude-new",
          summary: "Claude 完整完成内容",
          userQuestion: "新的问题",
          codexThreadId: undefined,
          transcriptAgentKind: "claude",
          transcriptSessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          allowLocalFileReferences: undefined,
        },
      ],
    );
  } finally {
    stop();
  }
});

test("does not send a fallback card when Claude is idle without a completed transcript turn", async () => {
  const source = new SnapshotSource({
    items: [makeClaudeSession("running")],
    activeAgentSessionId: "session-1",
    updatedAt: "2026-09-23T11:00:00.000Z",
  });
  const sent: FeishuCompletionEvent[] = [];
  let fallbackReads = 0;
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
      inspectLatestCompletion: async () => null,
      resolve: async () => {
        fallbackReads += 1;
        return "不应发送的 Claude 终端摘要";
      },
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
    source.emitSession(makeClaudeSession("idle"));
    await new Promise<void>((resolve) => setTimeout(resolve, 10));

    assert.equal(sent.length, 0);
    assert.equal(fallbackReads, 0);
  } finally {
    stop();
  }
});

test("notifies each Codex pane independently without waiting for it to become active", async () => {
  const source = new SnapshotSource({
    items: [
      {
        ...makeNodeTmuxSession("running"),
        lastOutputAt: "2026-09-18T10:00:00.000Z",
      },
    ],
    activeAgentSessionId: "session-1",
    updatedAt: "2026-09-18T10:00:00.000Z",
  });
  let observations: FeishuCompletionObservation[] = [
    {
      codexThreadId: "codex-thread-pane-one",
      completionId: "pane-one-existing",
      content: "pane one existing",
      completedAt: "2026-09-18T09:59:00.000Z",
    },
    {
      codexThreadId: "codex-thread-pane-two",
      completionId: "pane-two-existing",
      content: "pane two existing",
      completedAt: "2026-09-18T09:59:00.000Z",
    },
  ];
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
      resolve: async () => null,
      inspectLatestCompletions: async () => observations,
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

    observations = [
      observations[0]!,
      {
        codexThreadId: "codex-thread-pane-two",
        completionId: "pane-two-new",
        content: "inactive pane finished",
        completedAt: "2026-09-18T10:00:05.000Z",
      },
    ];
    source.emitSession({
      ...makeNodeTmuxSession("running"),
      lastOutputAt: "2026-09-18T10:00:05.000Z",
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 10));

    observations = [
      {
        codexThreadId: "codex-thread-pane-one",
        completionId: "pane-one-new",
        content: "other pane finished",
        completedAt: "2026-09-18T10:00:08.000Z",
      },
      observations[1]!,
    ];
    source.emitSession({
      ...makeNodeTmuxSession("running"),
      agentSessionId: "codex-thread-pane-two",
      lastOutputAt: "2026-09-18T10:00:08.000Z",
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 10));

    source.emitSession({
      ...makeNodeTmuxSession("running"),
      agentSessionId: "codex-thread-pane-one",
      lastOutputAt: "2026-09-18T10:00:09.000Z",
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 10));

    assert.deepEqual(
      sent.map((event) => ({
        codexThreadId: event.codexThreadId,
        completionId: event.completionId,
        summary: event.summary,
      })),
      [
        {
          codexThreadId: "codex-thread-pane-two",
          completionId: "pane-two-new",
          summary: "inactive pane finished",
        },
        {
          codexThreadId: "codex-thread-pane-one",
          completionId: "pane-one-new",
          summary: "other pane finished",
        },
      ],
    );
  } finally {
    stop();
  }
});

test("a tmux card state transition does not resend unchanged pane completions", async () => {
  const source = new SnapshotSource({
    items: [
      {
        ...makeNodeTmuxSession("running"),
        lastOutputAt: "2026-09-18T10:00:00.000Z",
      },
    ],
    activeAgentSessionId: "session-1",
    updatedAt: "2026-09-18T10:00:00.000Z",
  });
  let observations: FeishuCompletionObservation[] = [
    {
      codexThreadId: "codex-thread-pane-one",
      completionId: "pane-one-existing",
      content: "pane one existing",
      completedAt: "2026-09-18T09:58:00.000Z",
    },
    {
      codexThreadId: "codex-thread-pane-two",
      completionId: "pane-two-existing",
      content: "pane two existing",
      completedAt: "2026-09-18T09:59:00.000Z",
    },
  ];
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
      resolve: async () => null,
      inspectLatestCompletions: async () => observations,
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
    observations = [
      observations[0]!,
      {
        codexThreadId: "codex-thread-pane-two",
        completionId: "pane-two-new",
        content: "pane two completed",
        completedAt: "2026-09-18T10:00:05.000Z",
      },
    ];
    source.emitSession({
      ...makeNodeTmuxSession("idle"),
      lastOutputAt: "2026-09-18T10:00:05.000Z",
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 10));

    assert.deepEqual(
      sent.map((event) => event.completionId),
      ["pane-two-new"],
    );
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
  let completion: FeishuCompletionObservation = {
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
      codexThreadId: "codex-thread-goal-12345678",
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
        codexThreadId: event.codexThreadId,
        completionId: event.completionId,
        summary: event.summary,
      })),
      [
        {
          codexThreadId: "codex-thread-goal-12345678",
          completionId: "turn-goal-final",
          summary: "Goal 最终结果",
        },
      ],
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
    items: [makeFallbackSession("idle")],
    activeAgentSessionId: "session-1",
    updatedAt: "2026-09-01T10:00:00.000Z",
  };
  const source = new SnapshotSource({
    ...restoredSnapshot,
    items: [makeFallbackSession("detached")],
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
    source.emitSession(makeFallbackSession("running"));
    source.emitSession(makeFallbackSession("idle"));
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(sent.length, 0);

    source.emitSession(makeFallbackSession("running"));
    source.emitSession(makeFallbackSession("idle"));
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(sent.length, 1);
  } finally {
    stop();
  }
});

test("keeps a session armed when it was already running before restoration", async () => {
  const restoredSnapshot: ListAgentSessionsResponse = {
    items: [makeFallbackSession("running")],
    activeAgentSessionId: "session-1",
    updatedAt: "2026-09-01T10:00:00.000Z",
  };
  const source = new SnapshotSource({
    ...restoredSnapshot,
    items: [makeFallbackSession("detached")],
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
    source.emitSession(makeFallbackSession("running"));
    source.emitSession(makeFallbackSession("idle"));
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
    codexThreadId: "codex-thread-12345678",
    userQuestion: "帮我完成这个功能",
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
    "user-question": "帮我完成这个功能",
    "records-available": true,
  });
  assert.doesNotMatch(calls[0]?.args[2] ?? "", /codex-thread-12345678/);
  assert.equal(calls[0]?.options.timeout, 300_000);
  assert.deepEqual(delivery, {
    messages: [{ messageId: "om_notice", chatId: "oc_private" }],
  });
});

test("script sender only exposes quick replies for eligible Codex thread notifications", async () => {
  const notifications: Record<string, unknown>[] = [];
  const sender = new ScriptFeishuCompletionSender({
    scriptPath: "/workspace/scripts/codex-feishu-notify.mjs",
    fallbackWorkingDirectory: "/workspace/coding_kanban",
    quickRepliesAvailable: () => true,
    runCommand: async (_binary, args) => {
      notifications.push(JSON.parse(args[2] ?? "") as Record<string, unknown>);
      return {
        stdout: JSON.stringify({
          status: "sent",
          messages: [{ messageId: "om_notice", chatId: "oc_private" }],
        }),
      };
    },
  });

  await sender.send({
    sessionId: "session-codex",
    displayName: "Codex 任务",
    agentKind: "codex",
    workingDirectory: "/workspace/project-a",
    summary: "Codex 已完成",
    completedAt: "2026-09-23T10:30:00.000Z",
    completionId: "codex-turn-1",
    codexThreadId: "codex-thread-12345678",
  });
  await sender.send({
    sessionId: "session-claude",
    displayName: "Claude 任务",
    agentKind: "claude",
    workingDirectory: "/workspace/project-a",
    summary: "Claude 已完成",
    completedAt: "2026-09-23T10:31:00.000Z",
    completionId: "claude-turn-1",
    transcriptAgentKind: "claude",
    transcriptSessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  });
  await sender.send({
    sessionId: "session-fallback",
    displayName: "Codex fallback",
    agentKind: "codex",
    workingDirectory: "/workspace/project-a",
    summary: "Fallback 已完成",
    completedAt: "2026-09-23T10:32:00.000Z",
  });

  assert.equal(notifications[0]?.["quick-replies-available"], true);
  assert.equal(notifications[1]?.["quick-replies-available"], undefined);
  assert.equal(notifications[2]?.["quick-replies-available"], undefined);
  assert.doesNotMatch(
    JSON.stringify(notifications[0]),
    /codex-thread-12345678/,
  );
});

test("script sender defaults quick replies to unavailable", async () => {
  let notification: Record<string, unknown> | null = null;
  const sender = new ScriptFeishuCompletionSender({
    scriptPath: "/workspace/scripts/codex-feishu-notify.mjs",
    fallbackWorkingDirectory: "/workspace/coding_kanban",
    runCommand: async (_binary, args) => {
      notification = JSON.parse(args[2] ?? "") as Record<string, unknown>;
      return {
        stdout: JSON.stringify({
          status: "sent",
          messages: [{ messageId: "om_notice", chatId: "oc_private" }],
        }),
      };
    },
  });

  await sender.send({
    sessionId: "session-1",
    displayName: "Codex 任务",
    agentKind: "codex",
    workingDirectory: "/workspace/project-a",
    summary: "Codex 已完成",
    completedAt: "2026-09-23T10:30:00.000Z",
    completionId: "codex-turn-1",
    codexThreadId: "codex-thread-12345678",
  });

  assert.equal(notification?.["quick-replies-available"], undefined);
});

test("script sender carries only prepared local file references into the card binding", async () => {
  let notification: Record<string, unknown> | null = null;
  const sender = new ScriptFeishuCompletionSender({
    scriptPath: "/workspace/scripts/codex-feishu-notify.mjs",
    fallbackWorkingDirectory: "/workspace/coding_kanban",
    fileReferences: {
      prepare: async () => ({
        content: "查看 `src/app.ts:12`",
        references: [{ path: "src/app.ts", line: 12 }],
      }),
    },
    runCommand: async (_binary, args) => {
      notification = JSON.parse(args[2] ?? "") as Record<string, unknown>;
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
    summary: "[app.ts](/workspace/project-a/src/app.ts:12)",
    completedAt: "2026-09-18T10:30:00.000Z",
    completionId: "turn-structured-file",
    codexThreadId: "codex-thread-12345678",
    allowLocalFileReferences: true,
  });

  assert.equal(
    notification?.["last-assistant-message"],
    "查看 `src/app.ts:12`",
  );
  assert.deepEqual(notification?.["referenced-files"], [
    { path: "src/app.ts", line: 12 },
  ]);
  assert.deepEqual(delivery, {
    messages: [{ messageId: "om_notice", chatId: "oc_private" }],
    referencedFiles: [{ path: "src/app.ts", line: 12 }],
  });
});

test("script sender exposes generic transcript identity for non-Codex records", async () => {
  let notification: Record<string, unknown> | null = null;
  const sender = new ScriptFeishuCompletionSender({
    scriptPath: "/workspace/scripts/codex-feishu-notify.mjs",
    fallbackWorkingDirectory: "/workspace/coding_kanban",
    runCommand: async (_binary, args) => {
      notification = JSON.parse(args[2] ?? "") as Record<string, unknown>;
      return {
        stdout: JSON.stringify({
          status: "sent",
          messages: [{ messageId: "om_notice", chatId: "oc_private" }],
        }),
      };
    },
  });

  await sender.send({
    sessionId: "session-1",
    displayName: "Claude 任务",
    agentKind: "claude",
    workingDirectory: "/workspace/project-a",
    summary: "Claude 已完成",
    completedAt: "2026-09-23T10:30:00.000Z",
    completionId: "claude-turn-1",
    transcriptAgentKind: "claude",
    transcriptSessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  });

  assert.deepEqual(
    {
      recordsAvailable: notification?.["records-available"],
      transcriptAgentKind: notification?.["transcript-agent-kind"],
      transcriptSessionId: notification?.["transcript-session-id"],
      agentKind: notification?.["agent-kind"],
    },
    {
      recordsAvailable: true,
      transcriptAgentKind: "claude",
      transcriptSessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      agentKind: "claude",
    },
  );
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
