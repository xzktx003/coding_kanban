import { randomUUID } from "node:crypto";
import { projectRunEvent } from "../core/run-events.js";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { JsonStore } from "../core/json-store.js";
import { EventHub, type EventSubscription } from "../core/events.js";
import { object, type JsonObject } from "../core/json.js";
import {
  SessionDatabase,
  validDirectory,
  validId,
} from "../storage/database.js";

export interface AutomationSchedule {
  mode: "daily" | "interval";
  hour?: number | null;
  minute?: number | null;
  interval_hours?: number | null;
  weekdays?: string[];
}
export interface AutomationInput {
  name: string;
  projects: string[];
  prompt: string;
  schedule: AutomationSchedule;
  agent?: string;
  model_provider?: string;
  model?: string;
  cwd_mode?: "cwd" | "worktree";
  bot_id?: string;
}
export interface AutomationTask extends AutomationInput {
  id: string;
  agent: string;
  model_provider: string;
  model: string;
  cwd_mode: "cwd" | "worktree";
  cron_expression: string;
  created_at: string;
  paused: boolean;
}
export interface AgentRunSpec {
  taskId: string;
  taskName: string;
  prompt: string;
  model: string;
  modelProvider: string;
  cwd?: string;
  botId?: string;
  onStarted: (key: string) => void;
  signal: AbortSignal;
}
export type AgentRunner = (
  spec: AgentRunSpec,
) => Promise<"finished" | "detached">;
export interface AutomationOptions {
  dataDir: string;
  db: SessionDatabase;
  hub: EventHub;
  runners: Record<string, AgentRunner>;
  prepareWorktree?: (taskId: string, project: string) => Promise<string>;
  runTimeoutMs?: number;
  track?: (
    event:
      | "bot_routine_created"
      | "bot_run_done"
      | "bot_run_blocked"
      | "bot_run_failed",
  ) => void | Promise<void>;
}
const days = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
function weekdays(schedule: AutomationSchedule): string[] {
  const input = schedule.weekdays ?? [];
  if (!Array.isArray(input)) throw new Error("Invalid weekdays");
  return input.length
    ? input.map((v) => {
        if (
          typeof v !== "string" ||
          ![
            "sun",
            "sunday",
            "mon",
            "monday",
            "tue",
            "tuesday",
            "wed",
            "wednesday",
            "thu",
            "thursday",
            "fri",
            "friday",
            "sat",
            "saturday",
          ].includes(v.trim().toLowerCase())
        )
          throw new Error("Invalid weekday");
        return v.trim().slice(0, 3).toUpperCase();
      })
    : days;
}
export function scheduleToCron(s: AutomationSchedule): string {
  if (!s || typeof s !== "object") throw new Error("Invalid schedule");
  const day = weekdays(s).join(",");
  const minute = s.minute ?? 0;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59)
    throw new Error("minute must be between 0 and 59");
  if (s.mode === "daily") {
    const hour = s.hour ?? 9;
    if (!Number.isInteger(hour) || hour < 0 || hour > 23)
      throw new Error("hour must be between 0 and 23");
    return `0 ${minute} ${hour} * * ${day}`;
  }
  if (s.mode === "interval") {
    const n = s.interval_hours ?? 6;
    if (![1, 2, 3, 4, 6, 8, 12, 24].includes(n))
      throw new Error("interval hours must divide 24");
    return `0 ${minute} ${n === 24 ? "0" : `0/${n}`} * * ${day}`;
  }
  throw new Error("Invalid schedule mode");
}
function isDue(s: AutomationSchedule, date: Date) {
  return (
    weekdays(s).includes(days[date.getDay()]!) &&
    date.getMinutes() === (s.minute ?? 0) &&
    (s.mode === "daily"
      ? date.getHours() === (s.hour ?? 9)
      : date.getHours() % (s.interval_hours ?? 6) === 0)
  );
}
function legacyTask(value: unknown): AutomationTask {
  const t = value as AutomationTask & { access_mode?: string };
  if (!t || typeof t !== "object") throw new Error("Invalid automation");
  validId(t.id);
  if (
    typeof t.name !== "string" ||
    typeof t.prompt !== "string" ||
    !Array.isArray(t.projects)
  )
    throw new Error("Invalid stored automation");
  t.projects.forEach(validDirectory);
  scheduleToCron(t.schedule);
  return {
    ...t,
    agent:
      (t.agent ?? t.access_mode) === "agent"
        ? "codex"
        : (t.agent ?? t.access_mode ?? "codex"),
    model: t.model ?? "gpt-5-codex",
    model_provider: t.model_provider ?? "openai",
    paused: t.paused ?? false,
    cwd_mode: t.cwd_mode ?? "cwd",
  };
}

export class AutomationService {
  private store: JsonStore;
  private timer?: NodeJS.Timeout;
  private subscription?: EventSubscription;
  private running = new Map<string, Promise<void>>();
  private controllers = new Set<AbortController>();
  private codexRuns = new Set<string>();
  private completions = new Map<string, (status: string) => void>();
  private lastMinute = "";
  private closed = false;
  constructor(readonly options: AutomationOptions) {
    this.store = new JsonStore(
      join(options.dataDir, "automations.json"),
      () => ({ tasks: [] }),
    );
  }
  async initialize(startScheduler = true) {
    if (this.closed) throw new Error("Automation service is closed");
    if (this.subscription)
      throw new Error("Automation service is already initialized");
    await this.list();
    if (this.closed) throw new Error("Automation service is closed");
    this.lastMinute = String(Math.floor(Date.now() / 60_000));
    this.subscription = this.options.hub.subscribe({
      agents: "codex,bot",
      project: projectRunEvent,
      filter: (event) => {
        if (event.event === "bot:activity")
          return ["done", "blocked", "failed"].includes(
            String(event.payload.status),
          );
        if (event.event === "codex:disconnected") return true;
        if (event.event !== "codex:notification") return false;
        return (
          event.payload.method === "turn/completed" ||
          event.payload.method === "thread/closed" ||
          (event.payload.method === "error" &&
            object(event.payload.params).willRetry === false)
        );
      },
    });
    void this.consume();
    if (startScheduler) this.startScheduler();
  }
  startScheduler() {
    if (this.closed) throw new Error("Automation service is closed");
    if (!this.subscription)
      throw new Error("Automation service is not initialized");
    if (this.timer) return;
    this.lastMinute = String(Math.floor(Date.now() / 60_000));
    this.timer = setInterval(() => {
      void this.tick().catch((error) =>
        this.options.hub.publish("automation:run/failed", {
          error: String(error),
        }),
      );
    }, 1000);
    this.timer.unref();
  }
  private track(
    event:
      | "bot_routine_created"
      | "bot_run_done"
      | "bot_run_blocked"
      | "bot_run_failed",
  ) {
    // Never let an opt-in usage counter change task execution or expose task data.
    void Promise.resolve()
      .then(() => this.options.track?.(event))
      .catch(() => {});
  }
  private async consume() {
    try {
      for await (const event of this.subscription!) {
        try {
          if (event.event === "bot:activity") {
            const status = event.payload.status;
            if (
              status === "done" ||
              status === "blocked" ||
              status === "failed"
            )
              this.track(`bot_run_${status}`);
          } else if (event.event === "codex:disconnected") {
            // A Codex transport disconnect must not alter Claude or ACP jobs.
            const ids = [...this.codexRuns];
            for (const id of ids) this.completions.get(id)?.("failed");
            for (const id of ids) this.options.db.markRunStatus(id, "failed");
          } else if (event.event === "codex:notification") {
            const payload = event.payload,
              params = object(payload.params),
              turn = object(params.turn);
            if (typeof params.threadId !== "string") continue;
            if (
              payload.method === "thread/closed" &&
              !this.completions.has(params.threadId)
            )
              continue;
            const status =
              payload.method === "turn/completed" &&
              (turn.status === undefined || turn.status === "completed")
                ? "completed"
                : "failed";
            this.completions.get(params.threadId)?.(status);
            this.options.db.markRunStatus(params.threadId, status);
          }
        } catch (error) {
          if (!this.closed)
            this.options.hub.publish("automation:recording-error", {
              error: String(error),
            });
        }
      }
    } catch (error) {
      if (!this.closed)
        this.options.hub.publish("automation:recording-error", {
          error: String(error),
        });
      for (const settle of this.completions.values()) settle("failed");
    }
  }
  async tick(date = new Date()) {
    if (this.closed) return;
    const key = String(Math.floor(date.getTime() / 60_000));
    if (key === this.lastMinute) return;
    this.lastMinute = key;
    for (const task of await this.list())
      if (!task.paused && isDue(task.schedule, date)) void this.execute(task);
  }
  async list(): Promise<AutomationTask[]> {
    const root = await this.store.read();
    if (!Array.isArray(root.tasks))
      throw new Error("Invalid automations store");
    return root.tasks
      .map(legacyTask)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  private normalize(input: AutomationInput) {
    if (
      typeof input.name !== "string" ||
      !input.name.trim() ||
      typeof input.prompt !== "string" ||
      !input.prompt.trim() ||
      !Array.isArray(input.projects)
    )
      throw new Error("name, prompt and projects required");
    const projects = input.projects
      .map((p) => {
        if (typeof p !== "string") throw new Error("Invalid project");
        return p.trim();
      })
      .filter(Boolean);
    projects.forEach(validDirectory);
    let agent = (input.agent ?? "codex").trim().toLowerCase();
    if (agent === "agent") agent = "codex";
    if (!this.options.runners[agent])
      throw new Error(`unknown agent '${agent}'`);
    const botId = agent === "bot" ? input.bot_id?.trim() : undefined;
    if (agent === "bot" && !botId) throw new Error("a bot routine needs a bot");
    if (botId) validId(botId);
    const mode = input.cwd_mode ?? "cwd";
    if (!["cwd", "worktree"].includes(mode))
      throw new Error("Invalid cwd mode");
    return {
      name: input.name.trim(),
      prompt: input.prompt.trim(),
      projects,
      agent,
      model: input.model?.trim() || "gpt-5-codex",
      model_provider: input.model_provider?.trim() || "openai",
      schedule: input.schedule,
      cron_expression: scheduleToCron(input.schedule),
      cwd_mode: mode,
      ...(botId ? { bot_id: botId } : {}),
    };
  }
  private async change<T>(mutate: (tasks: AutomationTask[]) => T) {
    let result!: T;
    await this.store.update((root) => {
      if (!Array.isArray(root.tasks))
        throw new Error("Invalid automations store");
      const tasks = root.tasks.map(legacyTask);
      result = mutate(tasks);
      return {
        ...root,
        tasks: tasks.sort((a, b) =>
          a.created_at.localeCompare(b.created_at),
        ) as unknown as JsonObject["tasks"],
      };
    });
    return result;
  }
  async create(input: AutomationInput) {
    const task: AutomationTask = {
      ...this.normalize(input),
      id: "automation-" + randomUUID(),
      created_at: new Date().toISOString(),
      paused: false,
    };
    const created = await this.change((tasks) => {
      tasks.push(task);
      return task;
    });
    if (created.agent === "bot") this.track("bot_routine_created");
    return created;
  }
  async update(id: string, input: AutomationInput) {
    const normalized = this.normalize(input);
    return this.change((tasks) => {
      const index = tasks.findIndex((t) => t.id === id);
      if (index < 0) throw new Error("Automation not found");
      const previous = tasks[index]!;
      const next: AutomationTask = {
        ...normalized,
        id,
        created_at: previous.created_at,
        paused: previous.paused,
      };
      tasks[index] = next;
      return next;
    });
  }
  async setPaused(id: string, paused: boolean) {
    if (typeof paused !== "boolean") throw new Error("paused must be boolean");
    return this.change((tasks) => {
      const task = tasks.find((t) => t.id === id);
      if (!task) throw new Error("Automation not found");
      task.paused = paused;
      return task;
    });
  }
  async delete(id: string) {
    return this.change((tasks) => {
      const index = tasks.findIndex((t) => t.id === id);
      if (index < 0) throw new Error("Automation not found");
      tasks.splice(index, 1);
    });
  }
  async deleteForBot(id: string) {
    return this.change((tasks) => {
      for (let i = tasks.length - 1; i >= 0; i--)
        if (tasks[i]!.bot_id === id) tasks.splice(i, 1);
    });
  }
  async importPaused(input: unknown[]) {
    const validated = input.map(legacyTask);
    return this.change((tasks) => {
      let count = 0;
      for (const task of validated)
        if (!tasks.some((t) => t.id === task.id)) {
          tasks.push({ ...task, paused: true });
          count++;
        }
      return count;
    });
  }
  async runNow(id: string) {
    if (this.closed) throw new Error("Automation service is closed");
    const task = (await this.list()).find((t) => t.id === id);
    if (!task) throw new Error("Automation not found");
    if (this.closed) throw new Error("Automation service is closed");
    void this.execute(task);
  }
  execute(task: AutomationTask): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (this.running.has(task.id)) {
      this.options.hub.publish("automation:run/skipped", {
        taskId: task.id,
        reason: "a previous run is still in flight",
      });
      return Promise.resolve();
    }
    const runner = this.options.runners[task.agent];
    if (!runner) {
      this.options.hub.publish("automation:run/skipped", {
        taskId: task.id,
        reason: `no runner registered for agent '${task.agent}'`,
      });
      return Promise.resolve();
    }
    const work = Promise.resolve()
      .then(async () => {
        const errors: string[] = [];
        for (const target of task.projects.length
          ? task.projects
          : [undefined]) {
          if (this.closed) break;
          let active = true;
          let key: string | undefined;
          let timeout: NodeJS.Timeout | undefined;
          let detachedCompletion: Promise<string> | undefined;
          const controller = new AbortController();
          this.controllers.add(controller);
          let abortListener!: () => void;
          const interrupted = new Promise<never>((_, reject) => {
            abortListener = () =>
              reject(
                controller.signal.reason ?? new Error("Automation aborted"),
              );
            controller.signal.addEventListener("abort", abortListener, {
              once: true,
            });
          });
          // Arm cancellation before directory preparation or the native runner.
          timeout = setTimeout(
            () =>
              controller.abort(
                new Error(
                  "Automation timed out; delivery state may be unknown",
                ),
              ),
            this.options.runTimeoutMs ?? 3600000,
          );
          timeout.unref();
          try {
            let cwd = target;
            if (task.cwd_mode === "worktree" && target) {
              if (!this.options.prepareWorktree)
                throw new Error("Worktree service unavailable");
              cwd = await Promise.race([
                this.options.prepareWorktree(task.id, target),
                interrupted,
              ]);
            }
            controller.signal.throwIfAborted();
            const spec: AgentRunSpec = {
              taskId: task.id,
              taskName: task.name,
              prompt: task.prompt,
              model: task.model,
              modelProvider: task.model_provider,
              cwd,
              botId: task.bot_id,
              signal: controller.signal,
              onStarted: (id) => {
                controller.signal.throwIfAborted();
                if (!active) throw new Error("Automation run already settled");
                if (key && key !== id)
                  throw new Error("Runner reported multiple identities");
                key = id;
                if (task.agent === "codex") this.codexRuns.add(id);
                if (!detachedCompletion)
                  detachedCompletion = new Promise((resolve) =>
                    this.completions.set(id, resolve),
                  );
                const startedAt = new Date().toISOString();
                this.options.db.insertRunStarted(
                  task.id,
                  task.name,
                  id,
                  cwd ?? null,
                  startedAt,
                );
                this.options.hub.publish("automation:run/started", {
                  taskId: task.id,
                  taskName: task.name,
                  agent: task.agent,
                  threadId: id,
                  cwd: cwd ?? null,
                  startedAt,
                });
              },
            };
            const outcome = await Promise.race([
              runner(spec).then(async (outcome) => {
                if (outcome === "detached") {
                  if (!detachedCompletion)
                    throw new Error(
                      "Detached runner did not report its identity",
                    );
                  const status = await detachedCompletion;
                  if (status !== "completed")
                    throw new Error("Detached automation failed");
                }
                return outcome;
              }),
              interrupted,
            ]);
            controller.signal.throwIfAborted();
            if (key && outcome === "finished")
              this.options.db.markRunStatus(key, "completed");
          } catch (e) {
            if (key) this.options.db.markRunStatus(key, "failed");
            errors.push(`${target ?? "default"}: ${String(e)}`);
          } finally {
            active = false;
            controller.signal.removeEventListener("abort", abortListener);
            this.controllers.delete(controller);
            if (timeout) clearTimeout(timeout);
            if (key) {
              this.completions.delete(key);
              this.codexRuns.delete(key);
            }
          }
        }
        if (errors.length)
          this.options.hub.publish("automation:run/failed", {
            taskId: task.id,
            error: errors.join("; "),
          });
      })
      .finally(() => this.running.delete(task.id));
    this.running.set(task.id, work);
    return work;
  }
  close() {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    this.subscription?.close();
    for (const controller of this.controllers)
      controller.abort(new Error("Automation service is closed"));
    for (const settle of this.completions.values()) settle("failed");
    this.completions.clear();
    return Promise.allSettled([...this.running.values()]);
  }
}
export function registerAutomationRoutes(
  app: FastifyInstance,
  service: AutomationService,
) {
  app.post("/api/automation/list", () => service.list());
  const input = (value: unknown): AutomationInput => {
    const body = object(value);
    return {
      ...body,
      projects: body.projects ?? [],
      model_provider: body.model_provider ?? body.modelProvider,
      cwd_mode: body.cwd_mode ?? body.cwdMode,
      bot_id: body.bot_id ?? body.botId,
    } as unknown as AutomationInput;
  };
  app.post("/api/automation/create", (req) => service.create(input(req.body)));
  app.post("/api/automation/update", (req) => {
    const body = req.body as AutomationInput & { id: string };
    return service.update(body.id, input(body));
  });
  app.post("/api/automation/set-paused", (req) => {
    const b = req.body as { id: string; paused: boolean };
    return service.setPaused(b.id, b.paused);
  });
  app.post("/api/automation/delete", async (req, reply) => {
    await service.delete((req.body as { id: string }).id);
    return reply.code(200).send();
  });
  app.post("/api/automation/run-now", async (req, reply) => {
    await service.runNow((req.body as { id: string }).id);
    return reply.code(200).send();
  });
  app.post("/api/automation/runs/list", (req) => {
    const b = req.body as { task_id?: string; taskId?: string; limit?: number };
    return service.options.db.listRuns(b.task_id ?? b.taskId, b.limit);
  });
}
