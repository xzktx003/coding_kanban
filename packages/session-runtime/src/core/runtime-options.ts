import { isIP } from "node:net";
import { detectTailscale } from "../platform/device.js";

// Historical standalone runtime default; the managed gateway supplies --port explicitly.
export const DEFAULT_SESSION_WEB_PORT = 7420;
export interface RuntimeArguments {
  port: number;
  remote: boolean;
  allowedOrigins: string[];
}
function portValue(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d+$/.test(value)) return;
  const result = Number(value);
  return Number.isSafeInteger(result) && result <= 65535 ? result : undefined;
}
export function parseRuntimeArgs(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): RuntimeArguments {
  let port = portValue(env.VITE_WEB_PORT) ?? DEFAULT_SESSION_WEB_PORT;
  let remote = false;
  const allowedOrigins = (env.CODEXIA_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--remote") {
      remote = true;
      continue;
    }
    if (
      arg === "--port" ||
      arg === "--web-port" ||
      arg.startsWith("--web-port=") ||
      arg.startsWith("--port=")
    ) {
      const value = arg.includes("=")
        ? arg.slice(arg.indexOf("=") + 1)
        : args[++index];
      const parsed = portValue(value);
      if (parsed === undefined)
        throw new Error(`Invalid runtime port: ${value ?? "(missing)"}`);
      port = parsed;
      continue;
    }
    if (arg === "--allow-origin" || arg.startsWith("--allow-origin=")) {
      const value = arg.includes("=")
        ? arg.slice(arg.indexOf("=") + 1)
        : args[++index];
      if (!value || value.startsWith("--") || /[\x00-\x20]/.test(value))
        throw new Error("Invalid or missing --allow-origin");
      allowedOrigins.push(value);
      continue;
    }
    throw new Error(`Unknown runtime option: ${arg}`);
  }
  return { port, remote, allowedOrigins: [...new Set(allowedOrigins)] };
}
export async function resolveRuntimeOptions(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  detect: () => Promise<{ dns_name: string; ipv4: string } | null> = () =>
    detectTailscale(env),
) {
  const parsed = parseRuntimeArgs(args, env);
  const tailscale = parsed.remote ? await detect() : null;
  if (
    tailscale &&
    (isIP(tailscale.ipv4) !== 4 ||
      ["0.0.0.0", "255.255.255.255"].includes(tailscale.ipv4))
  )
    throw new Error("Tailscale returned an invalid bind address");
  return { ...parsed, host: tailscale?.ipv4 ?? "127.0.0.1", tailscale };
}
