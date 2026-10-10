import type { FastifyInstance } from "fastify";
import type { EventHub } from "../core/events.js";
import { bodyObject, object, type JsonObject } from "../core/json.js";
import { cleanString } from "./common.js";
import { DeviceToken, detectTailscale } from "./device.js";
import { Desktop } from "./desktop.js";
import { Dictation } from "./dictation.js";
import { Insights } from "./insights.js";
import { Publisher } from "./publish.js";
import { Telemetry } from "./telemetry.js";
export interface PlatformOptions {
  dataHome: string;
  hub: EventHub;
  env?: NodeJS.ProcessEnv;
  hasBots?: () => boolean | Promise<boolean>;
  port?: number;
  version?: string;
  fetcher?: typeof fetch;
}
export async function createPlatformServices(options: PlatformOptions) {
  const env = options.env ?? process.env;
  const deviceToken = await DeviceToken.load(options.dataHome);
  const desktop = new Desktop(env);
  const dictation = new Dictation(options.dataHome, env, options.fetcher);
  const insights = new Insights(env);
  const publisher = new Publisher(
    options.dataHome,
    env,
    (p) => options.hub.publish("publish:progress", p),
    options.fetcher,
  );
  const telemetry = new Telemetry(
    options.dataHome,
    env,
    options.hasBots ?? (() => false),
    options.version,
    options.fetcher,
  );
  return {
    env,
    port: options.port,
    deviceToken,
    desktop,
    dictation,
    insights,
    publisher,
    telemetry,
    async close() {
      await Promise.all([dictation.close(), desktop.close(), insights.close()]);
    },
  };
}
export type PlatformServices = Awaited<
  ReturnType<typeof createPlatformServices>
>;
export function registerPlatformRoutes(
  app: FastifyInstance,
  s: PlatformServices,
) {
  app.get("/api/pairing", async () => ({
    token: s.deviceToken.value(),
    port:
      s.port ?? (app.server.address() as { port?: number } | null)?.port ?? 0,
    tailscale: await detectTailscale(s.env),
  }));
  app.get("/api/telemetry/status", () => s.telemetry.status());
  app.post("/api/telemetry/consent", (r) =>
    s.telemetry.setConsent(bodyObject(r.body).consent),
  );
  app.post("/api/telemetry/active", async () => {
    await s.telemetry.track("app_active");
    return { ok: true };
  });
  const conversation = (v: unknown) => {
    const b = bodyObject(v);
    const id = b.conversationId ?? b.conversation_id;
    return id == null ? undefined : cleanString(id, "conversationId");
  };
  app.post("/api/sleep/prevent", async (r, reply) => {
    await s.desktop.prevent(conversation(r.body));
    return reply.code(200).send();
  });
  app.post("/api/sleep/allow", async (r, reply) => {
    await s.desktop.allow(conversation(r.body));
    return reply.code(200).send();
  });
  app.post("/api/openapp/check-app-installed", (r) =>
    s.desktop.check(bodyObject(r.body).appName),
  );
  app.post("/api/openapp/open-workspace-in", async (r, reply) => {
    const b = bodyObject(r.body);
    await s.desktop.open(b.path, b.options);
    return reply.code(200).send();
  });
  app.post("/api/insights/filter-options", () => s.insights.options());
  app.post("/api/insights/heatmaps", (r) =>
    s.insights.heatmaps(bodyObject(r.body)),
  );
  app.post("/api/insights/rankings", (r) =>
    s.insights.rankings(bodyObject(r.body)),
  );
  app.get("/api/dictation/models/status", (r) =>
    s.dictation.status(object(r.query)),
  );
  app.post("/api/dictation/models/download", (r) =>
    s.dictation.download(bodyObject(r.body)),
  );
  app.post("/api/dictation/models/cancel", (r) =>
    s.dictation.cancel(bodyObject(r.body)),
  );
  app.post("/api/dictation/models/remove", (r) =>
    s.dictation.remove(bodyObject(r.body)),
  );
  app.post("/api/dictation/transcribe", { bodyLimit: 8 * 1024 * 1024 }, (r) =>
    s.dictation.transcribe(bodyObject(r.body)),
  );
  app.post("/api/publish/connect/start", () => s.publisher.start());
  app.post("/api/publish/connect/poll", (r) =>
    s.publisher.poll(bodyObject(r.body).code),
  );
  app.post("/api/publish/disconnect", () => s.publisher.disconnect());
  app.get("/api/publish/whoami", () => s.publisher.whoami());
  app.post("/api/publish/game", (r) => s.publisher.publish(bodyObject(r.body)));
}
