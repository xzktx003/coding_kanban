import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { readFile, realpath, stat } from "node:fs/promises";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type {
  CodexEditorContext,
  CodexHostCapabilities,
  CodexHostCommand,
  CodexHostOwner,
} from "@agent-orchestrator/shared";
import { CodexHostBroker } from "../services/codex-host-broker.js";
import { CodexHostCompanionCredential } from "../services/codex-host-companion.js";
import { codexHostRelayScript } from "../services/codex-host-relay.js";
import { CodexHostWorkspaceService } from "../services/codex-host-workspace.js";
const invalid = (message = "无效的编辑器宿主请求", statusCode = 400): never => {
  throw Object.assign(new Error(message), { statusCode });
};
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : invalid();
function text(value: unknown, max = 4096): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > max ||
    /[\x00-\x1f\x7f]/.test(value)
  )
    invalid();
  return value as string;
}
const identifier = (value: unknown) => {
  const result = text(value, 160);
  if (!/^[a-zA-Z0-9_-]+$/.test(result)) invalid();
  return result;
};
export function parseCodexHostOwner(value: unknown): CodexHostOwner {
  const b = object(value),
    cwd = text(b.cwd),
    draftOwner = text(b.draftOwner, 8192);
  if (!isAbsolute(cwd)) invalid();
  return {
    cwd,
    draftOwner,
    threadId: b.threadId === null ? null : identifier(b.threadId),
    ...(b.agentId === undefined ? {} : { agentId: identifier(b.agentId) }),
  };
}
const number = (value: unknown) => {
  if (
    !Number.isInteger(value) ||
    Number(value) < 1 ||
    Number(value) > 10_000_000
  )
    invalid();
  return Number(value);
};
async function inWorkspace(cwd: string, value: unknown, exists = true) {
  const path = text(value);
  if (!isAbsolute(path)) invalid();
  const full = exists
    ? await realpath(path).catch(() => invalid("文件不存在或无法访问"))
    : path;
  const rel = relative(cwd, full);
  if (rel === ".." || rel.startsWith("../") || isAbsolute(rel))
    invalid("文件不属于该会话项目");
  return full;
}
export function validateCodexHostBrowserSource(request: FastifyRequest) {
  const origin = request.headers.origin;
  // Browser requests must originate from this gateway. Companion endpoints use
  // private bearer authorization and must not accept a browser Origin.
  if (origin) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      invalid("宿主请求来源不匹配", 403);
    }
    if (
      parsed!.host !== request.headers.host ||
      !["http:", "https:"].includes(parsed!.protocol) ||
      parsed!.username ||
      parsed!.password
    )
      invalid("宿主请求来源不匹配", 403);
  }
  if (request.headers["sec-fetch-site"] === "cross-site")
    invalid("宿主请求来源不匹配", 403);
}
export function registerCodexHostRoutes(
  app: FastifyInstance,
  options: {
    credential: CodexHostCompanionCredential;
    resolveOwner: (owner: CodexHostOwner) => Promise<string>;
    broker?: CodexHostBroker;
  },
) {
  const broker = options.broker ?? new CodexHostBroker();
  const workspace = new CodexHostWorkspaceService(
    dirname(options.credential.file),
  );
  const editor = async (value: unknown, cwd: string) => {
    const file = await realpath(text(value)).catch(() =>
      invalid("编辑工作区不存在", 409),
    );
    if (!file.endsWith(".code-workspace")) invalid("编辑工作区标识无效");
    try {
      const workspace = JSON.parse(await readFile(file, "utf8"));
      const privateConfig = JSON.parse(
        await readFile(
          join(dirname(file), "codex-host-companion.json"),
          "utf8",
        ),
      );
      if (
        !options.credential.valid("Bearer " + privateConfig.token) ||
        (await realpath(workspace.folders?.[0]?.path)) !== cwd
      )
        invalid("编辑工作区与项目不一致", 409);
    } catch {
      invalid("宿主扩展尚未准备或工作区与项目不一致，请重新连接", 409);
    }
    return file;
  };
  const binding = async (request: FastifyRequest) => {
    validateCodexHostBrowserSource(request);
    const b = object(request.body),
      owner = parseCodexHostOwner(b.owner),
      nonce = identifier(b.nonce);
    const cwd = await realpath(await options.resolveOwner(owner)).catch(() =>
      invalid("原会话项目无法核验", 409),
    );
    if (
      cwd !==
        (await realpath(owner.cwd).catch(() =>
          invalid("编辑器目录无法核验", 409),
        )) ||
      !(await stat(cwd)).isDirectory()
    )
      invalid("编辑器与原会话项目不一致", 409);
    return { b, owner: { ...owner, cwd }, nonce };
  };
  const companion = async (request: FastifyRequest) => {
    if (
      request.headers.origin ||
      !options.credential.valid(request.headers.authorization)
    )
      invalid("宿主扩展身份验证失败", 401);
    const b = object(request.body),
      cwd = await realpath(text(b.cwd)).catch(() => invalid());
    return {
      b,
      cwd,
      instanceId: identifier(b.instanceId),
      editorKey: await editor(b.editorKey, cwd),
    };
  };
  app.get("/api/session/codex-host/relay.js", async (_request, reply) =>
    reply
      .header("cache-control", "no-store")
      .type("text/javascript")
      .send(codexHostRelayScript),
  );
  app.post("/api/session/codex-host/bind", async (request) => {
    const { b, owner, nonce } = await binding(request);
    broker.bind(nonce, owner, await editor(b.editorKey, owner.cwd));
    return broker.status(nonce, owner);
  });
  app.post("/api/session/codex-host/state", async (request) => {
    const { owner, nonce } = await binding(request);
    return {
      status: broker.status(nonce, owner),
      events: broker.events(nonce, owner),
    };
  });
  app.post("/api/session/codex-host/active", async (request) => {
    const { b, owner, nonce } = await binding(request);
    if (typeof b.active !== "boolean") invalid();
    broker.activate(nonce, owner, b.active as boolean);
    return { success: true };
  });
  app.post("/api/session/codex-host/dispose", async (request) => {
    const { owner, nonce } = await binding(request);
    broker.dispose(nonce, owner);
    return { success: true };
  });
  app.post(
    "/api/session/codex-host/command",
    { bodyLimit: 1024 * 1024 },
    async (request) => {
      const { b, owner, nonce } = await binding(request),
        c = object(b.command);
      let command!: CodexHostCommand;
      if (c.type === "context")
        command = { type: "context", selectionOnly: c.selectionOnly === true };
      else if (c.type === "workspaceState")
        command = { type: "workspaceState" };
      else if (c.type === "openLocation")
        command = {
          type: "openLocation",
          path: await inWorkspace(owner.cwd, c.path),
          ...(c.line === undefined ? {} : { line: number(c.line) }),
          ...(c.column === undefined ? {} : { column: number(c.column) }),
        };
      else if (c.type === "definitions")
        command = {
          type: "definitions",
          path: await inWorkspace(owner.cwd, c.path),
          line: number(c.line),
          column: number(c.column),
        };
      else if (c.type === "showDiff") {
        if (
          typeof c.before !== "string" ||
          typeof c.after !== "string" ||
          c.before.length + c.after.length > 700_000 ||
          /\0/.test(c.before + c.after)
        )
          invalid();
        command = {
          type: "showDiff",
          path: await inWorkspace(owner.cwd, c.path, false),
          before: c.before as string,
          after: c.after as string,
          ...(c.title === undefined ? {} : { title: text(c.title, 200) }),
        };
      } else invalid();
      return broker.command(nonce, owner, command);
    },
  );
  app.post(
    "/api/session/codex-host/workspace",
    { bodyLimit: 600 * 1024 },
    async (request) => {
      const { b, owner, nonce } = await binding(request);
      // Authenticate the captured binding even for read-only Git/configuration.
      broker.status(nonce, owner);
      if (b.action === "mcpConfig")
        return {
          command: "node",
          args: [
            resolve(
              import.meta.dirname,
              "../../../../packages/codex-host-bridge/lsp-mcp.cjs",
            ),
          ],
          env: {
            CODING_KANBAN_HOST_CONFIG: options.credential.file,
            CODING_KANBAN_EDITOR_WORKSPACE: broker.editorWorkspace(
              nonce,
              owner,
            ),
            CODING_KANBAN_HOST_OWNER: JSON.stringify(owner),
          },
        };
      if (b.action === "read")
        return {
          cwd: owner.cwd,
          ...(await workspace.gitState(owner.cwd)),
          agents: await workspace.instructions(owner.cwd),
          recommendedSkills: [],
        };
      if (b.action === "recommended")
        return workspace.recommended(owner.cwd, b.refresh === true);
      if (b.action === "instructions") {
        if (b.confirmed !== true || typeof b.text !== "string")
          invalid("请显式保存 AGENTS.md");
        return workspace.saveInstructions(
          owner.cwd,
          b.text as string,
          text(b.revision, 64),
        );
      }
      if (b.confirmed !== true) invalid("请先确认原项目的工作区操作");
      if (b.action === "createBranch")
        return workspace.createBranch(owner.cwd, text(b.name, 160));
      if (b.action === "createWorktree")
        return workspace.createWorktree(owner.cwd, text(b.name, 160));
      if (b.action === "checkout") {
        await workspace.requireGitMutationScope(owner.cwd);
        const buffers = (await broker.command(nonce, owner, {
          type: "workspaceState",
        })) as { dirtyPaths: string[] };
        if (!Array.isArray(buffers.dirtyPaths) || buffers.dirtyPaths.length)
          invalid("VS Code 存在未保存缓冲，未切换分支", 409);
        return workspace.checkout(owner.cwd, text(b.name, 160));
      }
      if (b.action === "installSkill")
        return workspace.installRecommended(owner.cwd, text(b.skillId, 100));
      invalid();
    },
  );
  app.post("/api/session/codex-host/companion/connect", async (request) => {
    const { b, cwd, instanceId, editorKey } = await companion(request),
      caps = object(b.capabilities);
    const capabilities = Object.fromEntries(
      ["context", "openLocation", "showDiff", "todoCodeLens", "lsp"].map(
        (key) => {
          if (typeof caps[key] !== "boolean") invalid();
          return [key, caps[key]];
        },
      ),
    ) as unknown as CodexHostCapabilities;
    broker.connect(instanceId, cwd, capabilities, editorKey);
    return { version: 1 };
  });
  app.post("/api/session/codex-host/companion/poll", async (request) => {
    const { cwd, instanceId, editorKey } = await companion(request);
    return broker.poll(instanceId, cwd, editorKey);
  });
  app.post(
    "/api/session/codex-host/companion/result",
    { bodyLimit: 1024 * 1024 },
    async (request) => {
      const { b, cwd, instanceId, editorKey } = await companion(request);
      if (b.error !== undefined) text(b.error, 1000);
      broker.complete(
        instanceId,
        cwd,
        identifier(b.requestId),
        b.result,
        b.error as string | undefined,
        editorKey,
      );
      return { success: true };
    },
  );
  app.post("/api/session/codex-host/companion/context", async (request) => {
    const { b, cwd, instanceId, editorKey } = await companion(request),
      c = object(b.context);
    if (
      typeof c.text !== "string" ||
      c.text.length > 180_000 ||
      c.text.includes("\0")
    )
      invalid();
    const range = c.range === undefined ? undefined : object(c.range);
    const context: CodexEditorContext = {
      path: await inWorkspace(cwd, c.path),
      text: c.text as string,
      ...(range
        ? { range: { start: number(range.start), end: number(range.end) } }
        : {}),
    };
    if (context.range && context.range.end < context.range.start) invalid();
    broker.publish(instanceId, cwd, context, editorKey);
    return { success: true };
  });
  app.post("/api/session/codex-host/companion/lsp-status", async (request) => {
    const { b, cwd, editorKey } = await companion(request),
      owner = parseCodexHostOwner(b.owner);
    if ((await realpath(await options.resolveOwner(owner))) !== cwd)
      invalid("语言服务不属于原会话项目", 409);
    return broker.languageStatus(cwd, editorKey);
  });
  app.post("/api/session/codex-host/companion/lsp", async (request) => {
    const { b, cwd, editorKey, instanceId } = await companion(request),
      owner = parseCodexHostOwner(b.owner),
      command = object(b.command);
    if (
      (await realpath(await options.resolveOwner(owner))) !== cwd ||
      command.type !== "definitions"
    )
      invalid("语言服务不属于原会话项目", 409);
    return broker.languageCommand({ ...owner, cwd }, editorKey, instanceId, {
      type: "definitions",
      path: await inWorkspace(cwd, command.path),
      line: number(command.line),
      column: number(command.column),
    });
  });
  return broker;
}
