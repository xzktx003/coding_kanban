import { spawn } from "node:child_process";
import * as fs from "node:fs";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { parseJsonLines, readBoundedChunks } from "./json-lines.mjs";
import { decodeWireValue } from "./wire-value.mjs";
import { isContainerRecoveryQuery } from "./container-recovery-wire.mjs";
import {
  desktopConnectionEnvironment,
  desktopConnectionArguments,
} from "./connection-policy.mjs";
const { isSharedThreadAuthorityFrame } = createRequire(import.meta.url)(
  "./shared-thread-authority-wire.cjs",
);
const { isDirectoryFrame } = createRequire(import.meta.url)("./shared-directory-ipc.cjs");
const { isCatalogFrame } = createRequire(import.meta.url)("./shared-catalog-ipc.cjs");
const { isSharedDesktopTransportFrame } = createRequire(import.meta.url)("./native-shared-desktop-transport.cjs");
const { isSharedMcpFrame } = createRequire(import.meta.url)("./shared-mcp-wire.cjs");
const { isSharedThreadCreationFrame } = createRequire(import.meta.url)("./shared-thread-creation-ipc.cjs");
const { isSharedThreadSendFrame } = createRequire(import.meta.url)("./shared-thread-send-ipc.cjs");

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const MAX = 8 * 1024 * 1024;
const fail = () => {
  process.stdout.write(
    '{"type":"fatal","code":"CONTAINER_NATIVE_UNAVAILABLE"}\n',
  );
  process.exitCode = 1;
};
const safePath = (value) =>
  typeof value === "string" &&
  isAbsolute(value) &&
  resolve(value) === value &&
  !/[\x00-\x1f\x7f]/.test(value);
const [profileId, generation, runtimeRoot] = process.argv.slice(2);

// The owner gives this process a fresh, private /bridge. This records only the
// first fixed phase; diagnostics must never change the failure path.
function writeFirstCause(phase, enabled) {
  if (!enabled || typeof phase !== "string" || !/^(?:container_(?:output_frame_bytes|output_queue_bytes|stdout_error|native_error|native_frame_invalid|native_frame_bytes|native_wire_error|native_ready_invalid|native_shared_invalid|input_not_ready|input_poisoned|input_disconnected|input_frame_bytes|input_queue_bytes|input_wire_error|input_frame_invalid|input_scope_invalid|input_send_error|input_stream_error|input_jsonl_bytes|input_jsonl_invalid)|native_(?:wire_unsupported|wire_budget|wire_error|ipc_queue_bytes|ipc_send_error|ipc_callback_error|view_queue_count|view_queue_bytes|renderer_frame_error|renderer_ack_error|control_error)|renderer_(?:awaiting_count|awaiting_bytes|unsupported_value|value_budget|estimate_error|emit_error|unexpected_ack|overflow_unknown))$/.test(phase)) return;
  try {
    const info = fs.lstatSync("/bridge");
    if (!info.isDirectory() || info.uid !== process.getuid() || (info.mode & 0o7777) !== 0o700 || fs.realpathSync("/bridge") !== "/bridge") return;
    const fd = fs.openSync("/bridge/first-cause.json", fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    try { fs.fchmodSync(fd, 0o600); fs.writeFileSync(fd, JSON.stringify({v:1,phase}) + "\n"); }
    finally { fs.closeSync(fd); }
  } catch { /* First-cause telemetry is best effort; preserve the original path. */ }
}

function isolated() {
  try {
    const fields = Object.fromEntries(
      readFileSync("/proc/self/status", "utf8")
        .split("\n")
        .filter((x) => x.includes(":"))
        .map((line) => {
          const index = line.indexOf(":");
          return [line.slice(0, index), line.slice(index + 1).trim()];
        }),
    );
    return (
      process.getuid?.() !== 0 &&
      existsSync("/.dockerenv") &&
      readFileSync("/proc/1/comm", "utf8").trim() === "docker-init" &&
      fields.NoNewPrivs === "1" &&
      fields.Seccomp === "2" &&
      BigInt("0x" + fields.CapEff) === 0n
    );
  } catch {
    return false;
  }
}

async function main() {
  if (
    process.argv.length !== 5 ||
    !UUID.test(profileId ?? "") ||
    !UUID.test(generation ?? "") ||
    !safePath(runtimeRoot) ||
    !isolated()
  )
    return fail();
  let token, connectionEnv, connectionArgs;
  try {
    const info = lstatSync("/bridge/grant.json");
    if (
      !info.isFile() ||
      info.uid !== process.getuid() ||
      (info.mode & 0o7777) !== 0o600 ||
      info.size > 4096
    )
      return fail();
    const config = JSON.parse(readFileSync("/bridge/grant.json", "utf8"));
    if (
      !config ||
      config.profileId !== profileId ||
      config.generation !== generation ||
      !/^[a-f0-9]{64}$/.test(config.token ?? "")
    )
      return fail();
    token = config.token;
    connectionEnv = desktopConnectionEnvironment(config.connection);
    connectionArgs = desktopConnectionArguments(config.connection);
  } catch {
    return fail();
  }
  const lines = parseJsonLines(readBoundedChunks(process.stdin, 65536), {
    maxLineBytes: MAX,
    maxChunkBytes: 65536,
  });
  const first = await lines.next();
  let grant;
  try {
    grant = JSON.parse(first.value);
  } catch {
    return fail();
  }
  if (
    first.done ||
    !grant ||
    Object.keys(grant).sort().join(",") !== "token,type" ||
    grant.type !== "grant" ||
    grant.token !== token
  )
    return fail();
  let sharedEnabled = false, sharedMcpEnabled = false;
  try {
    const file = join(runtimeRoot, "resources", "private-config.json"),
      info = lstatSync(file);
    if (
      !info.isFile() ||
      info.uid !== process.getuid() ||
      (info.mode & 0o7777) !== 0o600 ||
      info.size > 16384
    )
      return fail();
    const config = JSON.parse(readFileSync(file, "utf8"));
    if (
      config?.version !== 1 ||
      config.profileId !== profileId ||
      config.generation !== generation ||
      config.runtimeRoot !== runtimeRoot
    )
      return fail();
    if (Object.hasOwn(config, "sharedThread")) {
      if (
        !config.sharedThread ||
        Object.keys(config.sharedThread).join(",") !== "version" ||
        ![1,2].includes(config.sharedThread.version)
      )
        return fail();
      sharedEnabled = true;
      sharedMcpEnabled = config.sharedThread.version === 2;
    }
  } catch {
    return fail();
  }
  const home = join(runtimeRoot, "home"),
    executable = join(runtimeRoot, "ChatGPT");
  if (
    process.env.DISPLAY !== ":98" ||
    process.env.XAUTHORITY !== "/tmp/desktop-Xauthority"
  )
    return fail();
  const env = {
    HOME: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_CACHE_HOME: join(home, ".cache"),
    PATH: "/usr/bin:/bin",
    DISPLAY: ":98",
    XAUTHORITY: "/tmp/desktop-Xauthority",
    LANG: "C.UTF-8",
    KANBAN_FIRST_CAUSE_ROOT: "/bridge",
    ...connectionEnv,
  };
  const native = spawn(
    executable,
    [
      "--user-data-dir=" + join(home, "user-data"),
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      ...connectionArgs,
    ],
    {
      cwd: runtimeRoot,
      env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    },
  );
  native.stdout?.resume();
  native.stderr?.resume();
  for (const stream of [native.stdout, native.stderr])
    stream?.on("error", () => {});
  let ready = false,
    poisoned = false,
    pendingBytes = 0,
    inboundBytes = 0;
  function output(line) {
    if (poisoned) return;
    const size = Buffer.byteLength(line) + 1;
    if (size > MAX + 1 || pendingBytes + size > MAX + 1) {
      writeFirstCause(size > MAX + 1 ? "container_output_frame_bytes" : "container_output_queue_bytes", true);
      poisoned = true;
      return;
    }
    pendingBytes += size;
    try {
      process.stdout.write(line + "\n", () => { pendingBytes -= size; });
    } catch (error) {
      writeFirstCause("container_stdout_error", true);
      throw error;
    }
  }
  process.stdout.on("error", () => {
    writeFirstCause("container_stdout_error", true);
    poisoned = true;
  });
  native.on("error", () => {
    writeFirstCause("container_native_error", true);
    output('{"type":"fatal","code":"CONTAINER_NATIVE_UNAVAILABLE"}');
    poisoned = true;
  });
  native.on("exit", () => {
    output('{"type":"nativeExit"}');
    process.stdin.destroy();
  });
  output(JSON.stringify({ type: "node", pid: process.pid }));
  native.on("message", (encoded, handle) => {
    let phase = "container_native_frame_invalid";
    try {
      if (handle || typeof encoded !== "string") throw Error();
      if (Buffer.byteLength(encoded) > MAX) { phase = "container_native_frame_bytes"; throw Error(); }
      phase = "container_native_wire_error";
      const frame = decodeWireValue(encoded);
      phase = "container_native_ready_invalid";
      if (!ready) {
        if (
          !frame ||
          frame.v !== 1 ||
          frame.type !== "ready" ||
          frame.profileId !== profileId ||
          frame.generation !== generation ||
          frame.pid !== native.pid
        )
          throw Error();
        ready = true;
      } else if (!frame || frame.v !== 1 || frame.type === "ready")
        throw Error();
      phase = "container_native_shared_invalid";
      if (
        typeof frame.type === "string" &&
        frame.type.startsWith("shared-") &&
        (!sharedEnabled ||
          !(isSharedThreadAuthorityFrame(frame, {
            side: "native",
            profileId,
            generation,
          }) || isDirectoryFrame(frame, {side:"native",profileId,generation}) || isCatalogFrame(frame, {side:"native",profileId,generation}) || isSharedDesktopTransportFrame(frame, {side:"native",profileId,generation}) || isSharedThreadCreationFrame(frame,{side:"host",profileId,generation}) || isSharedThreadSendFrame(frame,{side:"host",profileId,generation}) || (sharedMcpEnabled && isSharedMcpFrame(frame, {side:"native",profileId,generation}))))
      )
        throw Error();
      output(encoded);
    } catch {
      writeFirstCause(phase, true);
      poisoned = true;
    }
  });
  let inputPhase = "container_input_stream_error";
  try {
    for await (const encoded of lines) {
      const size = Buffer.byteLength(encoded);
      if (!ready) { inputPhase = "container_input_not_ready"; throw Error(); }
      if (poisoned) { inputPhase = "container_input_poisoned"; throw Error(); }
      if (!native.connected) { inputPhase = "container_input_disconnected"; throw Error(); }
      if (size > MAX) { inputPhase = "container_input_frame_bytes"; throw Error(); }
      if (inboundBytes + size > MAX) { inputPhase = "container_input_queue_bytes"; throw Error(); }
      inputPhase = "container_input_wire_error";
      const frame = decodeWireValue(encoded);
      const isSharedReply = frame?.type === "shared-reply" || frame?.type === "shared-rpc-chunk" || frame?.type === "shared-event-chunk" || frame?.type === "shared-directory-request" || frame?.type === "shared-directory-ack" || frame?.type === "shared-directory-close" || frame?.type === "shared-catalog-chunk" || frame?.type === "shared-catalog-error" || (typeof frame?.type === "string" && (frame.type.startsWith("shared-desktop-") || frame.type.startsWith("shared-mcp-") || frame.type.startsWith("shared-create-") || frame.type.startsWith("shared-send-")));
      const isRecoveryQuery = isContainerRecoveryQuery(frame);
      inputPhase = "container_input_frame_invalid";
      if (
        !frame ||
        frame.v !== 1 ||
        !(isSharedReply
          ? sharedEnabled &&
            (isSharedThreadAuthorityFrame(frame, {
              side: "host",
              profileId,
              generation,
            }) || isDirectoryFrame(frame, {side:"host",profileId,generation}) || isCatalogFrame(frame, {side:"host",profileId,generation}) || isSharedDesktopTransportFrame(frame, {side:"host",profileId,generation}) || isSharedThreadCreationFrame(frame,{side:"native",profileId,generation}) || isSharedThreadSendFrame(frame,{side:"native",profileId,generation}) || (sharedMcpEnabled && isSharedMcpFrame(frame, {side:"host",profileId,generation})))
          : isRecoveryQuery || [
              "createView",
              "destroyView",
              "call",
              "openPort",
              "portPost",
              "closePort",
            ].includes(frame.type))
      )
        throw Error();
      if (isSharedReply || isRecoveryQuery) {
        // Reply is restricted to the already authenticated owner channel.
      } else if (frame.type === "createView" || frame.type === "destroyView") {
        inputPhase = "container_input_scope_invalid";
        if (!UUID.test(frame.viewId ?? "")) throw Error();
      } else {
        inputPhase = "container_input_scope_invalid";
        if (
        !frame.scope ||
        frame.scope.profileId !== profileId ||
        frame.scope.generation !== generation ||
        !UUID.test(frame.scope.viewId ?? "")
      )
        throw Error();
      }
      inboundBytes += size;
      inputPhase = "container_input_send_error";
      await new Promise((resolveSend, rejectSend) => {
        try {
          native.send(encoded, (error) =>
            error ? rejectSend(error) : resolveSend(),
          );
        } catch (error) {
          rejectSend(error);
        }
      });
      inboundBytes -= size;
      inputPhase = "container_input_stream_error";
    }
  } catch (error) {
    if (inputPhase === "container_input_stream_error") {
      let code;
      try { code = Object.getOwnPropertyDescriptor(error, "code")?.value; } catch {}
      if (code === "JSONL_FRAME_TOO_LARGE" || code === "JSONL_CHUNK_TOO_LARGE") inputPhase = "container_input_jsonl_bytes";
      else if (typeof code === "string" && code.startsWith("JSONL_")) inputPhase = "container_input_jsonl_invalid";
    }
    writeFirstCause(inputPhase, true);
    poisoned = true;
  }
  // Deliberately retain the owned native and IPC; closing this input is not a stop request.
}

void main().catch(fail);
