import {
  mcpAuthChallenge,
  type NativeMcpAuthChallenge,
} from "@agent-orchestrator/shared";
type Prompt = { close: () => void };
type Inventory = {
  data: Array<{
    name: string;
    authStatus: string;
    startupSucceeded?: boolean;
    serverInfo?: unknown;
  }>;
  nextCursor: string | null;
};
export interface McpAuthDependencies {
  startupEnabled: (signal: AbortSignal) => Promise<boolean>;
  inventory: (cursor: string | null, signal: AbortSignal) => Promise<Inventory>;
  oauth: (
    params: { name: string; scopes?: string[]; threadId?: string },
    signal: AbortSignal,
  ) => Promise<{ authorizationUrl: string }>;
  reload: (signal: AbortSignal) => Promise<unknown>;
  open: (url: string) => unknown;
  threadIdSupported: () => boolean;
  prompt: (
    name: string,
    reconnect: () => Promise<void>,
    dismiss: () => void,
    remove: () => void,
  ) => Prompt;
  error: (kind: "start" | "completion", name: string) => void;
}
interface Server {
  required: boolean;
  updated: number;
  context?: { threadId: string; challenge: NativeMcpAuthChallenge };
  login?: { authorizationUrl?: string };
  prompt?: Prompt;
}
const record = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === "object" && !Array.isArray(value);
/** CHa state machine. Display membership never cancels an issued OAuth request. */
export class McpReauthentication {
  private alive = true;
  private abort = new AbortController();
  private servers = new Map<string, Server>();
  private configuration?: Promise<boolean>;
  private selected: string | null = null;
  constructor(
    private identity: string,
    private deps: McpAuthDependencies,
    private dismissed: Map<string, object>,
  ) {}
  private key(name: string) {
    return JSON.stringify([this.identity, name]);
  }
  private server(name: string) {
    let server = this.servers.get(name);
    if (!server) {
      server = { required: false, updated: 0 };
      this.servers.set(name, server);
    }
    return server;
  }
  private enabled() {
    return (this.configuration ??= this.deps
      .startupEnabled(this.abort.signal)
      .catch(() => false)
      .finally(() => {
        this.configuration = undefined;
      }));
  }
  private close(server: Server) {
    const prompt = server.prompt;
    server.prompt = undefined;
    prompt?.close();
  }
  private ready(name: string, login = false, at = Date.now()) {
    const server = this.server(name);
    server.required = false;
    server.updated = at;
    if (login) server.context = undefined;
    if (!server.context) server.login = undefined;
    if (login) this.close(server);
    this.dismissed.delete(this.key(name));
  }
  private show(name: string) {
    const server = this.server(name),
      key = this.key(name);
    if (!this.alive || server.prompt || server.login || this.dismissed.has(key))
      return;
    const dismiss = () => {
      if (!this.alive || !server.required) return;
      this.dismissed.delete(key);
      this.dismissed.set(key, {});
      while (this.dismissed.size > 100)
        this.dismissed.delete(this.dismissed.keys().next().value!);
    };
    let prompt!: Prompt;
    const reconnect = async () => {
      if (!this.alive || server.prompt !== prompt) return;
      if (!server.required && !server.context) {
        this.close(server);
        return;
      }
      if (server.login?.authorizationUrl) {
        this.deps.open(server.login.authorizationUrl);
        return;
      }
      if (server.login) return;
      if (server.context?.challenge.truncated) {
        this.deps.error("start", name);
        return;
      }
      const login = { authorizationUrl: undefined as string | undefined };
      server.login = login;
      const context = server.context;
      const params = {
        name,
        ...(context?.challenge.scopes.length
          ? { scopes: [...context.challenge.scopes] }
          : {}),
        ...(context && this.deps.threadIdSupported()
          ? { threadId: context.threadId }
          : {}),
      };
      try {
        const result = await this.deps.oauth(params, this.abort.signal);
        if (!this.alive || server.login !== login) return;
        login.authorizationUrl = result.authorizationUrl;
        this.deps.open(result.authorizationUrl);
      } catch {
        if (!this.alive || server.login !== login) return;
        server.login = undefined;
        if (!server.prompt && !server.required) server.context = undefined;
        this.deps.error("start", name);
      }
    };
    prompt = this.deps.prompt(name, reconnect, dismiss, () => {
      if (server.prompt === prompt) {
        server.prompt = undefined;
        if (!server.required && !server.login) server.context = undefined;
      }
    });
    server.prompt = prompt;
  }
  async refresh() {
    const started = Date.now();
    if (!(await this.enabled()) || !this.alive) return false;
    const statuses: Inventory["data"] = [];
    let cursor: string | null = null;
    try {
      do {
        const result = await this.deps.inventory(cursor, this.abort.signal);
        if (!this.alive) return false;
        statuses.push(...result.data);
        cursor = result.nextCursor;
      } while (cursor !== null && this.alive);
      if (!this.alive) return false;
      this.inventory(statuses, started, true);
      return true;
    } catch {
      return false;
    }
  }
  inventory(statuses: Inventory["data"], started: number, complete: boolean) {
    if (!this.alive) return;
    const names = new Set(statuses.map((s) => s.name));
    for (const status of statuses) {
      if (
        status.authStatus === "unknown" ||
        status.authStatus === "unsupported"
      )
        continue;
      const server = this.server(status.name);
      if (started <= server.updated) continue;
      if (status.authStatus === "notLoggedIn") {
        server.updated = started;
        server.required = true;
        this.show(status.name);
      } else if (status.startupSucceeded === true)
        this.ready(status.name, false, started);
    }
    if (complete)
      for (const [name, server] of this.servers)
        if (server.required && !names.has(name) && started > server.updated) {
          this.ready(name, false, started);
          if (!server.context) this.close(server);
        }
  }
  async selectThread(threadId: string | null) {
    if (threadId === this.selected) return;
    this.selected = threadId;
    if (!threadId) return;
    const pending = [...this.servers]
      .filter(
        ([name, s]) =>
          s.required &&
          !s.prompt &&
          !s.login &&
          this.dismissed.has(this.key(name)),
      )
      .map(([name, server]) => ({
        name,
        server,
        dismissal: this.dismissed.get(this.key(name)),
      }));
    if (!pending.length) return;
    if (!(await this.refresh()) || !this.alive || this.selected !== threadId)
      return;
    for (const { name, server, dismissal } of pending)
      if (
        server.required &&
        !server.prompt &&
        !server.login &&
        this.dismissed.get(this.key(name)) === dismissal
      ) {
        this.dismissed.delete(this.key(name));
        this.show(name);
      }
  }
  async event(method: string, params: unknown) {
    if (!this.alive || !record(params)) return;
    if (method === "mcpServer/startupStatus/updated") {
      if (typeof params.name !== "string") return;
      if (
        params.threadId != null &&
        !(
          params.status === "failed" &&
          params.failureReason === "reauthenticationRequired"
        )
      )
        return;
      if (params.status === "ready") {
        this.ready(params.name);
        return;
      }
      if (
        params.status === "failed" &&
        params.failureReason === "reauthenticationRequired"
      ) {
        const server = this.server(params.name);
        server.required = true;
        server.updated = Date.now();
        if (typeof params.threadId === "string" && !server.context)
          server.context = {
            threadId: params.threadId,
            challenge: { scopes: [] },
          };
        if ((await this.enabled()) && this.alive && server.required)
          this.show(params.name);
      } else if (params.status === "failed") await this.refresh();
    } else if (method === "item/completed") {
      const item = params.item;
      if (
        !record(item) ||
        item.type !== "mcpToolCall" ||
        typeof item.server !== "string" ||
        typeof params.threadId !== "string"
      )
        return;
      const challenge: NativeMcpAuthChallenge | undefined = record(
        item.nativeMcpAuthChallenge,
      )
        ? (item.nativeMcpAuthChallenge as NativeMcpAuthChallenge)
        : mcpAuthChallenge(item.result?._meta?.["mcp/www_authenticate"]);
      if (!challenge || !Array.isArray(challenge.scopes)) return;
      this.server(item.server).context = {
        threadId: params.threadId,
        challenge,
      };
      this.dismissed.delete(this.key(item.server));
      this.show(item.server);
    } else if (method === "mcpServer/oauthLogin/completed") {
      if (
        typeof params.name !== "string" ||
        typeof params.success !== "boolean"
      )
        return;
      const server = this.servers.get(params.name);
      if (params.success) {
        const hadLogin = !!server?.login;
        this.ready(params.name, true);
        if (hadLogin) void this.deps.reload(this.abort.signal).catch(() => {});
      } else if (
        server &&
        (server.required || server.context || server.login)
      ) {
        server.login = undefined;
        if (!server.prompt && !server.required) server.context = undefined;
        this.deps.error("completion", params.name);
      }
    } else if (method === "account/updated" && params.authMode != null)
      await this.refresh();
  }
  stop() {
    if (!this.alive) return;
    this.alive = false;
    this.abort.abort();
    for (const server of this.servers.values()) this.close(server);
    this.servers.clear();
  }
}
