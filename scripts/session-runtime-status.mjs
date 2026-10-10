import { readFileSync, statSync, readdirSync } from "node:fs";
import { dirname, resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { loadStartupEnv } from "./startup-env.mjs";
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** Inspect readiness and ownership; never signal a process or modify its identity. */
export async function sessionRuntimeStatus({
  root = repositoryRoot,
  env = process.env,
  fetcher = fetch,
  readFile = readFileSync,
  stat = statSync,
  fingerprint = runtimeBuildFingerprint,
} = {}) {
  if (env.SESSION_MODE_ENABLED === "0") return { state: "disabled" };
  const port = Number(env.SERVER_PORT || env.PORT || 4000);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("SERVER_PORT/PORT 必须在 1–65535 之间。");
  const hostname = env.SERVER_PUBLIC_HOST || "127.0.0.1";
  const host =
    hostname.includes(":") && !hostname.startsWith("[")
      ? `[${hostname}]`
      : hostname;
  const url = `http://${host}:${port}/api/session/health`;
  const dataHome = resolve(
    root,
    env.SESSION_DATA_HOME?.trim() || ".dev-runtime/session-mode",
  );
  const runtimeLog = resolve(dataHome, "runtime.log");
  let health;
  try {
    const response = await fetcher(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    health = await response.json();
    if (health.status !== "ok") throw new Error("健康检查尚未返回 ok");
  } catch (error) {
    return { state: "unavailable", url, runtimeLog, error: error.message };
  }
  const result = { state: "ready", url, runtimeLog, binaryState: "unknown" };
  try {
    const identity = JSON.parse(
      readFile(resolve(dataHome, "runtime.json"), "utf8"),
    );
    if (
      typeof identity.instance !== "string" ||
      !identity.instance ||
      typeof identity.binary !== "string" ||
      !isAbsolute(identity.binary) ||
      identity.instance !== health.instance ||
      !Number.isInteger(identity.pid) ||
      identity.pid <= 0
    )
      return result;
    const binary = identity.binary;
    const cmdline = readFile(`/proc/${identity.pid}/cmdline`, "utf8").split(
      "\0",
    );
    if (cmdline[0] !== binary) return result;
    if (identity.entrypoint) {
      if (
        typeof identity.entrypoint !== "string" ||
        !isAbsolute(identity.entrypoint) ||
        cmdline[1] !== identity.entrypoint
      )
        return result;
      return {
        ...result,
        pid: identity.pid,
        runtime: "typescript",
        binaryState:
          typeof identity.buildFingerprint === "string"
            ? fingerprint(dirname(identity.entrypoint)) ===
              identity.buildFingerprint
              ? "current"
              : "older"
            : "unknown",
      };
    }
    const disk = stat(binary),
      running = stat(`/proc/${identity.pid}/exe`);
    return {
      ...result,
      pid: identity.pid,
      runtime: "legacy",
      binaryState:
        disk.dev === running.dev && disk.ino === running.ino
          ? "current"
          : "older",
    };
  } catch {
    return result;
  }
}
export function printRuntimeStatus(result, log = console.log) {
  if (result.state === "disabled")
    log(
      "[session-status] 已禁用会话模式（SESSION_MODE_ENABLED=0），跳过会话健康检查。",
    );
  else if (result.state === "unavailable") {
    log(`[session-status] 会话服务未就绪：${result.error}；${result.url}`);
    log(
      `[session-status] 查看 ${result.runtimeLog}。前端/Node 网关正常不代表会话运行层已就绪。`,
    );
  } else {
    log(
      `[session-status] 会话服务就绪${result.pid ? `，PID ${result.pid}` : ""}：${result.url}`,
    );
    if (result.runtime === "legacy")
      log(
        "[session-status] 当前仍复用原有运行服务；TypeScript 默认入口将在没有存活运行服务时启用，切换须安排 Agent 安全窗口。",
      );
    if (result.binaryState === "older")
      log(
        "[session-status] 注意：运行中的二进制与磁盘构建产物不同，新会话运行代码尚未激活。保留现有任务，待会话结束后安排运行层更新；本命令不会停止 Agent。",
      );
    else if (result.binaryState === "unknown")
      log(
        "[session-status] 无法核对本地运行文件版本；未对未知进程执行任何操作。",
      );
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const result = await sessionRuntimeStatus({
      env: loadStartupEnv(repositoryRoot),
    });
    printRuntimeStatus(result);
    if (result.state === "unavailable") process.exitCode = 1;
  } catch (error) {
    console.error(`[session-status] ${error.message}`);
    process.exitCode = 1;
  }
}

export function runtimeBuildFingerprint(dist) {
  const hash = createHash("sha256");
  const visit = (directory, prefix) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      const path = resolve(directory, entry.name),
        name = `${prefix}${entry.name}`;
      if (entry.isDirectory()) visit(path, `${name}/`);
      else if (entry.isFile() && entry.name.endsWith(".js"))
        hash.update(name).update("\0").update(readFileSync(path)).update("\0");
    }
  };
  visit(dist, "");
  return hash.digest("hex");
}
