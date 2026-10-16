// One immutable authorization anchor per native generation. Metadata only.
import { createServer, createConnection } from "node:net";
import { lstat, readFile, open, chmod, link, unlink } from "node:fs/promises";
import {
  lstatSync,
  realpathSync,
  openSync,
  writeFileSync,
  fsyncSync,
  closeSync,
} from "node:fs";
import { join } from "node:path";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { controlDirectory } from "./control-channel.mjs";
import { captureProcessIdentity } from "./resources.mjs";
import { validateNativeScope } from "./native-scope.mjs";
import { validateAuthorizationBinding } from "./authorization-boundary.mjs";
import { createControlPeer, exact, uuid } from "./control-peer.mjs";

const failure = () => Error("native authority unavailable");
const same = (a, b) => Object.keys(b).every((key) => a?.[key] === b[key]);
export function validateAuthorityIdentity(value) {
  if (
    !exact(value, "generation,pid,startTicks") ||
    !uuid(value.generation) ||
    !Number.isSafeInteger(value.pid) ||
    value.pid <= 1 ||
    typeof value.startTicks !== "string" ||
    !/^[1-9][0-9]{0,29}$/.test(value.startTicks)
  )
    throw failure();
  return Object.freeze({ ...value });
}
function privateRootSync(root) {
  const info = lstatSync(root);
  if (
    !info.isDirectory() ||
    info.uid !== process.getuid?.() ||
    (info.mode & 0o777) !== 0o700 ||
    realpathSync(root) !== root
  )
    throw failure();
}
function assertUnrevoked(root) {
  privateRootSync(root);
  try {
    lstatSync(join(root, "authority-revoked"));
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw failure();
  }
  throw failure();
}
function persistRevocation(runtimeRoot, scope, reason) {
  let fd;
  try {
    if (
      !["authorization-changed", "native-closed", "observer-closed"].includes(
        reason,
      )
    )
      throw failure();
    privateRootSync(runtimeRoot);
    fd = openSync(join(runtimeRoot, "authority-revoked"), "wx", 0o600);
    writeFileSync(
      fd,
      JSON.stringify({ version: 1, nativeScope: scope, reason }),
    );
    fsyncSync(fd);
    return true;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
function validateRecord(record) {
  if (
    !exact(
      record,
      "binding,generation,nativeScope,pid,socketDev,socketIno,startTicks,token,version",
    ) ||
    record.version !== 1 ||
    typeof record.token !== "string" ||
    !/^[a-f0-9]{64}$/.test(record.token) ||
    [record.socketDev, record.socketIno].some(
      (v) => typeof v !== "string" || !/^[0-9]{1,30}$/.test(v),
    )
  )
    throw failure();
  validateAuthorityIdentity({
    generation: record.generation,
    pid: record.pid,
    startTicks: record.startTicks,
  });
  validateNativeScope(record.nativeScope);
  validateAuthorizationBinding(record.binding);
  return record;
}
export async function readNativeAuthority({ runtimeRoot, scope, authority }) {
  await controlDirectory(runtimeRoot);
  assertUnrevoked(runtimeRoot);
  const path = join(runtimeRoot, "authority.json"),
    info = await lstat(path);
  if (
    !info.isFile() ||
    info.uid !== process.getuid?.() ||
    (info.mode & 0o777) !== 0o600 ||
    info.size > 4096
  )
    throw failure();
  const record = validateRecord(JSON.parse(await readFile(path, "utf8")));
  if (
    !same(record.nativeScope, validateNativeScope(scope)) ||
    (authority && !same(record, validateAuthorityIdentity(authority)))
  )
    throw failure();
  const live = await captureProcessIdentity(record.pid);
  if (live.startTicks !== record.startTicks) throw failure();
  const socket = await lstat(join(runtimeRoot, "authority.sock"), {
    bigint: true,
  });
  if (
    !socket.isSocket() ||
    Number(socket.uid) !== process.getuid?.() ||
    Number(socket.mode & 0o777n) !== 0o600 ||
    String(socket.dev) !== record.socketDev ||
    String(socket.ino) !== record.socketIno
  )
    throw failure();
  assertUnrevoked(runtimeRoot);
  return record;
}

export async function listenNativeAuthority({ runtimeRoot, scope, binding }) {
  await controlDirectory(runtimeRoot);
  scope = validateNativeScope(scope);
  binding = validateAuthorizationBinding(binding);
  for (const name of [
    "authority.json",
    "authority.sock",
    "authority-revoked",
  ]) {
    try {
      await lstat(join(runtimeRoot, name));
      throw Error(
        "existing or revoked native authority requires explicit recovery",
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const identity = Object.freeze({
    generation: randomUUID(),
    ...(await captureProcessIdentity(process.pid)),
  });
  const peers = new Set(),
    path = join(runtimeRoot, "authority.sock"),
    bindPath = join(runtimeRoot, ".auth-" + randomBytes(8).toString("hex"));
  let valid = true,
    record,
    socketIdentity,
    closing,
    listenerOwned = false;
  let resolveClosed;
  const closed = new Promise((resolve) => {
    resolveClosed = resolve;
  });
  const server = createServer((socket) => {
    if (!valid || !record || peers.size >= 128) {
      socket.destroy();
      return;
    }
    let authenticated = false,
      peer;
    const timer = setTimeout(() => peer.close(), 5000);
    timer.unref();
    peer = createControlPeer(socket, {
      handler(method, args) {
        // A verified consumer may observe the same native boundary first.
        // Revoke before filesystem checks: persistence failure must still close all peers.
        if (authenticated && method === "revoke" && exact(args, "")) {
          revoke("authorization-changed");
          return null;
        }
        assertUnrevoked(runtimeRoot);
        if (
          !valid ||
          authenticated ||
          method !== "hello" ||
          !exact(args, "generation,nativeScope,token,version") ||
          args.version !== 1 ||
          args.generation !== identity.generation ||
          !same(args.nativeScope, scope) ||
          typeof args.token !== "string" ||
          !/^[a-f0-9]{64}$/.test(args.token) ||
          !timingSafeEqual(
            Buffer.from(args.token, "hex"),
            Buffer.from(record.token, "hex"),
          )
        ) {
          peer.close();
          throw failure();
        }
        validateNativeScope(args.nativeScope);
        authenticated = true;
        clearTimeout(timer);
        return {
          version: 1,
          generation: identity.generation,
          nativeScope: scope,
          binding,
        };
      },
      onClose() {
        clearTimeout(timer);
        peers.delete(peer);
      },
    });
    peers.add(peer);
  });
  function closeTransport() {
    valid = false;
    for (const peer of [...peers]) peer.close();
    return (closing ??= (async () => {
      await new Promise((resolve, reject) =>
        server.close((error) =>
          error && error.code !== "ERR_SERVER_NOT_RUNNING"
            ? reject(error)
            : resolve(),
        ),
      );
      if (socketIdentity) {
        try {
          const info = await lstat(path, { bigint: true });
          if (
            info.dev === socketIdentity.dev &&
            info.ino === socketIdentity.ino
          )
            await unlink(path);
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      }
    })().finally(resolveClosed));
  }
  function revoke(reason = "observer-closed") {
    if (!valid) return false;
    valid = false;
    const persisted = persistRevocation(runtimeRoot, scope, reason);
    void closeTransport().catch(() => {});
    return persisted;
  }
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(bindPath, resolve);
    });
    listenerOwned = true;
    server.removeAllListeners("error");
    server.on("error", () => revoke());
    await chmod(bindPath, 0o600);
    await link(bindPath, path);
    socketIdentity = await lstat(path, { bigint: true });
    record = Object.freeze({
      version: 1,
      ...identity,
      nativeScope: scope,
      binding,
      token: randomBytes(32).toString("hex"),
      socketDev: String(socketIdentity.dev),
      socketIno: String(socketIdentity.ino),
    });
    const temporary = join(
      runtimeRoot,
      ".authority-" + randomBytes(8).toString("hex"),
    );
    try {
      if (!valid) throw failure();
      const file = await open(temporary, "wx", 0o600);
      try {
        await file.writeFile(JSON.stringify(record));
        await file.sync();
      } finally {
        await file.close();
      }
      await link(temporary, join(runtimeRoot, "authority.json"));
    } finally {
      await unlink(temporary).catch(() => {});
    }
    return {
      identity,
      record,
      closed,
      revoke,
      snapshot: () => ({
        available: valid,
        connections: peers.size,
        ...identity,
      }),
      async close() {
        if (valid) revoke();
        await closeTransport();
      },
    };
  } catch (error) {
    if (listenerOwned) await closeTransport().catch(() => {});
    throw error;
  }
}

export async function connectNativeAuthority({
  runtimeRoot,
  scope,
  authority,
}) {
  scope = validateNativeScope(scope);
  authority = validateAuthorityIdentity(authority);
  const record = await readNativeAuthority({ runtimeRoot, scope, authority });
  const socket = createConnection(join(runtimeRoot, "authority.sock"));
  const peer = createControlPeer(socket, {
    handler() {
      throw failure();
    },
    notice() {
      throw failure();
    },
  });
  let revoked = false,
    revoking;
  const assertCurrent = () => {
    if (revoked || !peer.open) throw failure();
    assertUnrevoked(runtimeRoot);
  };
  try {
    const hello = await peer.request("hello", {
      version: 1,
      generation: authority.generation,
      nativeScope: scope,
      token: record.token,
    });
    if (
      !exact(hello, "binding,generation,nativeScope,version") ||
      hello.version !== 1 ||
      hello.generation !== authority.generation ||
      !same(hello.nativeScope, scope) ||
      !same(validateAuthorizationBinding(hello.binding), record.binding)
    )
      throw failure();
    await readNativeAuthority({ runtimeRoot, scope, authority });
    assertCurrent();
  } catch (error) {
    peer.close();
    throw error;
  }
  return {
    binding: validateAuthorizationBinding(record.binding),
    assertCurrent,
    revoke() {
      if (revoked) return false;
      revoked = true;
      const persisted = persistRevocation(
        runtimeRoot,
        scope,
        "authorization-changed",
      );
      revoking = peer
        .request("revoke", {})
        .catch(() => {})
        .finally(() => peer.close());
      return persisted;
    },
    assertBinding(value) {
      assertCurrent();
      if (!same(validateAuthorizationBinding(value), record.binding))
        throw failure();
    },
    closed: peer.closed,
    async close() {
      await revoking;
      peer.close();
      await peer.closed;
    },
  };
}
