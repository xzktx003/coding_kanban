// Explicit, owner-only Unix endpoint. The native task service is never stopped here.
import { createServer, createConnection } from "node:net";
import { lstat, realpath, chmod, link, unlink } from "node:fs/promises";
import { join, isAbsolute, resolve } from "node:path";
import { randomUUID, randomBytes, timingSafeEqual } from "node:crypto";
import { captureProcessIdentity } from "./resources.mjs";
import { validateNativeScope } from "./native-scope.mjs";
import { createVisibleLeaseController } from "./visibility-leases.mjs";
import { createControlPeer, exact, uuid } from "./control-peer.mjs";
import { validateAuthorizationBinding } from "./authorization-boundary.mjs";

export async function controlDirectory(root) {
  if (
    typeof root !== "string" ||
    !isAbsolute(root) ||
    resolve(root) !== root ||
    /[\x00-\x1f\x7f]/.test(root)
  )
    throw Error("canonical private control directory required");
  const info = await lstat(root);
  if (
    !info.isDirectory() ||
    info.uid !== process.getuid?.() ||
    (info.mode & 0o777) !== 0o700 ||
    (await realpath(root)) !== root
  )
    throw Error("owned private control directory required");
  if (Buffer.byteLength(join(root, ".bind-" + "a".repeat(16))) > 103)
    throw Error("private control socket path too long");
}
const sameScope = (a, b) =>
  ["domain", "generation", "pid", "startTicks"].every(
    (key) => a?.[key] === b[key],
  );
const ready = (manager) => {
  const s = manager.snapshot();
  return s.ready === true && s.authorizationBound === true;
};
export function validateControlRecord(record) {
  if (
    !exact(
      record,
      "generation,nativeScope,pid,socketDev,socketIno,startTicks,token,version",
    ) ||
    record.version !== 1 ||
    !uuid(record.generation) ||
    !Number.isSafeInteger(record.pid) ||
    record.pid <= 1 ||
    typeof record.startTicks !== "string" ||
    !/^[1-9][0-9]{0,29}$/.test(record.startTicks) ||
    typeof record.token !== "string" ||
    !/^[a-f0-9]{64}$/.test(record.token) ||
    [record.socketDev, record.socketIno].some(
      (v) => typeof v !== "string" || !/^[0-9]{1,30}$/.test(v),
    )
  )
    throw Error("exact private control record required");
  validateNativeScope(record.nativeScope);
  return record;
}
async function endpointInfo(root, record) {
  await controlDirectory(root);
  validateControlRecord(record);
  const processInfo = await captureProcessIdentity(record.pid);
  if (processInfo.startTicks !== record.startTicks)
    throw Error("private control process replaced");
  const path = join(root, "control.sock"),
    info = await lstat(path, { bigint: true });
  if (
    !info.isSocket() ||
    Number(info.uid) !== process.getuid?.() ||
    Number(info.mode & 0o777n) !== 0o600 ||
    String(info.dev) !== record.socketDev ||
    String(info.ino) !== record.socketIno ||
    (await realpath(path)) !== path
  )
    throw Error("private control endpoint replaced");
  return path;
}

export async function listenRefreshControl({
  manager,
  runtimeRoot,
  profiles,
  leaseGraceMs = 60000,
}) {
  await controlDirectory(runtimeRoot);
  if (
    !Array.isArray(profiles) ||
    !profiles.length ||
    profiles.length > 32 ||
    profiles.some((id) => !uuid(id)) ||
    new Set(profiles).size !== profiles.length
  )
    throw Error("bounded registered control profiles required");
  const nativeScope = validateNativeScope(manager.serviceScope);
  if (!ready(manager)) throw Error("verified native control manager required");
  const path = join(runtimeRoot, "control.sock");
  try {
    await lstat(path);
    throw Error("existing control endpoint requires explicit recovery");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const controllers = new Map();
  try {
    for (const profileId of profiles)
      controllers.set(
        profileId,
        createVisibleLeaseController({ manager, profileId, leaseGraceMs }),
      );
  } catch (error) {
    await Promise.all(
      [...controllers.values()].map((controller) => controller.close()),
    );
    throw error;
  }
  const peers = new Set(),
    contexts = new Set();
  let stopped = false,
    closing,
    activeOperations = 0,
    record;
  const bindPath = join(runtimeRoot, ".bind-" + randomBytes(8).toString("hex"));
  const server = createServer((socket) => {
    if (stopped || peers.size >= 32 || !record) {
      socket.destroy();
      return;
    }
    let authenticated = false,
      peer;
    const handles = new Map();
    const context = { handles };
    contexts.add(context);
    const helloTimer = setTimeout(() => peer.close(), 5000);
    helloTimer.unref();
    peer = createControlPeer(socket, {
      async handler(method, args) {
        if (!authenticated) {
          if (
            method !== "hello" ||
            !exact(args, "generation,nativeScope,token,version") ||
            args.version !== 1 ||
            args.generation !== record.generation ||
            !sameScope(args.nativeScope, nativeScope) ||
            typeof args.token !== "string" ||
            !/^[a-f0-9]{64}$/.test(args.token) ||
            !timingSafeEqual(
              Buffer.from(args.token, "hex"),
              Buffer.from(record.token, "hex"),
            ) ||
            !ready(manager)
          ) {
            peer.close();
            throw Error("private control admission failed");
          }
          validateNativeScope(args.nativeScope);
          authenticated = true;
          clearTimeout(helloTimer);
          return {
            version: 1,
            generation: record.generation,
            nativeScope,
            profiles: [...profiles],
          };
        }
        if (!ready(manager) || activeOperations >= 64)
          throw Error("private control manager unavailable");
        activeOperations++;
        try {
          if (method === "authorization") {
            if (!exact(args, "") || typeof manager.authorization !== "function")
              throw Error("native authorization unavailable");
            const binding = validateAuthorizationBinding(
              manager.authorization(),
            );
            if (!ready(manager))
              throw Error("native authorization unavailable");
            return binding;
          }
          if (method === "attach") {
            if (
              !exact(args, "handleId,input,profileId") ||
              !uuid(args.handleId) ||
              !controllers.has(args.profileId) ||
              handles.has(args.handleId) ||
              handles.size >= 64
            )
              throw Error("bounded exact control attachment required");
            const slot = { handle: null, replaced: false };
            handles.set(args.handleId, slot);
            try {
              slot.handle = await controllers
                .get(args.profileId)
                .attach(args.input, {
                  assertCurrent: async () => {
                    if (
                      !peer.open ||
                      handles.get(args.handleId) !== slot ||
                      slot.replaced
                    )
                      throw Error("control connection superseded");
                    const checked = await peer.request("verify", {
                      handleId: args.handleId,
                    });
                    if (
                      checked !== true ||
                      !peer.open ||
                      handles.get(args.handleId) !== slot ||
                      slot.replaced ||
                      !ready(manager)
                    )
                      throw Error("native host verification failed");
                  },
                  onReplaced: () => {
                    slot.replaced = true;
                    handles.delete(args.handleId);
                    if (peer.open)
                      peer.notify("replaced", { handleId: args.handleId });
                  },
                });
              if (!peer.open || slot.replaced) {
                slot.handle.disconnect();
                throw Error("control connection closed");
              }
              return slot.handle.identity;
            } catch (error) {
              handles.delete(args.handleId);
              throw error;
            }
          }
          if (method === "update") {
            if (!exact(args, "handleId,value") || !uuid(args.handleId))
              throw Error("exact control update required");
            const slot = handles.get(args.handleId);
            if (!slot?.handle || slot.replaced)
              throw Error("control attachment unavailable");
            await slot.handle.update(args.value);
            return true;
          }
          if (method === "disconnect") {
            if (!exact(args, "handleId") || !uuid(args.handleId))
              throw Error("exact control disconnect required");
            const slot = handles.get(args.handleId);
            handles.delete(args.handleId);
            slot?.handle?.disconnect();
            return true;
          }
          throw Error("unsupported private control operation");
        } finally {
          activeOperations--;
        }
      },
      onClose() {
        clearTimeout(helloTimer);
        for (const slot of handles.values()) {
          slot.replaced = true;
          slot.handle?.disconnect();
        }
        handles.clear();
        peers.delete(peer);
        contexts.delete(context);
      },
    });
    peers.add(peer);
  });
  let socketIdentity;
  const close = () => {
    if (closing) return closing;
    stopped = true;
    unobserve();
    for (const peer of peers) peer.close();
    closing = (async () => {
      await new Promise((resolve, reject) =>
        server.close((error) =>
          error && error.code !== "ERR_SERVER_NOT_RUNNING"
            ? reject(error)
            : resolve(),
        ),
      );
      try {
        const info = await lstat(path, { bigint: true });
        if (
          socketIdentity &&
          info.dev === socketIdentity.dev &&
          info.ino === socketIdentity.ino
        )
          await unlink(path);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      const cleanup = await Promise.all(
        [...controllers.values()].map((controller) => controller.close()),
      );
      return {
        unreleasedConsumers: cleanup.reduce(
          (sum, item) => sum + item.unreleasedConsumers,
          0,
        ),
      };
    })();
    return closing;
  };
  let unobserve = () => {};
  try {
    await new Promise((resolve, reject) => {
      const failed = (error) => reject(error);
      server.once("error", failed);
      server.listen(bindPath, () => {
        server.removeListener("error", failed);
        resolve();
      });
    });
    server.on("error", () => {
      void close().catch(() => {});
    });
    await chmod(bindPath, 0o600);
    // Node owns only the unpublished bind name. Explicit cleanup checks the
    // public hard link's inode, so closing cannot unlink a replaced endpoint.
    await link(bindPath, path);
    socketIdentity = await lstat(path, { bigint: true });
    record = Object.freeze({
      version: 1,
      generation: randomUUID(),
      ...(await captureProcessIdentity(process.pid)),
      nativeScope,
      token: randomBytes(32).toString("hex"),
      socketDev: String(socketIdentity.dev),
      socketIno: String(socketIdentity.ino),
    });
    unobserve = manager.onInvalidated(() => {
      for (const peer of [...peers]) peer.close();
    });
    if (!ready(manager))
      throw Error("native manager changed during control startup");
    return {
      record,
      close,
      snapshot: () => ({
        available: !stopped && ready(manager),
        connections: peers.size,
        handles: [...contexts].reduce((sum, c) => sum + c.handles.size, 0),
        pending: activeOperations,
        leases: [...controllers.values()].reduce(
          (sum, c) => sum + c.snapshot().leases,
          0,
        ),
      }),
    };
  } catch (error) {
    await close().catch(() => {});
    throw error;
  }
}

export async function connectRefreshControl({
  runtimeRoot,
  record,
  timeoutMs = 5000,
}) {
  validateControlRecord(record);
  record = Object.freeze({
    ...record,
    nativeScope: validateNativeScope(record.nativeScope),
  });
  const path = await endpointInfo(runtimeRoot, record),
    socket = createConnection(path),
    hooks = new Map();
  let available = false,
    profiles = new Set();
  const invalidate = () => {
    available = false;
    for (const slot of [...hooks.values()]) {
      try {
        slot.onReplaced?.();
      } catch {
        /* Own page only. */
      }
    }
    hooks.clear();
  };
  const peer = createControlPeer(socket, {
    timeoutMs,
    async handler(method, args) {
      if (
        method !== "verify" ||
        !exact(args, "handleId") ||
        !uuid(args.handleId) ||
        !available
      )
        throw Error("exact control verification required");
      const slot = hooks.get(args.handleId);
      if (!slot) throw Error("own control handle required");
      await slot.assertCurrent();
      if (!available || hooks.get(args.handleId) !== slot)
        throw Error("control verification superseded");
      return true;
    },
    notice(method, args) {
      if (
        method !== "replaced" ||
        !exact(args, "handleId") ||
        !uuid(args.handleId)
      )
        throw Error("exact control replacement required");
      const slot = hooks.get(args.handleId);
      hooks.delete(args.handleId);
      try {
        slot?.onReplaced?.();
      } catch {
        /* One replaced page cannot close another page's control connection. */
      }
    },
    onClose: invalidate,
  });
  try {
    const hello = await peer.request("hello", {
      version: 1,
      generation: record.generation,
      nativeScope: record.nativeScope,
      token: record.token,
    });
    if (
      !exact(hello, "generation,nativeScope,profiles,version") ||
      hello.version !== 1 ||
      hello.generation !== record.generation ||
      !sameScope(hello.nativeScope, record.nativeScope) ||
      !Array.isArray(hello.profiles) ||
      !hello.profiles.length ||
      hello.profiles.length > 32 ||
      hello.profiles.some((id) => !uuid(id)) ||
      new Set(hello.profiles).size !== hello.profiles.length
    )
      throw Error("exact control readiness required");
    validateNativeScope(hello.nativeScope);
    await endpointInfo(runtimeRoot, record);
    if (!peer.open) throw Error("control connection lost");
    profiles = new Set(hello.profiles);
    available = true;
  } catch (error) {
    peer.close();
    throw error;
  }
  return {
    serviceScope: record.nativeScope,
    async authorization() {
      if (!available || !peer.open)
        throw Error("native authorization unavailable");
      const value = validateAuthorizationBinding(
        await peer.request("authorization", {}),
      );
      if (!available || !peer.open)
        throw Error("native authorization unavailable");
      return value;
    },
    closed: peer.closed,
    async close() {
      peer.close();
      await peer.closed;
    },
    visibility(profileId) {
      if (!uuid(profileId) || !profiles.has(profileId))
        throw Error("registered control profile required");
      return {
        profileId,
        serviceScope: record.nativeScope,
        snapshot: () => ({ available: available && peer.open }),
        async attach(input, callbacks) {
          if (
            !available ||
            typeof callbacks?.assertCurrent !== "function" ||
            (callbacks.onReplaced !== undefined &&
              typeof callbacks.onReplaced !== "function") ||
            hooks.size >= 64
          )
            throw Error("bounded verified control attachment required");
          const handleId = randomUUID(),
            slot = { ...callbacks };
          hooks.set(handleId, slot);
          try {
            const identity = await peer.request("attach", {
              profileId,
              handleId,
              input,
            });
            if (
              !exact(identity, "leaseId,token") ||
              !uuid(identity.leaseId) ||
              typeof identity.token !== "string" ||
              !/^[a-f0-9]{64}$/.test(identity.token) ||
              !available ||
              hooks.get(handleId) !== slot
            )
              throw Error("exact control lease required");
            return {
              identity: Object.freeze(identity),
              update(value) {
                if (!available || hooks.get(handleId) !== slot)
                  return Promise.reject(Error("control attachment superseded"));
                return peer.request("update", { handleId, value });
              },
              disconnect() {
                if (hooks.get(handleId) !== slot) return;
                hooks.delete(handleId);
                if (available)
                  void peer
                    .request("disconnect", { handleId })
                    .catch(() => peer.close());
              },
            };
          } catch (error) {
            hooks.delete(handleId);
            throw error;
          }
        },
      };
    },
  };
}
