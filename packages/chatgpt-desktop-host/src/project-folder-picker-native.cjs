"use strict";

// Unconnected native-side folder-picker router. Roots and callbacks are
// server-owned startup dependencies; no host, socket, command or root is ever
// accepted from the browser. The original native project/Trust flow remains in
// charge after this picker returns.
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { performance } = require("node:perf_hooks");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TTL = 120000,
  MAX_PENDING = 16,
  MAX_PATHS = 8;
const error = () =>
  Object.assign(new Error("Project folder picker unavailable"), {
    code: "PROJECT_FOLDER_PICKER_UNAVAILABLE",
  });
const cancelled = () => ({ canceled: true, filePaths: [] });
const validPath = (value) =>
  typeof value === "string" &&
  value.length > 0 &&
  Buffer.byteLength(value) <= 4096 &&
  path.posix.isAbsolute(value) &&
  path.posix.normalize(value) === value &&
  !/[\u0000-\u001f\u007f]/u.test(value);
const contains = (root, value) =>
  value === root || value.startsWith(root === "/" ? "/" : root + "/");
const same = (a, b) =>
  a.dev === b.dev &&
  a.ino === b.ino &&
  a.uid === b.uid &&
  a.gid === b.gid &&
  a.mode === b.mode;

// A fixed container mount cannot be moved by the unprivileged native
// process. Refuse directory creation for ordinary, movable roots; selection
// of already existing directories does not use this restriction.
function isMountedRoot(root) {
  let fd;
  try {
    fd = fs.openSync("/proc/self/mountinfo", fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const block = Buffer.allocUnsafe(65536), chunks = [];
    let total = 0;
    for (;;) {
      const size = fs.readSync(fd, block, 0, block.length, null);
      if (!size) break;
      total += size;
      if (total > 4 * 1024 * 1024) return false;
      chunks.push(Buffer.from(block.subarray(0,size)));
    }
    return Buffer.concat(chunks).toString("utf8").split("\n").some(line => {
      const mount = line.split(" ")[4];
      return mount?.replace(/\\([0-7]{3})/g, (_all, octal) => String.fromCharCode(parseInt(octal,8))) === root;
    });
  } catch { return false; }
  finally { if (fd !== undefined) try { fs.closeSync(fd); } catch {} }
}

function createProjectFolderPicker(options, dependencies = {}) {
  const {
    homeRoot,
    projectRoots,
    getRecord,
    getOwnedRecord,
    verifyAuthority,
    verifyAuthoritySync,
    sendToView,
  } = options ?? {};
  const beforePathCheck = dependencies.beforePathCheck ?? (async () => {}),
    beforeDefaultCreate = dependencies.beforeDefaultCreate ?? (() => {}),
    verifyRootMount = dependencies.verifyRootMount ?? isMountedRoot,
    now = dependencies.now ?? (() => performance.now());
  const uid = process.getuid?.();
  if (
    uid === undefined ||
    !validPath(homeRoot) ||
    !Array.isArray(projectRoots) ||
    projectRoots.length > 8 ||
    projectRoots.some((root) => !validPath(root)) ||
    [
      getRecord,
      getOwnedRecord,
      verifyAuthority,
      verifyAuthoritySync,
      sendToView,
      beforePathCheck,
      beforeDefaultCreate,
      verifyRootMount,
      now,
    ].some((x) => typeof x !== "function")
  )
    throw error();
  const roots = [homeRoot, ...projectRoots],
    fds = [],
    rootInfo = [];
  if (
    roots.some((root, i) =>
      roots.some((other, j) => i !== j && contains(root, other)),
    )
  )
    throw error();
  try {
    for (let index = 0; index < roots.length; index++) {
      const root = roots[index];
      if (fs.realpathSync(root) !== root) throw error();
      const fd = fs.openSync(
        root,
        fs.constants.O_RDONLY |
          fs.constants.O_DIRECTORY |
          fs.constants.O_NOFOLLOW,
      );
      fds.push(fd);
      const a = fs.fstatSync(fd, { bigint: true }),
        b = fs.lstatSync(root, { bigint: true });
      if (
        !a.isDirectory() ||
        !b.isDirectory() ||
        !same(a, b) ||
        a.uid !== BigInt(uid) ||
        (a.mode & 2n) !== 0n ||
        (index === 0 && (a.mode & 0o7777n) !== 0o700n)
      )
        throw error();
      rootInfo.push({ root, fd, stat: a });
    }
  } catch {
    for (const fd of fds)
      try {
        fs.closeSync(fd);
      } catch {}
    throw error();
  }
  const pending = new Map(),
    handoffs = new Map(),
    outstandingHandoffs = new Set(),
    lifecycles = new WeakMap(),
    epochs = new WeakMap(),
    results = new WeakMap(),
    arrays = new WeakMap();
  let disposed = false,
    preparing = 0,
    validating = 0;
  function owned(sender, record) {
    try {
      return (
        !disposed &&
        getOwnedRecord(sender) === record &&
        getRecord(record.senderId) === record &&
        record.window?.webContents === sender &&
        record.failed !== true &&
        !record.window.isDestroyed() &&
        !sender.isDestroyed()
      );
    } catch {
      return false;
    }
  }
  function current(sender, record, epoch) {
    return epochs.get(record) === epoch && owned(sender, record);
  }
  function rootsCurrent() {
    if (disposed) return false;
    try {
      if (verifyAuthoritySync() !== true) return false;
      return rootInfo.every(({ root, fd, stat }) => {
        const a = fs.fstatSync(fd, { bigint: true }),
          b = fs.lstatSync(root, { bigint: true });
        return (
          a.isDirectory() &&
          b.isDirectory() &&
          same(a, stat) &&
          same(a, b) &&
          fs.realpathSync(root) === root
        );
      });
    } catch {
      return false;
    }
  }
  function createDefault(sender, target) {
    try {
      if (!validPath(target)) throw error();
      const index = projectRoots.indexOf(path.dirname(target));
      const name = path.basename(target), root = rootInfo[index + 1];
      if (index < 0 || !root || !name || name === "." || name === ".." ||
          Buffer.byteLength(name) > 255 || /[\\/\u0000-\u001f\u007f]/u.test(name)) throw error();
      const record = getOwnedRecord(sender), lifecycle = record && lifecycles.get(record), epoch = record && epochs.get(record);
      const authorized = () => record && lifecycle && lifecycle.epoch !== null &&
        lifecycles.get(record) === lifecycle && current(sender,record,epoch) &&
        rootsCurrent() && verifyRootMount(root.root) === true;
      if (!authorized()) throw error();
      beforeDefaultCreate(target);
      if (!authorized()) throw error();
      // The pinned mount-root descriptor anchors the mkdir to the authorized
      // directory. O_EXCL semantics of mkdir never replace an existing entry.
      const anchored = `/proc/self/fd/${root.fd}/${name}`;
      fs.mkdirSync(anchored, { mode: 0o755 });
      const named = fs.lstatSync(target,{bigint:true}), held = fs.lstatSync(anchored,{bigint:true});
      if (!authorized() || !named.isDirectory() || !held.isDirectory() ||
          !same(named,held) || fs.realpathSync(target) !== target) throw error();
    } catch { throw error(); }
  }
  function release(token, result = cancelled()) {
    if (pending.get(token.sender) !== token) return;
    pending.delete(token.sender);
    clearTimeout(token.timer);
    token.done = true;
    token.resolve(result);
  }
  function detachHandoff(sender) {
    const token = handoffs.get(sender);
    if (!token) return;
    handoffs.delete(sender);
    clearTimeout(token.handoffTimer);
  }
  function finishHandoff(token) {
    if (handoffs.get(token.sender) === token) detachHandoff(token.sender);
    clearTimeout(token.handoffTimer);
    outstandingHandoffs.delete(token);
  }
  function detachExpiredHandoffs() {
    for (const [sender, token] of handoffs)
      if (now() >= token.expires) detachHandoff(sender);
  }
  function active(token) {
    return (
      !token.done &&
      now() < token.expires &&
      current(token.sender, token.record, token.epoch) &&
      rootsCurrent()
    );
  }
  function notify(token, message) {
    try {
      if (!active(token)) return false;
      sendToView(token.record, message);
      return true;
    } catch {
      return false;
    }
  }
  function lifecycle(sender, message) {
    let record;
    try {
      record = getOwnedRecord(sender);
    } catch {
      return false;
    }
    if (
      !record ||
      !owned(sender, record) ||
      !rootsCurrent() ||
      !message ||
      typeof message !== "object" ||
      Array.isArray(message) ||
      Object.keys(message).sort().join(",") !== "epoch,sequence,type" ||
      message.type !== "kanban-project-folder-lifecycle" ||
      !Number.isSafeInteger(message.sequence) ||
      message.sequence < 1 ||
      (message.epoch !== null &&
        (typeof message.epoch !== "string" || !UUID.test(message.epoch)))
    )
      return false;
    const previous = lifecycles.get(record),
      seen = previous?.seen ?? new Set();
    if (
      (previous && message.sequence <= previous.sequence) ||
      (message.epoch !== null && (seen.has(message.epoch) || seen.size >= 4096))
    )
      return false;
    if (message.epoch !== null) seen.add(message.epoch);
    epochs.set(record, (epochs.get(record) ?? 0) + 1);
    const token = pending.get(sender);
    if (token) release(token);
    detachHandoff(sender);
    lifecycles.set(record, {
      sequence: message.sequence,
      epoch: message.epoch,
      seen,
    });
    try {
      sendToView(record, {
        type: "kanban-project-folder-lifecycle-ack",
        sequence: message.sequence,
        epoch: message.epoch,
      });
      return true;
    } catch {
      return false;
    }
  }
  function begin(sender, allowMultiple) {
    detachExpiredHandoffs();
    let record;
    try {
      record = getOwnedRecord(sender);
    } catch {}
    if (
      !record ||
      (allowMultiple !== true && allowMultiple !== false) ||
      pending.size + outstandingHandoffs.size >= MAX_PENDING ||
      preparing + validating >= MAX_PENDING ||
      pending.has(sender) ||
      handoffs.has(sender)
    )
      return null;
    const epoch = epochs.get(record),
      lifecycle = lifecycles.get(record);
    if (
      epoch === undefined ||
      !lifecycle ||
      lifecycle.epoch === null ||
      !current(sender, record, epoch) ||
      !rootsCurrent()
    )
      return null;
    let resolve;
    const promise = new Promise((done) => {
      resolve = done;
    });
    const token = {
      sender,
      record,
      epoch,
      activationEpoch: lifecycle.epoch,
      lifecycleSequence: lifecycle.sequence,
      requestId: randomUUID(),
      allowMultiple,
      expires: now() + TTL,
      resolve,
      done: false,
      busy: false,
      timer: null,
    };
    token.timer = setTimeout(() => release(token), TTL);
    token.timer.unref?.();
    pending.set(sender, token);
    return { token, promise };
  }
  async function open(sender, allowMultiple = false) {
    const state = begin(sender, allowMultiple);
    if (!state) return cancelled();
    const { token, promise } = state;
    preparing++;
    void (async () => {
      try {
        if (
          (await verifyAuthority()) !== true ||
          !active(token) ||
          !notify(token, {
            type: "kanban-project-folder-open",
            requestId: token.requestId,
            epoch: token.activationEpoch,
            allowMultiple,
            roots: [...roots],
          })
        )
          release(token);
      } catch {
        release(token);
      } finally {
        preparing--;
      }
    })();
    return promise;
  }
  async function checkedPath(input) {
    if (!validPath(input) || !roots.some((root) => contains(root, input)))
      throw error();
    await beforePathCheck(input);
    const resolved = await fs.promises.realpath(input);
    if (!validPath(resolved) || !roots.some((root) => contains(root, resolved)))
      throw error();
    const first = await fs.promises.stat(resolved, { bigint: true }),
      link = await fs.promises.lstat(resolved, { bigint: true });
    if (
      !first.isDirectory() ||
      !link.isDirectory() ||
      !same(first, link) ||
      (await fs.promises.realpath(input)) !== resolved
    )
      throw error();
    return { path: resolved, stat: first };
  }
  function pathsCurrent(token, paths) {
    const lifecycle = lifecycles.get(token.record);
    if (
      !current(token.sender, token.record, token.epoch) ||
      !lifecycle ||
      lifecycle.sequence !== token.lifecycleSequence ||
      lifecycle.epoch !== token.activationEpoch ||
      !rootsCurrent() ||
      now() >= token.expires
    )
      return false;
    try {
      return paths.every((value) => {
        const old = token.selected.get(value),
          currentStat = fs.lstatSync(value, { bigint: true });
        return (
          !!old &&
          currentStat.isDirectory() &&
          same(old, currentStat) &&
          fs.realpathSync(value) === value &&
          roots.some((root) => contains(root, value))
        );
      });
    } catch {
      return false;
    }
  }
  function handoff(token, paths) {
    if (!active(token)) {
      release(token);
      return;
    }
    const result = { canceled: false, filePaths: paths };
    results.set(result, token);
    handoffs.set(token.sender, token);
    outstandingHandoffs.add(token);
    release(token, result);
    token.handoffTimer = setTimeout(
      () => {
        if (handoffs.get(token.sender) === token) detachHandoff(token.sender);
      },
      Math.max(1, Math.ceil(token.expires - now())),
    );
    token.handoffTimer.unref?.();
  }
  async function direct(sender, paths) {
    if (
      !Array.isArray(paths) ||
      paths.length < 1 ||
      paths.length > MAX_PATHS ||
      paths.some((value) => typeof value !== "string") ||
      new Set(paths).size !== paths.length
    )
      return cancelled();
    const state = begin(sender, true);
    if (!state) return cancelled();
    const { token, promise } = state;
    validating++;
    void (async () => {
      try {
        const values = [];
        for (const selected of paths) {
          if (!active(token)) {
            release(token);
            return;
          }
          values.push(await checkedPath(selected));
        }
        if (
          (await verifyAuthority()) !== true ||
          !active(token) ||
          new Set(values.map((value) => value.path)).size !== values.length
        ) {
          release(token);
          return;
        }
        token.selected = new Map(
          values.map((value) => [value.path, value.stat]),
        );
        const canonical = values.map((value) => value.path);
        if (!pathsCurrent(token, canonical)) {
          release(token);
          return;
        }
        handoff(token, canonical);
      } catch {
        release(token);
      } finally {
        validating--;
      }
    })();
    return promise;
  }
  async function reply(sender, message) {
    const token = pending.get(sender);
    if (
      !token ||
      !message ||
      typeof message !== "object" ||
      Array.isArray(message) ||
      message.type !== "kanban-project-folder-reply" ||
      !UUID.test(message.requestId ?? "") ||
      message.requestId !== token.requestId ||
      message.epoch !== token.activationEpoch ||
      !["cancel", "select"].includes(message.action)
    )
      return;
    const keys = Object.keys(message).sort().join(",");
    if (message.action === "cancel") {
      if (keys !== "action,epoch,requestId,type") return;
      release(token);
      return;
    }
    if (
      keys !== "action,epoch,paths,requestId,type" ||
      !Array.isArray(message.paths) ||
      message.paths.length < 1 ||
      message.paths.length > (token.allowMultiple ? MAX_PATHS : 1) ||
      message.paths.some((value) => typeof value !== "string") ||
      new Set(message.paths).size !== message.paths.length ||
      token.busy
    )
      return;
    if (!active(token)) {
      release(token);
      return;
    }
    if (preparing + validating >= MAX_PENDING) {
      notify(token, {
        type: "kanban-project-folder-invalid",
        requestId: token.requestId,
        epoch: token.activationEpoch,
      });
      return;
    }
    token.busy = true;
    validating++;
    try {
      const values = [];
      for (const selected of message.paths) {
        if (!active(token)) {
          release(token);
          return;
        }
        values.push(await checkedPath(selected));
      }
      if ((await verifyAuthority()) !== true || !active(token)) {
        release(token);
        return;
      }
      if (new Set(values.map((value) => value.path)).size !== values.length)
        throw error();
      token.selected = new Map(values.map((value) => [value.path, value.stat]));
      const paths = values.map((value) => value.path);
      if (!pathsCurrent(token, paths)) throw error();
      if (
        !notify(token, {
          type: "kanban-project-folder-done",
          requestId: token.requestId,
          epoch: token.activationEpoch,
        }) ||
        !active(token)
      ) {
        release(token);
        return;
      }
      handoff(token, paths);
    } catch {
      if (!active(token)) {
        release(token);
        return;
      }
      token.busy = false;
      if (
        !notify(token, {
          type: "kanban-project-folder-invalid",
          requestId: token.requestId,
          epoch: token.activationEpoch,
        })
      )
        release(token);
    } finally {
      validating--;
    }
  }
  function complete(sender, result, validated) {
    const token = results.get(result);
    if (!token || sender !== token.sender) return [];
    results.delete(result);
    if (
      !Array.isArray(validated) ||
      validated.length > MAX_PATHS ||
      new Set(validated).size !== validated.length ||
      !pathsCurrent(token, validated)
    ) {
      finishHandoff(token);
      return [];
    }
    const out = [...validated];
    arrays.set(out, token);
    return out;
  }
  function consume(sender, validated) {
    const token = arrays.get(validated);
    if (!token || sender !== token.sender) return [];
    arrays.delete(validated);
    const accepted = pathsCurrent(token, validated);
    finishHandoff(token);
    return accepted ? validated : [];
  }
  function retire(sender) {
    let record;
    try {
      record = getOwnedRecord(sender);
    } catch {}
    if (record) {
      epochs.set(record, (epochs.get(record) ?? 0) + 1);
      const lifecycle = lifecycles.get(record);
      if (lifecycle) lifecycles.set(record, { ...lifecycle, epoch: null });
    }
    const token = pending.get(sender);
    if (token) release(token);
    detachHandoff(sender);
  }
  function dispose() {
    if (disposed) return;
    for (const token of pending.values()) release(token);
    disposed = true;
    handoffs.clear();
    for (const token of outstandingHandoffs) clearTimeout(token.handoffTimer);
    outstandingHandoffs.clear();
    for (const fd of fds)
      try {
        fs.closeSync(fd);
      } catch {}
  }
  return Object.freeze({
    lifecycle,
    createDefault,
    open,
    direct,
    reply,
    complete,
    consume,
    retire,
    dispose,
  });
}
module.exports = { createProjectFolderPicker };
