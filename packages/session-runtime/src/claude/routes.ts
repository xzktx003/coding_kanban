import type { FastifyInstance } from "fastify";
import {
  bodyObject,
  HttpError,
  stringField,
  type JsonObject,
} from "../core/json.js";
import type { ClaudeService } from "./service.js";
import { recentHistoryOptions, historyDetailOptions } from "../core/recent-history.js";
import { historyImageOptions,historyImageHeaders } from "../core/history-image.js";
const alias = (p: JsonObject, snake: string, camel: string) =>
  stringField({ value: p[snake] ?? p[camel] }, "value");
const id = (p: JsonObject) => alias(p, "session_id", "sessionId");
const cwd = (p: JsonObject) => alias(p, "working_dir", "workingDir");
export function registerClaudeRoutes(app: FastifyInstance, s: ClaudeService) {
  const owner = (p: JsonObject) => {
    if (p.expected_runtime_instance !== undefined || p.expected_cwd !== undefined)
      s.assertSessionScope(id(p), stringField(p,"expected_runtime_instance"), p.expected_cwd === undefined ? undefined : stringField(p,"expected_cwd"));
  };
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
    owner(p);
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
  empty("interrupt", (p) => { owner(p); return s.interrupt(id(p)); });
  empty("resume-session", (p) => s.resume(id(p), bodyObject(p.options)));
  app.post("/api/cc/session-snapshot", req => {
    const p=bodyObject(req.body);
    for (const key of ["expected_runtime_instance", "expected_cwd"])
      if (p[key] !== undefined && typeof p[key] !== "string") throw new HttpError(400, `Invalid ${key}`);
    return s.sessionSnapshot(id(p), p.expected_runtime_instance as string|undefined, p.expected_cwd as string|undefined);
  });
  app.post("/api/cc/permission-detail", req => {
    const p=bodyObject(req.body);
    for(const key of ["offset","limit"])
      if(p[key]!==undefined&&typeof p[key]!=="number")throw new HttpError(400,`Invalid ${key}`);
    if (p.expected_item_revision !== undefined && typeof p.expected_item_revision !== "string") throw new HttpError(400, "Invalid expected_item_revision");
    return s.permissionDetail(id(p), alias(p,"request_id","requestId"), stringField(p,"expected_runtime_instance"), {
      offset: Number(p.offset ?? 0), limit: Number(p.limit ?? 65536), expectedItemRevision: p.expected_item_revision as string|undefined,
    });
  });
  empty("delete-session", (p) => s.deleteSession(id(p)));
  app.post("/api/cc/session-messages", async (req) => {
    const body=bodyObject(req.body),view=(req.query as Record<string,unknown>).view;
    if(view!==undefined&&view!=="recent") throw new HttpError(400,"Invalid Claude history view");
    const historyId=await s.historySessionId(id(body));
    return view==="recent" ? s.history.recentMessages(historyId,recentHistoryOptions(body)) : s.history.messages(historyId);
  });
  app.post("/api/cc/session-message-detail", async req=>{
    const body=bodyObject(req.body),options=historyDetailOptions(body);
    return s.history.messageDetail(await s.historySessionId(id(body)),options.itemId,options);
  });
  app.post("/api/cc/session-message-image",async(req,reply)=>{
    const body=bodyObject(req.body),options=historyImageOptions(body);
    const image=await s.history.messageImage(await s.historySessionId(id(body)),options.itemId,options.index,options.download);
    return reply.headers(historyImageHeaders(image,options.index,options.download)).send(image.bytes);
  });
  empty("resolve-permission", (p) =>
    s.resolvePermission(
      alias(p, "request_id", "requestId"),
      stringField(p, "decision"),
      p.expected_runtime_instance === undefined ? undefined : {
        runtimeInstance:stringField(p,"expected_runtime_instance"),sessionId:id(p),
        executionId:p.execution_id===undefined?undefined:stringField(p,"execution_id"),
        inputRevision:p.input_revision===undefined?undefined:stringField(p,"input_revision"),
      },
    ),
  );
  empty("set-permission-mode", (p) => { owner(p); return s.setPermissionMode(id(p), stringField(p, "mode")); });
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
