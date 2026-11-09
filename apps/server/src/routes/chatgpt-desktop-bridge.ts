import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import type { FastifyInstance, FastifyRequest } from "fastify";
import WebSocket, { WebSocketServer, type RawData } from "ws";
import {
  connectDesktopControl,
  type DesktopControlConnection,
} from "@agent-orchestrator/chatgpt-desktop-host/control-client";
import { encodeWireValue } from "@agent-orchestrator/chatgpt-desktop-host/wire-value";
import {
  createChatGptDesktopProfileService,
  type ChatGptDesktopProfile,
  type ChatGptDesktopProfileResult,
} from "../services/chatgpt-desktop-profile.js";

const MAX_MESSAGE = 8 * 1024 * 1024,
  MAX_TOTAL = 32 * 1024 * 1024,
  MAX_CLIENTS = 16,
  REJECTED_UPGRADE_CLOSE_MS = 2000;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
// Only fixed control codes are ever logged; exception text and frame data may
// contain conversation content or credentials and must not reach the log.
const CONTROL_CODES = new Set([
  "ABORT_ERR", "CONTROL_INVALID_CONFIG", "CONTROL_IDENTITY_CHANGED",
  "CONTROL_DISCONNECTED", "CONTROL_TIMEOUT", "CONTROL_CLOSED",
  "CONTROL_OUTCOME_UNKNOWN", "CONTROL_INVALID_BOOTSTRAP",
  "CONTROL_ALREADY_CONSUMED", "CONTROL_INVALID_FRAME", "CONTROL_QUEUE_FULL",
  "CONTROL_PROTOCOL_ERROR", "CONTROL_UPSTREAM_ERROR", "CONTROL_HANDSHAKE_TIMEOUT",
]);
function controlCode(cause: unknown): string {
  const value = cause && typeof cause === "object" && "code" in cause ? cause.code : undefined;
  return typeof value === "string" && CONTROL_CODES.has(value) ? value : "CONTROL_UNKNOWN";
}
const BINDING_FIELDS = [
  "version",
  "id",
  "generation",
  "pid",
  "startTicks",
  "uid",
  "macAsarPath",
  "macAsarSha256",
  "linuxAsarPath",
  "linuxAsarSha256",
  "controlSocketPath",
  "serverSshSocketPath",
] as const;
const SOURCES: Readonly<Record<string, string>> = Object.freeze({
  "browser-entry.mjs": "@agent-orchestrator/chatgpt-desktop-host/browser-entry",
  "browser-bridge.mjs":
    "@agent-orchestrator/chatgpt-desktop-host/browser-bridge",
  "wire-value.mjs": "@agent-orchestrator/chatgpt-desktop-host/wire-value",
  "surface-host-bridge.mjs":
    "@agent-orchestrator/chatgpt-desktop-host/surface-host-bridge",
  "surface-activation.mjs":
    "@agent-orchestrator/chatgpt-desktop-host/surface-activation",
  "browser-surface-controller.mjs":
    "@agent-orchestrator/chatgpt-desktop-host/browser-surface-controller",
  "browser-image-file-picker.mjs":
    "@agent-orchestrator/chatgpt-desktop-host/browser-image-file-picker",
  "browser-ssh-alias-discovery.mjs":
    "@agent-orchestrator/chatgpt-desktop-host/browser-ssh-alias-discovery",
  "browser-project-folder-picker.mjs":
    "@agent-orchestrator/chatgpt-desktop-host/browser-project-folder-picker",
  "browser-isolated-pane-navigation.mjs":
    "@agent-orchestrator/chatgpt-desktop-host/browser-isolated-pane-navigation",
  "browser-shared-thread-navigation.mjs":
    "@agent-orchestrator/chatgpt-desktop-host/browser-shared-thread-navigation",
  "browser-shared-thread-submission.mjs":
    "@agent-orchestrator/chatgpt-desktop-host/browser-shared-thread-submission",
  "browser-shared-project-selection.mjs":
    "@agent-orchestrator/chatgpt-desktop-host/browser-shared-project-selection",
  "browser-shared-catalog.mjs":
    "@agent-orchestrator/chatgpt-desktop-host/browser-shared-catalog",
  "browser-shared-thread-directory.mjs":
    "@agent-orchestrator/chatgpt-desktop-host/browser-shared-thread-directory",
  "browser-sidebar-navigation-probe.mjs":
    "@agent-orchestrator/chatgpt-desktop-host/browser-sidebar-navigation-probe",
  "browser-react-root-probe.mjs":
    "@agent-orchestrator/chatgpt-desktop-host/browser-react-root-probe",
  "browser-context-menu.mjs":
    "@agent-orchestrator/chatgpt-desktop-host/browser-context-menu",
  "browser-rich-editor.mjs":
    "@agent-orchestrator/chatgpt-desktop-host/browser-rich-editor",
  "browser-composer-capability.mjs":
    "@agent-orchestrator/chatgpt-desktop-host/browser-composer-capability",
  "browser-composer-capability-entry.mjs":
    "@agent-orchestrator/chatgpt-desktop-host/browser-composer-capability-entry",
  "desktop-layout-browser.mjs":
    "@agent-orchestrator/chatgpt-desktop-host/desktop-layout-browser",
  "desktop-layout-core.mjs":
    "@agent-orchestrator/chatgpt-desktop-host/desktop-layout-core",
  "desktop-pane-layout.mjs":
    "@agent-orchestrator/chatgpt-desktop-host/desktop-pane-layout",
  "desktop-selected-pane-core.mjs":
    "@agent-orchestrator/chatgpt-desktop-host/desktop-selected-pane-core",
  "desktop-selected-pane-browser.mjs":
    "@agent-orchestrator/chatgpt-desktop-host/desktop-selected-pane-browser",
  "desktop-split-pane-core.mjs":
    "@agent-orchestrator/chatgpt-desktop-host/desktop-split-pane-core",
  "desktop-split-pane-browser.mjs":
    "@agent-orchestrator/chatgpt-desktop-host/desktop-split-pane-browser",
  "desktop-home-registrar.mjs":
    "@agent-orchestrator/chatgpt-desktop-host/desktop-home-registrar",
});
type ProfileReader = { readValidated(): Promise<ChatGptDesktopProfileResult> };
export interface ChatGptDesktopBridgeOptions {
  profileService?: ProfileReader;
  controlConnector?: typeof connectDesktopControl;
}
function same(
  a: Readonly<ChatGptDesktopProfile>,
  b: Readonly<ChatGptDesktopProfile>,
) {
  return BINDING_FIELDS.every((key) => a[key] === b[key]);
}
function sameOrigin(request: FastifyRequest) {
  const origin = request.headers.origin;
  if (typeof origin !== "string" || !request.headers.host) return false;
  const forwarded = request.headers["x-forwarded-proto"];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)
    ?.split(",")[0]
    ?.trim();
  const protocol =
    first === "https" || first === "wss"
      ? "https"
      : first === "http" || first === "ws"
        ? "http"
        : request.protocol;
  try {
    return (
      origin === new URL(origin).origin &&
      origin === `${protocol}://${request.headers.host}`
    );
  } catch {
    return false;
  }
}
function routeBinding(request: FastifyRequest) {
  const p = request.params as Record<string, string>;
  return UUID.test(p.profileId ?? "") && UUID.test(p.generation ?? "")
    ? p
    : undefined;
}

/** Dedicated receiver budget after inherited auth/request hooks. No LAN CDP or generic IPC. */
export async function registerChatGptDesktopBridgeRoutes(
  app: FastifyInstance,
  options: ChatGptDesktopBridgeOptions = {},
) {
  const profiles =
    options.profileService ?? createChatGptDesktopProfileService();
  const connectControl = options.controlConnector ?? connectDesktopControl;
  const controlVerifiesWrites = connectControl === connectDesktopControl;
  const bindings = new WeakMap<
    FastifyRequest,
    Readonly<ChatGptDesktopProfile>
  >();
  const active = new Set<WebSocket>(),
    rejected = new Set<Socket>(),
    heads = new WeakMap<IncomingMessage, Buffer>();
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_MESSAGE,
    perMessageDeflate: false,
  });
  let totalQueued = 0,
    totalMessages = 0,
    closing = false;
  const capture = (
    request: IncomingMessage,
    _socket: unknown,
    head: Buffer,
  ) => {
    if (
      /^\/chatgpt-desktop\/[^/?]+\/[^/?]+\/bridge(?:\?|$)/.test(
        request.url ?? "",
      )
    )
      heads.set(request, head);
  };
  app.server.prependListener("upgrade", capture);
  app.addHook("onSend", (request, reply, payload, done) => {
    // An inherited onRequest hook can reject before @fastify/websocket marks
    // request.ws. Its onResponse cleanup then does not own the upgrade socket.
    // This marker is set at the original upgrade event, even in that case.
    if (heads.has(request.raw)) {
      const socket = request.raw.socket;
      reply.header("connection", "close");
      if (!rejected.has(socket)) {
        rejected.add(socket);
        const timer = setTimeout(
          () => socket.destroy(),
          REJECTED_UPGRADE_CLOSE_MS,
        );
        timer.unref();
        socket.once("close", () => {
          clearTimeout(timer);
          rejected.delete(socket);
          heads.delete(request.raw);
        });
        reply.raw.once("finish", () => {
          if (!socket.destroyed) socket.destroySoon();
        });
      }
    }
    done(null, payload);
  });
  app.addHook("preClose", async () => {
    closing = true;
    for (const socket of active) socket.terminate();
    for (const socket of rejected) socket.destroy();
  });
  app.addHook("onClose", async () => {
    app.server.removeListener("upgrade", capture);
    await new Promise<void>((resolve) => wss.close(() => resolve()));
  });
  async function current() {
    try {
      const result = await profiles.readValidated();
      return result.status.state === "ready" ? result.profile : undefined;
    } catch {
      return undefined;
    }
  }
  async function verify(profile: Readonly<ChatGptDesktopProfile>) {
    const now = await current();
    return !!now && same(profile, now);
  }
  function proxy(socket: WebSocket, request: FastifyRequest) {
    if (closing || wss.clients.size > MAX_CLIENTS) {
      socket.close(1013, "Desktop connection limit");
      return;
    }
    active.add(socket);
    const profile = bindings.get(request)!;
    const abort = new AbortController();
    let control: DesktopControlConnection | undefined,
      pending = 0,
      pendingMessages = 0,
      settled = false,
      incomingActive = 0,
      incomingScheduled: NodeJS.Immediate | undefined;
    const incoming: Readonly<{ encoded: string; bytes: number }>[] = [];
    type OutputItem = { frame?: Readonly<{ encoded: string; bytes: number }>; delivery: number; dispatched: boolean; released: boolean; socketWritten: boolean; acknowledged: boolean; timer?: NodeJS.Timeout };
    const output: OutputItem[] = [], outputActive = new Set<OutputItem>(), outputByDelivery = new Map<number, OutputItem>();
    let deliverySequence = 0, bootstrapSent = false, bootstrapConfirmed = false,
      bootstrapTimer: NodeJS.Timeout | undefined, confirmBootstrap: (() => void) | undefined;
    const bootstrapReady = new Promise<void>((resolve) => { confirmBootstrap = resolve; });
    let outputBytes = 0, outputCount = 0, outputRunning = false, outputEnded = false,
      outputEndCause: unknown, outputScheduled: NodeJS.Immediate | undefined,
      wakeOutput: (() => void) | undefined;
    const releaseOutput = (item: OutputItem) => {
      if (item.released) return;
      item.released = true;
      clearTimeout(item.timer); outputByDelivery.delete(item.delivery);
      const bytes = item.frame!.bytes;
      item.frame = undefined;
      outputActive.delete(item);
      outputBytes -= bytes;
      outputCount--;
      totalQueued -= bytes;
      const wake = wakeOutput;
      wakeOutput = undefined;
      wake?.();
      if (!settled) {
        finishOutputIfEnded();
        scheduleOutput();
      }
    };
    const releaseIncoming = (bytes: number) => {
      pending -= bytes;
      totalQueued -= bytes;
      pendingMessages--;
      totalMessages--;
    };
    const close = (code = 1011, cause = "connection_closed", detail?: unknown) => {
      if (settled) return;
      const desktopTransport = {outputCount,outputBytes,outstandingAcks:outputByDelivery.size,incomingActive,pendingMessages,pendingBytes:pending};
      settled = true;
      clearTimeout(bootstrapTimer); confirmBootstrap?.(); confirmBootstrap = undefined;
      if (incomingScheduled) clearImmediate(incomingScheduled);
      incomingScheduled = undefined;
      for (const item of incoming.splice(0)) releaseIncoming(item.bytes);
      if (outputScheduled) clearImmediate(outputScheduled);
      outputScheduled = undefined;
      for (const item of output.splice(0)) releaseOutput(item);
      for (const item of [...outputActive]) releaseOutput(item);
      wakeOutput?.();
      wakeOutput = undefined;
      if (code !== 1000)
        app.log.warn({
          component: "chatgpt_desktop_bridge",
          desktopCloseCause: cause,
          desktopControlCode: controlCode(detail),
          desktopTransport,
        }, "Desktop bridge closed");
      abort.abort();
      control?.close();
      if (socket.readyState === WebSocket.OPEN)
        socket.close(code, "Desktop connection closed");
      else if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
    };
    socket.on("error", (error) => close(1011, "websocket_error", error));
    socket.once("close", () => {
      close(1000, "client_closed");
      for (const item of outputActive) releaseOutput(item);
      active.delete(socket);
    });
    const write = async (text: string) => {
      const bytes = Buffer.byteLength(text);
      if (
        bytes > MAX_MESSAGE ||
        socket.bufferedAmount + bytes > MAX_MESSAGE ||
        totalQueued + bytes > MAX_TOTAL ||
        socket.readyState !== WebSocket.OPEN
      )
        throw new Error("desktop send budget");
      totalQueued += bytes;
      try {
        await new Promise<void>((resolve, reject) =>
          socket.send(text, { binary: false, compress: false }, (err) =>
            err ? reject(err) : resolve(),
          ),
        );
      } finally {
        totalQueued -= bytes;
      }
    };
    const scheduleIncoming = () => {
      if (settled || incomingScheduled || incoming.length === 0) return;
      incomingScheduled = setImmediate(() => {
        incomingScheduled = undefined;
        const width = controlVerifiesWrites ? 8 : 1;
        while (!settled && control && incoming.length && incomingActive < width) {
          const item = incoming.shift()!;
          incomingActive++;
          let written: Promise<void>;
          try {
            // Admit the fixed client's bounded batch in input order on one
            // synchronous stack. It owns final identity checks and socket
            // ordering. Unknown connectors retain the independent serial gate.
            written = controlVerifiesWrites
              ? control.sendFrame(item.encoded)
              : (async () => {
                  if (!(await verify(profile)))
                    throw new Error("desktop profile changed");
                  if (!settled) await control!.sendFrame(item.encoded);
                })();
          } catch (error) {
            written = Promise.reject(error);
          }
          void written
            .catch((error: unknown) => close(1011, "control_send_failed", error))
            .finally(() => {
              releaseIncoming(item.bytes);
              incomingActive--;
              scheduleIncoming();
            });
        }
      });
    };
    const scheduleOutput = () => {
      if (settled || outputRunning || outputScheduled || output.length === 0) return;
      outputScheduled = setImmediate(() => {
        outputScheduled = undefined;
        void flushOutput();
      });
    };
    const finishOutputIfEnded = () => {
      if (!settled && outputEnded && outputCount === 0)
        close(1011, outputEndCause ? "control_receive_failed" : "control_stream_ended", outputEndCause);
    };
    async function flushOutput() {
      if (settled || outputRunning || output.length === 0) return;
      outputRunning = true;
      // Fix membership before the identity check; later frames require another
      // check, and queued plus active frames are capped together at eight.
      const batch = output.splice(0, controlVerifiesWrites ? 8 : 1);
      for (const item of batch) outputActive.add(item);
      try {
        if (!(await verify(profile))) {
          close(1011, "profile_changed");
          return;
        }
        if (settled) return;
        for (const item of batch) {
          if (settled || item.released || !item.frame || socket.readyState !== WebSocket.OPEN ||
              socket.bufferedAmount + item.frame.bytes > MAX_MESSAGE)
            throw new Error("desktop send budget");
          const encoded = item.frame.encoded;
          item.dispatched = true;
          // Kernel completion is not browser consumption. The original eight
          // charged slots stay held until this exact delivery is acknowledged
          // AND its own socket callback has succeeded; neither is inferred.
          item.timer = setTimeout(() => close(1011, "browser_ack_timeout"), 10000);
          item.timer.unref?.();
          socket.send(encoded, { binary: false, compress: false }, (error) => {
            if (error) { close(1011, "browser_send_failed", error); return; }
            item.socketWritten = true;
            if (item.acknowledged) releaseOutput(item);
          });
        }
      } catch (error) {
        close(1011, "browser_send_failed", error);
      } finally {
        for (const item of batch) if (!item.dispatched) releaseOutput(item);
        outputRunning = false;
        finishOutputIfEnded();
        scheduleOutput();
      }
    }
    async function collectOutput(frames: AsyncIterable<string>) {
      const iterator = frames[Symbol.asyncIterator]();
      try {
        while (!settled) {
          while (!settled && outputCount >= 8)
            await new Promise<void>((resolveCapacity) => { wakeOutput = resolveCapacity; });
          if (settled) return;
          const next = await iterator.next();
          if (settled) return;
          if (next.done) break;
          if (!Number.isSafeInteger(deliverySequence + 1)) { close(1011, "browser_delivery_limit"); return; }
          const delivery = ++deliverySequence;
          const encoded = 'KBC1:' + control!.scope.viewId + ':' + delivery + '\n' + next.value;
          const bytes = Buffer.byteLength(encoded);
          if (bytes > MAX_MESSAGE || pending + outputBytes + bytes > MAX_MESSAGE || totalQueued + bytes > MAX_TOTAL) {
            close(1009, "native_queue_limit");
            return;
          }
          const item: OutputItem = { frame: Object.freeze({ encoded, bytes }), delivery, dispatched: false, released: false, socketWritten: false, acknowledged: false };
          outputByDelivery.set(delivery, item);
          outputBytes += bytes;
          outputCount++;
          totalQueued += bytes;
          output.push(item);
          scheduleOutput();
        }
      } catch (error) {
        outputEndCause = error;
      }
      outputEnded = true;
      finishOutputIfEnded();
    }
    socket.on("message", (data: RawData, binary: boolean) => {
      if (settled) return;
      if (binary || !control) {
        close(1008, binary ? "client_binary_frame" : "client_before_bootstrap");
        return;
      }
      const buffer = Array.isArray(data)
        ? Buffer.concat(data)
        : Buffer.isBuffer(data)
          ? data
          : Buffer.from(data);
      const bytes = buffer.byteLength;
      // Fixed, connection-local flow metadata never becomes a native frame or
      // consumes an ordinary pending request reservation. Unknown/duplicate
      // numbers and acknowledgements before actual dispatch fail closed.
      if (buffer.subarray(0, 5).toString('utf8') === 'KBA1:') {
        const ack = bytes <= 80
          ? /^KBA1:([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}):((?:0|[1-9][0-9]{0,15}))$/.exec(buffer.toString('utf8')) : null;
        if (!ack || ack[1] !== control.scope.viewId) {
          close(1008, "browser_ack_invalid"); return;
        }
        const delivery = Number(ack[2]);
        if (!Number.isSafeInteger(delivery)) { close(1008, "browser_ack_invalid"); return; }
        if (delivery === 0 && bootstrapSent && !bootstrapConfirmed) {
          bootstrapConfirmed = true; clearTimeout(bootstrapTimer);
          confirmBootstrap?.(); confirmBootstrap = undefined; return;
        }
        const item = outputByDelivery.get(delivery);
        if (!bootstrapConfirmed || !item || !item.dispatched || item.released || item.acknowledged) {
          close(1008, "browser_ack_invalid"); return;
        }
        item.acknowledged = true;
        if (item.socketWritten) releaseOutput(item);
        return;
      }
      if (!bootstrapConfirmed) { close(1008, "browser_transport_mismatch"); return; }
      if (
        bytes > MAX_MESSAGE ||
        pending + outputBytes + bytes > MAX_MESSAGE ||
        totalQueued + bytes > MAX_TOTAL ||
        pendingMessages >= 64 ||
        totalMessages >= 256
      ) {
        close(1009, "client_queue_limit");
        return;
      }
      let encoded: string;
      try {
        encoded = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
      } catch {
        close(1007, "client_invalid_utf8");
        return;
      }
      pending += bytes;
      totalQueued += bytes;
      pendingMessages++;
      totalMessages++;
      incoming.push(Object.freeze({ encoded, bytes }));
      scheduleIncoming();
    });
    void (async () => {
      let phase = "control_connect_failed";
      try {
        control = await connectControl({
          profile,
          viewId: randomUUID(),
          verifyProfile: () => verify(profile),
          signal: abort.signal,
        });
        if (settled || !(await verify(profile))) {
          control.close();
          close(1011, "profile_changed");
          return;
        }
        phase = "bootstrap_send_failed";
        bootstrapSent = true;
        bootstrapTimer = setTimeout(() => close(1011, "browser_transport_timeout"), 10000);
        bootstrapTimer.unref?.();
        await write(
          'KBC1:' + control.scope.viewId + ':0\n' + encodeWireValue({
            v: 1,
            type: "bootstrap",
            scope: control.scope,
            bootstrap: control.bootstrap,
          }),
        );
        await bootstrapReady;
        if (settled) return;
        phase = "control_receive_failed";
        await collectOutput(control.frames);
      } catch (error) {
        close(1011, phase, error);
      }
    })();
  }
  // Override just this upgrade after Fastify's inherited websocket route hook,
  // so its global receiver cannot allocate a larger message before our checks.
  app.addHook("onRoute", (route) => {
    if (route.method !== "GET" || !route.url.endsWith("/bridge")) return;
    const ordinary = route.handler;
    route.handler = function (request, reply) {
      if (!request.ws) return ordinary.call(this, request, reply);
      reply.hijack();
      const head = heads.get(request.raw) ?? Buffer.alloc(0);
      heads.delete(request.raw);
      wss.handleUpgrade(request.raw, request.raw.socket, head, (socket) =>
        proxy(socket, request),
      );
    };
  });
  app.get(
    "/chatgpt-desktop/:profileId/:generation/bridge",
    {
      logLevel: "silent",
      preValidation: async (request, reply) => {
        if (!request.ws) return;
        if (
          !sameOrigin(request) ||
          request.headers["sec-websocket-protocol"] !== undefined
        )
          return reply.code(403).send({ error: "invalid_origin" });
        const params = routeBinding(request),
          profile = await current();
        if (!profile)
          return reply.code(503).send({ error: "profile_unavailable" });
        if (
          !params ||
          params.profileId !== profile.id ||
          params.generation !== profile.generation
        )
          return reply.code(404).send({ error: "not_found" });
        if (closing || wss.clients.size >= MAX_CLIENTS)
          return reply.code(503).send({ error: "connection_limit" });
        bindings.set(request, Object.freeze({ ...profile }));
      },
    },
    async (_request, reply) =>
      reply.code(426).send({ error: "websocket_required" }),
  );
  app.get(
    "/chatgpt-desktop/:profileId/:generation/webview/__host/:name",
    { logLevel: "silent" },
    async (request, reply) => {
      reply
        .header("cache-control", "private, no-store")
        .header("x-content-type-options", "nosniff");
      const params = routeBinding(request),
        profile = await current();
      if (!profile)
        return reply.code(503).send({ error: "profile_unavailable" });
      if (
        !params ||
        params.profileId !== profile.id ||
        params.generation !== profile.generation ||
        !Object.hasOwn(SOURCES, params.name!)
      )
        return reply.code(404).send({ error: "not_found" });
      try {
        const body = await readFile(
          new URL(import.meta.resolve(SOURCES[params.name!]!)),
        );
        if (body.length > 256 * 1024 || !(await verify(profile)))
          return reply.code(503).send({ error: "profile_unavailable" });
        return reply.type("text/javascript; charset=utf-8").send(body);
      } catch {
        return reply.code(503).send({ error: "resource_unavailable" });
      }
    },
  );
}
