import { randomUUID } from "node:crypto";
import { createRuntime } from "./server.js";
import { resolveRuntimeOptions } from "./core/runtime-options.js";

const options = await resolveRuntimeOptions(process.argv.slice(2), process.env);
const dataHome = process.env.SESSION_DATA_HOME;
if (!dataHome)
  throw new Error("SESSION_DATA_HOME must be explicitly configured");
if (options.remote && !options.tailscale)
  console.error(
    "--remote requires Tailscale to be installed, running, and logged in; staying on loopback",
  );
const runtime = await createRuntime({
  dataHome,
  instance: process.env.SESSION_RUNTIME_INSTANCE || randomUUID(),
  allowedOrigins: options.allowedOrigins,
});
try {
  await runtime.app.listen({ host: options.host, port: options.port });
} catch (error) {
  await runtime.app.close();
  throw error;
}
if (options.tailscale)
  console.error(
    `Listening on the tailnet at http://${options.tailscale.dns_name}:${(runtime.app.server.address() as { port: number }).port} (${options.host})`,
  );
let stopping: Promise<void> | undefined;
const stop = () => {
  stopping ??= runtime.app.close();
  void stopping.catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
