import { spawn } from "node:child_process";
import type { Readable, Writable } from "node:stream";

import type { FeishuNotificationSettingsResponse } from "@agent-orchestrator/shared";

import type { FeishuInboundMessageEvent } from "./feishu-reply-command-service.js";

const EVENT_KEY = "im.message.receive_v1";
const READY_MARKER = `[event] ready event_key=${EVENT_KEY}`;
const MAX_STREAM_BUFFER_CHARACTERS = 1024 * 1024;
const MAX_RESTART_DELAY_MS = 30_000;

interface FeishuEventChildProcess {
  stdin: Pick<Writable, "end">;
  stdout: Pick<Readable, "on">;
  stderr: Pick<Readable, "on">;
  once(event: "error", listener: (error: Error) => void): this;
  once(
    event: "exit",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): this;
}

type SpawnFeishuEventProcess = (
  binary: string,
  args: string[],
  options: {
    env: NodeJS.ProcessEnv;
    stdio: ["pipe", "pipe", "pipe"];
    windowsHide: true;
  },
) => FeishuEventChildProcess;

interface FeishuReplyEventListenerOptions {
  settings: {
    get(): FeishuNotificationSettingsResponse;
    subscribe?(
      listener: (settings: FeishuNotificationSettingsResponse) => void,
    ): () => void;
  };
  handleEvent(event: FeishuInboundMessageEvent): Promise<unknown>;
  spawnProcess?: SpawnFeishuEventProcess;
  logError?: (error: unknown) => void;
}

function defaultSpawnProcess(
  binary: string,
  args: string[],
  options: Parameters<SpawnFeishuEventProcess>[2],
): FeishuEventChildProcess {
  return spawn(binary, args, options);
}

function shouldListen(settings: FeishuNotificationSettingsResponse): boolean {
  return (
    settings.replyConfigured &&
    settings.replyEnabled &&
    settings.destinationType === "user"
  );
}

export class FeishuReplyEventListener {
  readonly #settings: FeishuReplyEventListenerOptions["settings"];
  readonly #handleEvent: FeishuReplyEventListenerOptions["handleEvent"];
  readonly #spawnProcess: SpawnFeishuEventProcess;
  readonly #logError: (error: unknown) => void;
  #child: FeishuEventChildProcess | null = null;
  #unsubscribe: (() => void) | null = null;
  #restartTimer: NodeJS.Timeout | null = null;
  #restartDelayMs = 1_000;
  #desired = false;
  #started = false;
  #eventQueue = Promise.resolve();

  constructor(options: FeishuReplyEventListenerOptions) {
    this.#settings = options.settings;
    this.#handleEvent = options.handleEvent;
    this.#spawnProcess = options.spawnProcess ?? defaultSpawnProcess;
    this.#logError = options.logError ?? (() => {});
  }

  start(): () => void {
    if (this.#started) {
      return () => this.stop();
    }
    this.#started = true;
    this.#unsubscribe =
      this.#settings.subscribe?.((settings) => this.#reconcile(settings)) ??
      null;
    this.#reconcile(this.#settings.get());
    return () => this.stop();
  }

  stop(): void {
    if (!this.#started) {
      return;
    }
    this.#started = false;
    this.#desired = false;
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    if (this.#restartTimer) {
      clearTimeout(this.#restartTimer);
      this.#restartTimer = null;
    }
    this.#stopChild();
  }

  #reconcile(settings: FeishuNotificationSettingsResponse): void {
    this.#desired = this.#started && shouldListen(settings);
    if (!this.#desired) {
      if (this.#restartTimer) {
        clearTimeout(this.#restartTimer);
        this.#restartTimer = null;
      }
      this.#stopChild();
      return;
    }
    if (!this.#child && !this.#restartTimer) {
      this.#startChild();
    }
  }

  #startChild(): void {
    let child: FeishuEventChildProcess;
    try {
      child = this.#spawnProcess(
        "lark-cli",
        ["event", "consume", EVENT_KEY, "--as", "bot"],
        {
          env: {
            ...process.env,
            LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1",
            LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1",
          },
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
        },
      );
    } catch (error) {
      this.#logError(error);
      this.#scheduleRestart();
      return;
    }

    this.#child = child;
    let ready = false;
    let stdoutBuffer = "";
    let stderrBuffer = "";
    const pendingLines: string[] = [];

    const enqueueLine = (line: string) => {
      let parsed: FeishuInboundMessageEvent;
      try {
        parsed = JSON.parse(line) as FeishuInboundMessageEvent;
      } catch {
        this.#logError(new Error("Feishu event consumer emitted invalid JSON"));
        return;
      }
      this.#eventQueue = this.#eventQueue
        .then(() => this.#handleEvent(parsed))
        .then(() => undefined)
        .catch((error) => this.#logError(error));
    };

    const drainStdout = () => {
      let newlineIndex = stdoutBuffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = stdoutBuffer.slice(0, newlineIndex).trim();
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        if (line) {
          if (ready) {
            enqueueLine(line);
          } else {
            pendingLines.push(line);
          }
        }
        newlineIndex = stdoutBuffer.indexOf("\n");
      }
      if (stdoutBuffer.length > MAX_STREAM_BUFFER_CHARACTERS) {
        stdoutBuffer = "";
        this.#logError(new Error("Feishu event stdout buffer exceeded limit"));
      }
    };

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdoutBuffer += chunk.toString();
      drainStdout();
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderrBuffer += chunk.toString();
      let newlineIndex = stderrBuffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = stderrBuffer.slice(0, newlineIndex).trim();
        stderrBuffer = stderrBuffer.slice(newlineIndex + 1);
        if (line === READY_MARKER) {
          ready = true;
          this.#restartDelayMs = 1_000;
          for (const pendingLine of pendingLines.splice(0)) {
            enqueueLine(pendingLine);
          }
        }
        newlineIndex = stderrBuffer.indexOf("\n");
      }
      if (stderrBuffer.length > MAX_STREAM_BUFFER_CHARACTERS) {
        stderrBuffer = "";
        this.#logError(new Error("Feishu event stderr buffer exceeded limit"));
      }
    });

    let terminated = false;
    const handleTermination = (error?: unknown) => {
      if (terminated) {
        return;
      }
      terminated = true;
      if (error) {
        this.#logError(error);
      }
      if (this.#child === child) {
        this.#child = null;
      }
      this.#scheduleRestart();
    };
    child.once("error", (error) => handleTermination(error));
    child.once("exit", () => handleTermination());
  }

  #stopChild(): void {
    const child = this.#child;
    this.#child = null;
    child?.stdin.end();
  }

  #scheduleRestart(): void {
    if (!this.#desired || this.#restartTimer) {
      return;
    }
    const delayMs = this.#restartDelayMs;
    this.#restartDelayMs = Math.min(
      this.#restartDelayMs * 2,
      MAX_RESTART_DELAY_MS,
    );
    this.#restartTimer = setTimeout(() => {
      this.#restartTimer = null;
      if (this.#desired && !this.#child) {
        this.#startChild();
      }
    }, delayMs);
    this.#restartTimer.unref();
  }
}
