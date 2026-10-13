import type { ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";

import { AgentSessionRegistry } from "./agent-session-registry.js";
import { PtyRuntimeManager } from "./pty-runtime-manager.js";
import { subscribeTerminalOutput } from "./terminal-output-subscription.js";
import { resolveTerminalReplayByteLimit } from "./terminal-replay-window.js";

const MAX_STREAM_SUBSCRIPTIONS = 64;
const MAX_IDENTIFIER_LENGTH = 256;
const MAX_WRITABLE_QUEUE_BYTES = 8 * 1024 * 1024;
const HEARTBEAT_INTERVAL_MS = 15_000;

export type TerminalStreamReadyFrame = {
  type: "ready";
  streamId: string;
};

export type TerminalStreamOutputFrame = {
  type: "frame";
  subscriptionId: string;
  agentSessionId: string;
  frame: string;
};

export type TerminalReplayBytesInput = string | number | undefined;

interface TerminalStreamSubscription {
  agentSessionId: string;
  terminalConnectionId: string;
  unsubscribe: () => void;
}

interface TerminalStreamConnection {
  closed: boolean;
  heartbeat: NodeJS.Timeout | null;
  response: ServerResponse;
  subscriptions: Map<string, TerminalStreamSubscription>;
}

export interface TerminalHttpMultiplexerOptions {
  maxScrollbackBytes: number;
  maxSubscriptions?: number;
  maxWritableQueueBytes?: number;
}

export class TerminalHttpMultiplexer {
  private readonly streams = new Map<string, TerminalStreamConnection>();
  private readonly maxSubscriptions: number;
  private readonly maxWritableQueueBytes: number;

  constructor(
    private readonly dependencies: {
      registry: AgentSessionRegistry;
      ptyRuntimeManager: PtyRuntimeManager;
    },
    private readonly options: TerminalHttpMultiplexerOptions,
  ) {
    this.maxSubscriptions =
      options.maxSubscriptions ?? MAX_STREAM_SUBSCRIPTIONS;
    this.maxWritableQueueBytes =
      options.maxWritableQueueBytes ?? MAX_WRITABLE_QUEUE_BYTES;
  }

  createStream(response: ServerResponse): string {
    const streamId = randomUUID();
    const connection: TerminalStreamConnection = {
      closed: false,
      heartbeat: null,
      response,
      subscriptions: new Map(),
    };
    this.streams.set(streamId, connection);

    const close = () => this.closeStream(streamId);
    response.once("close", close);
    response.once("error", close);

    connection.heartbeat = setInterval(() => {
      this.writeLine(streamId, "");
    }, HEARTBEAT_INTERVAL_MS);
    connection.heartbeat.unref();

    this.writeJson(streamId, {
      type: "ready",
      streamId,
    } satisfies TerminalStreamReadyFrame);

    return streamId;
  }

  subscribe(
    streamId: string,
    input: {
      agentSessionId: string;
      subscriptionId: string;
      replayBytes?: TerminalReplayBytesInput;
    },
  ):
    | "ok"
    | "invalid"
    | "conflict"
    | "missing-stream"
    | "missing-session"
    | "too-many" {
    const connection = this.streams.get(streamId);
    if (!connection || connection.closed) {
      return "missing-stream";
    }

    if (
      !isValidIdentifier(input.agentSessionId) ||
      !isValidSubscriptionId(input.subscriptionId)
    ) {
      return "invalid";
    }

    const existingSubscription = connection.subscriptions.get(
      input.subscriptionId,
    );
    if (existingSubscription) {
      return existingSubscription.agentSessionId === input.agentSessionId
        ? "ok"
        : "conflict";
    }

    if (connection.subscriptions.size >= this.maxSubscriptions) {
      return "too-many";
    }

    const replayBytes = normalizeReplayBytes(input.replayBytes);
    if (replayBytes === null) {
      return "invalid";
    }

    const replayByteLimit = resolveTerminalReplayByteLimit(
      replayBytes,
      this.options.maxScrollbackBytes,
    );
    const terminalConnectionId = randomUUID();
    const unsubscribe = subscribeTerminalOutput(
      input.agentSessionId,
      replayByteLimit,
      this.dependencies,
      (frame) => {
        this.writeJson(streamId, {
          type: "frame",
          subscriptionId: input.subscriptionId,
          agentSessionId: input.agentSessionId,
          frame,
        } satisfies TerminalStreamOutputFrame);
      },
    );

    if (!unsubscribe) {
      this.dependencies.ptyRuntimeManager.releaseTerminalConnection(
        input.agentSessionId,
        terminalConnectionId,
      );
      return "missing-session";
    }

    if (connection.closed) {
      unsubscribe();
      this.dependencies.ptyRuntimeManager.releaseTerminalConnection(
        input.agentSessionId,
        terminalConnectionId,
      );
      return "missing-stream";
    }

    connection.subscriptions.set(input.subscriptionId, {
      agentSessionId: input.agentSessionId,
      terminalConnectionId,
      unsubscribe,
    });
    return "ok";
  }

  unsubscribe(
    streamId: string,
    subscriptionId: string,
  ): "ok" | "invalid" | "missing-stream" {
    const connection = this.streams.get(streamId);
    if (!connection || connection.closed) {
      return "missing-stream";
    }
    if (!isValidSubscriptionId(subscriptionId)) {
      return "invalid";
    }

    this.removeSubscription(connection, subscriptionId);
    return "ok";
  }

  closeAllStreams(): void {
    for (const streamId of [...this.streams.keys()]) {
      this.closeStream(streamId, { closeResponse: true });
    }
  }

  closeStream(
    streamId: string,
    options: { closeResponse?: boolean } = {},
  ): void {
    const connection = this.streams.get(streamId);
    if (!connection || connection.closed) {
      return;
    }

    connection.closed = true;
    this.streams.delete(streamId);
    if (connection.heartbeat) {
      clearInterval(connection.heartbeat);
      connection.heartbeat = null;
    }

    for (const subscriptionId of connection.subscriptions.keys()) {
      this.removeSubscription(connection, subscriptionId);
    }

    if (options.closeResponse && !connection.response.destroyed) {
      try {
        connection.response.end();
      } finally {
        if (!connection.response.destroyed) {
          connection.response.destroy();
        }
      }
    }
  }

  getActiveStreamCount(): number {
    return this.streams.size;
  }

  private removeSubscription(
    connection: TerminalStreamConnection,
    subscriptionId: string,
  ): void {
    const subscription = connection.subscriptions.get(subscriptionId);
    if (!subscription) {
      return;
    }

    connection.subscriptions.delete(subscriptionId);
    subscription.unsubscribe();
    this.dependencies.ptyRuntimeManager.releaseTerminalConnection(
      subscription.agentSessionId,
      subscription.terminalConnectionId,
    );
  }

  private writeJson(streamId: string, payload: unknown): void {
    this.writeLine(streamId, JSON.stringify(payload));
  }

  private writeLine(streamId: string, line: string): void {
    const connection = this.streams.get(streamId);
    if (!connection || connection.closed || connection.response.destroyed) {
      return;
    }

    const chunk = `${line}\n`;
    const nextWritableBytes =
      connection.response.writableLength + Buffer.byteLength(chunk);
    if (nextWritableBytes > this.maxWritableQueueBytes) {
      connection.response.destroy();
      this.closeStream(streamId);
      return;
    }

    connection.response.write(chunk);
  }
}

export function isValidIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= MAX_IDENTIFIER_LENGTH
  );
}

export function isValidSubscriptionId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

export function normalizeReplayBytes(
  value: TerminalReplayBytesInput,
): string | undefined | null {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value <= 0) {
      return null;
    }
    return String(value);
  }

  if (!/^\d+$/.test(value)) {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return null;
  }

  return value;
}
