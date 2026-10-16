// Internal executable. There is no HTTP shutdown command or native task shutdown.
import {
  runRefreshControlService,
  validateControlStartupDiagnostic,
} from "./control-service.mjs";
import { controlDirectory } from "./control-channel.mjs";
import { writeFile } from "node:fs/promises";
import { dirname, join, basename } from "node:path";
process.umask(0o077);
if (process.argv.length !== 4 || process.argv[2] !== "--config")
  throw Error("exact private control config required");
let service,
  stopping = false;
const stop = () => {
  stopping = true;
  if (service)
    void service.close().catch(() => {
      process.exitCode = 1;
    });
};
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
try {
  service = await runRefreshControlService({ configPath: process.argv[3] });
  if (stopping) await service.close();
} catch (error) {
  try {
    const root = dirname(process.argv[3]);
    await controlDirectory(root);
    if (basename(process.argv[3]) === "control-config.json")
      await writeFile(
        join(root, "control-startup.json"),
        JSON.stringify(
          validateControlStartupDiagnostic(error?.controlStartup) ?? {
            state: "failed",
            stage: "configuration",
            code: "UNAVAILABLE",
            category: "unknown",
          },
        ),
        { mode: 0o600, flag: "wx" },
      );
  } catch {
    /* Never overwrite another diagnostic or publish the original exception. */
  }
  // No exception payload, paths, account response or capability enters logs.
  process.stderr.write("Private refresh control initialization failed.\n");
  process.exitCode = 1;
}
