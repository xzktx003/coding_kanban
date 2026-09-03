import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import type {
  DirectorySuggestionsInput,
  DirectorySuggestionsResponse,
  SshTarget,
} from "@agent-orchestrator/shared";

import { quoteForPosixShell } from "./runtime-compat.js";
import { buildSshArgs } from "./ssh-command.js";

const DIRECTORY_SUGGESTIONS_READY = "__DIRECTORY_SUGGESTIONS_READY__";
const MAX_DIRECTORY_SUGGESTIONS = 200;

function execRemote(sshTarget: SshTarget, command: string): string {
  try {
    const output = execFileSync(
      "ssh",
      buildSshArgs(sshTarget, {
        batchMode: true,
        connectTimeoutSeconds: 3,
        remoteCommand: command,
      }),
      {
        encoding: "utf8",
        timeout: 5_000,
      } satisfies ExecFileSyncOptions,
    );
    return typeof output === "string" ? output.trim() : "";
  } catch {
    return "";
  }
}

function resolveLocalPrefix(prefix: string): string {
  if (!prefix.trim()) {
    return homedir();
  }

  if (!prefix.startsWith("~")) {
    return prefix;
  }

  if (prefix === "~") {
    return homedir();
  }

  if (prefix.startsWith("~/")) {
    return path.join(homedir(), prefix.slice(2));
  }

  return prefix;
}

function splitSuggestionQuery(prefix: string): {
  baseDir: string;
  partialName: string;
} {
  const resolvedPrefix = resolveLocalPrefix(prefix);

  if (existsSync(resolvedPrefix)) {
    try {
      if (statSync(resolvedPrefix).isDirectory()) {
        return {
          baseDir: resolvedPrefix,
          partialName: "",
        };
      }
    } catch {
      // fall through to dirname matching
    }
  }

  return {
    baseDir: path.dirname(resolvedPrefix),
    partialName: path.basename(resolvedPrefix),
  };
}

function listLocalDirectorySuggestions(
  prefix: string,
): DirectorySuggestionsResponse {
  const { baseDir, partialName } = splitSuggestionQuery(prefix);
  if (!existsSync(baseDir)) {
    return { enabled: true, suggestions: [] };
  }

  let suggestions: string[];
  try {
    suggestions = readdirSync(baseDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => name.startsWith(partialName))
      .sort((left, right) => left.localeCompare(right))
      .slice(0, MAX_DIRECTORY_SUGGESTIONS)
      .map((name) => path.join(baseDir, name));
  } catch {
    suggestions = [];
  }

  return {
    enabled: true,
    suggestions,
  };
}

function buildRemoteSuggestionCommand(prefix: string): string {
  const effectivePrefix = prefix.trim() || "~/";
  const quotedPrefix = quoteForPosixShell(effectivePrefix);

  return [
    `prefix=${quotedPrefix}`,
    'if [ "${prefix#~}" != "$prefix" ]; then',
    '  resolved="$HOME${prefix#~}"',
    "else",
    '  resolved="$prefix"',
    "fi",
    'if [ -d "$resolved" ]; then',
    '  base_dir="$resolved"',
    '  partial=""',
    "else",
    '  base_dir=$(dirname "$resolved")',
    '  partial=$(basename "$resolved")',
    "fi",
    `printf '${DIRECTORY_SUGGESTIONS_READY}\n'`,
    'if [ -d "$base_dir" ]; then',
    '  find "$base_dir" -mindepth 1 -maxdepth 1 -type d -print 2>/dev/null |',
    "    LC_ALL=C sort |",
    "    while IFS= read -r candidate; do",
    "      name=${candidate##*/}",
    '      case "$name" in',
    '        "$partial"*) printf "%s\\n" "$candidate" ;;',
    "      esac",
    "    done |",
    `    head -n ${MAX_DIRECTORY_SUGGESTIONS}`,
    "fi",
  ].join("\n");
}

function listRemoteDirectorySuggestions(
  sshTarget: SshTarget,
  prefix: string,
): DirectorySuggestionsResponse {
  const output = execRemote(sshTarget, buildRemoteSuggestionCommand(prefix));
  if (!output.startsWith(DIRECTORY_SUGGESTIONS_READY)) {
    return {
      enabled: false,
      suggestions: [],
    };
  }

  const suggestions = output
    .split("\n")
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, MAX_DIRECTORY_SUGGESTIONS);

  return {
    enabled: true,
    suggestions,
  };
}

export function listDirectorySuggestions(
  input: DirectorySuggestionsInput,
): DirectorySuggestionsResponse {
  if (input.sshTarget) {
    return listRemoteDirectorySuggestions(input.sshTarget, input.prefix);
  }

  return listLocalDirectorySuggestions(input.prefix);
}
