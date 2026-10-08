import { spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadStartupEnv } from "./startup-env.mjs";
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export function validateNodeVersion(version = process.versions.node) {
  const [major, minor] = version.replace(/^v/, "").split(".").map(Number);
  if (
    !(
      (major === 20 && minor >= 19) ||
      (major === 22 && minor >= 12) ||
      major > 22
    )
  )
    throw new Error(
      "需要 Node.js ^20.19.0 或 >=22.12.0，建议使用 Node.js 24 LTS。",
    );
}
function executable(path) {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
function runCommand(command, args, options) {
  const result = spawnSync(command, args, { ...options, stdio: "inherit" });
  if (result.error)
    throw new Error(
      `无法执行 ${command}，请检查安装及 PATH：${result.error.message}`,
    );
  if (result.status !== 0)
    throw new Error(
      `编译失败（${command}，退出状态 ${result.status ?? result.signal}）；现有服务尚未停止。`,
    );
}
export function prepareDev({
  root = repositoryRoot,
  env = process.env,
  run = runCommand,
  log = console.log,
} = {}) {
  validateNodeVersion();
  if (env.WEB_HOST && env.WEB_HOST !== "0.0.0.0")
    throw new Error("WEB_HOST 必须是 0.0.0.0，以支持局域网访问。");
  for (const path of [
    "node_modules",
    "apps/server/node_modules",
    "apps/web/node_modules",
  ])
    if (!existsSync(resolve(root, path)))
      throw new Error(
        "依赖未安装完整，请先在仓库根目录运行 pnpm install --frozen-lockfile。",
      );
  const enabled = env.SESSION_MODE_ENABLED !== "0";
  const custom = env.SESSION_RUNTIME_BIN;
  // Match SessionRuntimeManager: explicit binaries are not overwritten by Cargo.
  const binary = resolve(
    root,
    custom || "packages/session-runtime/target/debug/codexia-web",
  );
  if (/[\x00-\x1f]/.test(binary))
    throw new Error("SESSION_RUNTIME_BIN 包含无效字符。");
  if (enabled && custom && !executable(binary))
    throw new Error("SESSION_RUNTIME_BIN 必须指向已构建且可执行的文件。");
  log("[dev-prepare] 编译 shared…");
  run("pnpm", ["--filter", "@agent-orchestrator/shared", "build"], {
    cwd: root,
    env,
  });
  if (!enabled)
    log(
      "[dev-prepare] SESSION_MODE_ENABLED=0：仅启动终端模式，跳过 Rust 编译。",
    );
  else if (custom)
    log(
      "[dev-prepare] 使用 SESSION_RUNTIME_BIN 指定的二进制，跳过本仓库 Rust 编译。",
    );
  else {
    log(
      "[dev-prepare] 增量编译会话运行层（首次构建需要 Rust stable、C/C++ 编译器、CMake）…",
    );
    run(
      process.execPath,
      [resolve(root, "scripts/build-session-runtime.mjs"), "build"],
      { cwd: root, env },
    );
    if (!executable(binary))
      throw new Error(
        "未找到默认 Rust 构建产物；自定义 CARGO_TARGET_DIR 时请设置 SESSION_RUNTIME_BIN。",
      );
  }
  log(
    "[dev-prepare] 准备完成。已有会话运行服务会继续复用；编译不会中断或替换正在运行的 Agent。",
  );
  return { enabled, binary };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    prepareDev({ env: loadStartupEnv(repositoryRoot) });
  } catch (error) {
    console.error(`[dev-prepare] ${error.message}`);
    process.exitCode = 1;
  }
}
