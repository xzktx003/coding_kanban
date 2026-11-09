import assert from "node:assert/strict";
import test from "node:test";

import type {
  AgentSessionRecord,
  ListAgentSessionsResponse,
} from "@agent-orchestrator/shared";

import {
  AgentCompletionFeishuNotifier,
  type FeishuCompletionEvent,
  type FeishuCompletionObservation,
  type StructuredCompletionChime,
} from "./agent-completion-feishu-notifier.js";

function session(
  interactionState: AgentSessionRecord["interactionState"],
  extras: Partial<AgentSessionRecord> = {},
): AgentSessionRecord {
  return {
    id: "session-1",
    workspaceId: "default",
    sourceType: "local",
    agentKind: "codex",
    displayName: "Codex",
    workingDirectory: "/workspace/app",
    connectionState: "online",
    interactionState,
    transportRef: { tmuxSession: "task", tmuxPane: "%1" },
    lastOutputAt: "2026-11-04T10:00:00.000Z",
    ...extras,
  };
}

class Source {
  #listener: ((snapshot: ListAgentSessionsResponse) => void) | null = null;
  #snapshot: ListAgentSessionsResponse;

  constructor(item: AgentSessionRecord) {
    this.#snapshot = {
      items: [item],
      activeAgentSessionId: item.id,
      updatedAt: "2026-11-04T10:00:00.000Z",
    };
  }

  subscribe(listener: (snapshot: ListAgentSessionsResponse) => void) {
    this.#listener = listener;
    listener(this.#snapshot);
    return () => {
      this.#listener = null;
    };
  }

  emit(item: AgentSessionRecord): void {
    this.#snapshot = {
      ...this.#snapshot,
      items: [item],
      updatedAt: new Date().toISOString(),
    };
    this.#listener?.(this.#snapshot);
  }
}

function observation(
  completionId: string,
  extras: Partial<FeishuCompletionObservation> = {},
): FeishuCompletionObservation {
  return {
    completionId,
    content: completionId,
    completedAt: "2026-11-04T10:00:01.000Z",
    ...extras,
  };
}

async function settled(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

test("structured completion chimes once even when Feishu delivery is off", async () => {
  const source = new Source(session("running"));
  let current = observation("baseline");
  const chimes: StructuredCompletionChime[] = [];
  const sent: FeishuCompletionEvent[] = [];
  const stop = new AgentCompletionFeishuNotifier({
    source,
    settings: {
      get: () => ({ configured: true, destinationType: "user", enabled: false }),
    },
    contentResolver: {
      resolve: async () => current.content,
      inspectLatestCompletions: async () => [current],
    },
    structuredCompletionProbeDelayMs: 0,
    structuredCompletionProbeIntervalMs: 0,
    onStructuredCompletion(chime) {
      chimes.push(chime);
    },
    sender: {
      send: async (event) => {
        sent.push(event);
      },
    },
  }).start();

  try {
    await settled();
    assert.equal(chimes.length, 0);
    assert.equal(sent.length, 0);

    current = observation("turn-1");
    source.emit(session("running", { lastOutputAt: "2026-11-04T10:00:02.000Z" }));
    await settled();
    assert.deepEqual(chimes, [
      { sessionId: "session-1", completionId: "turn-1", agentKind: "codex" },
    ]);
    assert.equal(sent.length, 0);

    source.emit(session("running", { lastOutputAt: "2026-11-04T10:00:03.000Z" }));
    await settled();
    assert.equal(chimes.length, 1);

    current = observation("goal-turn", {
      shouldNotify: false,
      pendingContinuationSource: true,
    });
    source.emit(session("running", { lastOutputAt: "2026-11-04T10:00:04.000Z" }));
    await settled();
    assert.equal(chimes.length, 1);

    current = observation("suppressed", { shouldNotify: false });
    source.emit(session("running", { lastOutputAt: "2026-11-04T10:00:05.000Z" }));
    await settled();
    source.emit(session("idle", { lastOutputAt: "2026-11-04T10:00:06.000Z" }));
    await settled();
    assert.equal(chimes.length, 1);
    assert.equal(sent.length, 0);
  } finally {
    stop();
  }
});

test("shell idle fallback and a throwing chime listener do not add or block Feishu", async () => {
  const source = new Source(
    session("running", {
      agentKind: "shell",
      displayName: "Shell",
      transportRef: { tmuxSession: "task", tmuxPane: "%7" },
    }),
  );
  const chimes: StructuredCompletionChime[] = [];
  const sent: FeishuCompletionEvent[] = [];
  const stop = new AgentCompletionFeishuNotifier({
    source,
    settings: {
      get: () => ({ configured: true, destinationType: "user", enabled: true }),
    },
    contentResolver: {
      resolve: async () => "shell output",
      inspectLatestCompletions: async () => {
        throw new Error("shell has no structured completion");
      },
    },
    structuredCompletionProbeDelayMs: 0,
    structuredCompletionProbeIntervalMs: 0,
    onStructuredCompletion() {
      chimes.push({
        sessionId: "unused",
        completionId: "unused",
        agentKind: "shell",
      });
      throw new Error("chime listener failed");
    },
    sender: {
      send: async (event) => {
        sent.push(event);
      },
    },
  }).start();

  try {
    source.emit(
      session("idle", {
        agentKind: "shell",
        displayName: "Shell",
        transportRef: { tmuxSession: "task", tmuxPane: "%7" },
        lastOutputAt: "2026-11-04T10:00:07.000Z",
      }),
    );
    await settled();
    assert.equal(chimes.length, 0);
    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.displayName, "Shell");
    assert.equal(sent[0]?.summary, "shell output");
  } finally {
    stop();
  }
});

test("a throwing chime listener still lets the structured Feishu card send", async () => {
  const source = new Source(session("running"));
  let current = observation("baseline");
  const sent: FeishuCompletionEvent[] = [];
  const stop = new AgentCompletionFeishuNotifier({
    source,
    settings: {
      get: () => ({ configured: true, destinationType: "user", enabled: true }),
    },
    contentResolver: {
      resolve: async () => current.content,
      inspectLatestCompletions: async () => [current],
    },
    structuredCompletionProbeDelayMs: 0,
    structuredCompletionProbeIntervalMs: 0,
    onStructuredCompletion() {
      throw new Error("chime listener failed");
    },
    sender: {
      send: async (event) => {
        sent.push(event);
      },
    },
  }).start();

  try {
    await settled();
    current = observation("turn-1");
    source.emit(session("running", { lastOutputAt: "2026-11-04T10:00:08.000Z" }));
    await settled();
    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.completionId, "turn-1");
  } finally {
    stop();
  }
});
