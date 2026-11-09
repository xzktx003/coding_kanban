// This fixed, short-lived child owns only one freshly allocated bind path.
// A transferred Server in the parent has no libuv pathname to unlink.
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const wire = import(pathToFileURL(path.join(__dirname, "wire-value.mjs")).href);
const exact = (value, keys) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));
const same = (a, b) =>
  a.dev === b.dev && a.ino === b.ino && a.mode === b.mode && a.uid === b.uid;
let server,
  binding,
  dir,
  dirInfo,
  bindingInfo,
  finished = false;
let queue = Promise.resolve();

function terminateWithoutUnlink() {
  // This only terminates this helper. Normal completion never takes this path.
  process.kill(process.pid, "SIGTERM");
}
async function send(frame, handle) {
  const { encodeWireValue } = await wire;
  if (!process.connected) return;
  await new Promise((resolve, reject) =>
    process.send(encodeWireValue(frame), handle, (error) =>
      error ? reject(error) : resolve(),
    ),
  );
}
function bindingStillOwned() {
  try {
    const currentDir = fs.lstatSync(dir, { bigint: true });
    const current = fs.lstatSync(binding, { bigint: true });
    return (
      currentDir.isDirectory() &&
      same(currentDir, dirInfo) &&
      current.isSocket() &&
      same(current, bindingInfo)
    );
  } catch {
    return false;
  }
}
async function finish() {
  if (finished) return;
  finished = true;
  if (server?.listening) {
    if (!bindingStillOwned()) {
      await send({
        v: 1,
        type: "error",
        code: "CONTROL_SOCKET_REPLACED",
      }).catch(() => {});
      terminateWithoutUnlink();
      return;
    }
    await new Promise((resolve) => server.close(resolve));
  }
  await send({ v: 1, type: "released" }).catch(() => {});
  if (process.connected) process.disconnect();
}
async function receive(encoded) {
  const { decodeWireValue } = await wire;
  const message = decodeWireValue(encoded, {
    maxEncodedBytes: 8192,
    maxDecodedBytes: 8192,
    maxNodes: 64,
  });
  if (
    exact(message, ["v", "type", "path"]) &&
    message.v === 1 &&
    message.type === "bind" &&
    !server
  ) {
    binding = message.path;
    if (
      typeof binding !== "string" ||
      !path.isAbsolute(binding) ||
      path.resolve(binding) !== binding ||
      path.basename(binding) !== "s" ||
      Buffer.byteLength(binding) > 107 ||
      /[\x00-\x1f\x7f]/.test(binding)
    )
      throw new Error();
    dir = path.dirname(binding);
    dirInfo = fs.lstatSync(dir, { bigint: true });
    if (
      fs.realpathSync(dir) !== dir ||
      !dirInfo.isDirectory() ||
      dirInfo.uid !== BigInt(process.getuid()) ||
      (dirInfo.mode & 0o7777n) !== 0o700n
    )
      throw new Error();
    try {
      fs.lstatSync(binding);
      throw new Error();
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    server = net.createServer((socket) => socket.destroy());
    server.maxConnections = 16;
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen({ path: binding, backlog: 16 }, resolve);
    });
    server.on("error", () => {
      void finish();
    });
    const before = fs.lstatSync(binding, { bigint: true });
    if (!before.isSocket() || before.uid !== BigInt(process.getuid()))
      throw new Error();
    fs.chmodSync(binding, 0o600);
    bindingInfo = fs.lstatSync(binding, { bigint: true });
    if (
      !bindingInfo.isSocket() ||
      bindingInfo.uid !== BigInt(process.getuid()) ||
      (bindingInfo.mode & 0o7777n) !== 0o600n ||
      before.dev !== bindingInfo.dev ||
      before.ino !== bindingInfo.ino
    )
      throw new Error();
    await send({ v: 1, type: "bound" }, server);
    return;
  }
  if (
    exact(message, ["v", "type"]) &&
    message.v === 1 &&
    (message.type === "release" || message.type === "cancel")
  ) {
    await finish();
    return;
  }
  throw new Error();
}
process.on("message", (message) => {
  queue = queue
    .then(() => receive(message))
    .catch(async () => {
      await send({ v: 1, type: "error", code: "CONTROL_UNAVAILABLE" }).catch(
        () => {},
      );
      await finish();
    });
});
process.on("disconnect", () => {
  queue = queue.then(finish).catch(terminateWithoutUnlink);
});
