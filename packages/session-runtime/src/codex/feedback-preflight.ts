import { createHash } from "node:crypto";
import { isAbsolute, normalize } from "node:path";
import { bodyObject, HttpError, isObject, object, type Json, type JsonObject } from "../core/json.js";
import type { Rpc } from "./ownership.js";

export interface FeedbackPreflightOptions {
  fetch?: typeof globalThis.fetch;
  baseURL?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxCacheEntries?: number;
  cacheTtlMs?: number;
  now?: () => number;
}
export interface FeedbackPreflightResult extends JsonObject {
  reason: null | "policy" | "configuration" | "unavailable";
  runtimeInstance: string;
  provenance: {
    config: "fresh" | "cache" | "default";
    requirements: "fresh" | "cache" | "unavailable";
    account: "native" | "unavailable";
    workspace: "fresh" | "cache" | "not-required" | "unavailable";
  };
}
type ActiveCacheKey = { next: number; applied: number; workspaceApplied: number; users: number };
type CacheLease = { key: string; entry: ActiveCacheKey; ordinal: number };
type Context = { epoch: number; controller: AbortController; deadline: number; leases: CacheLease[] };
type NativeAccount = { kind: "anonymous" | "apiKey" | "amazonBedrock" | "chatgpt"; routingId: string | null; identity: string };
type Auth = { method: string; token: string; target: string; identity: string };
type Policy = { disabled: boolean };
type Member = { structure: "personal" | "workspace" };
type Cached<T> = { value: T; expires: number };
type Read<T, P extends string> = { value: T | undefined; provenance: P; fresh?: T };
type Authority = {
  available: boolean;
  disabled: boolean;
  provenance: FeedbackPreflightResult["provenance"]["workspace"];
  auth?: Auth;
  member?: Member;
  settings?: Policy;
  key?: string;
  clearMember?: boolean;
  clearWorkspace?: boolean;
};
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const owns = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const limit = (value: number | undefined, fallback: number, min: number, max: number) =>
  Number.isFinite(value) ? Math.max(min, Math.min(max, Math.floor(value!))) : fallback;
const targetId = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value);

function cwd(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !value || Buffer.byteLength(value) > 4096 ||
      value.trim() !== value || /[\x00-\x1f\x7f]/.test(value) || !isAbsolute(value) ||
      value.split(/[\\/]/).some((segment) => segment === "." || segment === "..") || normalize(value) !== value)
    throw new HttpError(400, "Invalid feedback working directory");
  return value;
}

function params(value: Json): { threadId: string | null; cwd: string | null } {
  const body = bodyObject(value);
  if (Object.keys(body).some((key) => !["threadId", "cwd"].includes(key)) || !owns(body, "threadId"))
    throw new HttpError(400, "Invalid feedback preflight parameters");
  const thread = body.threadId;
  if (thread !== null && (typeof thread !== "string" || !thread || thread.trim() !== thread ||
      Buffer.byteLength(thread) > 512 || /[\x00-\x1f\x7f]/.test(thread)))
    throw new HttpError(400, "Invalid feedback threadId");
  return { threadId: thread, cwd: cwd(body.cwd) };
}

function nativeAccount(value: Json): NativeAccount | null {
  const response = object(value);
  if (!owns(response, "account") || typeof response.requiresOpenaiAuth !== "boolean") return null;
  if (response.account === null)
    return { kind: "anonymous", routingId: null, identity: "anonymous" };
  const account = object(response.account);
  if (account.type === "apiKey") return { kind: "apiKey", routingId: null, identity: "apiKey" };
  if (account.type === "amazonBedrock" && typeof account.usesCodexManagedCredentials === "boolean")
    return { kind: "amazonBedrock", routingId: null, identity: hash(JSON.stringify(["amazonBedrock", account.usesCodexManagedCredentials])) };
  if (account.type !== "chatgpt" ||
      !(account.email === null || typeof account.email === "string" && Buffer.byteLength(account.email) <= 512) ||
      typeof account.planType !== "string" || Buffer.byteLength(account.planType) > 128)
    return null;
  const routing = object(response.workspaceRouting), id = routing.chatgptAccountId;
  if (id !== undefined && id !== null && !targetId(id)) return null;
  const routingId = typeof id === "string" ? id : null;
  // Email/plan never infer structure. ChatGPT identity is rechecked with the
  // same transport's auth method/token below, not with public plan metadata.
  return { kind: "chatgpt", routingId, identity: hash(JSON.stringify(["chatgpt", routingId])) };
}

function auth(value: Json, account: NativeAccount): Auth | null {
  const response = object(value), token = response.authToken, method = response.authMethod;
  if (!["chatgpt", "chatgptAuthTokens"].includes(String(method)) || typeof token !== "string" ||
      token.length > 65_536 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return null;
  try {
    const payload = Buffer.from(token.split(".")[1], "base64url");
    if (payload.length > 32_768) return null;
    const claim = object(object(JSON.parse(payload.toString("utf8")))["https://api.openai.com/auth"]);
    const id = claim.chatgpt_account_id ?? claim.account_id;
    if (!targetId(id) || account.routingId !== null && id !== account.routingId) return null;
    // Token refresh does not change the original DP account/method identity.
    // Credentials are only used by this invocation's bounded HTTP reads.
    return { method: String(method), token, target: id, identity: hash(JSON.stringify([id, method])) };
  } catch { return null; }
}

/** Narrow internal policy projection. No credentials, raw config or membership
 * payloads are retained or returned. Every invocation attempts fresh reads. */
export class FeedbackPreflightService {
  private epoch = 0;
  private closed = false;
  private pending = new Set<AbortController>();
  private configs = new Map<string, Cached<Policy>>();
  private requirements = new Map<string, Cached<Policy>>();
  private members = new Map<string, Cached<Member>>();
  private workspaces = new Map<string, Cached<Policy>>();
  // Only active reads keep ordering slots. The 32-request cap and three
  // keys per read bound this map to 96; completed reads leave no tombstones.
  private activeCacheKeys = new Map<string, ActiveCacheKey>();
  private readonly fetch: typeof globalThis.fetch;
  private readonly baseURL: string | null;
  private readonly timeout: number;
  private readonly responseBytes: number;
  private readonly cacheEntries: number;
  private readonly cacheTtl: number;
  private readonly now: () => number;

  constructor(private readonly raw: Rpc, private readonly instance: string, options: FeedbackPreflightOptions = {}) {
    if (typeof instance !== "string" || !instance || instance.trim() !== instance ||
        Buffer.byteLength(instance) > 256 || /[\x00-\x1f\x7f]/.test(instance))
      throw new HttpError(503, "Feedback runtime unavailable");
    this.fetch = options.fetch ?? globalThis.fetch;
    this.timeout = limit(options.timeoutMs, 8000, 10, 30_000);
    this.responseBytes = limit(options.maxResponseBytes, 262_144, 1024, 1_048_576);
    this.cacheEntries = limit(options.maxCacheEntries, 64, 1, 256);
    this.cacheTtl = limit(options.cacheTtlMs, 300_000, 1, 600_000);
    this.now = options.now ?? Date.now;
    try {
      const url = new URL(options.baseURL ?? "https://chatgpt.com/backend-api");
      const loopback = ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname);
      this.baseURL = (url.protocol === "https:" || url.protocol === "http:" && loopback) && !url.username && !url.password &&
        !url.search && !url.hash ? url.href.replace(/\/$/, "") : null;
    } catch { this.baseURL = null; }
  }

  observe(method: string): void {
    if (["account/updated", "account/login/completed"].includes(method)) this.invalidate();
  }
  invalidate(): void {
    this.epoch++;
    this.configs.clear(); this.requirements.clear(); this.members.clear(); this.workspaces.clear();
    this.activeCacheKeys.clear();
    for (const controller of this.pending) controller.abort();
  }
  close(): void { this.closed = true; this.invalidate(); }
  private current(context: Context): void {
    if (this.closed || context.epoch !== this.epoch || context.controller.signal.aborted || this.now() >= context.deadline)
      throw new Error("Feedback preflight context changed");
  }
  private async wait<T>(work: Promise<T>, context: Context): Promise<T> {
    const signal = context.controller.signal;
    return new Promise<T>((resolve, reject) => {
      const abort = () => reject(new Error("Feedback preflight cancelled"));
      const cleanup = () => signal.removeEventListener("abort", abort);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      work.then((value) => { cleanup(); resolve(value); }, (error) => { cleanup(); reject(error); });
    });
  }
  private async rpc(method: string, body: Json, context: Context): Promise<Json> {
    this.current(context);
    const value = await this.wait(this.raw(method, body, {
      beforeSend: () => this.current(context), signal: context.controller.signal,
      timeoutMs: Math.max(1, context.deadline - this.now()),
    }), context);
    this.current(context);
    return value;
  }
  private get<T>(cache: Map<string, Cached<T>>, key: string): T | undefined {
    const entry = cache.get(key);
    if (!entry || entry.expires <= this.now()) { cache.delete(key); return undefined; }
    // An actively used fallback must not lose a known policy merely because
    // its last successful fetch is old. This TTL bounds idle retention only.
    entry.expires = this.now() + this.cacheTtl;
    cache.delete(key); cache.set(key, entry);
    return entry.value;
  }
  private set<T>(cache: Map<string, Cached<T>>, key: string, value: T): void {
    cache.delete(key); cache.set(key, { value, expires: this.now() + this.cacheTtl });
    while (cache.size > this.cacheEntries) cache.delete(cache.keys().next().value!);
  }
  private claimCacheKey(key: string, context: Context): CacheLease {
    this.current(context);
    let entry = this.activeCacheKeys.get(key);
    if (!entry) {
      if (this.activeCacheKeys.size >= 96) throw new Error("Feedback preflight cache admission exceeded");
      entry = { next: 0, applied: 0, workspaceApplied: 0, users: 0 };
      this.activeCacheKeys.set(key, entry);
    }
    if (entry.next >= Number.MAX_SAFE_INTEGER) throw new Error("Feedback preflight cache ordinal exceeded");
    entry.users++;
    const lease = { key, entry, ordinal: ++entry.next };
    context.leases.push(lease);
    return lease;
  }
  private applyCacheKey(lease: CacheLease, apply: () => void, workspace = false): void {
    const slot = workspace ? "workspaceApplied" : "applied";
    if (this.activeCacheKeys.get(lease.key) !== lease.entry || lease.ordinal < lease.entry[slot]) return;
    // A failed newer attempt is not a new snapshot or revocation. Only an
    // identity-validated fresh value or explicit clear advances this resource.
    apply();
    lease.entry[slot] = lease.ordinal;
  }
  private releaseCacheKeys(context: Context): void {
    for (const lease of context.leases.splice(0)) {
      lease.entry.users--;
      if (lease.entry.users === 0 && this.activeCacheKeys.get(lease.key) === lease.entry)
        this.activeCacheKeys.delete(lease.key);
    }
  }
  private result(): FeedbackPreflightResult {
    return { reason: "unavailable", runtimeInstance: this.instance,
      provenance: { config: "default", requirements: "unavailable", account: "unavailable", workspace: "unavailable" } };
  }
  private async account(context: Context): Promise<NativeAccount | null> {
    try { return nativeAccount(await this.rpc("account/read", { refreshToken: false }, context)); }
    catch { return null; }
  }
  private async token(account: NativeAccount, context: Context): Promise<Auth | null> {
    try { return auth(await this.rpc("getAuthStatus", { includeToken: true, refreshToken: false }, context), account); }
    catch { return null; }
  }
  private async scope(id: string, context: Context): Promise<string> {
    const response = object(await this.rpc("thread/read", { threadId: id, includeTurns: false }, context));
    const thread = object(response.thread);
    if (thread.id !== id || typeof thread.cwd !== "string") throw new Error("Feedback thread scope unavailable");
    const value = cwd(thread.cwd);
    if (value === null) throw new Error("Feedback thread scope unavailable");
    return value;
  }
  private async config(cwd: string | null, key: string, context: Context): Promise<Read<Policy, "fresh" | "cache" | "default">> {
    try {
      const value = object(await this.rpc("config/read", { cwd, includeLayers: false }, context));
      if (!isObject(value.config)) throw new Error("Feedback config unavailable");
      const feedback = value.config.feedback;
      // Original DP safeParse only applies explicit false for valid feedback
      // values; a malformed feedback value is not a fabricated false policy.
      const enabled = isObject(feedback) ? feedback.enabled : undefined;
      const valid = feedback === undefined || feedback === null || isObject(feedback) &&
        (enabled === undefined || enabled === null || typeof enabled === "boolean");
      const projected = { disabled: valid && enabled === false };
      return { value: projected, fresh: projected, provenance: "fresh" };
    } catch {
      const value = this.get(this.configs, key);
      return { value: value ?? { disabled: false }, provenance: value ? "cache" : "default" };
    }
  }
  private async requirement(key: string, context: Context): Promise<Read<Policy, "fresh" | "cache" | "unavailable">> {
    try {
      const value = object(await this.rpc("configRequirements/read", null, context));
      if (!(value.requirements === null || isObject(value.requirements))) throw new Error("Feedback requirements unavailable");
      const projected = { disabled: object(object(value.requirements).feedback).enabled === false };
      return { value: projected, fresh: projected, provenance: "fresh" };
    } catch {
      const value = this.get(this.requirements, key);
      return { value, provenance: value ? "cache" : "unavailable" };
    }
  }
  private async json(response: Response, context: Context): Promise<Json> {
    const length = response.headers.get("content-length");
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > this.responseBytes)) {
      void response.body?.cancel().catch(() => undefined);
      throw new Error("Feedback policy response exceeds budget");
    }
    if (!response.body) throw new Error("Feedback policy response unavailable");
    const reader = response.body.getReader(), chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const part = await this.wait(reader.read(), context);
        this.current(context);
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > this.responseBytes) throw new Error("Feedback policy response exceeds budget");
        chunks.push(part.value);
      }
      return JSON.parse(Buffer.concat(chunks, bytes).toString("utf8"));
    } finally {
      void reader.cancel().catch(() => undefined);
      try { reader.releaseLock(); } catch { /* The aborted read owns its pending release. */ }
    }
  }
  private async http(path: string, token: Auth, context: Context): Promise<{ kind: "ready"; data: Json } | { kind: "failed" | "revoked" }> {
    if (!this.baseURL) return { kind: "failed" };
    try {
      this.current(context);
      const response = await this.wait(this.fetch(this.baseURL + path, {
        method: "GET", redirect: "error", signal: context.controller.signal,
        headers: { Authorization: "Bearer " + token.token, "ChatGPT-Account-ID": token.target },
      }), context);
      this.current(context);
      if (!response.ok) {
        void response.body?.cancel().catch(() => undefined);
        return { kind: [401, 403, 404].includes(response.status) ? "revoked" : "failed" };
      }
      return { kind: "ready", data: await this.json(response, context) };
    } catch { return { kind: "failed" }; }
  }
  private async authority(account: NativeAccount | null, token: Auth | null, key: string, context: Context): Promise<Authority> {
    const unavailable: Authority = { available: false, disabled: false, provenance: "unavailable" };
    if (!account) return unavailable;
    if (account.kind !== "chatgpt") return { available: true, disabled: false, provenance: "not-required" };
    if (!token) return unavailable;
    const membership = await this.http("/accounts/check/v4-2023-04-27", token, context);
    let member: Member | undefined, freshMember: Member | undefined;
    if (membership.kind === "revoked") {
      return { ...unavailable, auth: token, key, clearMember: true, clearWorkspace: true };
    }
    if (membership.kind === "ready") {
      const candidate = object(object(object(membership.data).accounts)[token.target]);
      const value = object(candidate.account);
      if (value.account_id !== token.target || !["personal", "workspace"].includes(String(value.structure))) {
        return { ...unavailable, auth: token, key, clearMember: true, clearWorkspace: true };
      }
      member = freshMember = { structure: value.structure as Member["structure"] };
    } else member = this.get(this.members, key);
    if (!member) return { ...unavailable, auth: token };
    if (member.structure === "personal")
      return { available: true, disabled: false, provenance: "not-required", auth: token, key, member: freshMember };
    const settings = await this.http("/accounts/" + encodeURIComponent(token.target) + "/settings", token, context);
    if (settings.kind === "revoked") {
      return { ...unavailable, auth: token, key, member: freshMember, clearWorkspace: true };
    }
    if (settings.kind === "ready") {
      const beta = object(settings.data).beta_settings;
      if (isObject(beta) && (beta.enable_message_feedback === undefined || beta.enable_message_feedback === null || typeof beta.enable_message_feedback === "boolean")) {
        const policy = { disabled: beta.enable_message_feedback === false };
        return { available: true, disabled: policy.disabled, provenance: "fresh", auth: token, key, member: freshMember, settings: policy };
      }
    }
    const cached = this.get(this.workspaces, key);
    return cached ? { available: true, disabled: cached.disabled, provenance: "cache", auth: token, key, member: freshMember }
      : { ...unavailable, auth: token, key, member: freshMember };
  }

  async read(value: Json, signal?: AbortSignal): Promise<FeedbackPreflightResult> {
    const input = params(value), result = this.result();
    if (this.closed || this.pending.size >= 32) return result;
    const controller = new AbortController(), context: Context = { epoch: this.epoch, controller, deadline: this.now() + this.timeout, leases: [] };
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    this.pending.add(controller);
    const timer = setTimeout(abort, this.timeout);
    try {
      const workingDirectory = input.threadId === null ? input.cwd : await this.scope(input.threadId, context);
      const first = await this.account(context);
      const firstAuth = first?.kind === "chatgpt" ? await this.token(first, context) : null;
      this.current(context);
      result.provenance.account = first ? "native" : "unavailable";
      const authorityKey = hash(JSON.stringify([context.epoch, first?.identity ?? null, firstAuth?.target ?? null, firstAuth?.method ?? null]));
      const configKey = hash(JSON.stringify([authorityKey, workingDirectory]));
      const configLease = this.claimCacheKey("config:" + configKey, context);
      const requirementsLease = this.claimCacheKey("requirements:" + authorityKey, context);
      const authorityLease = this.claimCacheKey("authority:" + authorityKey, context);
      const [config, requirements, authority] = await Promise.all([
        this.config(workingDirectory, configKey, context), this.requirement(authorityKey, context), this.authority(first, firstAuth, authorityKey, context),
      ]);
      this.current(context);
      result.provenance.config = config.provenance;
      result.provenance.requirements = requirements.provenance;
      result.provenance.workspace = authority.provenance;
      const last = await this.account(context);
      if (first?.identity !== last?.identity || first?.kind !== last?.kind) return result;
      if (first?.kind === "chatgpt") {
        const lastAuth = await this.token(first, context);
        if (lastAuth?.identity !== firstAuth?.identity || lastAuth?.target !== firstAuth?.target) return result;
      }
      if (input.threadId !== null && await this.scope(input.threadId, context) !== workingDirectory) return result;
      this.current(context);
      if (first) {
        if (config.fresh) this.applyCacheKey(configLease, () => this.set(this.configs, configKey, config.fresh!));
        if (requirements.fresh) this.applyCacheKey(requirementsLease, () => this.set(this.requirements, authorityKey, requirements.fresh!));
        if (authority.key) {
          if (authority.clearMember || authority.member) this.applyCacheKey(authorityLease, () => {
            if (authority.clearMember) this.members.delete(authority.key!);
            else this.set(this.members, authority.key!, authority.member!);
          });
          if (authority.clearWorkspace || authority.settings) this.applyCacheKey(authorityLease, () => {
            if (authority.clearWorkspace) this.workspaces.delete(authority.key!);
            else this.set(this.workspaces, authority.key!, authority.settings!);
          }, true);
        }
      }
      result.reason = requirements.value?.disabled || authority.disabled ? "policy"
        : !authority.available ? "unavailable" : config.value?.disabled ? "configuration" : null;
      return result;
    } catch { return result; }
    finally {
      clearTimeout(timer); signal?.removeEventListener("abort", abort);
      this.releaseCacheKeys(context);
      controller.abort(); this.pending.delete(controller);
    }
  }
}
