import type { FastifyInstance } from "fastify";
import {
  bodyObject,
  HttpError,
  stringField,
  type JsonObject,
} from "../core/json.js";
import type { ClaudeService } from "./service.js";
const alias = (p: JsonObject, snake: string, camel: string) =>
  stringField({ value: p[snake] ?? p[camel] }, "value");
const id = (p: JsonObject) => alias(p, "session_id", "sessionId");
const cwd = (p: JsonObject) => alias(p, "working_dir", "workingDir");
export function registerClaudeRoutes(app: FastifyInstance, s: ClaudeService) {
  const empty = (
    path: string,
    operation: (p: JsonObject) => Promise<unknown>,
  ) =>
    app.post(`/api/cc/${path}`, async (req, reply) => {
      await operation(bodyObject(req.body));
      return reply.code(200).send();
    });
  empty("connect", (p) => s.connect(p));
  empty("send-message", (p) => {
    if (typeof p.message !== "string")
      throw new HttpError(400, "Invalid message");
    const paths = p.image_paths ?? [];
    if (!Array.isArray(paths) || paths.some((v) => typeof v !== "string"))
      throw new HttpError(400, "Invalid image_paths");
    return s.send(id(p), p.message, paths as string[]);
  });
  empty("disconnect", (p) => s.disconnect(id(p)));
  app.post("/api/cc/new-session", (req) =>
    s.newSession(bodyObject(bodyObject(req.body).options)),
  );
  empty("interrupt", (p) => s.interrupt(id(p)));
  empty("resume-session", (p) => s.resume(id(p), bodyObject(p.options)));
  empty("delete-session", (p) => s.deleteSession(id(p)));
  app.post("/api/cc/session-messages", (req) =>
    s.history.messages(id(bodyObject(req.body))),
  );
  empty("resolve-permission", (p) =>
    s.resolvePermission(
      alias(p, "request_id", "requestId"),
      stringField(p, "decision"),
    ),
  );
  empty("set-permission-mode", (p) =>
    s.setPermissionMode(id(p), stringField(p, "mode")),
  );
  app.post("/api/cc/rewind-files", (req) => {
    const p = bodyObject(req.body);
    const dryRun = p.dry_run ?? p.dryRun;
    if (dryRun !== undefined && typeof dryRun !== "boolean")
      throw new HttpError(400, "Invalid dry_run");
    return s.rewindFiles(
      id(p),
      alias(p, "user_message_id", "userMessageId"),
      dryRun === true,
    );
  });
  app.post("/api/cc/fork-session", (req) => {
    const p = bodyObject(req.body);
    const slice = p.up_to_message_id ?? p.upToMessageId;
    if (slice !== undefined && typeof slice !== "string")
      throw new HttpError(400, "Invalid up_to_message_id");
    if (p.title !== undefined && typeof p.title !== "string")
      throw new HttpError(400, "Invalid title");
    return s.forkSession(id(p), {
      ...(slice === undefined ? {} : { upToMessageId: slice }),
      ...(p.title === undefined ? {} : { title: p.title as string }),
      ...(p.working_dir === undefined && p.workingDir === undefined
        ? {}
        : { cwd: cwd(p) }),
    });
  });
  empty("rename-session", (p) => {
    if (typeof p.title !== "string") throw new HttpError(400, "Invalid title");
    const dir = p.working_dir ?? p.workingDir;
    return s.renameSession(
      id(p),
      p.title,
      dir === undefined ? undefined : cwd(p),
    );
  });
  app.get("/api/cc/installed-skills", () => s.config.skills());
  app.get("/api/cc/slash-commands", (req) => {
    const q = req.query as Record<string, string>;
    return s.config.slashCommands(q.cwd);
  });
  app.get("/api/cc/settings", () => s.config.settings.read());
  empty("settings", (p) => s.config.settings.write(bodyObject(p.settings)));
  app.get("/api/cc/sessions", (req) => {
    const q = req.query as Record<string, string>;
    const number = (key: string) => {
      if (q[key] === undefined) return undefined;
      const n = Number(q[key]);
      if (!Number.isSafeInteger(n) || n < 0)
        throw new HttpError(400, `Invalid ${key}`);
      return n;
    };
    const worktrees = q.include_worktrees ?? q.includeWorktrees;
    if (worktrees !== undefined && !["true", "false"].includes(worktrees))
      throw new HttpError(400, "Invalid include_worktrees");
    return s.history.list(
      q.directory,
      number("limit"),
      number("offset") ?? 0,
      worktrees !== "false",
    );
  });
  app.post("/api/cc/mcp/list", (req) =>
    s.config.list(cwd(bodyObject(req.body))),
  );
  app.post("/api/cc/mcp/get", (req) => {
    const p = bodyObject(req.body);
    return s.config.get(stringField(p, "name"), cwd(p));
  });
  app.post("/api/cc/mcp/add", (req) => {
    const p = bodyObject(req.body);
    return s.config.add(bodyObject(p.request), cwd(p));
  });
  app.post("/api/cc/mcp/remove", (req) => {
    const p = bodyObject(req.body);
    return s.config.remove(
      stringField(p, "name"),
      cwd(p),
      stringField(p, "scope"),
    );
  });
  app.post("/api/cc/mcp/disable", (req) => {
    const p = bodyObject(req.body);
    return s.config.toggle(stringField(p, "name"), cwd(p), false);
  });
  app.post("/api/cc/mcp/enable", (req) => {
    const p = bodyObject(req.body);
    return s.config.toggle(stringField(p, "name"), cwd(p), true);
  });
  app.get("/api/cc/mcp/projects", () => s.config.projects());
  app.get("/api/claude/usage", (req) =>
    s.usage.read((req.query as Record<string, string>).refresh === "true"),
  );
}
