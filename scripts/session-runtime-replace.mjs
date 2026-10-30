import { readFileSync, readlinkSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadStartupEnv } from "./startup-env.mjs";
import { sessionRuntimeStatus, readOwnedAgentActivity } from "./session-runtime-status.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Read-only candidates sharing this package's exact cwd and entrypoint. These
 * facts do not establish ownership: another SESSION_DATA_HOME may be active.
 * A child worktree is also an independent service, so compare cwd exactly.
 */
export function orphanedRuntimes({
  root = repositoryRoot,
  keepPid,
  listPids = () =>
    readdirSync("/proc")
      .filter((entry) => /^[1-9][0-9]*$/.test(entry))
      .map(Number),
  readCwd = (pid) => readlinkSync(`/proc/${pid}/cwd`),
  readCmdline = (pid) => readFileSync(`/proc/${pid}/cmdline`, "utf8"),
} = {}) {
  const cwd = resolve(root, "packages/session-runtime");
  const entrypoint = resolve(cwd, "dist/main.js");
  const orphans = [];
  for (const pid of listPids()) {
    if (pid === keepPid || pid === process.pid) continue;
    let own;
    try {
      own = readCwd(pid) === cwd && readCmdline(pid).split("\0").includes(entrypoint);
    } catch {
      continue; // Exited or owned by another user; never guess.
    }
    if (own) orphans.push(pid);
  }
  return orphans;
}

/** Threads the runtime reports as still executing a turn. */
export async function activeSessionThreads({
  origin,
  fetcher = fetch,
  timeoutMs = 15_000,
}) {
  const active = [];
  const seen = new Set();
  let cursor = null;
  for (let page = 0; page < 64; page += 1) {
    const response = await fetcher(`${origin}/api/session/api/codex/thread/list`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        cursor,
        limit: 100,
        sortKey: "updated_at",
        modelProviders: null,
        cwd: null,
        archived: false,
        useStateDbOnly: true,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    if (!Array.isArray(body?.data) || body.nextCursor === undefined) throw new Error("thread/list 响应不完整");
    for (const thread of body.data) {
      if (thread?.status?.type === "active" && typeof thread.id === "string")
        active.push(thread.id);
    }
    cursor = body.nextCursor ?? null;
    if (cursor === null) break;
    if (typeof cursor !== "string" || seen.has(cursor))
      throw new Error("thread/list 游标无效或重复");
    seen.add(cursor);
  }
  if (cursor !== null) throw new Error("thread/list 超出页数预算，活动列表尚未读完");
  return active;
}

/** Diagnostic group leadership only; it never establishes ownership of group members. */
export function runtimeLeadsGroup(
  pid,
  readStat = (target) => readFileSync(`/proc/${target}/stat`, "utf8"),
) {
  try {
    // Field 5 is pgid, counted after the comm field, which may contain spaces.
    const fields = readStat(pid).slice(readStat(pid).lastIndexOf(")") + 2).split(" ");
    return Number(fields[2]) === pid;
  } catch {
    return false;
  }
}

/**
 * Decide whether this repository's own session runtime should be replaced so a
 * fresh build takes effect. Returns the reason instead of signalling anything.
 */
export async function planRuntimeReplacement({
  root = repositoryRoot,
  env = process.env,
  fetcher = fetch,
  readFile = readFileSync,
  status = sessionRuntimeStatus,
  listActive = activeSessionThreads,
  force = false,
} = {}) {
  const result = await status({ root, env, fetcher, readFile });
  if (result.state === "disabled") return { action: "skip", reason: "disabled" };
  if (result.state === "unavailable")
    return { action: "skip", reason: "unavailable", detail: result.error };
  if (!result.pid)
    return { action: "skip", reason: "unverified-owner", url: result.url };
  if (result.binaryState === "current" && !force)
    return { action: "skip", reason: "already-current", pid: result.pid };
  if (result.binaryState !== "older" && result.binaryState !== "current")
    return { action: "skip", reason: "unknown-build", pid: result.pid };

  const ownedAgents = readOwnedAgentActivity(result.ownedAgents);
  const ownedBusy = ownedAgents && Object.values(ownedAgents).some(provider => Object.values(provider).some(count => count > 0));
  if (!force && !ownedAgents)
    return { action: "skip", reason: "owned-activity-unknown", pid: result.pid };
  if (!force && ownedBusy)
    return { action: "skip", reason: "owned-agents-connected", pid: result.pid, ownedAgents };

  const origin = new URL(result.url).origin;
  let active;
  let activityUnknown = !ownedAgents;
  try {
    active = await listActive({ origin, fetcher });
  } catch (error) {
    // Automatic updates preserve unknown activity. An explicit verified
    // maintenance request may stop the owned runtime, but never calls it idle.
    if (!force) return { action: "skip", reason: "active-unknown", pid: result.pid, detail: error.message };
    activityUnknown = true;
    active = [];
  }
  if (!force && active.length && result.codexBackend !== "shared-daemon")
    return { action: "skip", reason: "active-turns", pid: result.pid, active };
  return {
    action: "replace",
    reason: ownedBusy ? "owned-agents-stopped" : active.length
      ? result.codexBackend === "shared-daemon"
        ? "shared-tasks-preserved"
        : "active-turns-stopped"
      : force
        ? "forced"
        : "idle",
    pid: result.pid,
    active,
    ...(ownedBusy ? { ownedAgents } : {}),
    ...(activityUnknown ? { activityUnknown: true } : {}),
    ...(result.codexBackend === "shared-daemon" ? { codexBackend: "shared-daemon" } : {}),
  };
}

/** Stop this repository's own stale runtime so the next request starts the new build. */
export async function replaceSessionRuntime({
  plan = planRuntimeReplacement,
  signal = (pid, name) => process.kill(pid, name),
  alive = (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  },
  wait = (ms) => new Promise((done) => setTimeout(done, ms)),
  reap = orphanedRuntimes,
  log = console.log,
  ...options
} = {}) {
  // Group leadership does not establish ownership of a shared daemon. Signal
  // only the verified runtime; its close handlers release its own connections.
  // This also applies to orphan runtimes, whose native backend is unknown.
  const stop = (pid, name) => signal(pid, name);
  const decision = await plan(options);
  // The same entrypoint may host an independent data domain. Discovery is
  // diagnostic only; neither an automatic update nor --restart-runtime sweeps it.
  const orphanCandidates = decision.pid
    ? reap({ root: options.root ?? repositoryRoot, keepPid: decision.pid })
    : [];
  const orphans = [];
  if (orphanCandidates.length)
    log(`[runtime-replace] 发现 ${orphanCandidates.length} 个同入口运行层候选，未核实独立数据域；保留不清理：${orphanCandidates.join(", ")}`);
  if (decision.action !== "replace") {
    log(`[runtime-replace] 跳过运行层替换：${decision.reason}`);
    return { ...decision, orphans, ...(orphanCandidates.length ? {orphanCandidates} : {}) };
  }
  if (decision.ownedAgents)
    log(`[runtime-replace] 按显式维护请求停止本运行层自有 Claude/ACP 连接：${JSON.stringify(decision.ownedAgents)}`);
  if (decision.activityUnknown)
    log("[runtime-replace] 按显式维护请求替换已核实运行层；部分 Agent 活动未知，不能视为安全空闲");
  if (decision.active.length && decision.codexBackend === "shared-daemon")
    log(`[runtime-replace] 保留官方共享服务中的 ${decision.active.length} 个活跃轮次，仅替换看板连接层`);
  else if (decision.active.length)
    log(
      `[runtime-replace] 按用户要求结束 ${decision.active.length} 个活跃轮次：${decision.active.join(", ")}`,
    );
  log(
    `[runtime-replace] 停止${decision.reason === "forced" ? "当前" : "过期"}运行层 ${decision.pid}，新构建将在下次请求时启用`,
  );
  stop(decision.pid, "SIGTERM");
  for (let attempt = 0; attempt < 20 && alive(decision.pid); attempt += 1)
    await wait(250);
  if (alive(decision.pid)) {
    log(`[runtime-replace] 运行层未退出，强制停止 ${decision.pid}`);
    stop(decision.pid, "SIGKILL");
  }
  return { ...decision, stopped: true, orphans, ...(orphanCandidates.length ? {orphanCandidates} : {}) };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--restart-runtime")) {
    console.error("[runtime-replace] 只接受 --restart-runtime");
    process.exitCode = 1;
  } else {
    try {
      await replaceSessionRuntime({
        env: loadStartupEnv(repositoryRoot),
        force: args.includes("--restart-runtime"),
      });
    } catch (error) {
      console.error(`[runtime-replace] ${error.message}`);
      process.exitCode = 1;
    }
  }
}
