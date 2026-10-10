// Native history aggregation adapted from agent-insights d653ec5 (MIT).
// Original license is retained in packages/session-runtime/LICENSE.
import { createReadStream, existsSync } from "node:fs";
import { Worker } from "node:worker_threads";
import { readdir, stat, readFile } from "node:fs/promises";
import { basename, dirname, join, sep } from "node:path";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import { type JsonObject } from "../core/json.js";
type Agent = "Claude" | "Codex" | "Gemini";
interface Tokens {
  input: number;
  output: number;
  cached: number;
  cache_creation: number;
  reasoning: number;
  total: number;
}
interface Record {
  agent: Agent;
  date: string;
  size: number;
  session?: string;
  cwd?: string;
  model?: string;
  tokens: Tokens;
  tools: Map<string, number>;
}
function number(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0;
}
function string(value: unknown) {
  return typeof value === "string" ? value : undefined;
}
function add(map: Map<string, number>, key: unknown) {
  if (typeof key === "string") map.set(key, (map.get(key) ?? 0) + 1);
}
async function* files(root: string, ext: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (e) {
    if (["ENOENT", "EACCES"].includes((e as NodeJS.ErrnoException).code ?? ""))
      return;
    throw e;
  }
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) yield* files(path, ext);
    else if (entry.isFile() && entry.name.endsWith(ext)) yield path;
  }
}
async function* lines(path: string) {
  const stream = createReadStream(path, { encoding: "utf8" });
  const reader = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of reader) yield line;
  } finally {
    reader.close();
    stream.destroy();
  }
}
export class NativeInsightsScanner {
  private cache = new Map<string, { fingerprint: string; record: Record }>();
  private at = 0;
  private records: Record[] = [];
  private pending?: Promise<Record[]>;
  constructor(
    private env: NodeJS.ProcessEnv,
    private ttl = 60000,
  ) {}
  collected() {
    if (Date.now() - this.at < this.ttl) return Promise.resolve(this.records);
    if (this.pending) return this.pending;
    this.pending = this.scan()
      .then((records) => {
        this.records = records;
        this.at = Date.now();
        return records;
      })
      .finally(() => {
        this.pending = undefined;
      });
    return this.pending;
  }
  private async scan() {
    const home = this.env.HOME ?? this.env.USERPROFILE ?? homedir();
    const roots: [Agent, string, string][] = [
      ["Claude", join(home, ".claude/projects"), ".jsonl"],
      ["Codex", this.env.CODEX_HOME ?? join(home, ".codex"), ".jsonl"],
      ["Gemini", join(home, ".gemini/tmp"), ".json"],
    ];
    const records: Record[] = [];
    const present = new Set<string>();
    for (const [agent, root, extension] of roots) {
      for await (const path of files(root, extension)) {
        if (
          (agent === "Claude" && basename(path).startsWith("agent-")) ||
          (agent === "Gemini" && !path.includes(`${sep}chats${sep}`))
        )
          continue;
        present.add(path);
        const info = await stat(path);
        const fingerprint = `${info.size}:${info.mtimeMs}:${info.birthtimeMs}`;
        const cached = this.cache.get(path);
        if (cached?.fingerprint === fingerprint) {
          records.push(cached.record);
          continue;
        }
        const record: Record = {
          agent,
          date: new Date(info.birthtimeMs > 0 ? info.birthtimeMs : info.mtimeMs)
            .toISOString()
            .slice(0, 10),
          size: info.size,
          tokens: {
            input: 0,
            output: 0,
            cached: 0,
            cache_creation: 0,
            reasoning: 0,
            total: 0,
          },
          tools: new Map(),
        };
        if (agent === "Gemini") {
          let data;
          try {
            data = JSON.parse(await readFile(path, "utf8"));
          } catch {
            continue;
          }
          record.session = string(data.sessionId ?? data.session_id);
          record.cwd = await readFile(
            join(dirname(dirname(path)), ".project_root"),
            "utf8",
          )
            .then((v) => v.trim())
            .catch(() => undefined);
          for (const msg of Array.isArray(data.messages) ? data.messages : []) {
            record.model ??= string(msg.model);
            for (const [to, from] of [
              ["input", "input"],
              ["output", "output"],
              ["cached", "cached"],
              ["reasoning", "thoughts"],
              ["total", "total"],
            ] as const)
              record.tokens[to] += number(msg.tokens?.[from]);
            for (const tool of msg.toolCalls ?? [])
              add(record.tools, tool.name);
          }
        } else {
          let first = true;
          let count = 0;
          for await (const line of lines(path)) {
            if (!line.trim()) continue;
            count++;
            if (
              agent === "Codex" &&
              !first &&
              !line.includes("\\u") &&
              ![
                '"session_meta"',
                '"turn_context"',
                '"token_count"',
                '"custom_tool_call"',
              ].some((tag) => line.includes(tag))
            )
              continue;
            let data;
            try {
              data = JSON.parse(line);
            } catch {
              continue;
            }
            if (agent === "Codex") {
              if (first) {
                record.cwd = string(data.payload?.cwd);
                first = false;
              }
              const p = data.payload ?? {};
              if (data.type === "session_meta") record.session ??= string(p.id);
              if (data.type === "turn_context")
                record.model ??= string(p.model);
              if (
                data.type === "response_item" &&
                p.type === "custom_tool_call"
              )
                add(record.tools, p.name);
              if (
                data.type === "event_msg" &&
                p.type === "token_count" &&
                p.info?.total_token_usage
              ) {
                const t = p.info.total_token_usage;
                for (const [to, from] of [
                  ["input", "input_tokens"],
                  ["output", "output_tokens"],
                  ["cached", "cached_input_tokens"],
                  ["reasoning", "reasoning_output_tokens"],
                  ["total", "total_tokens"],
                ] as const)
                  if (Number.isSafeInteger(t[from]) && t[from] >= 0)
                    record.tokens[to] = t[from];
              }
            } else {
              record.session ??= string(data.sessionId);
              if (count <= 3) record.cwd ??= string(data.cwd);
              record.model ??= string(data.message?.model);
              for (const tool of Array.isArray(data.message?.content)
                ? data.message.content
                : [])
                if (tool.type === "tool_use") add(record.tools, tool.name);
              const t = data.usage ?? data.message?.usage ?? {};
              record.tokens.input += number(t.input_tokens);
              record.tokens.output += number(t.output_tokens);
              record.tokens.cached += number(t.cache_read_input_tokens);
              record.tokens.cache_creation += number(
                t.cache_creation_input_tokens,
              );
            }
          }
        }
        if (agent === "Claude")
          record.tokens.total =
            record.tokens.input +
            record.tokens.output +
            record.tokens.cached +
            record.tokens.cache_creation;
        if (!record.tokens.input && !record.tokens.output)
          record.tokens = {
            input: 0,
            output: 0,
            cached: 0,
            cache_creation: 0,
            reasoning: 0,
            total: 0,
          };
        this.cache.set(path, { fingerprint, record });
        records.push(record);
      }
    }
    for (const path of this.cache.keys())
      if (!present.has(path)) this.cache.delete(path);
    return records;
  }
  private async filtered(filters: JsonObject) {
    const days = (
      { day: 1, week: 7, month: 30, year: 365 } as { [key: string]: number }
    )[String(filters.range)];
    const cutoff = days
      ? new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)
      : undefined;
    return (await this.collected()).filter(
      (r) =>
        (!cutoff || r.date >= cutoff) &&
        (filters.cwd == null || r.cwd === filters.cwd) &&
        ((filters.sessionId == null && filters.session_id == null) ||
          r.session === (filters.sessionId ?? filters.session_id)) &&
        (!["Claude", "Codex", "Gemini"].includes(String(filters.agent)) ||
          r.agent === filters.agent),
    );
  }
  async options() {
    const records = await this.collected();
    return {
      cwds: [
        ...new Set(
          records.flatMap((r) => (r.cwd === undefined ? [] : [r.cwd])),
        ),
      ].sort(),
      session_ids: [
        ...new Set(
          records.flatMap((r) => (r.session === undefined ? [] : [r.session])),
        ),
      ].sort(),
    };
  }
  async rankings(filters: JsonObject) {
    const records = await this.filtered(filters);
    const rank = (field: "cwd" | "session") => {
      const groups = new Map<
        string,
        {
          key: string;
          sessions: number;
          total_tokens: number;
          input_tokens: number;
          output_tokens: number;
          cache_read_tokens: number;
          agents: string[];
        }
      >();
      for (const r of records) {
        const key = r[field];
        if (key === undefined) continue;
        const a = groups.get(key) ?? {
          key,
          sessions: 0,
          total_tokens: 0,
          input_tokens: 0,
          output_tokens: 0,
          cache_read_tokens: 0,
          agents: [],
        };
        a.sessions++;
        a.total_tokens += r.tokens.total;
        a.input_tokens += r.tokens.input;
        a.output_tokens += r.tokens.output;
        a.cache_read_tokens += r.tokens.cached;
        if (!a.agents.includes(r.agent)) a.agents.push(r.agent);
        a.agents.sort();
        groups.set(key, a);
      }
      return [...groups.values()]
        .sort(
          (a, b) =>
            b.total_tokens - a.total_tokens || a.key.localeCompare(b.key),
        )
        .slice(0, 30);
    };
    return { by_cwd: rank("cwd"), by_session: rank("session") };
  }
  async heatmaps(filters: JsonObject) {
    const records = await this.filtered(filters);
    const aggregate = (agent: Agent) => {
      const rows = records.filter((r) => r.agent === agent);
      if (!rows.length) return null;
      const days = new Map<
          string,
          { date: string; count: number; size: number }
        >(),
        tools = new Map<string, number>(),
        models = new Map<string, number>();
      const token_stats = {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_tokens: 0,
        cache_read_tokens: 0,
        total_tokens: 0,
      } as { [key: string]: number };
      let reasoning = 0;
      for (const r of rows) {
        const day = days.get(r.date) ?? { date: r.date, count: 0, size: 0 };
        day.count++;
        day.size += r.size;
        days.set(r.date, day);
        for (const [tool, count] of r.tools)
          tools.set(tool, (tools.get(tool) ?? 0) + count);
        add(models, r.model);
        token_stats.input_tokens += r.tokens.input;
        token_stats.output_tokens += r.tokens.output;
        token_stats.cache_creation_tokens += r.tokens.cache_creation;
        token_stats.cache_read_tokens += r.tokens.cached;
        token_stats.total_tokens += r.tokens.total;
        reasoning += r.tokens.reasoning;
      }
      if (reasoning > 0) token_stats.reasoning_tokens = reasoning;
      const data = [...days.values()].sort((a, b) =>
        a.date.localeCompare(b.date),
      );
      return {
        agent,
        data,
        max_count: Math.max(...data.map((d) => d.count)),
        total_files: rows.length,
        total_size: rows.reduce((n, r) => n + r.size, 0),
        tool_calls: [...tools]
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .map(([tool_name, count]) => ({ tool_name, count })),
        token_stats,
        models: [...models]
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .map(([name]) => name),
      };
    };
    return {
      claude: aggregate("Claude"),
      codex: aggregate("Codex"),
      gemini: aggregate("Gemini"),
    };
  }
}

/** Only compact aggregates cross the worker boundary; histories stay off the request loop. */
export class Insights {
  private worker?: Worker;
  private sequence = 0;
  private pending = new Map<
    number,
    { resolve(value: unknown): void; reject(error: Error): void }
  >();
  constructor(
    private env: NodeJS.ProcessEnv,
    private ttl = 60000,
  ) {}
  private start() {
    if (this.worker) return this.worker;
    const compiled = new URL("./insights-worker.js", import.meta.url);
    const module = existsSync(compiled)
      ? compiled
      : new URL("./insights-worker.ts", import.meta.url);
    const workerData = { env: this.env, ttl: this.ttl, module: module.href };
    const worker = module.pathname.endsWith(".ts")
      ? new Worker(
          'const {workerData}=require("node:worker_threads"); import("tsx/esm/api").then(({register})=>{register(); return import(workerData.module);});',
          {
            eval: true,
            workerData,
            resourceLimits: { maxOldGenerationSizeMb: 256 },
          },
        )
      : new Worker(module, {
          workerData,
          resourceLimits: { maxOldGenerationSizeMb: 256 },
        });
    this.worker = worker;
    worker.on(
      "message",
      (message: { id: number; value?: unknown; error?: string }) => {
        const operation = this.pending.get(message.id);
        if (!operation) return;
        this.pending.delete(message.id);
        if (message.error) operation.reject(new Error(message.error));
        else operation.resolve(message.value);
        if (!this.pending.size) worker.unref();
      },
    );
    const fail = (error: Error) => {
      if (this.worker !== worker) return;
      this.worker = undefined;
      for (const operation of this.pending.values()) operation.reject(error);
      this.pending.clear();
    };
    worker.on("error", fail);
    worker.on("exit", (code) =>
      fail(new Error(`Usage scanner exited (${code})`)),
    );
    worker.unref();
    return worker;
  }
  private request<T>(
    method: "heatmaps" | "rankings" | "options",
    filters: JsonObject = {},
  ) {
    const worker = this.start();
    const id = ++this.sequence;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject });
      worker.ref();
      worker.postMessage({ id, method, filters });
    });
  }
  options() {
    return this.request<Awaited<ReturnType<NativeInsightsScanner["options"]>>>(
      "options",
    );
  }
  rankings(filters: JsonObject) {
    return this.request<Awaited<ReturnType<NativeInsightsScanner["rankings"]>>>(
      "rankings",
      filters,
    );
  }
  heatmaps(filters: JsonObject) {
    return this.request<Awaited<ReturnType<NativeInsightsScanner["heatmaps"]>>>(
      "heatmaps",
      filters,
    );
  }
  async close() {
    const worker = this.worker;
    this.worker = undefined;
    for (const operation of this.pending.values())
      operation.reject(new Error("Usage scanner closed"));
    this.pending.clear();
    if (worker) await worker.terminate();
  }
}
