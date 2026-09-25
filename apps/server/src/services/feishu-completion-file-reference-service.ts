import { lstat, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import {
  isContainedPath,
  isSafeAbsolutePath,
  isSensitivePath,
  resolveTrustedFileRoot,
} from "./feishu-trusted-local-file.js";

const MAX_REFERENCED_FILES = 5;
const MAX_LINK_TARGET_CHARACTERS = 2_048;
const MARKDOWN_FILE_LINK_PATTERN = /!?\[[^\]\n]+\]\((<[^>\n]+>|[^)\n]+)\)/gu;
const FENCE_PATTERN = /^\s{0,3}(`{3,}|~{3,})/u;
const URI_SCHEME_PATTERN =
  /^(?:[a-z][a-z0-9+.-]*:\/\/|mailto:|data:|javascript:)/iu;
const WINDOWS_PATH_PATTERN = /^[a-z]:[\\/]/iu;

export interface FeishuCompletionFileReference {
  path: string;
  line?: number;
}

export interface PreparedFeishuCompletionFileReferences {
  content: string;
  references: FeishuCompletionFileReference[];
}

interface ResolvedMarkdownFileLink {
  displayPath: string;
  reference?: FeishuCompletionFileReference;
}

function normalizeLinkTarget(rawTarget: string): string | null {
  const withoutAngles =
    rawTarget.startsWith("<") && rawTarget.endsWith(">")
      ? rawTarget.slice(1, -1)
      : rawTarget;
  if (
    !withoutAngles ||
    Array.from(withoutAngles).length > MAX_LINK_TARGET_CHARACTERS ||
    /[\u0000-\u001f\u007f]/u.test(withoutAngles)
  ) {
    return null;
  }
  try {
    return decodeURIComponent(withoutAngles);
  } catch {
    return null;
  }
}

function splitLocation(target: string): {
  filePath: string;
  line?: number;
} {
  const hashMatch = /^(.*)#L([1-9]\d*)$/u.exec(target);
  if (hashMatch) {
    return { filePath: hashMatch[1]!, line: Number(hashMatch[2]) };
  }
  const suffixMatch = /^(.*):([1-9]\d*)(?::[1-9]\d*)?$/u.exec(target);
  if (suffixMatch && !WINDOWS_PATH_PATTERN.test(target)) {
    return { filePath: suffixMatch[1]!, line: Number(suffixMatch[2]) };
  }
  return { filePath: target };
}

function inlineCode(value: string): string {
  return value.includes("`") ? value : `\`${value}\``;
}

function isInsideInlineCode(line: string, offset: number): boolean {
  const prefix = line.slice(0, offset);
  return (prefix.match(/(?<!\\)`/gu)?.length ?? 0) % 2 === 1;
}

export class FeishuCompletionFileReferenceService {
  constructor(private readonly options: { homeDirectory?: string } = {}) {}

  async prepare(input: {
    content: string;
    workingDirectory: string;
  }): Promise<PreparedFeishuCompletionFileReferences> {
    let rootStats;
    try {
      rootStats = await lstat(input.workingDirectory);
    } catch {
      return { content: input.content, references: [] };
    }
    if (
      !rootStats.isDirectory() ||
      rootStats.isSymbolicLink() ||
      !path.isAbsolute(input.workingDirectory) ||
      path.resolve(input.workingDirectory) ===
        path.parse(input.workingDirectory).root ||
      path.resolve(input.workingDirectory) ===
        path.resolve(this.options.homeDirectory ?? homedir())
    ) {
      return { content: input.content, references: [] };
    }

    const root = await realpath(input.workingDirectory);
    const trustRoot = await resolveTrustedFileRoot({
      workingDirectory: root,
      ...(this.options.homeDirectory
        ? { homeDirectory: this.options.homeDirectory }
        : {}),
    });
    const references: FeishuCompletionFileReference[] = [];
    const seen = new Set<string>();
    let activeFence: string | null = null;
    const lines = input.content.split("\n");
    const rewritten: string[] = [];

    for (const line of lines) {
      const fence = FENCE_PATTERN.exec(line)?.[1]?.[0] ?? null;
      if (fence) {
        activeFence =
          activeFence === null
            ? fence
            : activeFence === fence
              ? null
              : activeFence;
        rewritten.push(line);
        continue;
      }
      if (activeFence !== null) {
        rewritten.push(line);
        continue;
      }

      let cursor = 0;
      let nextLine = "";
      for (const match of line.matchAll(MARKDOWN_FILE_LINK_PATTERN)) {
        const offset = match.index;
        if (isInsideInlineCode(line, offset)) {
          continue;
        }
        nextLine += line.slice(cursor, offset);
        const resolved = await this.#resolveLink(root, trustRoot, match[1]!);
        if (!resolved) {
          nextLine += match[0];
        } else {
          nextLine += inlineCode(resolved.displayPath);
          if (resolved.reference && references.length < MAX_REFERENCED_FILES) {
            const key = resolved.reference.path;
            if (!seen.has(key)) {
              seen.add(key);
              references.push(resolved.reference);
            }
          }
        }
        cursor = offset + match[0].length;
      }
      nextLine += line.slice(cursor);
      rewritten.push(nextLine);
    }

    return { content: rewritten.join("\n"), references };
  }

  async #resolveLink(
    root: string,
    trustRoot: string | null,
    rawTarget: string,
  ): Promise<ResolvedMarkdownFileLink | null> {
    const target = normalizeLinkTarget(rawTarget);
    if (
      !target ||
      (URI_SCHEME_PATTERN.test(target) && !WINDOWS_PATH_PATTERN.test(target))
    ) {
      return null;
    }
    const location = splitLocation(target);
    const candidate = path.isAbsolute(location.filePath)
      ? path.resolve(location.filePath)
      : path.resolve(root, location.filePath);
    const insideWorkspace = isContainedPath(root, candidate);
    const insideTrust =
      trustRoot !== null && isContainedPath(trustRoot, candidate);
    if (!insideWorkspace && !insideTrust) {
      return null;
    }

    try {
      const stats = await lstat(candidate);
      if (!stats.isFile() || stats.isSymbolicLink()) {
        return null;
      }
      const resolved = await realpath(candidate);
      if (resolved !== candidate) {
        return null;
      }
      if (insideWorkspace) {
        if (!isContainedPath(root, resolved)) {
          return null;
        }
        const relativePath = path
          .relative(root, resolved)
          .split(path.sep)
          .join("/");
        const displayPath = `${relativePath}${location.line ? `:${location.line}` : ""}`;
        return {
          displayPath,
          ...(!isSensitivePath(relativePath)
            ? {
                reference: {
                  path: relativePath,
                  ...(location.line ? { line: location.line } : {}),
                },
              }
            : {}),
        };
      }
      if (!trustRoot || !isContainedPath(trustRoot, resolved)) {
        return null;
      }
      const displayPath = `${resolved}${location.line ? `:${location.line}` : ""}`;
      if (!isSafeAbsolutePath(resolved) || isSensitivePath(resolved)) {
        return isSensitivePath(resolved) ? { displayPath } : null;
      }
      return {
        displayPath,
        reference: {
          path: resolved,
          ...(location.line ? { line: location.line } : {}),
        },
      };
    } catch {
      return null;
    }
  }
}
