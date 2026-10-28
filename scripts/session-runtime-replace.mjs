import { readFileSync, readlinkSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadStartupEnv } from "./startup-env.mjs";
import { sessionRuntimeStatus } from "./session-runtime-status.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Session runtimes this repository leaked in earlier runs: the exact cwd and
 * entrypoint of this package, excluding the recorded owner. A child worktree
 * nests inside the root but is an independent service, so compare exactly.
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
    if (!Array.isArray(body?.data)) throw new Error("thread/list 响应不完整");
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
  return active;
}

/** True when the pid leads its own process group, so the group holds only its tree. */
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
} = {}) {
  const result = await status({ root, env, fetcher, readFile });
  if (result.state === "disabled") return { action: "skip", reason: "disabled" };
  if (result.state === "unavailable")
    return { action: "skip", reason: "unavailable", detail: result.error };
  if (!result.pid)
    return { action: "skip", reason: "unverified-owner", url: result.url };
  if (result.binaryState === "current")
    return { action: "skip", reason: "already-current", pid: result.pid };
  if (result.binaryState !== "older")
    return { action: "skip", reason: "unknown-build", pid: result.pid };

  const origin = new URL(result.url).origin;
  let active;
  try {
    active = await listActive({ origin, fetcher });
  } catch (error) {
    // An unreadable thread list is not evidence that nothing is running.
    return {
      action: "skip",
      reason: "active-unknown",
      pid: result.pid,
      detail: error.message,
    };
  }
  return {
    action: "replace",
    reason: active.length ? "active-turns-stopped" : "idle",
    pid: result.pid,
    active,
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
  leadsGroup = runtimeLeadsGroup,
  log = console.log,
  ...options
} = {}) {
  // The runtime leads its own group, so signalling the group also reclaims the
  // `codex app-server` child. Fall back to the bare pid when it does not lead,
  // because a shared group could belong to an unrelated service.
  const stop = (pid, name) => {
    if (leadsGroup(pid)) {
      try {
        signal(-pid, name);
        return;
      } catch {
        // Group gone already; the per-pid attempt below reports the real state.
      }
    }
    signal(pid, name);
  };
  const decision = await plan(options);
  // Reaping needs a known owner to keep; without one every match is ambiguous.
  const orphans = decision.pid
    ? reap({ root: options.root ?? repositoryRoot, keepPid: decision.pid })
    : [];
  for (const pid of orphans) {
    log(`[runtime-replace] 停止本仓库遗留的孤儿运行层 ${pid}`);
    stop(pid, "SIGTERM");
  }
  if (decision.action !== "replace") {
    log(`[runtime-replace] 跳过运行层替换：${decision.reason}`);
    return { ...decision, orphans };
  }
  if (decision.active.length)
    log(
      `[runtime-replace] 按用户要求结束 ${decision.active.length} 个活跃轮次：${decision.active.join(", ")}`,
    );
  log(`[runtime-replace] 停止过期运行层 ${decision.pid}，新构建将在下次请求时启用`);
  stop(decision.pid, "SIGTERM");
  for (let attempt = 0; attempt < 20 && alive(decision.pid); attempt += 1)
    await wait(250);
  if (alive(decision.pid)) {
    log(`[runtime-replace] 运行层未退出，强制停止 ${decision.pid}`);
    stop(decision.pid, "SIGKILL");
  }
  for (const pid of orphans)
    if (alive(pid)) {
      log(`[runtime-replace] 孤儿运行层未退出，强制停止 ${pid}`);
      stop(pid, "SIGKILL");
    }
  return { ...decision, stopped: true, orphans };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    await replaceSessionRuntime({ env: loadStartupEnv(repositoryRoot) });
  } catch (error) {
    console.error(`[runtime-replace] ${error.message}`);
    process.exitCode = 1;
  }
}
