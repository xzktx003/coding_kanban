import { resolveSessionDataHome } from "./session-data-home.js";
import { resolveShellStartupEnv } from "./runtime-compat.js";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { isAbsolute, resolve } from "node:path";

interface RuntimeIdentity {
  pid: number;
  port: number;
  instance: string;
  binary: string;
}

async function allocatePort(configured: string | undefined): Promise<number> {
  if (configured?.trim()) {
    const value = Number(configured);
    if (!Number.isInteger(value) || value < 1 || value > 65535)
      throw new Error("SESSION_RUNTIME_PORT must be between 1 and 65535");
    return value;
  }
  return new Promise((accept, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("No runtime port allocated"));
        return;
      }
      server.close((error) => (error ? reject(error) : accept(address.port)));
    });
  });
}

export class SessionRuntimeManager {
  constructor(
    private readonly sourceRoot: string,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  private starting: Promise<string | undefined> | undefined;
  start(): Promise<string | undefined> {
    if (this.starting) return this.starting;
    this.starting = this.startOwned().finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }

  private async startOwned(): Promise<string | undefined> {
    if (this.env.SESSION_MODE_ENABLED === "0") return undefined;
    const binary = resolve(
      this.env.SESSION_RUNTIME_BIN ||
        resolve(
          this.sourceRoot,
          "packages/session-runtime/target/debug/codexia-web",
        ),
    );
    const dataHome = resolveSessionDataHome(
      this.sourceRoot,
      this.env.SESSION_DATA_HOME,
    );
    if (
      !isAbsolute(binary) ||
      !isAbsolute(dataHome) ||
      /[\x00-\x1f]/.test(binary + dataHome)
    )
      throw new Error("Invalid session runtime paths");
    const identityPath = resolve(dataHome, "runtime.json");
    mkdirSync(dataHome, { recursive: true, mode: 0o700 });
    try {
      const identity = JSON.parse(
        readFileSync(identityPath, "utf8"),
      ) as RuntimeIdentity;
      if (
        identity.binary === binary &&
        Number.isInteger(identity.pid) &&
        identity.pid > 0 &&
        Number.isInteger(identity.port) &&
        identity.port > 0 &&
        identity.port <= 65535 &&
        typeof identity.instance === "string"
      ) {
        const origin = `http://127.0.0.1:${identity.port}`;
        const cmdline = readFileSync(
          `/proc/${identity.pid}/cmdline`,
          "utf8",
        ).split("\0");
        if (cmdline[0] === binary) {
          if (await this.ready(origin, identity.instance)) return origin;
          // Do not spawn a second agent service while an owned process still runs.
          throw new Error(
            "Owned session runtime is running but its health check failed",
          );
        }
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Owned session"))
        throw error; /* Identity absent or process already exited. */
    }
    if (!existsSync(binary)) {
      console.warn(
        "[session-mode] Runtime binary missing. Run pnpm session:build to enable session mode.",
      );
      return undefined;
    }
    const port = await allocatePort(this.env.SESSION_RUNTIME_PORT);
    const origin = `http://127.0.0.1:${port}`;
    const instance = randomUUID();
    const shellEnv = await resolveShellStartupEnv(this.env).catch(() => ({}));
    const log = openSync(resolve(dataHome, "runtime.log"), "a", 0o600);
    const child = spawn(binary, ["--port", String(port)], {
      cwd: resolve(this.sourceRoot, "packages/session-runtime"),
      detached: true,
      env: {
        ...shellEnv,
        ...this.env,
        SESSION_DATA_HOME: dataHome,
        SESSION_RUNTIME_INSTANCE: instance,
        CODEXIA_NO_BROWSER: "1",
      },
      stdio: ["ignore", log, log],
    });
    closeSync(log);
    let failure: Error | undefined;
    child.on("error", (error) => {
      failure = error;
    });
    child.unref();
    // Persist ownership before the first await so a Node watch restart cannot
    // orphan an unrecorded daemon during its initial health check.
    if (child.pid)
      writeFileSync(
        identityPath,
        JSON.stringify({ pid: child.pid, port, instance, binary }),
        { mode: 0o600 },
      );
    for (let attempt = 0; attempt < 100; attempt++) {
      if (failure || child.exitCode !== null)
        throw (
          failure ??
          new Error(`Session runtime exited with code ${child.exitCode}`)
        );
      if (await this.ready(origin, instance)) {
        writeFileSync(
          identityPath,
          JSON.stringify({ pid: child.pid, port, instance, binary }),
          { mode: 0o600 },
        );
        return origin;
      }
      await new Promise((accept) => setTimeout(accept, 200));
    }
    // Only the child spawned here may be stopped. Never reclaim a foreign port.
    child.kill("SIGTERM");
    throw new Error(
      "Session runtime did not become ready; see its runtime.log",
    );
  }

  private async ready(origin: string, instance: string): Promise<boolean> {
    try {
      const response = await fetch(`${origin}/health`, {
        signal: AbortSignal.timeout(500),
      });
      const body = (await response.json()) as {
        status?: string;
        instance?: string;
      };
      return response.ok && body.status === "ok" && body.instance === instance;
    } catch {
      return false;
    }
  }
}
