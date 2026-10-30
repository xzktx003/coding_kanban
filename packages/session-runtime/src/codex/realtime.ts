import { nativeRealtimeWebRtcSupported } from "./native-version.js";
import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  bodyObject,
  HttpError,
  object,
  type Json,
  type JsonObject,
} from "../core/json.js";
import type { Rpc } from "./ownership.js";
import type { CodexService } from "./client.js";
type Snapshot = {
  connected: boolean;
  scope?: string;
  generation: number;
  accountRevision: number;
  nativeVersion?: string;
};
type Context = {
  threadId: string;
  snapshot: Snapshot;
  expires: number;
  phase: "ready" | "starting" | "active" | "stopping" | "revoked";
  sent: boolean;
  started: boolean;
  cancelled: boolean;
  intents: Set<string>;
  resolve?: (sdp: string) => void;
  reject?: (error: Error) => void;
};
const valid = (value: unknown, max = 512): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= max &&
  !/[\x00-\x1f\x7f]/.test(value);
export class ThreadRealtime {
  private contexts = new Map<string, Context>();
  private active?: Context;
  constructor(private options: { raw: Rpc; snapshot: () => Snapshot }) {}
  invalidate() {
    for (const context of this.contexts.values()) {
      context.phase = "revoked";
      context.reject?.(
        new HttpError(409, "Realtime connection or account changed"),
      );
    }
    this.contexts.clear();
    this.active = undefined;
  }
  observe(method: string, params: JsonObject) {
    if (
      [
        "account/updated",
        "account/login/completed",
        "codex:disconnected",
      ].includes(method)
    ) {
      this.invalidate();
      return;
    }
    const context = this.active;
    if (!context || params.threadId !== context.threadId) return;
    if (method === "thread/realtime/started") {
      if (context.phase === "starting" && context.sent && !context.started) {
        context.started = true;
        if (context.cancelled)
          queueMicrotask(() => void this.stopContext(context).catch(() => {}));
      } else {
        context.phase = "revoked";
        context.reject?.(
          new HttpError(409, "Realtime session was changed by another client"),
        );
        this.active = undefined;
      }
    }
    if (
      method === "thread/realtime/sdp" &&
      context.phase === "starting" &&
      context.started
    ) {
      if (
        typeof params.sdp === "string" &&
        Buffer.byteLength(params.sdp) <= 131072
      )
        context.resolve?.(params.sdp);
      else context.reject?.(new HttpError(502, "Invalid native realtime SDP"));
    }
    if (method === "thread/realtime/error") {
      context.reject?.(
        new HttpError(
          502,
          String(
            params.message ?? params.error ?? "Native realtime startup failed",
          ),
        ),
      );
    }
    if (method === "thread/realtime/closed") {
      context.reject?.(new HttpError(409, "Realtime session closed"));
      context.phase = "revoked";
      this.active = undefined;
    }
  }
  private assert(context: Context) {
    const current = this.options.snapshot(),
      before = context.snapshot;
    if (
      context.phase === "revoked" ||
      !current.connected ||
      current.scope !== before.scope ||
      current.generation !== before.generation ||
      current.accountRevision !== before.accountRevision
    )
      throw new HttpError(
        409,
        "Realtime connection, account or session changed/revoked",
      );
  }
  private get(value: Json) {
    const context =
      typeof value === "string" ? this.contexts.get(value) : undefined;
    if (!context)
      throw new HttpError(409, "Realtime context expired or revoked");
    this.assert(context);
    return context;
  }
  async preflight(body: JsonObject) {
    if (
      Object.keys(body).some((key) => key !== "threadId") ||
      !valid(body.threadId)
    )
      throw new HttpError(400, "Invalid realtime target");
    for (const [token, context] of this.contexts)
      if (
        context.phase === "revoked" ||
        (context.expires < Date.now() && context.phase === "ready")
      )
        this.contexts.delete(token);
    if (this.contexts.size >= 32 || this.active)
      throw new HttpError(
        409,
        "Another voice session is active or awaiting confirmation",
      );
    const account = object(
        await this.options.raw("account/read", { refreshToken: false }),
      ),
      snapshot = this.options.snapshot();
    if (
      !snapshot.connected ||
      !snapshot.scope ||
      !nativeRealtimeWebRtcSupported(snapshot.nativeVersion)
    )
      throw new HttpError(
        422,
        "This native version has not been verified for realtime WebRTC",
      );
    if (account.requiresOpenaiAuth === true && account.account === null)
      throw new HttpError(
        401,
        "Sign in to the native model service before starting voice",
      );
    const loaded = object(await this.options.raw("thread/loaded/list", {}));
    if (
      !Array.isArray(loaded.data) ||
      !loaded.data.some(
        (value) =>
          value === body.threadId || object(value).id === body.threadId,
      )
    )
      throw new HttpError(
        409,
        "Open the existing native thread before starting voice; this read will not resume it",
      );
    const metadata = object(
      await this.options.raw("thread/read", {
        threadId: body.threadId,
        includeTurns: false,
      }),
    );
    if (object(metadata.thread).id !== body.threadId)
      throw new HttpError(409, "Native thread identity changed");
    const token = randomBytes(32).toString("hex"),
      context: Context = {
        threadId: body.threadId,
        snapshot,
        expires: Date.now() + 60000,
        phase: "ready",
        sent: false,
        started: false,
        cancelled: false,
        intents: new Set(),
      };
    this.assert(context);
    if (this.contexts.size >= 32 || this.active)
      throw new HttpError(
        409,
        "Another voice session is active or awaiting confirmation",
      );
    this.contexts.set(token, context);
    return {
      contextToken: token,
      threadId: body.threadId,
      transport: "webrtc",
      requiresReplacementConfirmation: true,
    };
  }
  async start(body: JsonObject) {
    if (
      Object.keys(body).some(
        (key) =>
          !["contextToken", "threadId", "sdp", "replaceExisting"].includes(key),
      ) ||
      body.replaceExisting !== true
    )
      throw new HttpError(
        400,
        "Explicit confirmation of native voice replacement required",
      );
    if (
      typeof body.sdp !== "string" ||
      !body.sdp.startsWith("v=0") ||
      Buffer.byteLength(body.sdp) > 131072
    )
      throw new HttpError(400, "Invalid realtime offer SDP");
    const context = this.get(body.contextToken);
    if (body.threadId !== context.threadId)
      throw new HttpError(409, "Realtime thread identity mismatch");
    if (
      context.phase !== "ready" ||
      context.expires < Date.now() ||
      this.active
    )
      throw new HttpError(
        409,
        "Realtime intent already submitted or expired; do not resend",
      );
    context.phase = "starting";
    this.active = context;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const answer = new Promise<string>((resolve, reject) => {
      context.resolve = resolve;
      context.reject = reject;
      timer = setTimeout(
        () =>
          reject(
            new HttpError(
              504,
              "Realtime start outcome is unknown; it will not be resent",
            ),
          ),
        20000,
      );
      timer.unref();
    });
    void answer.catch(() => {});
    try {
      await this.options.raw(
        "thread/realtime/start",
        {
          threadId: context.threadId,
          outputModality: "audio",
          transport: { type: "webrtc", sdp: body.sdp },
        },
        {
          beforeSend: () => {
            this.assert(context);
            if (context.cancelled)
              throw new HttpError(
                409,
                "Realtime cancelled before native write",
              );
            context.sent = true;
          },
          timeoutMs: 20000,
        },
      );
      const sdp = await answer;
      this.assert(context);
      if (context.cancelled) {
        await this.stopContext(context);
        throw new HttpError(409, "Realtime start was cancelled");
      }
      context.phase = "active";
      return {
        contextToken: body.contextToken,
        threadId: context.threadId,
        sdp,
      };
    } catch (error) {
      if (!context.sent) {
        context.phase = "revoked";
        if (this.active === context) this.active = undefined;
      }
      throw error;
    } finally {
      clearTimeout(timer);
      context.resolve = undefined;
      context.reject = undefined;
    }
  }
  async appendText(body: JsonObject) {
    if (
      Object.keys(body).some(
        (key) =>
          !["contextToken", "threadId", "text", "intentId"].includes(key),
      ) ||
      !valid(body.intentId, 128) ||
      typeof body.text !== "string" ||
      body.text.trim().length === 0 ||
      Buffer.byteLength(body.text) > 65536
    )
      throw new HttpError(400, "Invalid realtime text intent");
    const context = this.get(body.contextToken);
    if (body.threadId !== context.threadId || context.phase !== "active")
      throw new HttpError(409, "Realtime text target changed or is not active");
    if (context.intents.has(body.intentId) || context.intents.size >= 256)
      throw new HttpError(
        409,
        "Realtime text intent already submitted; do not resend",
      );
    context.intents.add(body.intentId);
    return this.options.raw(
      "thread/realtime/appendText",
      { threadId: context.threadId, text: body.text },
      {
        beforeSend: () => {
          this.assert(context);
          if (context.phase !== "active")
            throw new HttpError(
              409,
              "Realtime session changed before text write",
            );
        },
        timeoutMs: 15000,
      },
    );
  }

  private async stopContext(context: Context) {
    this.assert(context);
    if (this.active !== context)
      throw new HttpError(409, "Realtime ownership changed");
    if (!context.started) {
      context.cancelled = true;
      return { status: "stopping" };
    }
    context.phase = "stopping";
    await this.options.raw(
      "thread/realtime/stop",
      { threadId: context.threadId },
      { beforeSend: () => this.assert(context), timeoutMs: 15000 },
    );
    context.phase = "revoked";
    if (this.active === context) this.active = undefined;
    return { status: "stopped" };
  }
  async stop(body: JsonObject) {
    if (
      Object.keys(body).some(
        (key) => !["contextToken", "threadId"].includes(key),
      )
    )
      throw new HttpError(400, "Invalid realtime stop");
    const context = this.get(body.contextToken);
    if (body.threadId !== context.threadId)
      throw new HttpError(409, "Realtime thread identity mismatch");
    if (context.phase === "ready") {
      context.phase = "revoked";
      return { status: "not-started" };
    }
    context.cancelled = true;
    return this.stopContext(context);
  }
}
export function registerRealtimeRoutes(
  app: FastifyInstance,
  service: CodexService,
) {
  const manager = new ThreadRealtime({
    raw: service.raw.bind(service),
    snapshot: () => service.connectionSnapshot(),
  });
  const events = service.options.hub.subscribe({
    filter: (event) => {
      if (event.event === "codex:disconnected") manager.invalidate();
      if (event.event === "codex:notification") {
        const payload = object(event.payload);
        manager.observe(String(payload.method), object(payload.params));
      }
      return false;
    },
  });
  app.addHook("onClose", async () => {
    manager.invalidate();
    events.close();
  });
  for (const action of ["preflight", "start", "stop", "append-text"] as const)
    app.post(
      "/api/codex/realtime/" + action,
      { bodyLimit: 150000 },
      async (request, reply) => {
        reply.header("cache-control", "no-store");
        return action === "append-text"
          ? manager.appendText(bodyObject(request.body))
          : manager[action](bodyObject(request.body));
      },
    );
}
