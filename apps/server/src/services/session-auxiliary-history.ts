import { createHash } from "node:crypto";
import { request as httpRequest } from "node:http";
import { constants } from "node:fs";
import {
  lstat,
  open,
  readdir,
  readlink,
  realpath,
  stat,
} from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
  AuxiliaryHistoryError,
  auxiliaryRecentProvider,
  auxiliaryRecentRequest,
} from "./auxiliary-history-projection.js";

type Library =
  typeof import("@agent-orchestrator/session-runtime/auxiliary-history");
type Reader = ReturnType<Library["createAuxiliaryHistoryReader"]>;
type Provider = "cc" | "acp";
interface SourceAnchor {
  scope: string;
  dataHome: string;
  nativeEnv: NodeJS.ProcessEnv;
  origin: string;
  instance: string;
  claudeIdentityRoot: string;
}
interface Options {
  attachmentRoot: string;
  origin: () => string | null;
  loadLibrary?: () => Promise<Library>;
}
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const identity = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 4096 &&
  !/[\x00-\x1f]/.test(value);
function unavailable(): never {
  throw new AuxiliaryHistoryError(
    501,
    "AUXILIARY_HISTORY_SOURCE_UNVERIFIED",
    "当前会话服务的本地历史来源无法核实，已保留原服务；请在安全维护窗口核对配置后重试。",
  );
}
export function auxiliaryLocalTarget(
  method: string,
  suffix: string,
): { provider: Provider; kind: "recent" | "detail" | "image" } | null {
  const provider = auxiliaryRecentProvider(method, suffix);
  if (provider) return { provider, kind: "recent" };
  if (method !== "POST") return null;
  const pathname = decodeURIComponent(
    new URL(suffix, "http://session.invalid").pathname,
  );
  for (const provider of ["cc", "acp"] as const) {
    const prefix =
      provider === "cc" ? "/api/cc/session-message" : "/api/acp/session";
    if (pathname === `${prefix}-detail`) return { provider, kind: "detail" };
    if (pathname === `${prefix}-image`) return { provider, kind: "image" };
  }
  return null;
}
function invalidRequest(): never {
  throw new AuxiliaryHistoryError(
    400,
    "AUXILIARY_HISTORY_INVALID_REQUEST",
    "无效的本地历史只读请求。",
  );
}
async function limited(
  path: string,
  limit: number,
  noFollow = true,
): Promise<Buffer> {
  const handle = await open(
    path,
    constants.O_RDONLY |
      constants.O_NONBLOCK |
      (noFollow ? constants.O_NOFOLLOW : 0),
  );
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > limit) unavailable();
    const chunks: Buffer[] = [];
    let bytes = 0;
    while (bytes <= limit) {
      const chunk = Buffer.alloc(Math.min(16384, limit + 1 - bytes));
      const read = await handle.read(chunk, 0, chunk.length, null);
      if (!read.bytesRead) return Buffer.concat(chunks, bytes);
      bytes += read.bytesRead;
      if (bytes > limit) unavailable();
      chunks.push(chunk.subarray(0, read.bytesRead));
    }
    unavailable();
  } finally {
    await handle.close();
  }
}
async function ownedDirectory(path: string) {
  const canonical = await realpath(path),
    info = await stat(canonical);
  if (
    !info.isDirectory() ||
    info.uid !== process.getuid?.() ||
    info.mode & 0o002
  )
    unavailable();
  return { path: canonical, dev: info.dev, ino: info.ino };
}
async function nativeDirectory(path: string) {
  try {
    return await ownedDirectory(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const parent = await ownedDirectory(dirname(path));
    return {
      path: join(parent.path, path.slice(dirname(path).length + 1)),
      missing: true,
    };
  }
}
function absolute(value: unknown): asserts value is string {
  if (!identity(value) || !isAbsolute(value)) unavailable();
}
function ticks(value: string): string {
  const fields = value
    .slice(value.lastIndexOf(")") + 2)
    .trim()
    .split(/\s+/);
  if (
    value.lastIndexOf(")") < 0 ||
    fields[0] === "Z" ||
    !/^[1-9]\d*$/.test(fields[19] ?? "")
  )
    unavailable();
  return fields[19]!;
}
async function ownedListen(pid: number, port: number, ipv6: boolean) {
  const files = await readdir(`/proc/${pid}/fd`);
  if (files.length > 4096) unavailable();
  const sockets = new Set<string>();
  for (const file of files) {
    try {
      const value = await readlink(`/proc/${pid}/fd/${file}`);
      const match = /^socket:\[(\d+)\]$/.exec(value);
      if (match) sockets.add(match[1]!);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  const table = (
    await limited(`/proc/${pid}/net/${ipv6 ? "tcp6" : "tcp"}`, 2 * 1024 * 1024)
  ).toString("utf8");
  const local = `${ipv6 ? "00000000000000000000000001000000" : "0100007F"}:${port.toString(16).toUpperCase().padStart(4, "0")}`;
  if (
    !table.split("\n").some((line) => {
      const fields = line.trim().split(/\s+/);
      return (
        fields[1] === local &&
        fields[3] === "0A" &&
        fields[7] === String(process.getuid?.()) &&
        sockets.has(fields[9] ?? "")
      );
    })
  )
    unavailable();
}
/** Direct loopback HTTP ignores gateway proxy credentials/environment. */
function metadata(
  origin: string,
  path: string,
  signal: AbortSignal,
  body?: Record<string, unknown>,
  maxBytes = 32768,
): Promise<{ status: number; value: any }> {
  return new Promise((accept, reject) => {
    const request = httpRequest(
      new URL(path, origin),
      {
        agent: false,
        method: body ? "POST" : "GET",
        signal: AbortSignal.any([signal, AbortSignal.timeout(2000)]),
        headers: body ? { "content-type": "application/json" } : undefined,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > maxBytes) {
            request.destroy();
            reject(new Error("Bounded runtime metadata exceeded"));
          } else chunks.push(chunk);
        });
        response.once("error", reject);
        response.once("end", () => {
          try {
            accept({
              status: response.statusCode ?? 0,
              value: JSON.parse(Buffer.concat(chunks, bytes).toString("utf8")),
            });
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    request.once("error", reject);
    request.end(body ? JSON.stringify(body) : undefined);
  });
}
async function health(origin: string, instance: string, signal: AbortSignal) {
  const response = await metadata(origin, "/health", signal);
  if (
    response.status !== 200 ||
    response.value?.status !== "ok" ||
    response.value.instance !== instance
  )
    unavailable();
}

/** Metadata only: no session history, account endpoint, shell or runtime startup. */
async function capture(
  options: Options,
  signal: AbortSignal,
): Promise<SourceAnchor> {
  signal.throwIfAborted();
  if (!process.getuid || !isAbsolute(options.attachmentRoot)) unavailable();
  const configured = resolve(options.attachmentRoot, ".."),
    data = await ownedDirectory(configured);
  const recordPath = join(data.path, "runtime.json"),
    recordInfo = await lstat(recordPath);
  if (
    !recordInfo.isFile() ||
    recordInfo.isSymbolicLink() ||
    recordInfo.uid !== process.getuid() ||
    recordInfo.mode & 0o077
  )
    unavailable();
  const bytes = await limited(recordPath, 65536),
    record = JSON.parse(bytes.toString("utf8"));
  const origin = options.origin();
  if (!origin) unavailable();
  const url = new URL(origin);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !Number.isSafeInteger(record.pid) ||
    record.pid <= 1 ||
    !Number.isSafeInteger(record.port) ||
    record.port < 1 ||
    record.port > 65535 ||
    Number(url.port) !== record.port ||
    !identity(record.instance)
  )
    unavailable();
  absolute(record.binary);
  if (record.entrypoint !== undefined) absolute(record.entrypoint);
  const proc = `/proc/${record.pid}`,
    processInfo = await stat(proc);
  if (processInfo.uid !== process.getuid()) unavailable();
  const started = ticks(
    (await limited(join(proc, "stat"), 16384)).toString("utf8"),
  );
  const args = (await limited(join(proc, "cmdline"), 65536))
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  if (
    args[0] !== record.binary ||
    (record.entrypoint && args[1] !== record.entrypoint) ||
    (record.startTicks !== undefined && record.startTicks !== started)
  )
    unavailable();
  const binary = await stat(record.binary),
    executable = await stat(join(proc, "exe"));
  if (binary.dev !== executable.dev || binary.ino !== executable.ino)
    unavailable();
  const env: NodeJS.ProcessEnv = {};
  for (const entry of (await limited(join(proc, "environ"), 1024 * 1024))
    .toString("utf8")
    .split("\0")) {
    const equals = entry.indexOf("="),
      key = entry.slice(0, equals);
    if (
      [
        "SESSION_DATA_HOME",
        "SESSION_RUNTIME_INSTANCE",
        "HOME",
        "USERPROFILE",
        "CLAUDE_CONFIG_DIR",
        "PATH",
        "SystemRoot",
        "SYSTEMROOT",
        "TMPDIR",
      ].includes(key)
    )
      env[key] = entry.slice(equals + 1);
  }
  absolute(env.SESSION_DATA_HOME);
  absolute(env.HOME);
  const runtimeData = await ownedDirectory(env.SESSION_DATA_HOME);
  if (
    runtimeData.dev !== data.dev ||
    runtimeData.ino !== data.ino ||
    env.SESSION_RUNTIME_INSTANCE !== record.instance
  )
    unavailable();
  const home = await ownedDirectory(env.HOME),
    claudePath = env.CLAUDE_CONFIG_DIR ?? join(env.HOME, ".claude");
  absolute(claudePath);
  const claude = await nativeDirectory(claudePath);
  const cwd = await readlink(join(proc, "cwd"));
  await ownedListen(record.pid, record.port, url.hostname === "[::1]");
  await health(url.origin, record.instance, signal);
  const again = await lstat(recordPath);
  if (
    again.dev !== recordInfo.dev ||
    again.ino !== recordInfo.ino ||
    !bytes.equals(await limited(recordPath, 65536)) ||
    ticks((await limited(join(proc, "stat"), 16384)).toString("utf8")) !==
      started
  )
    unavailable();
  signal.throwIfAborted();
  const nativeEnv: NodeJS.ProcessEnv = {
    ...env,
    HOME: home.path,
    CLAUDE_CONFIG_DIR: claude.path,
  };
  delete nativeEnv.SESSION_DATA_HOME;
  delete nativeEnv.SESSION_RUNTIME_INSTANCE;
  return {
    dataHome: data.path,
    nativeEnv,
    origin: url.origin,
    instance: record.instance,
    claudeIdentityRoot: claudePath,
    scope: digest({
      origin: url.origin,
      record: digest(bytes.toString("utf8")),
      data,
      uid: processInfo.uid,
      started,
      args,
      executable: [executable.dev, executable.ino],
      cwd,
      home,
      claude,
      nativeEnv,
      runtimeRoots: { home: env.HOME, claude: claudePath },
    }),
  };
}

/** Pins one verified managed runtime. A changed or missing anchor never rebinds. */
export class SessionAuxiliaryHistory {
  private anchor?: SourceAnchor;
  private reader?: Reader;
  private library?: Library;
  private initializing?: Promise<void>;
  constructor(private readonly options: Options) {}
  private async initialize(signal: AbortSignal) {
    if (this.reader) return;
    this.initializing ??= (async () => {
      const source = await capture(this.options, signal);
      if (this.anchor && this.anchor.scope !== source.scope) unavailable();
      this.anchor ??= source;
      const library = await (this.options.loadLibrary?.() ??
        import("@agent-orchestrator/session-runtime/auxiliary-history"));
      this.library = library;
      this.reader = library.createAuxiliaryHistoryReader({
        dataHome: source.dataHome,
        cacheHome: join(source.dataHome, ".auxiliary-history", source.scope),
        sourceScope: source.scope,
        nativeEnv: source.nativeEnv,
        claudeIdentityRoot: source.claudeIdentityRoot,
        resolveClaudeSession: (ownerId: string, current: AbortSignal) =>
          this.resolveClaudeSession(ownerId, current),
        verifySource: (current: AbortSignal) => this.verify(current),
      });
    })();
    try {
      await this.initializing;
    } finally {
      this.initializing = undefined;
    }
  }
  private async verify(signal: AbortSignal) {
    const source = await capture(this.options, signal);
    if (!this.anchor || source.scope !== this.anchor.scope) unavailable();
  }
  private async resolveClaudeSession(
    ownerId: string,
    signal: AbortSignal,
  ): Promise<string | undefined> {
    await this.verify(signal);
    const source = this.anchor!;
    const response = await metadata(
      source.origin,
      "/api/cc/session-snapshot",
      signal,
      { session_id: ownerId, expected_runtime_instance: source.instance },
      2 * 1024 * 1024,
    );
    await this.verify(signal);
    if ([404, 501].includes(response.status)) return undefined;
    const value = response.value;
    if (
      response.status !== 200 ||
      !value ||
      value.runtimeInstance !== source.instance ||
      value.sessionId !== ownerId ||
      !identity(value.eventSessionId) ||
      (value.nativeSessionId !== null && !identity(value.nativeSessionId))
    )
      throw new AuxiliaryHistoryError(
        409,
        "AUXILIARY_HISTORY_IDENTITY_UNVERIFIED",
        "Claude 历史身份暂时无法核实，请重新读取。",
      );
    return value.nativeSessionId ?? undefined;
  }
  private async read<T>(
    signal: AbortSignal,
    work: (reader: Reader, library: Library) => Promise<T>,
  ): Promise<T> {
    try {
      await this.initialize(signal);
      await this.verify(signal);
      const value = await work(this.reader!, this.library!);
      await this.verify(signal);
      return value;
    } catch (error) {
      if (signal.aborted) throw error;
      if (error instanceof AuxiliaryHistoryError) throw error;
      const status = (error as { statusCode?: unknown }).statusCode;
      if (
        [
          "HISTORY_IMAGE_BYTE_LIMIT",
          "HISTORY_IMAGE_PREVIEW_PIXEL_LIMIT",
        ].includes(String((error as { code?: unknown }).code))
      )
        throw new AuxiliaryHistoryError(
          Number(status),
          String((error as { code: string }).code),
          String((error as Error).message).slice(0, 512),
        );
      if (
        Number.isSafeInteger(status) &&
        Number(status) >= 400 &&
        Number(status) <= 599
      )
        throw new AuxiliaryHistoryError(
          Number(status),
          "AUXILIARY_HISTORY_READ_FAILED",
          "本地只读历史暂不可用，请核对来源后重试。",
        );
      unavailable();
    }
  }
  recent(
    provider: Provider,
    id: string,
    options: { cursor?: string; limit?: number; metadataOnly?: boolean },
    signal: AbortSignal,
  ) {
    return this.read(signal, async (reader) =>
      Response.json(await reader.readRecent(provider, id, options, signal)),
    );
  }
  detail(
    provider: Provider,
    id: string,
    item: string,
    options: { offset: number; limit: number },
    signal: AbortSignal,
  ) {
    return this.read(signal, async (reader) => {
      const value = await reader.readDetail(
        provider,
        id,
        item,
        options,
        signal,
      );
      if (
        !value ||
        value.format !== "json" ||
        typeof value.text !== "string" ||
        !/^[a-f0-9]{64}$/.test(value.itemRevision) ||
        typeof value.revision !== "string" ||
        value.revision.length > 512 ||
        (value.nextOffset !== null &&
          (!Number.isSafeInteger(value.nextOffset) ||
            value.nextOffset <= options.offset)) ||
        Buffer.byteLength(JSON.stringify(value)) > 65536
      )
        throw new AuxiliaryHistoryError(
          502,
          "AUXILIARY_HISTORY_INVALID",
          "会话服务返回了无效的历史详情。",
        );
      return Response.json(value);
    });
  }
  image(
    provider: Provider,
    id: string,
    item: string,
    index: number,
    download: boolean,
    signal: AbortSignal,
  ) {
    return this.read(signal, async (reader, library) => {
      const image = await reader.readImage(
        provider,
        id,
        item,
        index,
        download,
        signal,
      );
      if (
        image.bytes.length < 1 ||
        image.bytes.length > 10 * 1024 * 1024 ||
        !Number.isSafeInteger(image.width) ||
        image.width < 1 ||
        !Number.isSafeInteger(image.height) ||
        image.height < 1 ||
        !/^[a-f0-9]{64}$/.test(image.revision) ||
        !["image/png", "image/jpeg", "image/gif", "image/webp"].includes(
          image.mimeType,
        )
      )
        throw new AuxiliaryHistoryError(
          502,
          "AUXILIARY_HISTORY_INVALID",
          "会话服务返回了无效的历史图片。",
        );
      return new Response(new Uint8Array(image.bytes), {
        headers: library.historyImageHeaders(image, index, download),
      });
    });
  }
  response(
    target: NonNullable<ReturnType<typeof auxiliaryLocalTarget>>,
    suffix: string,
    body: unknown,
    signal: AbortSignal,
  ): Promise<Response> {
    if (target.kind === "recent") {
      const value = auxiliaryRecentRequest(target.provider, suffix, body);
      return this.recent(
        target.provider,
        value.sessionId,
        {
          limit: value.limit,
          metadataOnly: value.metadataOnly,
          ...(value.cursor ? { cursor: value.cursor } : {}),
        },
        signal,
      );
    }
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      new URL(suffix, "http://session.invalid").search
    )
      invalidRequest();
    const value = body as Record<string, unknown>,
      id =
        value.session_id ??
        (target.provider === "cc" ? value.sessionId : undefined);
    const keys =
      target.kind === "detail"
        ? ["session_id", "sessionId", "item_id", "offset", "limit"]
        : ["session_id", "sessionId", "item_id", "image_index", "download"];
    if (
      !identity(id) ||
      !identity(value.item_id) ||
      Object.keys(value).some((key) => !keys.includes(key))
    )
      invalidRequest();
    if (target.kind === "detail") {
      const offset = value.offset ?? 0,
        limit = value.limit ?? 65536;
      if (
        !Number.isSafeInteger(offset) ||
        Number(offset) < 0 ||
        !Number.isSafeInteger(limit) ||
        Number(limit) < 1 ||
        Number(limit) > 65536
      )
        invalidRequest();
      return this.detail(
        target.provider,
        id,
        value.item_id,
        { offset: Number(offset), limit: Number(limit) },
        signal,
      );
    }
    if (
      !Number.isSafeInteger(value.image_index) ||
      Number(value.image_index) < 0 ||
      Number(value.image_index) > 31 ||
      (value.download !== undefined && typeof value.download !== "boolean")
    )
      invalidRequest();
    return this.image(
      target.provider,
      id,
      value.item_id,
      Number(value.image_index),
      value.download === true,
      signal,
    );
  }
}
