import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FeishuReplyBindingStore } from "./feishu-reply-binding-store.js";
import { SessionCodexFeishuNotifier } from "./session-codex-feishu-notifier.js";

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
    transportRef: { tmuxSession: "existing-task", tmuxPane: "%7" },
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

test("does not send a terminal-preview fallback for an unbound local tmux card", async () => {
  const unboundSession = (
    interactionState: AgentSessionRecord["interactionState"],
  ): AgentSessionRecord => ({
    ...makeFallbackSession(interactionState),
    lastAgentMessageSummary: undefined,
    outputPreview: "⚠ Transcript writes are failing…",
    transportRef: { tmuxSession: "tmp" },
  });
  const source = new SnapshotSource({
    items: [unboundSession("running")],
    activeAgentSessionId: "session-1",
    updatedAt: "2026-09-24T07:29:00.000Z",
  });
  const sent: FeishuCompletionEvent[] = [];
  const stop = new AgentCompletionFeishuNotifier({
    source,
    settings: {
      get: () => ({ configured: true, enabled: true }),
    },
    sender: {
      send: async (event) => {
        sent.push(event);
      },
    },
  }).start();

  try {
    source.emitSession(unboundSession("idle"));
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(sent.length, 0);
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

test("script sender marks native session cards without offering terminal controls", async () => {
  let notification: any;
  const sender = new ScriptFeishuCompletionSender({
    scriptPath: "/scripts/notify.mjs",
    fallbackWorkingDirectory: "/workspace",
    quickRepliesAvailable: () => true,
    runCommand: async (_binary, args) => {
      notification = JSON.parse(args[2]!);
      return {
        stdout: JSON.stringify({
          status: "sent",
          messages: [{ messageId: "om_native", chatId: "oc_private" }],
        }),
      };
    },
  });
  await sender.send({
    sessionId: "session-codex:native-thread",
    sessionModeThreadId: "native-thread",
    displayName: "原会话",
    agentKind: "codex",
    summary: "完成",
    completionId: "turn-one",
    completedAt: "2026-10-10T01:00:00.000Z",
  });
  assert.equal(notification["session-mode-thread-id"], "native-thread");
  assert.equal(notification["quick-replies-available"], undefined);
  assert.equal(notification["records-available"], undefined);
});

const sharedCompletion: FeishuCompletionEvent = {
  sessionId: "session-codex:native-thread-123",
  sessionModeThreadId: "native-thread-123",
  agentKind: "codex",
  displayName: "会话任务",
  summary: "已经完成",
  completionId: "shared-turn-1",
  completedAt: "2026-10-10T10:00:00.000Z",
};
const terminalCompletion: FeishuCompletionEvent = {
  ...sharedCompletion,
  sessionId: "terminal-registry-session",
  sessionModeThreadId: undefined,
  codexThreadId: "native-thread-123",
};

test("native and terminal observers share one delivery, including concurrent sends", async () => {
  let calls = 0;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const sender = new ScriptFeishuCompletionSender({
    scriptPath: "/workspace/notify.mjs",
    fallbackWorkingDirectory: "/workspace",
    runCommand: async () => {
      calls++;
      await pending;
      return {
        stdout: JSON.stringify({
          status: "sent",
          messages: [{ messageId: "om_shared", chatId: "oc_private" }],
        }),
      };
    },
  });
  const native = sender.send(sharedCompletion);
  const terminal = sender.send(terminalCompletion);
  release();
  const deliveries = await Promise.all([native, terminal]);
  assert.equal(calls, 1);
  assert.deepEqual(deliveries[0], deliveries[1]);
  assert.deepEqual(await sender.send(terminalCompletion), deliveries[0]);
  assert.equal(calls, 1);
  await sender.send({ ...sharedCompletion, completionId: "shared-turn-2" });
  await sender.send({
    ...terminalCompletion,
    codexThreadId: "another-thread-123",
  });
  assert.equal(calls, 3, "different turns and threads must still notify");
});

test("shared sender retries failed delivery and keeps the old native idempotency identity locally", async () => {
  let attempts = 0;
  const identities: Array<string | undefined> = [];
  const sender = new ScriptFeishuCompletionSender({
    scriptPath: "/workspace/notify.mjs",
    fallbackWorkingDirectory: "/workspace",
    runCommand: async (_binary, args, options) => {
      identities.push(options.env?.KANBAN_COMPLETION_IDEMPOTENCY_THREAD);
      if (!JSON.parse(args[2]!)["session-mode-thread-id"])
        assert.doesNotMatch(args[2]!, /native-thread-123/);
      if (++attempts === 1) throw new Error("temporary failure");
      return {
        stdout: JSON.stringify({
          status: "sent",
          messages: [{ messageId: "om_retry", chatId: "oc_private" }],
        }),
      };
    },
  });
  await assert.rejects(sender.send(sharedCompletion), /delivery failed/);
  await sender.send(terminalCompletion);
  await sender.send(sharedCompletion);
  assert.equal(attempts, 2);
  assert.deepEqual(identities, [
    "kanban-session-codex:native-thread-123",
    "kanban-session-codex:native-thread-123",
  ]);
});

test("persisted cross-source delivery survives sender restart and retains native reply routing", async () => {
  const root = mkdtempSync(join(tmpdir(), "feishu-shared-delivery-"));
  const statePath = join(root, "bindings.json");
  let calls = 0;
  try {
    for (const events of [
      [sharedCompletion, terminalCompletion],
      [terminalCompletion, sharedCompletion],
    ]) {
      rmSync(statePath, { force: true });
      for (const event of events) {
        const bindings = new FeishuReplyBindingStore({ statePath });
        const sender = new ScriptFeishuCompletionSender({
          deliveryHistory: bindings,
          scriptPath: "/workspace/notify.mjs",
          fallbackWorkingDirectory: "/workspace",
          runCommand: async () => {
            calls++;
            return {
              stdout: JSON.stringify({
                status: "sent",
                messages: [
                  { messageId: "om_first", chatId: "oc_private" },
                  { messageId: "om_second", chatId: "oc_private" },
                ],
              }),
            };
          },
        });
        const delivery = await sender.send(event);
        bindings.record({
          ...event,
          completionId: event.completionId!,
          messages: delivery.messages,
        });
      }
      const stored = new FeishuReplyBindingStore({ statePath });
      assert.equal(
        stored.resolve("om_first")?.sessionModeThreadId,
        sharedCompletion.sessionModeThreadId,
      );
      assert.equal(
        stored.resolve("om_second")?.sessionModeThreadId,
        sharedCompletion.sessionModeThreadId,
      );
    }
    assert.equal(
      calls,
      2,
      "only the first observer in each order may send, even across restart",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("real native completion events and terminal rollout observations produce one Feishu card in either order", async () => {
  const root = mkdtempSync(join(tmpdir(), "feishu-observer-pair-"));
  const waitFor = async (check: () => boolean) => {
    const deadline = Date.now() + 2000;
    while (!check()) {
      assert.ok(Date.now() < deadline, "observers did not converge");
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };
  try {
    for (const nativeFirst of [true, false]) {
      const bindings = new FeishuReplyBindingStore({
        statePath: join(root, `${nativeFirst}.json`),
      });
      let sends = 0;
      const observed: FeishuCompletionEvent[] = [];
      const sender = new ScriptFeishuCompletionSender({
        scriptPath: "/workspace/notify.mjs",
        fallbackWorkingDirectory: "/workspace",
        deliveryHistory: bindings,
        runCommand: async () => {
          sends++;
          return {
            stdout: JSON.stringify({
              status: "sent",
              messages: [
                { messageId: "om_observer_card", chatId: "oc_private" },
              ],
            }),
          };
        },
      });
      const deliveryRecorder = {
        record: (
          event: FeishuCompletionEvent,
          delivery: { messages: Array<{ messageId: string; chatId: string }> },
        ) => {
          observed.push(event);
          bindings.record({
            ...event,
            completionId: event.completionId!,
            messages: delivery.messages,
          });
        },
      };
      let observation: FeishuCompletionObservation = {
        codexThreadId: sharedCompletion.sessionModeThreadId,
        completionId: "baseline-old-turn",
        content: "旧任务",
        completedAt: new Date(Date.now() - 60_000).toISOString(),
      };
      const source = new SnapshotSource({
        items: [makeNodeTmuxSession("running")],
        activeAgentSessionId: "session-1",
        updatedAt: new Date().toISOString(),
      });
      const stop = new AgentCompletionFeishuNotifier({
        source,
        sender,
        deliveryRecorder,
        settings: { get: () => ({ configured: true, enabled: true }) },
        contentResolver: {
          resolve: async () => observation.content,
          inspectLatestCompletion: async () => observation,
        },
        structuredCompletionProbeDelayMs: 0,
        structuredCompletionProbeIntervalMs: 0,
      }).start();
      const native = new SessionCodexFeishuNotifier({
        sender,
        deliveryRecorder,
        settings: { get: () => ({ configured: true, enabled: true }) },
        readThread: async () => ({
          thread: {
            id: sharedCompletion.sessionModeThreadId,
            source: "appServer",
            turns: [
              {
                id: sharedCompletion.completionId,
                status: "completed",
                items: [
                  {
                    type: "agentMessage",
                    phase: "final_answer",
                    text: "已经完成",
                  },
                ],
              },
            ],
          },
        }),
      });
      try {
        await new Promise((resolve) => setTimeout(resolve, 10));
        const triggerNative = async () => {
          await native.observe("runtime-observer-test", {
            seq: 1,
            event: "codex:notification",
            payload: {
              method: "turn/completed",
              params: {
                threadId: sharedCompletion.sessionModeThreadId,
                turn: {
                  id: sharedCompletion.completionId,
                  status: "completed",
                },
              },
            },
          });
          await native.drain();
        };
        const triggerTerminal = async () => {
          observation = {
            ...observation,
            completionId: sharedCompletion.completionId!,
            content: "已经完成",
            completedAt: new Date().toISOString(),
          };
          source.emitSession({
            ...makeNodeTmuxSession("running"),
            lastOutputAt: new Date().toISOString(),
          });
          await waitFor(() =>
            observed.some((event) => !event.sessionModeThreadId),
          );
        };
        if (nativeFirst) {
          await triggerNative();
          await triggerTerminal();
        } else {
          await triggerTerminal();
          await triggerNative();
        }
        assert.equal(
          observed.length,
          2,
          "both real observers must execute their completion path",
        );
        assert.equal(sends, 1, "the shared sender must invoke the bridge once");
        assert.equal(
          bindings.resolve("om_observer_card")?.sessionModeThreadId,
          sharedCompletion.sessionModeThreadId,
        );
      } finally {
        stop();
        await native.close();
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
