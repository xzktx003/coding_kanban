import { access, readFile, mkdir } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, dirname, isAbsolute, join } from "node:path";
import { homedir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { bodyObject, HttpError, isObject } from "../core/json.js";
import type { AcpAgentDef } from "./types.js";
const execFileAsync = promisify(execFile);
const presets = [
  {
    id: "keke",
    name: "Keke",
    bin: "keke",
    args: ["agent", "stdio"],
    pkg: "@milisp/keke@0.1.38",
  },
  {
    id: "claude",
    name: "Claude Code",
    bin: "claude-code-acp",
    args: [],
    pkg: "@agentclientprotocol/claude-agent-acp@latest",
  },
];
export function validateAgent(value: unknown): AcpAgentDef {
  const def = bodyObject(value);
  for (const key of ["id", "name", "command"])
    if (
      typeof def[key] !== "string" ||
      !def[key] ||
      /[\x00-\x1f]/.test(def[key] as string)
    )
      throw new HttpError(400, `Invalid agent ${key}`);
  if (
    def.args !== undefined &&
    (!Array.isArray(def.args) ||
      def.args.some((x) => typeof x !== "string" || x.includes("\0")))
  )
    throw new HttpError(400, "Invalid agent args");
  if (
    def.env !== undefined &&
    (!isObject(def.env) ||
      Object.entries(def.env).some(
        ([k, v]) =>
          !k || /[=\0]/.test(k) || typeof v !== "string" || v.includes("\0"),
      ))
  )
    throw new HttpError(400, "Invalid agent env");
  return {
    id: def.id as string,
    name: def.name as string,
    command: def.command as string,
    args: (def.args ?? []) as string[],
    env: (def.env ?? {}) as Record<string, string>,
  };
}
export async function which(
  command: string,
  env: NodeJS.ProcessEnv,
): Promise<string | undefined> {
  if (/[\x00-\x1f]/.test(command)) return;
  for (const path of isAbsolute(command)
    ? [command]
    : (env.PATH ?? "")
        .split(delimiter)
        .filter(Boolean)
        .map((p) => join(p, command))) {
    try {
      await access(path, constants.X_OK);
      return path;
    } catch {}
  }
}
export async function listAgents(
  dataHome: string,
  env: NodeJS.ProcessEnv,
): Promise<AcpAgentDef[]> {
  const agents: AcpAgentDef[] = [];
  for (const p of presets) {
    const paths = [
      ...(p.id === "keke" ? [join(dirname(process.execPath), p.bin)] : []),
      join(dataHome, "tools", "node_modules", ".bin", p.bin),
      p.bin,
    ];
    let found: string | undefined;
    for (const path of paths) {
      found = await which(path, env);
      if (found) break;
    }
    const npx = found ? undefined : await which("npx", env);
    agents.push({
      id: p.id,
      name: p.name,
      command: found ?? npx ?? "npx",
      args: found ? p.args : ["-y", p.pkg, ...p.args],
      env: {},
      available: Boolean(found || npx),
      local: Boolean(found),
    });
  }
  const file = join(env.HOME ?? homedir(), ".plux", "acp-agents.json");
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return agents;
    throw e;
  }
  const users = bodyObject(JSON.parse(raw));
  const entries = bodyObject(users.agents ?? {});
  for (const [name, entry] of Object.entries(entries).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const def = validateAgent({
      id: name
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "-")
        .replace(/^-+|-+$/g, ""),
      name,
      ...bodyObject(entry),
    });
    def.available = Boolean(await which(def.command, env));
    def.local = def.available;
    const i = agents.findIndex((a) => a.id === def.id);
    if (i < 0) agents.push(def);
    else agents[i] = def;
  }
  return agents;
}
export async function installAgent(
  id: string,
  dataHome: string,
  env: NodeJS.ProcessEnv,
): Promise<AcpAgentDef> {
  const preset = presets.find((p) => p.id === id);
  if (!preset) throw new HttpError(400, `${id} has no npm package to install`);
  const npm = await which("npm", env);
  if (!npm)
    throw new Error("npm was not found on PATH — install Node.js first.");
  const toolHome = join(dataHome, "tools");
  await mkdir(toolHome, { recursive: true });
  await execFileAsync(
    npm,
    ["install", "--prefix", toolHome, "--no-audit", "--no-fund", preset.pkg],
    { env, timeout: 10 * 60_000, maxBuffer: 1024 * 1024 },
  );
  const agent = (await listAgents(dataHome, env)).find((a) => a.id === id)!;
  if (!agent.local)
    throw new Error(
      "Installation completed but local ACP launcher is unavailable",
    );
  return agent;
}
