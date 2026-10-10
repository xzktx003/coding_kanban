import { resolveSessionDataHome } from "./session-data-home.js";
import { resolveShellStartupEnv } from "./runtime-compat.js";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import { createServer } from "node:net";
import { isAbsolute, resolve } from "node:path";

interface RuntimeIdentity {
  pid: number;
  port: number;
  instance: string;
  binary: string;
  entrypoint?: string;
  buildFingerprint?: string;
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
    this.starting = this.startLocked().finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }

  private async startLocked(): Promise<string | undefined> {
    if (this.env.SESSION_MODE_ENABLED === "0") return undefined;
    const dataHome = resolveSessionDataHome(
      this.sourceRoot,
      this.env.SESSION_DATA_HOME,
    );
    if (/[\x00-\x1f]/.test(dataHome))
      throw new Error("Invalid session runtime paths");
    mkdirSync(dataHome, { recursive: true, mode: 0o700 });
    const lock = resolve(dataHome, "runtime-start.lock");
    const token = randomUUID();
    let fd: number;
    try {
      fd = openSync(lock, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const owner = JSON.parse(readFileSync(lock, "utf8")) as { pid?: number };
      if (!Number.isInteger(owner.pid) || owner.pid! <= 0)
        throw new Error(
          "Session runtime startup ownership is unknown; preserve the existing startup lock",
        );
      try {
        process.kill(owner.pid!, 0);
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === "ESRCH") {
          rmSync(lock);
          return this.startLocked();
        }
        throw cause;
      }
      throw new Error(
        "Session runtime startup is already in progress; retry after it finishes",
      );
    }
    try {
      writeFileSync(fd, JSON.stringify({ pid: process.pid, token }));
      closeSync(fd);
      return await this.startOwned();
    } finally {
      try {
        const owner = JSON.parse(readFileSync(lock, "utf8")) as {
          token?: string;
        };
        if (owner.token === token) rmSync(lock);
      } catch {
        /* Never remove an unknown owner's lock. */
      }
    }
  }

  private async startOwned(): Promise<string | undefined> {
    if (this.env.SESSION_MODE_ENABLED === "0") return undefined;
    const entrypoint = this.env.SESSION_RUNTIME_BIN
      ? undefined
      : resolve(this.sourceRoot, "packages/session-runtime/dist/main.js");
    const binary = this.env.SESSION_RUNTIME_BIN
      ? resolve(
          this.sourceRoot,
          this.env.SESSION_RUNTIME_BIN ||
            resolve(this.sourceRoot, "packages/session-runtime/dist/main.js"),
        )
      : process.execPath;
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
        typeof identity.binary === "string" &&
        isAbsolute(identity.binary) &&
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
        if (
          cmdline[0] === identity.binary &&
          (!identity.entrypoint || cmdline[1] === identity.entrypoint)
        ) {
          if (await this.ready(origin, identity.instance)) return origin;
          // Do not spawn a second agent service while an owned process still runs.
          throw new Error(
            "Owned session runtime is running but its health check failed",
          );
        }
        throw new Error(
          "Owned session runtime PID still exists with unverified process identity; refusing a second runtime",
        );
      }
      throw new Error(
        "Owned session runtime identity is invalid; refusing to overwrite it",
      );
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code !== "ENOENT" &&
        (error as NodeJS.ErrnoException).code !== "ESRCH"
      )
        throw error;
      // Only a missing identity or confirmed exited process permits a fresh start.
    }
    if (!existsSync(entrypoint ?? binary)) {
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
    const buildFingerprint = entrypoint
      ? runtimeBuildFingerprint(
          resolve(this.sourceRoot, "packages/session-runtime/dist"),
        )
      : undefined;
    const child = spawn(
      binary,
      [...(entrypoint ? [entrypoint] : []), "--port", String(port)],
      {
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
      },
    );
    closeSync(log);
    let failure: Error | undefined;
    child.on("error", (error) => {
      failure = error;
    });
    child.unref();
    // Persist ownership before the first await so a Node watch restart cannot
    // orphan an unrecorded daemon during its initial health check.
    if (child.pid)
      writeIdentity(
        identityPath,
        JSON.stringify({
          pid: child.pid,
          port,
          instance,
          binary,
          entrypoint,
          buildFingerprint,
        }),
      );
    for (let attempt = 0; attempt < 100; attempt++) {
      if (failure || child.exitCode !== null)
        throw (
          failure ??
          new Error(`Session runtime exited with code ${child.exitCode}`)
        );
      if (await this.ready(origin, instance)) {
        writeIdentity(
          identityPath,
          JSON.stringify({
            pid: child.pid,
            port,
            instance,
            binary,
            entrypoint,
            buildFingerprint,
          }),
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

/** Hash the complete emitted JS tree so status notices changes outside main.js. */
export function runtimeBuildFingerprint(dist: string): string {
  const hash = createHash("sha256");
  const visit = (directory: string, prefix: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      const path = resolve(directory, entry.name),
        name = `${prefix}${entry.name}`;
      if (entry.isDirectory()) visit(path, `${name}/`);
      else if (entry.isFile() && entry.name.endsWith(".js"))
        hash.update(name).update("\0").update(readFileSync(path)).update("\0");
    }
  };
  visit(dist, "");
  return hash.digest("hex");
}

function writeIdentity(path: string, encoded: string) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, encoded, { mode: 0o600, flag: "wx" });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}
