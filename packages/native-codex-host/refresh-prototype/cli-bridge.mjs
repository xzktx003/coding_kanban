// Explicit isolated refresh connection; default startup never enables it.
import WebSocket from "ws";
import { createReadStream } from "node:fs";
import { lstat, readFile, realpath } from "node:fs/promises";
import {
  isAbsolute,
  resolve,
  relative,
  sep,
  basename,
  dirname,
} from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { validateNativeScope } from "./native-scope.mjs";

const OFFICIAL_VERSION = "26.51007.21434";
const CLI_VERSION = "0.162.0-alpha.17.2";
const CLI_SHA256 =
  "73b73b048546993298234a295de01ef2424e7a8b29def9d0ecb1ca7cb77500d4";
const VSIX_SHA256 =
  "75cee7497cf38c721cfeaa7383b579537b4e4439086f996258705de5da03ad56";
const MAX_INPUT_BYTES = 8 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_PENDING_BYTES = 8 * 1024 * 1024;
const FIELDS = [
  "runtimeRoot",
  "socketPath",
  "cliPath",
  "officialVsix",
  "officialVersion",
  "cliVersion",
  "cliSha256",
  "officialVsixSha256",
];
// Copy the bounded text so a diagnostic cannot retain a large SlicedString.
const diagnosticText = (value) =>
  Buffer.from(value.slice(0, 128)).toString("utf8");
const diagnosticId = (value) =>
  typeof value === "string"
    ? diagnosticText(value)
    : typeof value === "number" && Number.isFinite(value)
      ? value
      : undefined;

// Diagnostic only: inspect a bounded header already buffered by pinned ws.
// Missing/changed library internals leave attribution unknown; they never
// change framing, limits, backpressure or protocol decisions.
function outputLimitMetadata(receiver) {
  let remaining = 256;
  const prefix = [];
  const buffers = receiver?._fragments?.length
    ? receiver._fragments
    : receiver?._buffers;
  for (const bytes of Array.isArray(buffers) ? buffers : []) {
    if (!Buffer.isBuffer(bytes) || remaining <= 0) break;
    const part = bytes.subarray(0, remaining);
    prefix.push(part);
    remaining -= part.length;
  }
  const header = Buffer.concat(prefix).toString("utf8");
  const method = header.match(
    /^\s*\{\s*(?:"jsonrpc"\s*:\s*"2\.0"\s*,\s*)?"method"\s*:\s*"([A-Za-z][A-Za-z0-9_/]{0,127})"/,
  )?.[1];
  const bytes = receiver?._totalPayloadLength;
  return {
    limitBytes: MAX_OUTPUT_BYTES,
    declaredBytes: Number.isSafeInteger(bytes) && bytes >= 0 ? bytes : null,
    method: method ? diagnosticText(method) : null,
  };
}

export function validateLaunchArguments(args) {
  const forms = [
    ["app-server", "--analytics-default-enabled"],
    [
      "-c",
      "features.code_mode_host=true",
      "app-server",
      "--analytics-default-enabled",
    ],
  ];
  if (args.length === 1 && args[0] === "--version") return "version";
  if (
    forms.some(
      (form) =>
        form.length === args.length &&
        form.every((value, i) => value === args[i]),
    )
  )
    return "connect";
  throw new Error("Unsupported official CLI launch arguments");
}

export function validateBridgeMetadata(value) {
  const invalid = () => {
    throw new Error("Invalid refresh bridge metadata");
  };
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== FIELDS.length ||
    FIELDS.some((key) => !Object.hasOwn(value, key))
  )
    invalid();
  if (
    value.officialVersion !== OFFICIAL_VERSION ||
    value.cliVersion !== CLI_VERSION ||
    value.cliSha256 !== CLI_SHA256 ||
    value.officialVsixSha256 !== VSIX_SHA256
  )
    invalid();
  for (const key of ["runtimeRoot", "socketPath", "cliPath", "officialVsix"])
    if (
      typeof value[key] !== "string" ||
      !isAbsolute(value[key]) ||
      resolve(value[key]) !== value[key] ||
      /[\x00-\x1f\x7f?#]/.test(value[key])
    )
      invalid();
  const rel = relative(value.runtimeRoot, value.socketPath);
  if (
    !rel ||
    rel === ".." ||
    rel.startsWith(`..${sep}`) ||
    isAbsolute(rel) ||
    value.socketPath.includes(":") ||
    Buffer.byteLength(value.socketPath) > 103
  )
    invalid();
  return value;
}

async function regularOwned(file, mode, limit, read = true) {
  if ((await realpath(file)) !== file)
    throw new Error("Refresh bridge refuses symlink paths");
  const info = await lstat(file);
  if (
    !info.isFile() ||
    info.uid !== process.getuid?.() ||
    (mode !== undefined && (info.mode & 0o777) !== mode) ||
    info.size > limit
  )
    throw new Error("Refresh bridge requires an owned bounded regular file");
  return read ? readFile(file) : undefined;
}

export async function verifyBridgeConfig(configPath) {
  if (!isAbsolute(configPath) || resolve(configPath) !== configPath)
    throw new Error("Refresh config path must be absolute");
  const metadata = validateBridgeMetadata(
    JSON.parse((await regularOwned(configPath, 0o600, 16 * 1024)).toString()),
  );
  const info = await lstat(metadata.runtimeRoot);
  if (
    !info.isDirectory() ||
    info.uid !== process.getuid?.() ||
    (info.mode & 0o777) !== 0o700 ||
    (await realpath(metadata.runtimeRoot)) !== metadata.runtimeRoot
  )
    throw new Error("Refresh runtime must be an owned private directory");
  const configRel = relative(metadata.runtimeRoot, configPath);
  if (!configRel || configRel.startsWith("..") || isAbsolute(configRel))
    throw new Error("Refresh config outside private runtime");
  // Nested socket directories must also remain private, not just the runtime root.
  if (relative(metadata.runtimeRoot, metadata.socketPath).includes(sep))
    throw new Error(
      "Refresh socket must be directly inside its private runtime",
    );
  await verifyControlSocket(metadata.socketPath);
  await verifyNativeArtifacts(metadata);
  return metadata;
}

export async function verifyNativeArtifacts(value) {
  const metadata = validateBridgeMetadata(value);
  for (const [key, expected] of [
    ["cliPath", metadata.cliSha256],
    ["officialVsix", metadata.officialVsixSha256],
  ]) {
    await regularOwned(metadata[key], undefined, 512 * 1024 * 1024, false);
    const digest = createHash("sha256");
    for await (const bytes of createReadStream(metadata[key]))
      digest.update(bytes);
    const hash = digest.digest("hex");
    if (hash !== expected)
      throw new Error("Refresh bridge binary version/hash mismatch");
  }
  const { stdout } = await promisify(execFile)(
    metadata.cliPath,
    ["--version"],
    { timeout: 3000, maxBuffer: 1024 },
  );
  if (stdout.trim() !== `codex-cli ${CLI_VERSION}`)
    throw new Error("Refresh bridge CLI version mismatch");
  return metadata;
} /** This pinned native version uses a hash-named physical socket and rendezvous link. */
export async function verifyControlSocket(socketPath) {
  const entry = await lstat(socketPath);
  const actual = await realpath(socketPath);
  if (entry.uid !== process.getuid?.())
    throw new Error("Refresh control socket owner mismatch");
  if (
    entry.isSymbolicLink() &&
    basename(actual) !== createHash("sha256").update(socketPath).digest("hex")
  )
    throw new Error("Refresh control socket rendezvous mismatch");
  if (!entry.isSymbolicLink() && actual !== socketPath)
    throw new Error("Refresh control socket path mismatch");
  const parent = dirname(actual);
  const parentInfo = await lstat(parent);
  const socket = await lstat(actual);
  if (
    !socket.isSocket() ||
    socket.uid !== process.getuid?.() ||
    (socket.mode & 0o777) !== 0o600 ||
    !parentInfo.isDirectory() ||
    parentInfo.uid !== process.getuid?.() ||
    (parentInfo.mode & 0o777) !== 0o700 ||
    (await realpath(parent)) !== parent
  )
    throw new Error("Refresh control socket unavailable or not private");
  return actual;
}

/** One stdio client = one native connection. Never stop or reconfigure its server. */
export function connectStdio({
  socketPath,
  input,
  output,
  connectTimeoutMs = 5000,
  signal,
  onProtocol,
  beforeReady,
}) {
  if (
    !Number.isSafeInteger(connectTimeoutMs) ||
    connectTimeoutMs < 1 ||
    connectTimeoutMs > 60000 ||
    (beforeReady !== undefined && typeof beforeReady !== "function")
  )
    throw Error("bounded native admission check required");
  const ws = new WebSocket(`ws+unix://${socketPath}:/`, {
    maxPayload: MAX_OUTPUT_BYTES,
    handshakeTimeout: connectTimeoutMs,
    perMessageDeflate: false,
  });
  let opened = false;
  let admitted = false;
  let settled = false;
  let pending = Buffer.alloc(0);
  let finishing = false;
  let closeTimer;
  let admissionTimer;
  let resolveReady, rejectReady, resolveDone, rejectDone;
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const done = new Promise((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  ready.catch(() => {});
  done.catch(() => {});
  const cleanup = () => {
    clearTimeout(closeTimer);
    clearTimeout(admissionTimer);
    input.off("data", data);
    input.off("end", end);
    input.off("error", fail);
    output.off("drain", drain);
    output.off("error", fail);
    signal?.removeEventListener("abort", abort);
    pending = Buffer.alloc(0);
    input.pause();
  };
  const fail = (error) => {
    if (settled) return;
    settled = true;
    cleanup();
    ws.terminate();
    rejectReady(error);
    rejectDone(error);
  };
  const finish = () => {
    if (settled) return;
    settled = true;
    cleanup();
    if (!admitted)
      rejectReady(
        new Error("Refresh connection closed before authority admission"),
      );
    resolveDone();
  };
  const abort = () => {
    if (finishing || settled) return;
    finishing = true;
    clearTimeout(admissionTimer);
    input.pause();
    pending = Buffer.alloc(0);
    if (opened) {
      // stdout backpressure pauses the reader, including the peer's close ACK.
      // Closing this client must not depend on a consumer that has gone away.
      ws._socket?.resume();
      ws.close();
      closeTimer = setTimeout(() => {
        ws.terminate();
        finish();
      }, 1000);
      closeTimer.unref();
    } else ws.terminate();
  };
  const send = (line) => {
    if (!line.length || line.length > MAX_INPUT_BYTES)
      throw new Error("JSONL input limit exceeded");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(line);
    let value;
    try {
      value = JSON.parse(text);
    } catch {
      throw new Error("Invalid JSONL input");
    }
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Invalid JSONL object");
    onProtocol?.({
      direction: "request",
      method:
        typeof value.method === "string" ? diagnosticText(value.method) : null,
      id: diagnosticId(value.id),
      bytes: line.length,
    });
    if (ws.bufferedAmount + line.length > MAX_PENDING_BYTES)
      throw new Error("JSONL pending limit exceeded");
    ws.send(text, (error) => {
      if (error) fail(error);
      else if (ws.bufferedAmount < MAX_PENDING_BYTES / 2 && !finishing)
        input.resume();
    });
    if (ws.bufferedAmount >= MAX_PENDING_BYTES / 2) input.pause();
  };
  const data = (chunk) => {
    try {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      pending = Buffer.concat([pending, bytes]);
      let newline;
      while ((newline = pending.indexOf(10)) >= 0) {
        if (newline > MAX_INPUT_BYTES)
          throw new Error("JSONL input limit exceeded");
        const line = pending.subarray(0, newline);
        pending = pending.subarray(newline + 1);
        if (line.length) send(line);
      }
      if (pending.length > MAX_INPUT_BYTES)
        throw new Error("JSONL input limit exceeded");
      // Drop the backing allocation of a consumed large chunk.
      if (!pending.length) pending = Buffer.alloc(0);
    } catch (error) {
      fail(error);
    }
  };
  const end = () => {
    if (pending.length) {
      fail(new Error("Incomplete JSONL input"));
      return;
    }
    abort();
  };
  const drain = () => {
    if (!settled) ws._socket?.resume();
  };
  admissionTimer = setTimeout(
    () => fail(new Error("Private native admission timed out")),
    connectTimeoutMs,
  );
  admissionTimer.unref();
  input.pause();
  output.on("error", fail);
  output.on("drain", drain);
  ws.once("open", () => {
    if (finishing) {
      ws.close();
      return;
    }
    opened = true;
    const admit = () => {
      if (finishing || settled) return;
      admitted = true;
      clearTimeout(admissionTimer);
      input.on("data", data);
      input.once("end", end);
      input.once("error", fail);
      resolveReady();
      input.resume();
    };
    if (beforeReady)
      void Promise.resolve()
        .then(beforeReady)
        .then(admit, (error) => {
          if (!finishing && !settled) fail(error);
        });
    else admit();
  });
  ws.on("message", (bytes, binary) => {
    if (finishing || settled) return;
    try {
      if (!admitted)
        throw new Error("Native output arrived before authority admission");
      if (
        binary ||
        bytes.length > MAX_OUTPUT_BYTES ||
        bytes.includes(10) ||
        bytes.includes(13)
      )
        throw new Error("Native output frame limit/format invalid");
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      let value;
      try {
        value = JSON.parse(text);
      } catch {
        throw new Error("Invalid native JSONL response");
      }
      onProtocol?.({
        direction: "response",
        method:
          typeof value.method === "string"
            ? diagnosticText(value.method)
            : null,
        id: diagnosticId(value.id),
        errorCode: diagnosticId(value.error?.code),
        bytes: bytes.length,
      });
      if (output.writableLength + bytes.length + 1 > MAX_PENDING_BYTES)
        throw new Error("Native output pending limit exceeded");
      if (!output.write(Buffer.concat([bytes, Buffer.from("\n")])))
        ws._socket?.pause();
    } catch (error) {
      fail(error);
    }
  });
  ws.once("error", (error) => {
    const limited = error.code === "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH";
    const failure = new Error(
      limited
        ? "Native output payload limit exceeded"
        : "Private native connection failed",
    );
    if (limited) {
      failure.code = "NATIVE_OUTPUT_LIMIT";
      try {
        failure.nativeOutputLimit = outputLimitMetadata(ws._receiver);
      } catch {
        /* Attribution may be unknown; transport still fails closed. */
      }
    }
    fail(failure);
  });
  ws.once("close", (code) => {
    if (settled) return;
    if (!finishing && code !== 1000)
      fail(new Error("Private native connection lost; no automatic replay"));
    else finish();
  });
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  return { ready, done, close: abort };
}

export async function runBridge({
  configPath,
  argv,
  input = process.stdin,
  output = process.stdout,
  signal,
  onProtocol,
  scope,
}) {
  const mode = validateLaunchArguments(argv);
  if (scope !== undefined) scope = validateNativeScope(scope);
  const metadata = await verifyBridgeConfig(configPath);
  let beforeReady;
  if (scope) {
    const { verifyPrivateServiceIdentity } =
      await import("./private-service.mjs");
    beforeReady = () => verifyPrivateServiceIdentity({ metadata, scope });
    await beforeReady();
  }
  if (mode === "version") {
    output.write(`codex-cli ${CLI_VERSION}\n`);
    return;
  }
  const connection = connectStdio({
    socketPath: metadata.socketPath,
    input,
    output,
    signal,
    onProtocol,
    beforeReady,
  });
  await connection.done;
}
