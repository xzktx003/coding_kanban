import { createHash, randomBytes } from "node:crypto";
import { HttpError, object, type Json, type JsonObject } from "../core/json.js";
import type { Rpc } from "./ownership.js";
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const short = (value: unknown, limit = 1024): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= limit &&
  !/[\x00-\x1f]/u.test(value);
export type McpPreviewTool = {
  server: "codex_apps";
  tool: string;
  connectorId: string;
  targetId: string;
  metadata: JsonObject;
  mode?: "info" | "fetch";
  explicitLink?: boolean;
};
type Snapshot<T> = {
  identity: string;
  account: string;
  epoch: number;
  target: T;
  connection: McpPreviewTool;
};
type Host = {
  account: string;
  start: Promise<string>;
  active: number;
  retired: boolean;
  thread?: string;
  cleanup?: Promise<void>;
};

export type McpPreviewDefinition<T, D extends Json> = {
  target(href: string): T | null;
  select(statuses: Json[], target: T): McpPreviewTool | null;
  arguments(target: T, connection: McpPreviewTool): JsonObject;
  decode(value: unknown, target: T, connection: McpPreviewTool): D;
  unavailable: D;
};
/** No Agent turns, borrowed threads, general tool calls, or URL fetches. */
export class ReadOnlyMcpPreviewService<T, D extends Json> {
  private epoch = 0;
  private closed = false;
  private host?: Host;
  private hosts = new Set<Host>();
  private contexts = new Map<
    string,
    { snapshot: Snapshot<T>; expires: number }
  >();
  private results = new Map<
    string,
    { data: D; stale: number; expires: number }
  >();
  private reads = new Map<string, Promise<D>>();
  private sweep: ReturnType<typeof setInterval>;
  constructor(
    private readonly raw: Rpc,
    private readonly instance: string,
    private readonly definition: McpPreviewDefinition<T, D>,
    private readonly now = Date.now,
  ) {
    this.sweep = setInterval(() => this.prune(), 30_000);
    this.sweep.unref();
  }
  private prune(): void {
    const now = this.now();
    for (const [key, entry] of this.contexts)
      if (entry.expires <= now) this.contexts.delete(key);
    for (const [key, entry] of this.results)
      if (entry.expires <= now) this.results.delete(key);
  }
  private target(href: unknown): T {
    if (!short(href, 4096))
      throw new HttpError(400, "Invalid MCP preview href");
    const target = this.definition.target(href);
    if (!target) throw new HttpError(400, "Unsupported MCP preview target");
    return target;
  }
  private async account(): Promise<string | null> {
    const response = object(
      await this.raw("account/read", { refreshToken: false }),
    );
    const account = object(response.account),
      routing = object(response.workspaceRouting);
    const key =
      account.type === "chatgpt" &&
      short(account.email) &&
      short(routing.chatgptAccountId) &&
      short(routing.backendOrigin, 2048) &&
      ["NO_CONSTRAINT", "us", "us_cr"].includes(
        String(routing.accountRoutingOverride),
      )
        ? digest([
            routing.chatgptAccountId,
            account.email,
            routing.backendOrigin,
            routing.accountRoutingOverride,
          ])
        : null;
    if (this.host && this.host.account !== key) this.retire(this.host);
    return key;
  }
  private async snapshot(target: T): Promise<Snapshot<T> | null> {
    if (this.closed) throw new HttpError(503, "MCP preview service closed");
    const epoch = this.epoch,
      account = await this.account();
    if (!account) return null;
    const statuses: Json[] = [],
      cursors = new Set<string>();
    let cursor: Json = null;
    for (let page = 0; page < 10; page++) {
      const response = object(
        await this.raw("mcpServerStatus/list", { cursor, limit: 100 }),
      );
      if (!Array.isArray(response.data))
        throw new Error("Invalid MCP directory");
      statuses.push(...response.data);
      cursor = response.nextCursor;
      if (cursor == null) break;
      if (!short(cursor, 4096) || cursors.has(cursor) || page === 9)
        throw new Error("Invalid MCP directory cursor");
      cursors.add(cursor);
    }
    const connection = this.definition.select(statuses, target);
    if (epoch !== this.epoch || account !== (await this.account()))
      throw new HttpError(409, "MCP preview account changed");
    if (!connection) return null;
    const identity = digest([
      this.instance,
      epoch,
      account,
      connection,
      target,
    ]);
    return { identity, account, epoch, connection, target };
  }
  private async verify(snapshot: Snapshot<T>): Promise<void> {
    if (snapshot.epoch !== this.epoch)
      throw new HttpError(409, "MCP preview connection changed");
    let current: Snapshot<T> | null;
    try {
      current = await this.snapshot(snapshot.target);
    } catch {
      throw new HttpError(409, "MCP preview connection changed");
    }
    if (!current || current.identity !== snapshot.identity)
      throw new HttpError(409, "MCP preview connection changed");
  }
  async context(href: unknown): Promise<JsonObject> {
    const target = this.target(href);
    this.prune();
    let snapshot: Snapshot<T> | null;
    try {
      snapshot = await this.snapshot(target);
    } catch (error) {
      if (error instanceof HttpError && error.statusCode === 409) throw error;
      return { context: null };
    }
    if (!snapshot) return { context: null };
    if (this.host && this.host.account !== snapshot.account)
      this.retire(this.host);
    if (this.contexts.size >= 128)
      this.contexts.delete(this.contexts.keys().next().value!);
    const token = randomBytes(32).toString("hex");
    this.contexts.set(token, { snapshot, expires: this.now() + 300_000 });
    return { context: { identity: snapshot.identity, token } };
  }
  async read(href: unknown, token: unknown): Promise<JsonObject> {
    const target = this.target(href);
    if (!short(token, 64) || !/^[a-f0-9]{64}$/u.test(token))
      throw new HttpError(400, "Invalid MCP preview context");
    this.prune();
    const context = this.contexts.get(token);
    if (!context || digest(target) !== digest(context.snapshot.target))
      throw new HttpError(409, "MCP preview context expired or target changed");
    const snapshot = context.snapshot;
    await this.verify(snapshot);
    const cached = this.results.get(snapshot.identity);
    if (cached && cached.stale > this.now()) {
      cached.expires = this.now() + 300_000;
      return { identity: snapshot.identity, data: cached.data };
    }
    let work = this.reads.get(snapshot.identity);
    if (!work) {
      if (this.reads.size >= 16)
        throw new HttpError(429, "Too many MCP preview reads");
      work = this.load(snapshot);
      this.reads.set(snapshot.identity, work);
    }
    try {
      return { identity: snapshot.identity, data: await work };
    } finally {
      if (this.reads.get(snapshot.identity) === work)
        this.reads.delete(snapshot.identity);
    }
  }
  private async load(snapshot: Snapshot<T>): Promise<D> {
    let host = this.host;
    if (!host || host.retired || host.account !== snapshot.account) {
      if (host) this.retire(host);
      host = {
        account: snapshot.account,
        active: 0,
        retired: false,
        start: Promise.resolve(""),
      };
      this.host = host;
      this.hosts.add(host);
      const captured = host;
      host.start = this.raw("thread/start", {
        ephemeral: true,
        permissions: ":read-only",
        threadSource: "mcp_extension_host",
      }).then((response) => {
        const id = object(object(response).thread).id;
        if (!short(id, 512)) throw new Error("Invalid preview host thread");
        captured.thread = id;
        return id;
      });
    }
    host.active++;
    let data = this.definition.unavailable;
    try {
      const threadId = await host.start;
      await this.verify(snapshot);
      const target = snapshot.target,
        connection = snapshot.connection;
      const args = this.definition.arguments(target, connection);
      const result = await this.raw("mcpServer/tool/call", {
        threadId,
        server: connection.server,
        tool: connection.tool,
        arguments: args,
        _meta: { ...connection.metadata, thread_id: threadId, threadId },
      });
      await this.verify(snapshot);
      data = this.definition.decode(result, target, connection);
    } catch {
      // The native query also caches an unavailable tool result without retrying.
      if (!host.thread) this.retire(host);
    } finally {
      host.active--;
      if (host.retired) this.cleanup(host);
    }
    if (!this.closed && snapshot.epoch === this.epoch) {
      if (this.results.size >= 128)
        this.results.delete(this.results.keys().next().value!);
      this.results.set(snapshot.identity, {
        data,
        stale: this.now() + 60_000,
        expires: this.now() + 300_000,
      });
    }
    return data;
  }
  private retire(host: Host): void {
    host.retired = true;
    if (this.host === host) this.host = undefined;
    this.cleanup(host);
  }
  private cleanup(host: Host): void {
    if (!host.retired || host.active || host.cleanup) return;
    host.cleanup = (
      host.thread
        ? this.raw("thread/unsubscribe", { threadId: host.thread })
        : Promise.resolve(null)
    )
      .catch(() => null)
      .then(() => {
        this.hosts.delete(host);
      });
  }
  invalidate(retireHost = true): void {
    this.epoch++;
    this.contexts.clear();
    this.results.clear();
    if (retireHost && this.host) this.retire(this.host);
  }
  observe(method: string, params: JsonObject = {}): void {
    if (method === "thread/closed") {
      for (const host of this.hosts)
        if (host.thread === params.threadId) this.retire(host);
    }
    if (["account/updated", "account/login/completed"].includes(method)) {
      this.invalidate(false);
      // Retire only after the authoritative account identity actually changes.
      void this.account().catch(() => {});
    }
  }
  async close(): Promise<void> {
    this.closed = true;
    clearInterval(this.sweep);
    this.invalidate();
    await Promise.allSettled([...this.reads.values()]);
    for (const host of this.hosts) {
      this.retire(host);
      await host.cleanup;
    }
  }
}
