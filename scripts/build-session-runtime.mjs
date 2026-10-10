import { loadStartupEnv } from "./startup-env.mjs";
import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export function runtimeBuildCommand(operation = "build") {
  if (!["build", "check", "test", "clippy"].includes(operation))
    throw new Error("Unsupported runtime build operation");
  // Keep the old command alias usable while all owned runtime code moves to TS.
  return {
    command: "pnpm",
    args: [
      "--filter",
      "@agent-orchestrator/session-runtime",
      operation === "clippy" ? "check" : operation,
    ],
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const env = loadStartupEnv(root);
  const runtime = runtimeBuildCommand(process.argv[2] || "build");
  const steps = [
    {
      command: "pnpm",
      args: ["--filter", "@agent-orchestrator/shared", "build"],
    },
    runtime,
  ];
  for (const { command, args } of steps) {
    const code = await new Promise((resolve) => {
      const child = spawn(command, args, { cwd: root, stdio: "inherit", env });
      child.once("error", (error) => {
        console.error(
          `无法运行 TypeScript 会话构建：${error.message}。请运行 pnpm install --frozen-lockfile。`,
        );
        resolve(1);
      });
      child.once("exit", (code) => resolve(code ?? 1));
    });
    if (code !== 0) {
      process.exitCode = code;
      break;
    }
  }
}
