/** Isolated metadata-only backend used by restart tests. Never starts an Agent runtime. */
import Fastify from "../../apps/server/node_modules/fastify/fastify.js";
import { join } from "node:path";
import { registerSessionTabsRoutes } from "../../apps/server/src/routes/session-tabs";
import { registerSessionProjectsRoutes } from "../../apps/server/src/routes/session-projects";
async function main() {
  const app = Fastify();
  const home = process.argv[2];
  if (!home) throw new Error("An isolated data directory is required");
  registerSessionTabsRoutes(app, {
    file: join(home, "followed-sessions.json"),
  });
  registerSessionProjectsRoutes(app, {
    file: join(home, "projects.json"),
    legacyFile: join(home, ".codexia/settings.json"),
  });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  console.log(
    JSON.stringify({
      port: typeof address === "object" && address ? address.port : 0,
    }),
  );
  process.on("SIGTERM", () => {
    void app.close().then(() => process.exit(0));
  });
}
void main();
