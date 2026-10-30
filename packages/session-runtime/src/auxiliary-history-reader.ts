import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { opendir, stat } from "node:fs/promises";
import {
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  statSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import Database from "better-sqlite3";
import { ClaudeHistory, type historyCall } from "./claude/history.js";
import { HISTORY_WORKER_SOURCE } from "./claude/history-worker-source.js";
import { ClaudeSessionIdentity } from "./claude/session-identity.js";
import { validateSessionId } from "./claude/history.js";
import {
  acpRecentHistory,
  acpHistoryDetail,
  acpHistoryImage,
} from "./acp/history-projection.js";
import { HttpError } from "./core/json.js";
import { KeyedSerial } from "./core/serial.js";
import {
  historySessionIdentity,
  historyDetailOptions,
  historyBefore,
  historyCursor,
  recentHistoryOptions,
  type RecentHistoryOptions,
  type RecentHistoryPage,
} from "./core/recent-history.js";
import { historyImageOptions } from "./core/history-image.js";

export type AuxiliaryHistoryProvider = "cc" | "acp";
export interface AuxiliaryHistoryReaderOptions {
  /** Fixed managed-runtime directory. Never obtained from a request. */
  dataHome: string;
  /** Gateway-owned private derivative cache; never the runtime/native source. */
  cacheHome: string;
  /** Fixed runtime/source generation, used to namespace derivative projection. */
  sourceScope: string;
  /** Caller binds these to the same managed runtime's native filesystem home. */
  nativeEnv: NodeJS.ProcessEnv;
  /** Required ownership/scope check before source access and before publication. */
  verifySource: (signal: AbortSignal) => void | Promise<void>;
  /** Optional server-verified alias metadata; never a client native-ID override. */
  resolveClaudeSession?: (
    ownerId: string,
    signal: AbortSignal,
  ) => string | undefined | Promise<string | undefined>;
  /** Raw fixed runtime history-root spelling, for its existing alias namespace. */
  claudeIdentityRoot?: string;
}

function absolute(value: string) {
  if (!isAbsolute(value) || /[\x00-\x1f]/.test(value))
    throw new Error("Invalid auxiliary history directory");
  return resolve(value);
}
const overlaps = (a: string, b: string) =>
  a === b || a.startsWith(b + sep) || b.startsWith(a + sep);
function canonicalCandidate(path: string): string {
  const tail: string[] = [];
  let parent = path;
  for (;;) {
    try {
      return join(realpathSync(parent), ...tail.reverse());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const next = dirname(parent);
      if (next === parent) throw error;
      tail.push(parent.slice(next.length + (next.endsWith(sep) ? 0 : 1)));
      parent = next;
    }
  }
}
function privateDirectory(path: string) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const info = lstatSync(path);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    info.mode & 0o077 ||
    (process.getuid && info.uid !== process.getuid())
  )
    throw new Error(
      "Auxiliary history cache must be an owned private directory",
    );
  return realpathSync(path);
}
function privateFile(path: string) {
  try {
    closeSync(openSync(path, "wx", 0o600));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const info = lstatSync(path);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.nlink !== 1 ||
    info.mode & 0o077 ||
    (process.getuid && info.uid !== process.getuid())
  )
    throw new Error("Auxiliary projection must be an owned private file");
}

/** Only these two filesystem SDK calls can run. Cancellation signals our child only. */
export async function readClaudeHistoryWorker(
  method: "listSessions" | "getSessionMessages",
  args: unknown[],
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
  launch: typeof spawn = spawn,
): Promise<unknown> {
  signal.throwIfAborted();
  if (!["listSessions", "getSessionMessages"].includes(method))
    throw new Error("Readonly Claude history method required");
  return new Promise((resolveResult, reject) => {
    const child = launch(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        HISTORY_WORKER_SOURCE,
        import.meta.resolve("@anthropic-ai/claude-agent-sdk"),
        method,
        JSON.stringify(args),
      ],
      { env, stdio: ["ignore", "pipe", "pipe"] },
    );
    let forceTimer: ReturnType<typeof setTimeout> | undefined;
    let error: unknown,
      bytes = 0,
      stderr = "";
    const chunks: Buffer[] = [];
    const stop = (reason: unknown) => {
      error ??= reason;
      child.kill();
      forceTimer ??= setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null)
          child.kill("SIGKILL");
      }, 1000);
      forceTimer.unref();
    };
    const abort = () =>
      stop(signal.reason ?? new DOMException("Read cancelled", "AbortError"));
    const timer = setTimeout(
      () => stop(new HttpError(504, "Claude history read timed out")),
      30_000,
    );
    timer.unref();
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    child.stdout?.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 64 * 1024 * 1024)
        stop(new HttpError(413, "Claude history exceeds response limit"));
      else if (!error) chunks.push(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < 4096)
        stderr += chunk.toString().slice(0, 4096 - stderr.length);
    });
    child.once("error", (reason) => {
      error ??= reason;
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      clearTimeout(forceTimer);
      signal.removeEventListener("abort", abort);
      if (error) return reject(error);
      if (code !== 0)
        return reject(new Error(stderr || "Claude history read failed"));
      try {
        resolveResult(JSON.parse(Buffer.concat(chunks).toString()));
      } catch (reason) {
        reject(reason);
      }
    });
  });
}

/** No runtime, Agent, native connection, default IPC or source schema is initialized. */
export function createAuxiliaryHistoryReader(
  options: AuxiliaryHistoryReaderOptions,
) {
  if (
    typeof options.verifySource !== "function" ||
    !options.sourceScope ||
    options.sourceScope.length > 512
  )
    throw new Error("A fixed verified auxiliary history source is required");
  const dataHome = absolute(options.dataHome),
    cacheHome = absolute(options.cacheHome);
  const nativeHome = absolute(
    options.nativeEnv.HOME ?? options.nativeEnv.USERPROFILE ?? "",
  );
  const claudeHome = absolute(
    options.nativeEnv.CLAUDE_CONFIG_DIR ?? join(nativeHome, ".claude"),
  );
  const assertCacheLocation = () => {
    const candidate = canonicalCandidate(cacheHome);
    if (
      candidate === canonicalCandidate(dataHome) ||
      overlaps(candidate, canonicalCandidate(join(dataHome, ".codexia"))) ||
      overlaps(candidate, canonicalCandidate(claudeHome))
    )
      throw new Error("Auxiliary history cache overlaps a source directory");
  };
  assertCacheLocation();
  // Do not inherit NODE_OPTIONS, provider credentials or SDK/session-store flags.
  const env = Object.freeze(
    Object.fromEntries(
      [
        "HOME",
        "USERPROFILE",
        "CLAUDE_CONFIG_DIR",
        "PATH",
        "SystemRoot",
        "SYSTEMROOT",
        "TMPDIR",
      ]
        .filter((key) => typeof options.nativeEnv[key] === "string")
        .map((key) => [key, options.nativeEnv[key]]),
    ),
  );
  const sourceScope = options.sourceScope,
    verifySource = options.verifySource,
    resolveClaudeSession = options.resolveClaudeSession;
  const identityRoot =
    options.claudeIdentityRoot ??
    options.nativeEnv.CLAUDE_CONFIG_DIR ??
    join(options.nativeEnv.HOME ?? options.nativeEnv.USERPROFILE!, ".claude");
  absolute(identityRoot);
  const identity = new ClaudeSessionIdentity(dataHome, identityRoot);
  async function claudeSourceId(owner: string, signal: AbortSignal) {
    signal.throwIfAborted();
    const observed = await resolveClaudeSession?.(owner, signal);
    if (observed !== undefined) return validateSessionId(observed);
    const candidate = await identity.resolve(owner);
    let projects;
    try {
      projects = await opendir(join(claudeHome, "projects"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (projects) {
      let visited = 0;
      for await (const project of projects) {
        signal.throwIfAborted();
        if (!project.isDirectory() && !project.isSymbolicLink()) continue;
        if (++visited > 10_000)
          throw new HttpError(
            413,
            "Claude history metadata exceeds directory budget",
          );
        try {
          const file = await stat(
            join(claudeHome, "projects", project.name, `${candidate}.jsonl`),
          );
          if (file.isFile()) return candidate;
        } catch (error) {
          if (
            !["ENOENT", "ENOTDIR"].includes(
              (error as NodeJS.ErrnoException).code ?? "",
            )
          )
            throw error;
        }
      }
    }
    throw new HttpError(409, "Claude 历史身份暂不可核实，请稍后重试。");
  }
  const serial = new KeyedSerial();
  const verify = async (signal: AbortSignal) => {
    signal.throwIfAborted();
    await verifySource(signal);
    signal.throwIfAborted();
  };
  async function read<T>(
    provider: AuxiliaryHistoryProvider,
    id: string,
    signal: AbortSignal | undefined,
    work: (context: {
      cc?: ClaudeHistory;
      ccId?: string;
      source?: Database.Database;
      projection?: Database.Database;
      signal: AbortSignal;
    }) => Promise<T> | T,
  ) {
    if (provider !== "cc" && provider !== "acp")
      throw new HttpError(400, "Invalid history provider");
    historySessionIdentity(id);
    if (provider === "cc") validateSessionId(id);
    const active = signal ?? new AbortController().signal;
    return serial.run(provider, async () => {
      await verify(active);
      assertCacheLocation();
      const cache = privateDirectory(cacheHome);
      // Resolve after creation as well; a symlinked cache parent cannot reach a source.
      if (
        overlaps(cache, realpathSync(join(dataHome, ".codexia"))) ||
        overlaps(cache, claudeHome)
      )
        throw new Error("Auxiliary history cache overlaps a source directory");
      if (provider === "cc") {
        const ccCache = privateDirectory(join(cache, "cc"));
        const ccMetadata = privateDirectory(join(ccCache, ".codexia"));
        privateFile(join(ccMetadata, "cache.db"));
        const ccId = await claudeSourceId(id, active);
        await verify(active);
        const cc = new ClaudeHistory(ccCache, env, {
          call: ((method, args, callEnv) => {
            if (method === "deleteSession")
              throw new Error("Readonly history cannot delete a session");
            return readClaudeHistoryWorker(method, args, callEnv, active);
          }) as typeof historyCall,
        });
        const result = await work({ cc, ccId, signal: active });
        if ((await claudeSourceId(id, active)) !== ccId)
          throw new HttpError(
            409,
            "Claude history identity changed; retry the readonly history.",
          );
        await verify(active);
        return result;
      }
      const sourcePath = join(dataHome, ".codexia", "cache.db"),
        info = lstatSync(sourcePath);
      if (
        !info.isFile() ||
        info.isSymbolicLink() ||
        (process.getuid && info.uid !== process.getuid())
      )
        throw new HttpError(501, "当前运行服务没有可核实的本地 ACP 历史源。");
      const source = new Database(sourcePath, {
        readonly: true,
        fileMustExist: true,
      });
      let projection: Database.Database | undefined;
      try {
        source.pragma("query_only=ON");
        source.pragma("busy_timeout=5000");
        if (
          !source
            .prepare("SELECT 1 FROM acp_sessions WHERE session_id=?")
            .get(id)
        )
          throw new HttpError(404, "ACP 历史会话不存在。");
        const sourceKey = createHash("sha256")
          .update(
            JSON.stringify([
              sourceScope,
              realpathSync(sourcePath),
              info.dev,
              info.ino,
            ]),
          )
          .digest("hex");
        const path = join(cache, `acp-${sourceKey}.db`);
        privateFile(path);
        projection = new Database(path, { fileMustExist: true });
        projection.pragma("busy_timeout=5000");
        const result = await work({ source, projection, signal: active });
        const after = statSync(sourcePath);
        if (after.dev !== info.dev || after.ino !== info.ino)
          throw new HttpError(409, "ACP 历史源已变化，请重新读取。");
        await verify(active);
        return result;
      } finally {
        projection?.close();
        source.close();
      }
    });
  }
  return {
    readRecent(
      provider: AuxiliaryHistoryProvider,
      id: string,
      options: RecentHistoryOptions = {},
      signal?: AbortSignal,
    ): Promise<RecentHistoryPage<Record<string, unknown>>> {
      recentHistoryOptions(options as Record<string, unknown>);
      return read(
        provider,
        id,
        signal,
        async ({ cc, ccId, source, projection, signal }) => {
          if (!cc)
            return acpRecentHistory(projection!, id, options, source!, signal);
          const before = historyBefore("cc", id, options.cursor);
          const page = await cc.recentMessages(ccId!, {
            ...options,
            ...(before ? { cursor: historyCursor("cc", ccId!, before) } : {}),
          });
          const next = historyBefore("cc", ccId!, page.nextCursor ?? undefined);
          return {
            ...page,
            data: page.data.map(
              (row): Record<string, unknown> => ({ ...row, session_id: id }),
            ),
            nextCursor: next ? historyCursor("cc", id, next) : null,
          };
        },
      );
    },
    readDetail(
      provider: AuxiliaryHistoryProvider,
      id: string,
      itemId: string,
      options: { offset: number; limit: number },
      signal?: AbortSignal,
    ) {
      historyDetailOptions({ item_id: itemId, ...options });
      return read(provider, id, signal, ({ cc, ccId, source, projection }) =>
        cc
          ? cc.messageDetail(ccId!, itemId, options)
          : acpHistoryDetail(projection!, id, itemId, options, source!),
      );
    },
    readImage(
      provider: AuxiliaryHistoryProvider,
      id: string,
      itemId: string,
      index: number,
      download = false,
      signal?: AbortSignal,
    ) {
      historyImageOptions({ item_id: itemId, image_index: index, download });
      return read(provider, id, signal, ({ cc, ccId, source }) =>
        cc
          ? cc.messageImage(ccId!, itemId, index, download)
          : acpHistoryImage(source!, id, itemId, index, download),
      );
    },
  };
}
