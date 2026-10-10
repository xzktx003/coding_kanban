import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HTTPMethods } from "fastify";
import { createRuntime } from "./server.js";

const contract: Array<{
  method: HTTPMethods;
  path: string;
  legacyHandler: string;
}> = JSON.parse(
  await readFile(new URL("../route-contract.json", import.meta.url), "utf8"),
);
const dataHome = await mkdtemp(join(tmpdir(), "kanban-ts-audit-"));
const runtime = await createRuntime({ dataHome, instance: "migration-audit" });
try {
  await runtime.app.ready();
  const missing = contract.filter(
    (route) => !runtime.app.hasRoute({ method: route.method, url: route.path }),
  );
  console.log(
    JSON.stringify(
      {
        total: contract.length,
        registered: contract.length - missing.length,
        missing,
        note: "Route registration is necessary but does not prove behavior parity or migration completion.",
      },
      null,
      2,
    ),
  );
  if (missing.length) process.exitCode = 1;
} finally {
  await runtime.app.close();
  await rm(dataHome, { recursive: true, force: true });
}
