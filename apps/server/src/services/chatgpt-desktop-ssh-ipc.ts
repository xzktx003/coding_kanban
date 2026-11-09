import { createServer, type Socket } from "node:net";
import { lstatSync, realpathSync, chmodSync, unlinkSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import type {
  ChatGptSshConnections,
  SshConnectionScope,
} from "./chatgpt-desktop-ssh-connections.js";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const MAX_LINE = 4 * 1024 * 1024 + 1024;
const CODES = new Set([
  "SSH_PROFILE_CHANGED",
  "SSH_ALIAS_UNAVAILABLE",
  "SSH_ALIAS_NOT_SAVED",
  "SSH_REQUEST_INVALID",
  "SSH_CONNECTION_EXISTS",
  "SSH_CONNECTION_UNAVAILABLE",
  "SSH_CONNECTION_LIMIT",
  "SSH_CONFIG_UNSAFE",
  "SSH_VERSION_PROBE_FAILED",
  "SSH_VERSION_PROBE_TIMEOUT",
  "SSH_VERSION_PROBE_LIMIT",
]);
const errorCode = (error: unknown) => {
  const code = (error as { code?: unknown })?.code;
  return typeof code === "string" && CODES.has(code)
    ? code
    : "SSH_CONNECTION_FAILED";
};
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const keys = (value: Record<string, unknown>, allowed: string[]) =>
  Object.keys(value).length === allowed.length &&
  Object.keys(value).every((k) => allowed.includes(k));

/** Server-owned UDS in the explicit native /bridge mount. Never an HTTP option. */
export async function startChatGptSshConnectionIpc({
  socketPath,
  connections,
}: {
  socketPath: string;
  connections: ChatGptSshConnections;
}) {
  const parent = dirname(socketPath),
    stat = lstatSync(parent);
  if (
    !isAbsolute(socketPath) ||
    resolve(socketPath) !== socketPath ||
    /[\x00-\x1f\x7f]/.test(socketPath) ||
    socketPath.length > 100 ||
    realpathSync(parent) !== parent ||
    !stat.isDirectory() ||
    stat.uid !== process.getuid!() ||
    (stat.mode & 0o777) !== 0o700
  )
    throw Error("Invalid fixed SSH IPC directory");
  try {
    lstatSync(socketPath);
    throw Error("SSH IPC path already exists");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  let ready = false;
  const clients = new Set<Socket>();
  const server = createServer((socket) => {
    if (!ready || clients.size >= 8) {
      socket.destroy();
      return;
    }
    clients.add(socket);
    let pending = Buffer.alloc(0),
      processing = false,
      opened = false,
      first = true,
      total = 0;
    let transport: { write(text: string): void; close(): void } | undefined;
    const send = async (value: unknown) => {
      const text = JSON.stringify(value) + "\n";
      if (
        Buffer.byteLength(text) > MAX_LINE ||
        socket.writableLength + Buffer.byteLength(text) > 8 * 1024 * 1024
      )
        throw Error("SSH IPC queue limit");
      if (!socket.write(text))
        await new Promise<void>((resolve, reject) => {
          const cleanup = () => {
            socket.off("drain", drain);
            socket.off("close", close);
            socket.off("error", close);
          };
          const drain = () => {
              cleanup();
              resolve();
            },
            close = () => {
              cleanup();
              reject(Error("SSH IPC closed"));
            };
          socket.once("drain", drain);
          socket.once("close", close);
          socket.once("error", close);
        });
    };
    const finish = () => {
      transport?.close();
      clients.delete(socket);
    };
    socket.on("close", finish);
    socket.on("error", () => socket.destroy());
    const deadline = setTimeout(() => socket.destroy(), 10_000);
    deadline.unref();
    async function handle(line: Buffer) {
      let value: any;
      try {
        value = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(line),
        );
      } catch {
        throw Error("SSH IPC invalid JSON");
      }
      if (first) {
        first = false;
        if (
          !object(value) ||
          value.v !== 1 ||
          !UUID.test(String(value.profileId)) ||
          !UUID.test(String(value.generation))
        )
          throw Error("SSH IPC invalid identity");
        const scope: SshConnectionScope = {
          id: value.profileId as string,
          generation: value.generation as string,
        };
        if (value.type === "open") {
          if (
            !keys(value, [
              "v",
              "type",
              "profileId",
              "generation",
              "connectionId",
            ]) ||
            !UUID.test(String(value.connectionId))
          )
            throw Error("SSH IPC invalid open");
          transport = await connections.attach(
            value.connectionId as string,
            scope,
            {
              send: (text) => send({ v: 1, type: "rpc", text }),
              close: () => socket.destroy(),
            },
          );
          await send({
            v: 1,
            type: "opened",
            connectionId: value.connectionId,
          });
          opened = true;
          clearTimeout(deadline);
          return;
        }
        if (
          value.type !== "request" ||
          !keys(value, [
            "v",
            "type",
            "id",
            "profileId",
            "generation",
            "method",
            "params",
          ]) ||
          !UUID.test(String(value.id)) ||
          !object(value.params)
        )
          throw Error("SSH IPC invalid request");
        let result: unknown;
        try {
          switch (value.method) {
            case "discover":
              if (!keys(value.params, [])) throw Error();
              result = await connections.discover(scope);
              break;
            case "refresh":
              if (!keys(value.params, [])) throw Error();
              result = await connections.refresh(scope);
              break;
            case "save":
              if (
                !keys(value.params, ["aliases"]) ||
                !Array.isArray(value.params.aliases)
              )
                throw Error();
              result = await connections.save(
                value.params.aliases as string[],
                scope,
              );
              break;
            case "version":
              if (
                !keys(value.params, ["alias"]) ||
                typeof value.params.alias !== "string"
              )
                throw Error();
              result = await connections.probeVersion(
                value.params.alias,
                scope,
              );
              break;
            case "connect":
              if (
                !keys(value.params, ["alias"]) ||
                typeof value.params.alias !== "string"
              )
                throw Error();
              result = await connections.connect(
                value.params.alias as string,
                scope,
              );
              break;
            case "disconnect":
              if (
                !keys(value.params, ["alias"]) ||
                typeof value.params.alias !== "string"
              )
                throw Error();
              result = await connections.disconnect(
                value.params.alias as string,
                scope,
              );
              break;
            default:
              throw Error();
          }
          await send({ v: 1, type: "reply", id: value.id, result });
        } catch (error) {
          await send({
            v: 1,
            type: "reply",
            id: value.id,
            error: { code: errorCode(error) },
          });
        }
        socket.end();
        return;
      }
      if (
        !opened ||
        !transport ||
        !object(value) ||
        !keys(value, ["v", "type", "text"]) ||
        value.v !== 1 ||
        value.type !== "rpc" ||
        typeof value.text !== "string"
      )
        throw Error("SSH IPC invalid frame");
      transport.write(value.text);
    }
    async function pump() {
      if (processing || socket.destroyed) return;
      processing = true;
      try {
        for (;;) {
          const at = pending.indexOf(10);
          if (at >= 0) {
            const line = pending.subarray(0, at);
            pending = pending.subarray(at + 1);
            if (line.length > (first ? 64 * 1024 : MAX_LINE))
              throw Error("SSH IPC frame limit");
            await handle(line);
            continue;
          }
          const size = Math.min(65_536, socket.readableLength);
          if (!size) break;
          const chunk = socket.read(size) as Buffer | null;
          if (!chunk) break;
          pending = Buffer.concat([pending, chunk]);
          total += chunk.length;
          if (
            pending.length > (first ? 64 * 1024 : MAX_LINE) ||
            (total > 16 * 1024 * 1024 && !opened)
          )
            throw Error("SSH IPC limit");
        }
      } catch {
        socket.destroy();
      } finally {
        processing = false;
        if (!socket.destroyed && socket.readableLength)
          queueMicrotask(() => void pump());
      }
    }
    socket.on("readable", () => void pump());
    socket.on("close", () => clearTimeout(deadline));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });
  chmodSync(socketPath, 0o600);
  const inode = lstatSync(socketPath);
  ready = true;
  return Object.freeze({
    async close() {
      ready = false;
      for (const client of clients) client.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      try {
        const now = lstatSync(socketPath);
        if (now.isSocket() && now.dev === inode.dev && now.ino === inode.ino)
          unlinkSync(socketPath);
      } catch {}
    },
  });
}
