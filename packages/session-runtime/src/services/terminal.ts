import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import * as pty from "node-pty";
import type { FastifyInstance } from "fastify";
import { EventHub } from "../core/events.js";
import { bodyObject, HttpError, type JsonObject } from "../core/json.js";
import { absolutePath } from "./paths.js";

function dimension(value: unknown, field: string, fallback?: number): number {
  if (value === undefined || value === null) {
    if (fallback !== undefined) return fallback;
    throw new HttpError(400, `Invalid terminal ${field}`);
  }
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 65535)
    throw new HttpError(400, `Invalid terminal ${field}`);
  return Number(value);
}

export class Terminals {
  private sessions = new Map<string, pty.IPty>();
  private closed = false;
  constructor(
    private readonly hub: EventHub,
    private readonly options: {
      shell?: string;
      shellArgs?: string[];
      env?: NodeJS.ProcessEnv;
    } = {},
  ) {}

  get count(): number {
    return this.sessions.size;
  }

  async start(
    params: JsonObject,
  ): Promise<{ session_id: string; shell: string }> {
    if (this.closed) throw new Error("Terminal service closed");
    const cols = dimension(params.cols, "cols", 120),
      rows = dimension(params.rows, "rows", 30);
    const cwd = absolutePath(params.cwd ?? homedir());
    if (!(await stat(cwd)).isDirectory())
      throw new HttpError(400, "Terminal cwd must be a directory");
    const env = this.options.env ?? process.env;
    const shell =
      this.options.shell ??
      (process.platform === "win32"
        ? "powershell.exe"
        : env.SHELL ||
          (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash"));
    if (!shell || /[\x00-\x1f]/.test(shell))
      throw new HttpError(400, "Invalid terminal shell");
    if (this.closed) throw new Error("Terminal service closed");
    const terminal = pty.spawn(
      shell,
      this.options.shellArgs ??
        (process.platform === "win32" ? ["-NoLogo"] : ["-i", "-l"]),
      {
        cwd,
        cols,
        rows,
        name: "xterm-256color",
        env: { ...env, TERM: "xterm-256color" },
      },
    );
    const session_id = randomUUID();
    this.sessions.set(session_id, terminal);
    const data = terminal.onData((chunk) =>
      this.hub.publish("terminal:data", { session_id, data: chunk }),
    );
    const exit = terminal.onExit(() => {
      if (this.sessions.get(session_id) === terminal)
        this.sessions.delete(session_id);
      data.dispose();
      exit.dispose();
      this.hub.publish("terminal:exit", {
        session_id,
        message: "terminal closed",
      });
    });
    return { session_id, shell };
  }

  private get(id: string): pty.IPty {
    const terminal = this.sessions.get(id);
    if (!terminal) throw new Error("Terminal session not found");
    return terminal;
  }

  write(id: string, data: string): void {
    if (typeof data !== "string")
      throw new HttpError(400, "Invalid terminal data");
    this.get(id).write(data);
  }
  resize(id: string, cols: number, rows: number): void {
    this.get(id).resize(dimension(cols, "cols"), dimension(rows, "rows"));
  }
  stop(id: string): void {
    const terminal = this.get(id);
    terminal.kill();
    this.sessions.delete(id);
  }
  close(): void {
    this.closed = true;
    for (const terminal of this.sessions.values()) terminal.kill();
    this.sessions.clear();
  }
}

export function registerTerminalRoutes(
  app: FastifyInstance,
  terminals: Terminals,
): void {
  app.post("/api/terminal/start", (request) =>
    terminals.start(bodyObject(request.body)),
  );
  for (const operation of ["write", "resize", "stop"] as const)
    app.post(`/api/terminal/${operation}`, async (request, reply) => {
      const body = bodyObject(request.body);
      const id = body.session_id ?? body.sessionId;
      if (typeof id !== "string" || !id)
        throw new HttpError(400, "Invalid terminal session ID");
      if (operation === "write") terminals.write(id, body.data as string);
      if (operation === "resize")
        terminals.resize(id, body.cols as number, body.rows as number);
      if (operation === "stop") terminals.stop(id);
      return reply.code(200).send();
    });
}
