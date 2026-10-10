import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";

async function executable(path: string): Promise<boolean> {
  try { await access(path, constants.X_OK); return (await stat(path)).isFile(); } catch { return false; }
}

/** Explicit configuration wins; conventional native installs and PATH remain supported. */
export async function discoverCodex(env: NodeJS.ProcessEnv): Promise<string> {
  if (env.CODEX_PATH) {
    if (/[\x00-\x1f]/.test(env.CODEX_PATH)) throw new Error("Invalid CODEX_PATH");
    const path = resolve(env.CODEX_PATH);
    if (!await executable(path)) throw new Error("Configured CODEX_PATH is not executable");
    return path;
  }
  const home = env.HOME || env.USERPROFILE || homedir();
  const arch = process.arch === "arm64" ? "aarch64" : "x86_64";
  const platform = process.platform === "darwin" ? `${arch}-apple-darwin` : process.platform === "win32" ? `${arch}-pc-windows-msvc` : `${arch}-unknown-linux-musl`;
  const name = process.platform === "win32" ? "codex.exe" : "codex";
  const packages = [join(home, ".bun/install/global/node_modules/@openai/codex"),
    join(home, ".local/share/npm/lib/node_modules/@openai/codex"),
    "/usr/local/lib/node_modules/@openai/codex", "/opt/homebrew/lib/node_modules/@openai/codex"];
  if (env.APPDATA) packages.push(join(env.APPDATA, "npm/node_modules/@openai/codex"));
  const candidates = packages.flatMap(root => [join(root, "bin", `codex-${platform}${process.platform === "win32" ? ".exe" : ""}`), join(root, "vendor", platform, "codex", name)]);
  candidates.push(join(home, ".cargo/bin", name), ...["/usr/local/bin", "/opt/homebrew/bin"].map(dir => join(dir, name)));
  for (const directory of (env.PATH || "").split(delimiter).filter(Boolean)) candidates.push(resolve(directory, name));
  for (const candidate of candidates) if (await executable(candidate)) return candidate;
  throw new Error("codex backend is not available (codex binary not found in PATH; configure CODEX_PATH)");
}
