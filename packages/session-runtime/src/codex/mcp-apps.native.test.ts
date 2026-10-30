import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { EventHub } from "../core/events.js";
import { object, type JsonObject } from "../core/json.js";
import { CodexService } from "./client.js";
import { readItemDetail } from "./item-detail.js";
import { McpAppSourceReader } from "./mcp-app-source.js";
import { McpApps } from "./mcp-apps.js";
import {
  registerOwnedNativeFixture,
  cleanupOwnedNativeFixture,
  ownedDaemonIdentity,
  type OwnedNativeIdentity,
} from "./daemon-native-fixture.js";
const run = promisify(execFile),
  binary = process.env.SESSION_CODEX_DAEMON_NATIVE_BIN;
const appHtml =
  "<!doctype html><html><body><p>PRIVATE_NATIVE_MCP_APP</p></body></html>";
test(
  "isolated official daemon produces a real MCP source and reads/calls its exact local App",
  { skip: !binary, timeout: 90_000 },
  async (t) => {
    const base = await mkdtemp(join(tmpdir(), "kanban-mcp-native-")),
      home = join(base, "home"),
      codexHome = join(base, "codex"),
      project = join(base, "project");
    await Promise.all(
      [home, codexHome, project].map((path) => mkdir(path, { mode: 0o700 })),
    );
    const methods: string[] = [],
      calls: unknown[] = [];
    let providerCalls = 0;
    const mcp = createServer(async (req, res) => {
      if (req.method !== "POST") {
        res.writeHead(405);
        res.end();
        return;
      }
      let input = "";
      for await (const part of req) input += part;
      const q = JSON.parse(input);
      methods.push(q.method);
      if (q.id == null) {
        res.writeHead(202);
        res.end();
        return;
      }
      let result: unknown = {};
      if (q.method === "initialize")
        result = {
          protocolVersion: "2025-03-26",
          capabilities: { tools: {}, resources: {} },
          serverInfo: { name: "Private native fixture", version: "1" },
        };
      if (q.method === "tools/list")
        result = {
          tools: [
            {
              name: "show",
              description: "Show the private fixture app",
              inputSchema: {
                type: "object",
                properties: { value: { type: "number" } },
              },
              _meta: {
                ui: {
                  resourceUri: "ui://private-app",
                  visibility: ["app", "model"],
                },
              },
            },
          ],
        };
      if (q.method === "resources/list")
        result = {
          resources: [
            {
              uri: "ui://private-app",
              name: "Private app",
              mimeType: "text/html;profile=mcp-app",
            },
          ],
        };
      if (q.method === "resources/templates/list")
        result = { resourceTemplates: [] };
      if (q.method === "resources/read")
        result = {
          contents: [
            {
              uri: "ui://private-app",
              mimeType: "text/html;profile=mcp-app",
              text: appHtml,
              _meta: { ui: { csp: {} } },
            },
          ],
        };
      if (q.method === "tools/call") {
        calls.push(q.params);
        result = {
          content: [{ type: "text", text: "PRIVATE_NATIVE_RESULT" }],
          structuredContent: { value: q.params.arguments.value },
        };
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: q.id, result }));
    });
    const provider = createServer(async (req, res) => {
      let text = "";
      for await (const part of req) text += part;
      const request = JSON.parse(text);
      providerCalls++;
      const tool = (request.tools ?? []).find((tool: any) =>
        String(tool.name).includes("show"),
      );
      const item =
        providerCalls === 1
          ? {
              type: "function_call",
              id: "fixture-mcp-item",
              call_id: "fixture-mcp-call",
              namespace: "mcp__local",
              name: "show",
              arguments: JSON.stringify({ value: 1 }),
            }
          : {
              type: "message",
              role: "assistant",
              id: "fixture-answer",
              content: [{ type: "output_text", text: "NATIVE_MCP_FINISHED" }],
            };
      res.writeHead(200, { "content-type": "text/event-stream" });
      for (const event of [
        {
          type: "response.created",
          response: { id: `fixture-${providerCalls}` },
        },
        { type: "response.output_item.done", item },
        {
          type: "response.completed",
          response: {
            id: `fixture-${providerCalls}`,
            usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
          },
        },
      ])
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      res.end();
    });
    await Promise.all(
      [mcp, provider].map(
        (server) =>
          new Promise<void>((resolve) =>
            server.listen(0, "127.0.0.1", resolve),
          ),
      ),
    );
    const port = (provider.address() as { port: number }).port,
      mcpPort = (mcp.address() as { port: number }).port;
    await writeFile(
      join(codexHome, "config.toml"),
      `model="fixture"\nmodel_provider="fixture"\napproval_policy="never"\nsandbox_mode="read-only"\n[model_providers.fixture]\nname="Private MCP native fixture"\nbase_url="http://127.0.0.1:${port}/v1"\nwire_api="responses"\nrequires_openai_auth=false\nrequest_max_retries=0\nstream_max_retries=0\n[mcp_servers.local]\ndefault_tools_approval_mode="approve"\nurl="http://127.0.0.1:${mcpPort}/mcp"\n`,
      { mode: 0o600 },
    );
    await registerOwnedNativeFixture(codexHome);
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: home,
      CODEX_HOME: codexHome,
      CODEX_PATH: binary!,
      HTTP_PROXY: "http://127.0.0.1:9",
      HTTPS_PROXY: "http://127.0.0.1:9",
      NO_PROXY: "127.0.0.1,localhost",
      SESSION_CODEX_DAEMON_AUTO_START: "1",
    };
    const hub = new EventHub(),
      service = new CodexService({
        hub,
        env,
        instance: "mcp-native-fixture",
        sweepIntervalMs: 0,
      });
    let identity: OwnedNativeIdentity | undefined;
    t.after(async () => {
      await service.close();
      hub.close();
      identity ??= await ownedDaemonIdentity(codexHome);
      await run(binary!, ["app-server", "daemon", "stop"], {
        env,
        timeout: 15000,
        maxBuffer: 65536,
      });
      if (identity) await cleanupOwnedNativeFixture(identity);
      for (const server of [provider, mcp]) {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
      await rm(base, { recursive: true, force: true });
    });
    const sourceReader = new McpAppSourceReader(
      hub,
      () => service.connectionSnapshot(),
      async () => {
        throw new Error(
          "Live source must come from the verified bounded native hub",
        );
      },
    );
    t.after(() => sourceReader.close());
    const operation = await service.operationContext();
    const started = object(
      await service.guardedCall(
        "thread/start",
        {
          cwd: project,
          model: "fixture",
          approvalPolicy: "never",
          sandbox: "read-only",
        },
        operation.scope,
      ),
    );
    identity = await ownedDaemonIdentity(codexHome);
    const threadId = String(object(started.thread).id);
    let source: JsonObject | undefined,
      turnId = "";
    let sourceReady!: () => void;
    const completed = new Promise<void>((resolve) => (sourceReady = resolve));
    const subscription = hub.subscribe({
      filter: (event) => {
        const payload = object(event.payload),
          params = object(payload.params),
          item = object(params.item);
        if (
          payload.method === "item/completed" &&
          params.threadId === threadId &&
          item.type === "mcpToolCall"
        ) {
          source = item;
          turnId = String(params.turnId);
          sourceReady();
        }
        return false;
      },
    });
    t.after(() => subscription.close());
    await service.raw("turn/start", {
      threadId,
      input: [{ type: "text", text: "Call show once", text_elements: [] }],
    });
    await Promise.race([
      completed,
      new Promise((_, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Native MCP item did not complete")),
          30000,
        );
        timer.unref();
      }),
    ]);
    assert.ok(source, "official native turn must contain an MCP tool item");
    assert.equal(source.status, "completed", JSON.stringify(source));
    const scope = service.connectionSnapshot().scope,
      app = new McpApps({
        raw: service.raw.bind(service),
        snapshot: () => service.connectionSnapshot(),
        readSource: (target, signal) => sourceReader.read(target, signal),
      });
    t.after(() => app.close());
    const context = await app.context({
      threadId,
      turnId,
      itemId: String(source.id),
    });
    assert.equal(context.html, appHtml);
    assert.deepEqual(context.toolInput, { value: 1 });
    await app.call({
      contextToken: context.contextToken,
      threadId,
      tool: "show",
      arguments: { value: 2 },
      intentId: "private-native-call",
      confirmed: true,
    });
    assert.equal(calls.length, 2);
    assert.ok(methods.includes("resources/read"));
    const detail = await readItemDetail(
      service.options,
      {
        threadId,
        turnId,
        itemId: String(source.id),
        expectedType: "mcpToolCall",
      },
      AbortSignal.timeout(20000),
    );
    const detailChunks: Buffer[] = [];
    for await (const chunk of detail.body)
      detailChunks.push(Buffer.from(chunk));
    await detail.finished;
    assert.equal(
      object(object(JSON.parse(Buffer.concat(detailChunks).toString())).item)
        .id,
      source.id,
    );
    console.log(
      "MCP_NATIVE_DETAIL",
      JSON.stringify({
        nativeScopeMatched: detail.metrics.nativeScope === scope,
        exactMcpItem: true,
        method: "thread/read",
        includeTurns: true,
      }),
    );
    console.log(
      "MCP_APP_NATIVE_ACCEPTANCE",
      JSON.stringify({
        realNativeItem: true,
        sourceResourceUri:
          object(source.appContext).resourceUri ?? source.mcpAppResourceUri,
        catalogVerified: true,
        resourceRead: true,
        explicitCall: true,
        nativeCalls: calls.length,
        providerCalls,
        accountCopied: false,
        daemonScopeVerified: !!scope,
      }),
    );
  },
);
