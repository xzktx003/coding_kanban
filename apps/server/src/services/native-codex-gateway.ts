import { constants } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import { request } from "node:http";
import { isAbsolute, join, parse, resolve } from "node:path";

const MAX_RECORD_BYTES = 64 * 1024;
const MAX_MANIFEST_BYTES = 1024 * 1024;
export interface NativeCodexStatus {
  available: boolean;
  reason?: string;
  iframeUrl?: string;
  extensionVersion?: string;
  fixtures?: Array<{ id: string; label: string }>;
}
export interface NativeCodexRuntime {
  upstream: URL;
  projectDir: string;
  extensionVersion?: string;
  fixtures: Array<{ id: string; label: string }>;
}
export interface NativeCodexConfiguration {
  upstreamUrl?: string;
  runtimeRecord?: string;
}

export function validateNativeCodexUpstream(input?: string): URL | null {
  // Check the spelling before URL normalization (127.1/integer IPs normalize to loopback).
  const match = input?.match(
    /^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):([1-9]\d{0,4})\/?$/,
  );
  if (!match || Number(match[2]) > 65535) return null;
  try {
    return new URL(input!);
  } catch {
    return null;
  }
}

async function assertNoSymlinks(path: string): Promise<void> {
  if (!isAbsolute(path) || resolve(path) !== path || path.includes("\0"))
    throw new Error("invalid path");
  let current = parse(path).root;
  for (const part of path.slice(current.length).split("/").filter(Boolean)) {
    current = join(current, part);
    if ((await lstat(current)).isSymbolicLink())
      throw new Error("symlink rejected");
  }
}

async function readBoundedJson(
  path: string,
  maxBytes: number,
  privateRecord = false,
): Promise<Record<string, unknown>> {
  await assertNoSymlinks(path);
  const file = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const info = await file.stat();
    if (
      !info.isFile() ||
      info.size > maxBytes ||
      (privateRecord &&
        (info.uid !== process.getuid?.() || (info.mode & 0o7777) !== 0o600))
    )
      throw new Error("unsafe file");
    const buffer = Buffer.alloc(maxBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const result = await file.read(
        buffer,
        length,
        buffer.length - length,
        null,
      );
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    if (length > maxBytes) throw new Error("file too large");
    const value: unknown = JSON.parse(
      buffer.subarray(0, length).toString("utf8"),
    );
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("invalid JSON record");
    return value as Record<string, unknown>;
  } finally {
    await file.close();
  }
}

function version(value: unknown): string | undefined {
  return typeof value === "string" &&
    /^\d+(?:\.\d+){1,3}(?:[-+][a-zA-Z0-9.-]+)?$/.test(value) &&
    value.length <= 80
    ? value
    : undefined;
}

async function installedVersion(
  extensionsDir: unknown,
): Promise<string | undefined> {
  if (typeof extensionsDir !== "string") return undefined;
  try {
    await assertNoSymlinks(extensionsDir);
    const entries = await readdir(extensionsDir, { withFileTypes: true });
    if (entries.length > 512) return undefined;
    const found: string[] = [];
    for (const entry of entries) {
      if (
        !entry.isDirectory() ||
        !/^openai\.chatgpt-[a-zA-Z0-9.+-]+$/.test(entry.name)
      )
        continue;
      const manifest = await readBoundedJson(
        join(extensionsDir, entry.name, "package.json"),
        MAX_MANIFEST_BYTES,
      );
      const actualVersion = version(manifest.version);
      if (
        manifest.publisher === "openai" &&
        manifest.name === "chatgpt" &&
        actualVersion
      )
        found.push(actualVersion);
    }
    // Multiple distinct installed versions are ambiguous; do not guess the active version.
    const unique = [...new Set(found)];
    return unique.length === 1 ? unique[0] : undefined;
  } catch {
    return undefined;
  }
}

function fixtures(value: unknown): NativeCodexRuntime["fixtures"] {
  if (!Array.isArray(value) || value.length > 16)
    throw new Error("invalid fixtures");
  const result = value.map((item, index) => {
    const row = typeof item === "string" ? { id: item } : item;
    if (
      !row ||
      typeof row !== "object" ||
      typeof row.id !== "string" ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(row.id)
    )
      throw new Error("invalid fixture id");
    const label =
      typeof row.label === "string"
        ? row.label
        : typeof row.title === "string"
          ? row.title
          : `Fixture ${index + 1}`;
    return {
      id: row.id,
      label: label.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 160),
    };
  });
  if (new Set(result.map((row) => row.id)).size !== result.length)
    throw new Error("duplicate fixtures");
  return result;
}

async function probe(upstream: URL): Promise<boolean> {
  return new Promise((resolveProbe) => {
    const req = request(
      new URL("/healthz", upstream),
      { method: "GET", timeout: 1500 },
      (response) => {
        // Consume without retaining response bodies or following host redirects.
        response.destroy();
        resolveProbe(response.statusCode === 200);
      },
    );
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolveProbe(false));
    req.end();
  });
}

export class NativeCodexGateway {
  constructor(
    private readonly configuration: () => NativeCodexConfiguration = () => ({
      upstreamUrl: process.env.NATIVE_CODEX_UPSTREAM_URL,
      runtimeRecord: process.env.NATIVE_CODEX_RUNTIME_RECORD,
    }),
  ) {}

  async runtime(): Promise<NativeCodexRuntime | null> {
    const configuration = this.configuration();
    const upstream = validateNativeCodexUpstream(configuration.upstreamUrl);
    if (!upstream || !configuration.runtimeRecord) return null;
    try {
      const record = await readBoundedJson(
        configuration.runtimeRecord,
        MAX_RECORD_BYTES,
        true,
      );
      if (
        record.protocol !== "http" ||
        !Number.isInteger(record.port) ||
        record.port !== Number(upstream.port || "80")
      )
        return null;
      const projectDir = record.projectDir;
      if (
        typeof projectDir !== "string" ||
        projectDir.length > 4096 ||
        !isAbsolute(projectDir) ||
        resolve(projectDir) !== projectDir ||
        /[\u0000-\u001f\u007f]/.test(projectDir)
      )
        return null;
      const extensionVersion =
        version(record.extensionVersion) ??
        (await installedVersion(record.extensionsDir));
      return {
        upstream,
        projectDir,
        fixtures: fixtures(record.threads),
        ...(extensionVersion ? { extensionVersion } : {}),
      };
    } catch {
      return null;
    }
  }

  async status(): Promise<NativeCodexStatus> {
    const runtime = await this.runtime();
    if (!runtime)
      return {
        available: false,
        reason: "Codex 宿主暂未配置。",
      };
    if (!(await probe(runtime.upstream)))
      return { available: false, reason: "Codex 宿主暂不可用。" };
    return {
      available: true,
      iframeUrl: `/native-codex/?folder=${encodeURIComponent(runtime.projectDir)}`,
      ...(runtime.extensionVersion
        ? { extensionVersion: runtime.extensionVersion }
        : {}),
      fixtures: runtime.fixtures,
    };
  }
}
