import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cargo =
  process.env.SESSION_CARGO_BIN ||
  (existsSync(resolve(homedir(), ".cargo/bin/cargo"))
    ? resolve(homedir(), ".cargo/bin/cargo")
    : "cargo");
const operation = process.argv[2] || "build";
if (!["build", "check", "test", "clippy"].includes(operation))
  throw new Error("Unsupported runtime build operation");
const args = [
  operation,
  "--manifest-path",
  resolve(root, "packages/session-runtime/Cargo.toml"),
  "--locked",
];
if (["test", "clippy"].includes(operation)) args.push("--workspace");
else args.push("-p", "codexia-web");
if (operation === "clippy") args.push("--all-targets", "--", "-D", "warnings");
const child = spawn(cargo, args, {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    WHISPER_DONT_GENERATE_BINDINGS: "1",
    ...(operation === "test"
      ? {
          SESSION_DATA_HOME: resolve(root, ".dev-runtime/session-tests"),
          CODEX_HOME: resolve(root, ".dev-runtime/session-tests/.codex"),
          CLAUDE_CONFIG_DIR: resolve(
            root,
            ".dev-runtime/session-tests/.claude",
          ),
        }
      : {}),
  },
});
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
