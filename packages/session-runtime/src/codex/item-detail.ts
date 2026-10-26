import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { PassThrough, Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import parser, { type Token } from "stream-json/parser.js";
import type { CodexOptions } from "./client.js";
import { discoverCodex } from "./executable.js";
import { HttpError } from "../core/json.js";
import { DetailSelector, type DetailRequest } from "./item-detail-selector.js";

// Process-wide admission: neither a service instance nor an HTTP connection owns a second slot.
const occupied = new Set<"detail" | "chat">();
const fail = (status: number, code: string) => new HttpError(status, code);
export const DETAIL_LIMITS = Object.freeze({
  inputBytes: 4096,
  byteQueue: 65536,
  tokenQueue: 16,
  depth: 128,
  header: 512,
  initializeMs: 10000,
  totalMs: 120000,
  idleMs: 15000,
  closeMs: 2000,
});
export interface DetailMetrics {
  inputBytes: number;
  outputBytes: number;
  maxInputChunk: number;
  maxParserQueue: number;
  maxOutputQueue: number;
  pid?: number;
  childExited: boolean;
  backpressureMs: number;
}
export interface DetailRead {
  body: Readable;
  finished: Promise<void>;
  metrics: DetailMetrics;
}
/** One independent read-only native transport. No shared StdioRpc, ownership, retry or persistent cache. */
export async function readItemDetail(
  options: Pick<CodexOptions, "env" | "resolveEnv" | "launch">,
  wanted: DetailRequest,
  signal: AbortSignal,
): Promise<DetailRead> {
  return readNativeProjection(options, {
    channel: "detail",
    method: "thread/read",
    params: { threadId: wanted.threadId, includeTurns: true },
    selector: (initialized, ready) => new DetailSelector(wanted, initialized, ready),
  }, signal);
}

/** Internal fixed read plans only: HTTP clients never supply methods or launch arguments. */
export async function readNativeProjection(
  options: Pick<CodexOptions, "env" | "resolveEnv" | "launch">,
  plan: {
    channel: "detail" | "chat";
    method: "thread/read" | "thread/turns/list";
    params: unknown;
    selector: (initialized: () => void, ready: () => void) => {
      consume(token: Token): Buffer[];
      readonly done: boolean;
      end(): void;
    };
  },
  signal: AbortSignal,
): Promise<DetailRead> {
  if (signal.aborted) throw fail(502, "DETAIL_CANCELLED");
  if (occupied.has(plan.channel)) throw fail(429, "DETAIL_BUSY");
  occupied.add(plan.channel);
  const body = new PassThrough({ highWaterMark: DETAIL_LIMITS.byteQueue });
  body.on("error", () => {}); // Consumers can attach after a pre-header failure.
  const metrics: DetailMetrics = {
    inputBytes: 0,
    outputBytes: 0,
    maxInputChunk: 0,
    maxParserQueue: 0,
    maxOutputQueue: 0,
    childExited: false,
    backpressureMs: 0,
  };
  const controller = new AbortController();
  let child: ChildProcessWithoutNullStreams | undefined;
  let nativeExited: Promise<void> | undefined;
  let resolveReady!: () => void, rejectReady!: (e: unknown) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  let lastProgress = performance.now(),
    blocked = false;
  let initTimer: ReturnType<typeof setTimeout> | undefined;
  const abort = (e: HttpError) => {
    if (!controller.signal.aborted) controller.abort(e);
  };
  const onAbort = () => abort(fail(502, "DETAIL_CANCELLED"));
  signal.addEventListener("abort", onAbort, { once: true });
  const total = setTimeout(
    () => abort(fail(504, "DETAIL_TIMEOUT")),
    DETAIL_LIMITS.totalMs,
  );
  const idle = setInterval(() => {
    if (!blocked && performance.now() - lastProgress >= DETAIL_LIMITS.idleMs)
      abort(fail(504, "DETAIL_TIMEOUT"));
  }, 250);
  const tokens = parser.asStream({
    jsonStreaming: true,
    packKeys: false,
    packStrings: false,
    packNumbers: false,
    streamKeys: true,
    streamStrings: true,
    streamNumbers: true,
    writableObjectMode: true,
    writableHighWaterMark: 1,
    readableObjectMode: true,
    readableHighWaterMark: DETAIL_LIMITS.tokenQueue,
  });
  tokens.on("error", () => {});
  const stopPipeline = () => {
    tokens.destroy(controller.signal.reason);
    body.destroy(controller.signal.reason);
    child?.stdout.destroy();
  };
  controller.signal.addEventListener("abort", stopPipeline, { once: true });
  const bodyClosed = () => {
    if (!body.writableFinished) onAbort();
  };
  body.once("close", bodyClosed);
  const write = async (chunk: Buffer) => {
    controller.signal.throwIfAborted();
    metrics.outputBytes += chunk.length;
    const flowing = body.write(chunk);
    metrics.maxOutputQueue = Math.max(
      metrics.maxOutputQueue,
      body.writableLength,
    );
    if (!flowing) {
      blocked = true;
      const start = performance.now();
      try {
        await once(body, "drain", { signal: controller.signal });
      } finally {
        metrics.backpressureMs += performance.now() - start;
        lastProgress = performance.now();
        blocked = false;
      }
    }
  };
  const send = (method: string, params?: unknown, id?: number) => {
    if (!child || controller.signal.aborted)
      throw fail(502, "DETAIL_CANCELLED");
    child.stdin.write(
      JSON.stringify({
        ...(id === undefined ? {} : { id }),
        method,
        ...(params === undefined ? {} : { params }),
      }) + "\n",
    );
  };
  const abortable = async <T>(work: Promise<T>): Promise<T> => {
    controller.signal.throwIfAborted();
    let cancel!: () => void;
    const stopped = new Promise<never>((_resolve, reject) => {
      cancel = () => reject(controller.signal.reason);
      controller.signal.addEventListener("abort", cancel, { once: true });
    });
    try {
      return await Promise.race([work, stopped]);
    } finally {
      controller.signal.removeEventListener("abort", cancel);
    }
  };
  const finished = (async () => {
    let feeding: Promise<void> | undefined;
    try {
      const env = options.resolveEnv
        ? await abortable(options.resolveEnv())
        : (options.env ?? process.env);
      controller.signal.throwIfAborted();
      const launch = options.launch ?? {
        command: await abortable(discoverCodex(env)),
        args: ["app-server", "-c", "thread_unload_delay_secs=2"],
      };
      controller.signal.throwIfAborted();
      child = spawn(launch.command, launch.args, {
        env,
        stdio: ["pipe", "pipe", "pipe"],
      });
      metrics.pid = child.pid;
      nativeExited = new Promise<void>((resolve) => {
        child!.once("exit", () => {
          metrics.childExited = true;
          resolve();
        });
        child!.once("error", () => {
          if (!child!.pid) {
            metrics.childExited = true;
            resolve();
          }
        });
      });
      child.on("error", () => abort(fail(503, "DETAIL_START_FAILED")));
      child.stdin.on("error", () => abort(fail(502, "DETAIL_NATIVE_ERROR")));
      child.stderr.resume(); // Drain and discard; never publish native text or credentials.
      initTimer = setTimeout(
        () => abort(fail(504, "DETAIL_TIMEOUT")),
        DETAIL_LIMITS.initializeMs,
      );
      const selector = plan.selector(
        () => {
          clearTimeout(initTimer);
          send("initialized");
          send(plan.method, plan.params, 2);
        },
        resolveReady,
      );
      const stdout = child.stdout;
      async function* chunks() {
        const decoder = new TextDecoder("utf-8", {
          fatal: true,
          ignoreBOM: true,
        });
        for await (const incoming of stdout) {
          const bytes = incoming as Buffer;
          for (
            let offset = 0;
            offset < bytes.length;
            offset += DETAIL_LIMITS.inputBytes
          ) {
            controller.signal.throwIfAborted();
            const piece = bytes.subarray(
              offset,
              offset + DETAIL_LIMITS.inputBytes,
            );
            lastProgress = performance.now();
            metrics.inputBytes += piece.length;
            metrics.maxInputChunk = Math.max(
              metrics.maxInputChunk,
              piece.length,
            );
            const text = decoder.decode(piece, { stream: true });
            if (text) yield text;
          }
        }
        const rest = decoder.decode();
        if (rest) yield rest;
      }
      feeding = pipeline(
        Readable.from(chunks(), { objectMode: true, highWaterMark: 1 }),
        tokens,
        { signal: controller.signal },
      );
      // Attach immediately so cancellation and early selected completion never create unhandled rejection.
      void feeding.catch(() => {});
      send(
        "initialize",
        {
          clientInfo: { name: plan.channel === "detail" ? "kanban_detail_reader" : "kanban_chat_reader", version: "1" },
          capabilities: { experimentalApi: true },
        },
        1,
      );
      for await (const token of tokens) {
        metrics.maxParserQueue = Math.max(
          metrics.maxParserQueue,
          tokens.readableLength,
        );
        for (const bytes of selector.consume(token as Token))
          await write(bytes);
        if (selector.done) break;
      }
      selector.end();
      body.end();
    } catch (error) {
      const safe = controller.signal.aborted
        ? controller.signal.reason
        : error instanceof HttpError
          ? error
          : fail(
              child ? 502 : 503,
              child ? "DETAIL_PROTOCOL_ERROR" : "DETAIL_START_FAILED",
            );
      rejectReady(safe);
      body.destroy(safe);
    } finally {
      clearTimeout(initTimer);
      clearTimeout(total);
      clearInterval(idle);
      signal.removeEventListener("abort", onAbort);
      controller.signal.removeEventListener("abort", stopPipeline);
      body.off("close", bodyClosed);
      tokens.destroy();
      child?.stdout.destroy();
      await feeding?.catch(() => {});
      if (child) {
        child.stdin.end();
        const wait = async () => {
          let timer: ReturnType<typeof setTimeout> | undefined;
          await Promise.race([
            nativeExited,
            new Promise<void>((r) => {
              timer = setTimeout(r, DETAIL_LIMITS.closeMs);
            }),
          ]);
          clearTimeout(timer);
        };
        if (!metrics.childExited) await wait();
        if (!metrics.childExited && child.pid) {
          child.kill("SIGTERM");
          await wait();
        }
        if (!metrics.childExited && child.pid) {
          child.kill("SIGKILL");
          await nativeExited;
        }
        child.stdin.destroy();
        child.stdout.destroy();
        child.stderr.destroy();
      }
      occupied.delete(plan.channel);
    }
  })();
  try {
    await ready;
  } catch (error) {
    await finished;
    throw error;
  }
  return { body, finished, metrics };
}
