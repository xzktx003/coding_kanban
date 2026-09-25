import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

import type { SshHostPreset } from "@agent-orchestrator/shared";

interface ParsedHost {
  name: string;
  hostname?: string;
  port?: string;
  user?: string;
  identityFile?: string;
}

export function parseSshConfig(): SshHostPreset[] {
  const configPath = resolve(homedir(), ".ssh", "config");
  let content: string;
  try {
    content = readFileSync(configPath, "utf-8");
  } catch {
    return [];
  }

  return parseSshConfigContent(content);
}

export function parseSshConfigContent(content: string): SshHostPreset[] {
  const hosts: ParsedHost[] = [];
  let current: ParsedHost | null = null;

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = line.match(/^(\w+)\s+(.+)$/);
    if (!match) continue;

    const [, key, value] = match;
    const keyLower = key.toLowerCase();

    if (keyLower === "host") {
      const name = value
        .split(/\s+/)
        .find((name) => !name.includes("*") && !name.includes("?"));
      current = name ? { name } : null;
      if (current) hosts.push(current);
    } else if (current) {
      if (keyLower === "hostname") current.hostname = value;
      else if (keyLower === "port") current.port = value;
      else if (keyLower === "user") current.user = value;
      else if (keyLower === "identityfile") {
        current.identityFile = value.replace(/^~/, homedir());
      }
    }
  }

  return hosts
    .filter((h) => h.hostname)
    .map((h) => ({
      name: h.name,
      host: h.hostname!,
      port: parseInt(h.port ?? "22", 10),
      username: h.user,
      identityFile: h.identityFile,
      defaultPath: "~/",
    }));
}
