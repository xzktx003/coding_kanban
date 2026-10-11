import { createRequire } from "node:module";
import { registerSessionModeRoutes } from "../../../apps/server/src/routes/session-mode.ts";
import { registerCodexRoutes } from "../../../packages/session-runtime/src/codex/routes.ts";
import { CodexService } from "../../../packages/session-runtime/src/codex/client.ts";
import { EventHub } from "../../../packages/session-runtime/src/core/events.ts";
import { join } from "node:path";
const Fastify = createRequire(
  new URL("../../../apps/server/package.json", import.meta.url),
)("fastify");
const origin = process.argv[2],
  root = process.argv[3];
const target = new URL(origin);
if (target.protocol !== "http:" || target.hostname !== "127.0.0.1")
  throw new Error("Fixture origin must be loopback HTTP");
const app = Fastify();
const nativeCalls: unknown[] = [];
const native = new CodexService({
  hub: new EventHub(),
  instance: "mcp-config-fixture",
  sweepIntervalMs: 0,
  env: {
    ...process.env,
    CODEX_HOME: join(root, "cli"),
    SESSION_DATA_HOME: root,
  },
});
Object.assign(native, {
  raw: async (method: string, params: unknown) => {
    nativeCalls.push({ method, params });
    if (method === "config/read")
      return {
        config: {
          desktop: {
            mcp_startup_authentication: true,
            secret: "PRIVATE_CONFIG",
          },
        },
        layers: [{ credential: "PRIVATE_CONFIG" }],
      };
    throw new Error("Unexpected isolated native request");
  },
});
registerCodexRoutes(app, native);
app.get("/__fixture/native-calls", () => nativeCalls);
app.addHook("onRequest", async (r: any, reply: any) => {
  process.stderr.write("request " + r.url + "\n");
  reply.header("access-control-allow-origin", "*");
  reply.header("access-control-allow-methods", "GET, POST, OPTIONS");
  reply.header("access-control-allow-headers", "content-type");
});
// The owned browser fixture redirects a JSON POST to this separate origin.
// WebKit issues a real CORS preflight; keep the production gateway unchanged.
app.options("/api/codex/config/read", (_request: unknown, reply: any) =>
  reply.code(204).send(),
);
registerSessionModeRoutes(app, { origin, attachmentRoot: root });
await app.listen({ host: "0.0.0.0", port: 0 });
process.stdout.write(
  JSON.stringify({ origin: app.listeningOrigin, pid: process.pid }) + "\n",
);
process.on("SIGTERM", () => {
  void native
    .close()
    .then(() => app.close())
    .finally(() => process.exit(0));
});
