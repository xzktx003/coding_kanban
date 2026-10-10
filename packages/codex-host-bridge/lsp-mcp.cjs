#!/usr/bin/env node
/* Optional stdio MCP transport for the explicitly configured editor workspace. */
const fs = require("node:fs/promises");
const path = require("node:path");
const readline = require("node:readline");
const crypto = require("node:crypto");
const { request } = require("./extension.cjs");
const tool = {
  name: "vscode_find_definitions",
  description:
    "Find definitions using the configured VS Code language providers in this session's exact editor workspace. Paths and positions are validated; this tool only reads language results.",
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "File path in the captured workspace",
      },
      line: { type: "integer", minimum: 1 },
      column: { type: "integer", minimum: 1 },
    },
    required: ["path", "line", "column"],
    additionalProperties: false,
  },
};
async function execute(argumentsValue, env = process.env) {
  if (
    !env.CODING_KANBAN_HOST_CONFIG ||
    !env.CODING_KANBAN_EDITOR_WORKSPACE ||
    !env.CODING_KANBAN_HOST_OWNER
  )
    throw new Error(
      "未配置本会话的 VS Code LSP MCP 宿主；请从宿主设置复制当前工作区配置",
    );
  const config = JSON.parse(
      await fs.readFile(env.CODING_KANBAN_HOST_CONFIG, "utf8"),
    ),
    editorKey = await fs.realpath(env.CODING_KANBAN_EDITOR_WORKSPACE),
    owner = JSON.parse(env.CODING_KANBAN_HOST_OWNER),
    cwd = await fs.realpath(owner.cwd);
  if (
    config.version !== 1 ||
    !/^[a-f0-9]{64}$/.test(config.token) ||
    typeof owner.draftOwner !== "string" ||
    !editorKey.endsWith(".code-workspace")
  )
    throw new Error("LSP MCP 宿主配置无效");
  const file = await fs.realpath(
      path.resolve(cwd, String(argumentsValue.path)),
    ),
    relative = path.relative(cwd, file);
  if (
    relative === ".." ||
    relative.startsWith("../") ||
    path.isAbsolute(relative) ||
    !Number.isInteger(argumentsValue.line) ||
    !Number.isInteger(argumentsValue.column) ||
    argumentsValue.line < 1 ||
    argumentsValue.column < 1
  )
    throw new Error("语言查询必须属于原会话项目，并提供有效行列");
  const body = {
    cwd,
    editorKey,
    owner: { ...owner, cwd },
    instanceId: "mcp-status-" + crypto.randomUUID(),
  };
  const status = await request(config, "lsp-status", body);
  if (!status.available)
    throw new Error(status.reason || "当前 VS Code 语言服务不可用");
  return request(config, "lsp", {
    ...body,
    instanceId: status.instanceId,
    command: {
      type: "definitions",
      path: file,
      line: argumentsValue.line,
      column: argumentsValue.column,
    },
  });
}
async function handle(message, executeTool = execute) {
  if (message.method === "initialize")
    return {
      protocolVersion: ["2024-11-05", "2025-03-26", "2025-06-18"].includes(
        message.params?.protocolVersion,
      )
        ? message.params.protocolVersion
        : "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "coding-kanban-vscode-lsp", version: "0.1.0" },
    };
  if (message.method === "ping") return {};
  if (message.method === "tools/list") return { tools: [tool] };
  if (message.method === "tools/call") {
    if (message.params?.name !== tool.name)
      throw Object.assign(new Error("Unknown language tool"), { code: -32602 });
    try {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              await executeTool(message.params.arguments || {}),
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: String(error.message) }],
        isError: true,
      };
    }
  }
  throw Object.assign(new Error("Method not found"), { code: -32601 });
}
if (require.main === module) {
  const input = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });
  input.on("line", async (line) => {
    if (line.length > 1024 * 1024) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      process.stdout.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "Parse error" },
        }) + "\n",
      );
      return;
    }
    if (message.id === undefined) return;
    try {
      process.stdout.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: await handle(message),
        }) + "\n",
      );
    } catch (error) {
      process.stdout.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          error: { code: error.code || -32603, message: String(error.message) },
        }) + "\n",
      );
    }
  });
}
module.exports = { handle, execute };
