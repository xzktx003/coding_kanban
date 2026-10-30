import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { lstat, realpath, stat } from "node:fs/promises";
import { request } from "node:http";
import type { Socket } from "node:net";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { Duplex, Readable, Writable } from "node:stream";
import { discoverCodex } from "./executable.js";

const starts = new Map<string, Promise<void>>();
const upgradeTimeoutMs = 10_000;
const websocketGuid = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
export interface DaemonConnection {
  stream: Duplex;
  scope: string;
  /** Revalidate this connection's fixed endpoint binding, without RPC or process operations. */
  verifyIdentity(): Promise<string>;
}

/** Local deployment configuration only. No browser-supplied paths or process arguments. */
export function daemonConfig(env: NodeJS.ProcessEnv) {
  const configured = env.SESSION_CODEX_DAEMON_SOCKET;
  const home =
    env.CODEX_HOME || join(env.HOME || env.USERPROFILE || homedir(), ".codex");
  const socket =
    configured || join(home, "app-server-control", "app-server-control.sock");
  if (!isAbsolute(socket) || /[\x00-\x1f]/.test(socket))
    throw new Error("Invalid SESSION_CODEX_DAEMON_SOCKET");
  const auto = env.SESSION_CODEX_DAEMON_AUTO_START ?? "1";
  if (auto !== "0" && auto !== "1")
    throw new Error("Invalid SESSION_CODEX_DAEMON_AUTO_START");
  return { socket, home, autoStart: !configured && auto === "1" };
}

async function verifySocket(
  path: string,
): Promise<{ real: string; scope: string }> {
  const link = await lstat(path);
  if (!link.isSocket() && !link.isSymbolicLink())
    throw new Error("DAEMON_UNAVAILABLE: configured endpoint is not a socket");
  const resolved = await realpath(path);
  const [file, parent, rendezvousParent] = await Promise.all([
    stat(resolved),
    stat(dirname(resolved)),
    stat(dirname(path)),
  ]);
  const uid = process.getuid?.();
  // Official Linux deployments may publish an owned symlink into a private physical directory.
  // Validate both locations; never unlink or chmod an existing daemon endpoint.
  if (
    !file.isSocket() ||
    [link, file, parent, rendezvousParent].some(
      (value) => uid !== undefined && value.uid !== uid,
    ) ||
    (file.mode & 0o077) !== 0 ||
    (parent.mode & 0o022) !== 0 ||
    (rendezvousParent.mode & 0o022) !== 0
  )
    throw new Error(
      "DAEMON_UNAVAILABLE: endpoint ownership or permissions are unsafe",
    );
  return {
    real: resolved,
    scope: createHash("sha256")
      .update(JSON.stringify([resolved, file.dev, file.ino, file.ctimeMs]))
      .digest("hex"),
  };
}

async function startOfficialDaemon(
  env: NodeJS.ProcessEnv,
  home: string,
): Promise<void> {
  const command = await discoverCodex(env),
    key = JSON.stringify([command, home]);
  let work = starts.get(key);
  if (!work) {
    work = new Promise<void>((resolve, reject) => {
      // This idempotent official command owns daemon startup and its lock. Kanban never launches
      // a private app-server or sends daemon stop/restart/update, including on gateway shutdown.
      execFile(
        command,
        ["app-server", "daemon", "start"],
        { env, timeout: 20_000, maxBuffer: 64 * 1024, windowsHide: true },
        (error) => {
          if (error)
            reject(
              new Error(
                "DAEMON_UNAVAILABLE: official daemon start failed; configure or start the official daemon",
              ),
            );
          else resolve();
        },
      );
    });
    starts.set(key, work);
    void work
      .finally(() => {
        if (starts.get(key) === work) starts.delete(key);
      })
      .catch(() => {});
  }
  return work;
}

async function upgrade(
  path: string,
  signal?: AbortSignal,
): Promise<{ socket: Socket; head: Buffer }> {
  signal?.throwIfAborted();
  const key = randomBytes(16).toString("base64"),
    expected = createHash("sha1")
      .update(key + websocketGuid)
      .digest("base64");
  return new Promise((resolve, reject) => {
    const req = request({
      socketPath: path,
      path: "/",
      method: "GET",
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": key,
      },
    });
    let settled = false;
    const timer = setTimeout(
      () => req.destroy(new Error("DAEMON_UNAVAILABLE: connection timed out")),
      upgradeTimeoutMs,
    );
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    };
    const abort = () =>
      req.destroy(new Error("NOT_SENT: daemon connection cancelled"));
    signal?.addEventListener("abort", abort, { once: true });
    req.once("upgrade", (response, socket, head) => {
      cleanup();
      settled = true;
      if (
        response.statusCode !== 101 ||
        response.headers["sec-websocket-accept"] !== expected ||
        String(response.headers.upgrade).toLowerCase() !== "websocket" ||
        response.headers["sec-websocket-extensions"]
      ) {
        socket.destroy();
        reject(new Error("DAEMON_UNAVAILABLE: invalid WebSocket handshake"));
        return;
      }
      resolve({ socket, head });
    });
    req.once("response", (response) => {
      response.resume();
      req.destroy(
        new Error(
          "DAEMON_UNAVAILABLE: endpoint is not an official WebSocket service",
        ),
      );
    });
    req.once("error", (error) => {
      cleanup();
      if (!settled) reject(error);
    });
    req.end();
  });
}

/** Mask every client frame. The official daemon endpoint negotiates plain WebSocket, not JSONL. */
function frame(payload: Buffer, opcode = 1): Buffer {
  const extra = payload.length < 126 ? 0 : payload.length <= 65535 ? 2 : 8;
  const header = Buffer.alloc(2 + extra + 4),
    mask = randomBytes(4);
  header[0] = 0x80 | opcode;
  header[1] = 0x80 | (extra === 0 ? payload.length : extra === 2 ? 126 : 127);
  if (extra === 2) header.writeUInt16BE(payload.length, 2);
  if (extra === 8) header.writeBigUInt64BE(BigInt(payload.length), 2);
  mask.copy(header, 2 + extra);
  const masked = Buffer.allocUnsafe(payload.length);
  for (let i = 0; i < payload.length; i++)
    masked[i] = payload[i]! ^ mask[i & 3]!;
  return Buffer.concat([header, masked]);
}

/** Streaming frame reader: a 100 MiB tool result is projected without first retaining a 100 MiB WS message. */
function jsonLineStream(socket: Socket, head: Buffer): Duplex {
  const chunks = socket[Symbol.asyncIterator]();
  let current: Buffer = head,
    position = 0;
  const take = async (maximum: number): Promise<Buffer> => {
    while (position === current.length) {
      const next = await chunks.next();
      if (next.done)
        throw new Error("DELIVERY_UNKNOWN: daemon connection ended");
      current = next.value as Buffer;
      position = 0;
    }
    const result = current.subarray(
      position,
      Math.min(current.length, position + maximum),
    );
    position += result.length;
    return result;
  };
  const exact = async (length: number) => {
    const result = Buffer.allocUnsafe(length);
    let offset = 0;
    while (offset < length) {
      const piece = await take(length - offset);
      piece.copy(result, offset);
      offset += piece.length;
    }
    return result;
  };
  async function* messages() {
    let fragmented = false;
    try {
      while (true) {
        const header = await exact(2),
          first = header[0]!,
          second = header[1]!,
          opcode = first & 15,
          fin = !!(first & 128);
        if (first & 0x70 || second & 128 || ![0, 1, 8, 9, 10].includes(opcode))
          throw new Error(
            "DELIVERY_UNKNOWN: unsupported daemon WebSocket frame",
          );
        let length = BigInt(second & 127);
        if (length === 126n) length = BigInt((await exact(2)).readUInt16BE());
        else if (length === 127n) length = (await exact(8)).readBigUInt64BE();
        if (length > BigInt(Number.MAX_SAFE_INTEGER))
          throw new Error("DELIVERY_UNKNOWN: invalid daemon frame length");
        if (opcode >= 8) {
          if (!fin || length > 125n)
            throw new Error("DELIVERY_UNKNOWN: invalid daemon control frame");
          const payload = await exact(Number(length));
          if (opcode === 8) return;
          if (opcode === 9)
            await new Promise<void>((resolve, reject) =>
              socket.write(frame(payload, 10), (error) =>
                error ? reject(error) : resolve(),
              ),
            );
          continue;
        }
        if ((opcode === 0 && !fragmented) || (opcode === 1 && fragmented))
          throw new Error("DELIVERY_UNKNOWN: invalid daemon fragment order");
        fragmented = !fin;
        let remaining = Number(length);
        while (remaining > 0) {
          const piece = await take(Math.min(remaining, 4096));
          remaining -= piece.length;
          yield piece;
        }
        if (fin) yield Buffer.from("\n");
      }
    } finally {
      socket.destroy();
    }
  }
  const readable = Readable.from(messages(), {
    objectMode: false,
    highWaterMark: 64 * 1024,
  });
  const writable = new Writable({
    highWaterMark: 64 * 1024,
    write(value: Buffer, _encoding, callback) {
      // Callers write one complete JSON document per operation. Remove only the JSONL delimiter.
      const payload = value.at(-1) === 10 ? value.subarray(0, -1) : value;
      socket.write(frame(payload), callback);
    },
    final(callback) {
      socket.end(frame(Buffer.alloc(0), 8), callback);
    },
    destroy(error, callback) {
      socket.destroy();
      callback(error);
    },
  });
  const stream = Duplex.from({ readable, writable });
  stream.once("close", () => socket.destroy());
  socket.on("error", (error) => stream.destroy(error));
  return stream;
}

/** Attach only. Failure never falls back to a private instance and never replays an RPC. */
export async function connectDaemonStream(
  env: NodeJS.ProcessEnv = process.env,
  signal?: AbortSignal,
  resolveStartEnv?: () => Promise<NodeJS.ProcessEnv>,
): Promise<DaemonConnection> {
  const config = daemonConfig(env);
  const start = async () => {
    const launchEnv = resolveStartEnv ? await resolveStartEnv() : env;
    signal?.throwIfAborted();
    if (daemonConfig(launchEnv).socket !== config.socket)
      throw new Error(
        "DAEMON_UNAVAILABLE: startup environment changed the configured execution domain",
      );
    await startOfficialDaemon(launchEnv, config.home);
  };
  let endpoint: Awaited<ReturnType<typeof verifySocket>>;
  try {
    endpoint = await verifySocket(config.socket);
  } catch (error) {
    if (!config.autoStart || (error as NodeJS.ErrnoException).code !== "ENOENT")
      throw new Error(
        `DAEMON_UNAVAILABLE: ${error instanceof Error ? error.message : "invalid endpoint"}`,
      );
    signal?.throwIfAborted();
    await start();
    signal?.throwIfAborted();
    endpoint = await verifySocket(config.socket);
  }
  signal?.throwIfAborted();
  let connection: Awaited<ReturnType<typeof upgrade>>;
  try {
    connection = await upgrade(config.socket, signal);
  } catch (error) {
    if (
      !config.autoStart ||
      (error as NodeJS.ErrnoException).code !== "ECONNREFUSED"
    )
      throw new Error(
        `DAEMON_UNAVAILABLE: ${error instanceof Error ? error.message : "connection failed"}`,
      );
    await start();
    signal?.throwIfAborted();
    endpoint = await verifySocket(config.socket);
    connection = await upgrade(config.socket, signal);
  }
  // Detect a path replacement across the handshake rather than authorizing a connection by stale metadata.
  try {
    const current = await verifySocket(config.socket);
    signal?.throwIfAborted();
    if (current.scope !== endpoint.scope)
      throw new Error(
        "DAEMON_UNAVAILABLE: endpoint identity changed during connection",
      );
    return {
      stream: jsonLineStream(connection.socket, connection.head),
      scope: current.scope,
      verifyIdentity: async () => {
        let verified: Awaited<ReturnType<typeof verifySocket>>;
        try {
          verified = await verifySocket(config.socket);
        } catch {
          throw new Error(
            "NOT_SENT: official daemon endpoint binding changed or is unavailable",
          );
        }
        if (verified.scope !== current.scope)
          throw new Error("NOT_SENT: official daemon endpoint binding changed");
        return createHash("sha256")
          .update("official-daemon-endpoint-v1\0")
          .update(verified.scope)
          .digest("hex");
      },
    };
  } catch (error) {
    connection.socket.destroy();
    throw error;
  }
}
