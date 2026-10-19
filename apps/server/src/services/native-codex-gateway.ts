import { constants } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import { request } from "node:http";
import { isAbsolute, join, parse, resolve } from "node:path";
import {
  composeContextText,
  validNativeInputMention,
} from "@agent-orchestrator/shared";

const MAX_RECORD_BYTES = 64 * 1024;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_BROKER_AUTH_BYTES = 4096;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_SEND_BODY_BYTES = 1024 * 1024;
export interface NativeCodexStatus {
  available: boolean;
  resumeAvailable: boolean;
  sendAvailable: boolean;
  reason?: string;
  iframeUrl?: string;
  extensionVersion?: string;
  fixtures?: Array<{ id: string; label: string }>;
  newChatWindowIds?: string[];
}
export interface NativeCodexSendRequest {
  threadId: string;
  column: number;
  cwd: string;
  submissionId: string;
  text: string;
  images: string[];
  contexts: Array<Record<string, unknown>>;
  mentions: Array<{ name: string; path: string }>;
}
export interface NativeCodexRuntime {
  refreshScope?:NativeRefreshScope;
  upstream: URL;
  projectDir: string;
  runtimeRoot?: string;
  extensionVersion?: string;
  fixtures: Array<{ id: string; label: string }>;
  newChatWindowIds?: string[];
  brokerPort?: number;
  brokerAuthFile?: string;
}
export interface NativeRefreshScope {domain:string;generation:string;pid:number;startTicks:string}
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

function newChatWindowIds(
  record: Record<string, unknown>,
): string[] | undefined {
  const value = record.newChatWindowIds;
  if (
    record.panelMode !== "new-chats" ||
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > 2 ||
    value.some((id) => typeof id !== "string" || !UUID.test(id)) ||
    new Set(value).size !== value.length
  )
    return undefined;
  return value.slice() as string[];
}

export function validateNativeCodexWindowRestore(
  value: unknown,
  allowedWindowIds: readonly string[],
): { windowId: string; threadId: string; column: number } {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== "column,threadId,windowId"
  )
    throw new Error("invalid native Codex restore request");
  const input = value as Record<string, unknown>;
  if (
    typeof input.windowId !== "string" ||
    !UUID.test(input.windowId) ||
    !allowedWindowIds.includes(input.windowId) ||
    typeof input.threadId !== "string" ||
    !UUID.test(input.threadId) ||
    !Number.isInteger(input.column) ||
    (input.column as number) < 1 ||
    (input.column as number) > allowedWindowIds.length ||
    allowedWindowIds[(input.column as number) - 1] !== input.windowId
  )
    throw new Error("native Codex restore target is not allowlisted");
  return {
    windowId: input.windowId,
    threadId: input.threadId,
    column: input.column as number,
  };
}

export function validateNativeCodexResume(value: unknown): {
  threadId: string;
  column: number;
} {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== "column,threadId"
  )
    throw new Error("invalid native Codex resume request");
  const input = value as Record<string, unknown>;
  if (
    typeof input.threadId !== "string" ||
    !UUID.test(input.threadId) ||
    !Number.isInteger(input.column) ||
    (input.column as number) < 1 ||
    (input.column as number) > 3
  )
    throw new Error("native Codex resume target is invalid");
  return { threadId: input.threadId, column: input.column as number };
}

export function validateNativeCodexResumeBeside(value: unknown): {
  threadId: string;
  instanceId: string;
} {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== "instanceId,threadId" ||
    !UUID.test((value as { threadId?: string }).threadId ?? "") ||
    !UUID.test((value as { instanceId?: string }).instanceId ?? "")
  )
    throw new Error("invalid native Codex multiwindow resume request");
  return { threadId: (value as { threadId: string }).threadId, instanceId: (value as { instanceId: string }).instanceId };
}

export function validateNativeCodexNewBeside(value: unknown): { windowId: string; instanceId: string } {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== "instanceId,windowId" ||
    typeof (value as { windowId?: unknown }).windowId !== "string" ||
    !UUID.test((value as { windowId: string }).windowId) ||
    !UUID.test((value as { instanceId?: string }).instanceId ?? ""))
    throw new Error("invalid native Codex new-chat request");
  return { windowId: (value as { windowId: string }).windowId, instanceId: (value as { instanceId: string }).instanceId };
}

export function validateNativeCodexFocus(value: unknown): { kind: "new" | "thread"; targetId: string; instanceId: string } {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== "instanceId,kind,targetId")
    throw new Error("invalid native Codex focus request");
  const input = value as Record<string, unknown>;
  if ((input.kind !== "new" && input.kind !== "thread") ||
    typeof input.targetId !== "string" || !UUID.test(input.targetId) ||
    typeof input.instanceId !== "string" || !UUID.test(input.instanceId))
    throw new Error("invalid native Codex focus target");
  return { kind: input.kind, targetId: input.targetId, instanceId: input.instanceId };
}

export function validateNativeCodexTheme(value: unknown): { instanceId: string; theme: "light" | "dark" } {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== "instanceId,theme")
    throw new Error("invalid native Codex theme request");
  const input = value as Record<string, unknown>;
  if (typeof input.instanceId !== "string" || !UUID.test(input.instanceId) ||
    (input.theme !== "light" && input.theme !== "dark"))
    throw new Error("native Codex theme must be light or dark");
  return { instanceId: input.instanceId, theme: input.theme };
}

export function validateNativeCodexReleaseInstance(value: unknown): { oldInstanceId: string; currentInstanceId: string } {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== "currentInstanceId,oldInstanceId")
    throw new Error("invalid native Codex host handoff");
  const input = value as Record<string, unknown>;
  if (typeof input.oldInstanceId !== "string" || !UUID.test(input.oldInstanceId) ||
    typeof input.currentInstanceId !== "string" || !UUID.test(input.currentInstanceId) ||
    input.oldInstanceId === input.currentInstanceId)
    throw new Error("native Codex host handoff requires two distinct instances");
  return { oldInstanceId: input.oldInstanceId, currentInstanceId: input.currentInstanceId };
}

function nativeSendRequest(value: unknown): NativeCodexSendRequest {
  const invalid = (): never => {
    throw new Error("invalid native Codex send request");
  };
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).sort().join(",") !==
      "column,contexts,cwd,images,mentions,submissionId,text,threadId" ||
    typeof input.threadId !== "string" ||
    !UUID.test(input.threadId) ||
    typeof input.submissionId !== "string" ||
    !UUID.test(input.submissionId) ||
    !Number.isInteger(input.column) ||
    Number(input.column) < 1 ||
    Number(input.column) > 3 ||
    typeof input.cwd !== "string" ||
    !isAbsolute(input.cwd) ||
    input.cwd.length > 4096 ||
    /[\x00-\x1f\x7f]/.test(input.cwd) ||
    typeof input.text !== "string" ||
    input.text.length > 200_000 ||
    input.text.includes("\0") ||
    !Array.isArray(input.images) ||
    input.images.length > 8 ||
    input.images.some(
      (path) =>
        typeof path !== "string" ||
        !isAbsolute(path) ||
        path.length > 4096 ||
        /[\x00-\x1f\x7f]/.test(path),
    ) ||
    !Array.isArray(input.contexts) ||
    input.contexts.length > 32 ||
    !Array.isArray(input.mentions) ||
    input.mentions.length > 32 ||
    input.mentions.some((mention) => !validNativeInputMention(mention))
  )
    invalid();
  const contexts = input.contexts as Array<Record<string, unknown>>;
  const seen = new Set<string>();
  for (const context of contexts) {
    if (
      !context ||
      typeof context !== "object" ||
      Array.isArray(context) ||
      Object.keys(context).some(
        (key) =>
          ![
            "id",
            "kind",
            "name",
            "text",
            "path",
            "range",
            "sourceThreadId",
            "sourceItemId",
          ].includes(key),
      ) ||
      typeof context.id !== "string" ||
      !context.id ||
      context.id.length > 160 ||
      /[\x00-\x1f\x7f]/.test(context.id) ||
      seen.has(context.id) ||
      !["paste", "quote", "file"].includes(String(context.kind)) ||
      typeof context.name !== "string" ||
      context.name.length > 512 ||
      /[\x00-\x1f\x7f]/.test(context.name) ||
      typeof context.text !== "string" ||
      context.text.length > 200_000 ||
      context.text.includes("\0") ||
      (context.path !== undefined &&
        (typeof context.path !== "string" ||
          !isAbsolute(context.path) ||
          context.path.length > 4096 ||
          /[\x00-\x1f\x7f]/.test(context.path)))
    )
      invalid();
    seen.add(context.id as string);
    for (const field of ["sourceThreadId", "sourceItemId"])
      if (
        context[field] !== undefined &&
        (typeof context[field] !== "string" ||
          !context[field] ||
          context[field].length > 160 ||
          /[\x00-\x1f\x7f]/.test(context[field] as string))
      )
        invalid();
    if (context.range !== undefined) {
      const range = context.range as Record<string, unknown>;
      if (
        !range ||
        typeof range !== "object" ||
        Array.isArray(range) ||
        Object.keys(range).sort().join(",") !== "end,start" ||
        !Number.isSafeInteger(range.start) ||
        !Number.isSafeInteger(range.end) ||
        Number(range.start) < 1 ||
        Number(range.end) < Number(range.start)
      )
        invalid();
    }
  }
  const images = input.images as string[];
  const mentions = input.mentions as Array<{ name: string; path: string }>;
  const text = composeContextText(input.text as string, contexts as never);
  if (
    text.length > 200_000 ||
    (!text.trim() && images.length === 0 && mentions.length === 0)
  )
    invalid();
  return structuredClone(input) as unknown as NativeCodexSendRequest;
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
      const windows = newChatWindowIds(record);
      const brokerPort =
        Number.isInteger(record.brokerPort) &&
        (record.brokerPort as number) >= 1024 &&
        (record.brokerPort as number) <= 65535 &&
        record.brokerPort !== record.port
          ? (record.brokerPort as number)
          : undefined;
      const brokerAuthFile =
        typeof record.brokerAuthFile === "string" &&
        record.brokerAuthFile.length <= 4096 &&
        isAbsolute(record.brokerAuthFile) &&
        resolve(record.brokerAuthFile) === record.brokerAuthFile &&
        !/[\u0000-\u001f\u007f]/.test(record.brokerAuthFile)
          ? record.brokerAuthFile
          : undefined;
      const runtimeRoot = typeof record.runtimeRoot === "string" &&
        record.runtimeRoot.length <= 4096 && isAbsolute(record.runtimeRoot) &&
        resolve(record.runtimeRoot) === record.runtimeRoot &&
        !/[\u0000-\u001f\u007f]/.test(record.runtimeRoot)
          ? record.runtimeRoot : undefined;
      const candidate=record.refreshConnection as Partial<NativeRefreshScope>|undefined;
      const refreshScope=candidate&&typeof candidate==="object"&&!Array.isArray(candidate)&&
        typeof candidate.domain==="string"&&UUID.test(candidate.domain)&&typeof candidate.generation==="string"&&UUID.test(candidate.generation)&&
        Number.isSafeInteger(candidate.pid)&&(candidate.pid as number)>1&&typeof candidate.startTicks==="string"&&/^(?:0|[1-9][0-9]{0,19})$/.test(candidate.startTicks)
        ?{domain:candidate.domain,generation:candidate.generation,pid:candidate.pid as number,startTicks:candidate.startTicks}:undefined;
      return {
        upstream,
        projectDir,
        ...(runtimeRoot ? { runtimeRoot } : {}),
        ...(refreshScope?{refreshScope}:{}),
        fixtures: fixtures(record.threads),
        ...(extensionVersion ? { extensionVersion } : {}),
        ...(windows ? { newChatWindowIds: windows } : {}),
        ...(brokerPort ? { brokerPort } : {}),
        ...(brokerAuthFile ? { brokerAuthFile } : {}),
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
        resumeAvailable: false,
        sendAvailable: false,
        reason: "Codex 宿主暂未配置。",
      };
    if (!(await probe(runtime.upstream)))
      return {
        available: false,
        resumeAvailable: false,
        sendAvailable: false,
        reason: "Codex 宿主暂不可用。",
      };
    const capabilities = await this.companionCapabilities(runtime);
    return {
      available: true,
      resumeAvailable: capabilities.resumeAvailable,
      sendAvailable: capabilities.sendAvailable,
      iframeUrl: `/native-codex/?folder=${encodeURIComponent(runtime.projectDir)}`,
      ...(runtime.extensionVersion
        ? { extensionVersion: runtime.extensionVersion }
        : {}),
      fixtures: runtime.fixtures,
      ...(runtime.newChatWindowIds
        ? { newChatWindowIds: runtime.newChatWindowIds }
        : {}),
    };
  }

  private async companionCapabilities(
    runtime: NativeCodexRuntime,
  ): Promise<{ resumeAvailable: boolean; sendAvailable: boolean }> {
    if (!runtime.brokerPort || !runtime.brokerAuthFile)
      return { resumeAvailable: false, sendAvailable: false };
    try {
      const auth = await readBoundedJson(
        runtime.brokerAuthFile,
        MAX_BROKER_AUTH_BYTES,
        true,
      );
      if (
        auth.port !== runtime.brokerPort ||
        typeof auth.token !== "string" ||
        !/^[0-9a-f]{64}$/.test(auth.token)
      )
        return { resumeAvailable: false, sendAvailable: false };
      return await new Promise<{
        resumeAvailable: boolean;
        sendAvailable: boolean;
      }>((resolveReady) => {
        let settled = false;
        const finish = (capabilities: {
          resumeAvailable: boolean;
          sendAvailable: boolean;
        }) => {
          if (settled) return;
          settled = true;
          resolveReady(capabilities);
        };
        const outbound = request(
          {
            hostname: "127.0.0.1",
            port: runtime.brokerPort,
            path: "/status",
            method: "GET",
            timeout: 1500,
            headers: { authorization: `Bearer ${auth.token}` },
          },
          (response) => {
            let responseBody = "";
            let size = 0;
            response.on("data", (chunk: Buffer) => {
              size += chunk.length;
              if (size <= MAX_BROKER_AUTH_BYTES)
                responseBody += chunk.toString("utf8");
              else {
                finish({ resumeAvailable: false, sendAvailable: false });
                response.destroy();
              }
            });
            response.on("end", () => {
              if (response.statusCode !== 200 || size > MAX_BROKER_AUTH_BYTES) {
                finish({ resumeAvailable: false, sendAvailable: false });
                return;
              }
              try {
                const status: unknown = JSON.parse(responseBody);
                const value = status as {
                  companionActive?: unknown;
                  officialActive?: unknown;
                  sendAvailable?: unknown;
                  broker?: { enabled?: unknown };
                };
                const ready =
                  value?.companionActive === true &&
                  value.officialActive === true &&
                  value.broker?.enabled === true;
                finish({
                  resumeAvailable: ready,
                  sendAvailable: ready && value.sendAvailable === true,
                });
              } catch {
                finish({ resumeAvailable: false, sendAvailable: false });
              }
            });
            response.on("error", () =>
              finish({ resumeAvailable: false, sendAvailable: false }),
            );
            // destroy() without an error can emit only aborted/close, never end.
            response.once("aborted", () =>
              finish({ resumeAvailable: false, sendAvailable: false }),
            );
            response.once("close", () =>
              finish({ resumeAvailable: false, sendAvailable: false }),
            );
          },
        );
        outbound.on("timeout", () => outbound.destroy());
        outbound.on("error", () =>
          finish({ resumeAvailable: false, sendAvailable: false }),
        );
        outbound.end();
      });
    } catch {
      return { resumeAvailable: false, sendAvailable: false };
    }
  }

  async restoreNewChatThread(value: unknown): Promise<number> {
    const runtime = await this.runtime();
    if (!runtime?.newChatWindowIds || !runtime.brokerPort || !runtime.brokerAuthFile)
      return 503;
    let body: ReturnType<typeof validateNativeCodexWindowRestore>;
    let instanceId: string | undefined;
    try {
      if (value && typeof value === "object" && !Array.isArray(value) && "instanceId" in value) {
        const input = value as Record<string, unknown>;
        if (Object.keys(input).sort().join(",") !== "column,instanceId,threadId,windowId" ||
          typeof input.instanceId !== "string" || !UUID.test(input.instanceId)) throw new Error("invalid host instance");
        instanceId = input.instanceId;
        body = validateNativeCodexWindowRestore({ windowId: input.windowId, threadId: input.threadId, column: input.column }, runtime.newChatWindowIds);
      } else {
        body = validateNativeCodexWindowRestore(value, runtime.newChatWindowIds);
      }
    } catch {
      return 400;
    }
    return (await this.callBroker(runtime, "/restore", body, "restored", instanceId)).status;
  }

  async resumeThreadInNativeWindow(value: unknown): Promise<number> {
    const runtime = await this.runtime();
    if (!runtime?.brokerPort || !runtime.brokerAuthFile) return 503;
    let body: ReturnType<typeof validateNativeCodexResume>;
    try {
      body = validateNativeCodexResume(value);
    } catch {
      return 400;
    }
    return (await this.callBroker(runtime, "/resume", body, "opened")).status;
  }

  async resumeThreadBeside(value: unknown): Promise<{ status: number; column?: number }> {
    const runtime = await this.runtime();
    if (!runtime?.brokerPort || !runtime.brokerAuthFile) return { status: 503 };
    let body: ReturnType<typeof validateNativeCodexResumeBeside>;
    try {
      body = validateNativeCodexResumeBeside(value);
    } catch {
      return { status: 400 };
    }
    return this.callBroker(runtime, "/resume-beside", { threadId: body.threadId }, "opened", body.instanceId);
  }

  async openNewChatBeside(value: unknown): Promise<{ status: number; column?: number }> {
    const runtime = await this.runtime();
    if (!runtime?.brokerPort || !runtime.brokerAuthFile) return { status: 503 };
    let body: ReturnType<typeof validateNativeCodexNewBeside>;
    try { body = validateNativeCodexNewBeside(value); }
    catch { return { status: 400 }; }
    return this.callBroker(runtime, "/new-beside", { windowId: body.windowId }, "opened", body.instanceId);
  }

  async applyNativeTheme(value: unknown): Promise<{ status: number }> {
    const runtime = await this.runtime();
    if (!runtime?.brokerPort || !runtime.brokerAuthFile) return { status: 503 };
    let body: ReturnType<typeof validateNativeCodexTheme>;
    try { body = validateNativeCodexTheme(value); }
    catch { return { status: 400 }; }
    return this.callBroker(runtime, "/theme", { theme: body.theme }, "applied", body.instanceId);
  }

  async focusNativeWindow(value: unknown): Promise<{ status: number; column?: number }> {
    const runtime = await this.runtime();
    if (!runtime?.brokerPort || !runtime.brokerAuthFile) return { status: 503 };
    let body: ReturnType<typeof validateNativeCodexFocus>;
    try { body = validateNativeCodexFocus(value); }
    catch { return { status: 400 }; }
    return this.callBroker(runtime, "/focus", { kind: body.kind, targetId: body.targetId }, "focused", body.instanceId);
  }

  async releasePreviousInstance(value: unknown): Promise<{ status: number }> {
    let body: ReturnType<typeof validateNativeCodexReleaseInstance>;
    try { body = validateNativeCodexReleaseInstance(value); }
    catch { return { status: 400 }; }
    const runtime = await this.runtime();
    if (!runtime?.runtimeRoot || !runtime.brokerPort || !runtime.brokerAuthFile) return { status: 503 };
    if (!(await this.instanceActive(runtime, body.currentInstanceId))) return { status: 409 };
    return this.callBroker(runtime, "/release", { currentInstanceId: body.currentInstanceId }, "released", body.oldInstanceId);
  }

  async instanceStatus(value: unknown): Promise<{ status: number; active?: boolean }> {
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).join(",") !== "instanceId" ||
      typeof (value as { instanceId?: unknown }).instanceId !== "string" || !UUID.test((value as { instanceId: string }).instanceId))
      return { status: 400 };
    const runtime = await this.runtime();
    if (!runtime?.runtimeRoot) return { status: 503 };
    return { status: 200, active: await this.instanceActive(runtime, (value as { instanceId: string }).instanceId) };
  }

  private async instanceActive(runtime: NativeCodexRuntime, instanceId: string): Promise<boolean> {
    try {
      const auth = await readBoundedJson(join(runtime.runtimeRoot!, `companion-session-${instanceId}.json`), MAX_BROKER_AUTH_BYTES, true);
      if (auth.instanceId !== instanceId || !Number.isInteger(auth.port) || (auth.port as number) < 1024 || (auth.port as number) > 65535 ||
        typeof auth.token !== "string" || !/^[0-9a-f]{64}$/.test(auth.token)) return false;
      return await new Promise<boolean>((resolveActive) => {
        let settled = false;
        const finish = (active: boolean) => { if (!settled) { settled = true; resolveActive(active); } };
        const outbound = request({ hostname: "127.0.0.1", port: auth.port as number, path: "/status", method: "GET", timeout: 1500,
          headers: { authorization: `Bearer ${auth.token}` } }, (response) => {
          let body = ""; let size = 0;
          response.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size <= MAX_RECORD_BYTES) body += chunk.toString("utf8");
            else {
              finish(false);
              response.destroy();
            }
          });
          response.on("end", () => {
            if (response.statusCode !== 200 || size > MAX_RECORD_BYTES) return finish(false);
            try { const result = JSON.parse(body) as { instanceBroker?: { enabled?: unknown; instanceId?: unknown } };
              finish(result?.instanceBroker?.enabled === true && result.instanceBroker.instanceId === instanceId);
            } catch { finish(false); }
          });
          response.on("error", () => finish(false));
          response.once("aborted", () => finish(false));
          response.once("close", () => finish(false));
        });
        outbound.on("timeout", () => outbound.destroy());
        outbound.on("error", () => finish(false));
        outbound.end();
      });
    } catch { return false; }
  }

  async sendToNativeThread(
    value: unknown,
  ): Promise<{ status: number; turnId?: string }> {
    const runtime = await this.runtime();
    if (!runtime?.brokerPort || !runtime.brokerAuthFile) return { status: 503 };
    let body: NativeCodexSendRequest;
    try {
      body = nativeSendRequest(value);
    } catch {
      return { status: 400 };
    }
    const payload = JSON.stringify(body);
    if (Buffer.byteLength(payload) > MAX_SEND_BODY_BYTES)
      return { status: 413 };
    return this.callSendBroker(runtime, payload);
  }

  private async callSendBroker(
    runtime: NativeCodexRuntime,
    payload: string,
  ): Promise<{ status: number; turnId?: string }> {
    try {
      const auth = await readBoundedJson(
        runtime.brokerAuthFile!,
        MAX_BROKER_AUTH_BYTES,
        true,
      );
      if (
        auth.port !== runtime.brokerPort ||
        typeof auth.token !== "string" ||
        !/^[0-9a-f]{64}$/.test(auth.token)
      )
        return { status: 503 };
      return await new Promise((resolveResult) => {
        const outbound = request(
          {
            hostname: "127.0.0.1",
            port: runtime.brokerPort,
            path: "/send",
            method: "POST",
            timeout: 25_000,
            headers: {
              authorization: `Bearer ${auth.token}`,
              "content-type": "application/json",
              "content-length": Buffer.byteLength(payload),
            },
          },
          (response) => {
            let responseBody = "";
            let size = 0;
            response.on("data", (chunk: Buffer) => {
              size += chunk.length;
              if (size <= MAX_BROKER_AUTH_BYTES)
                responseBody += chunk.toString("utf8");
              else {
                resolveResult({ status: 502 });
                response.destroy();
              }
            });
            response.on("end", () => {
              if (size > MAX_BROKER_AUTH_BYTES) {
                resolveResult({ status: 502 });
                return;
              }
              if (response.statusCode !== 200) {
                resolveResult({
                  status:
                    response.statusCode === 400 || response.statusCode === 409
                      ? response.statusCode
                      : response.statusCode === 413
                        ? 413
                        : 503,
                });
                return;
              }
              try {
                const result: unknown = JSON.parse(responseBody);
                const turnId = (result as { turnId?: unknown })?.turnId;
                resolveResult(
                  result &&
                    typeof result === "object" &&
                    (result as { accepted?: unknown }).accepted === true &&
                    typeof turnId === "string" &&
                    UUID.test(turnId)
                    ? { status: 202, turnId }
                    : { status: 502 },
                );
              } catch {
                resolveResult({ status: 502 });
              }
            });
            response.on("error", () => resolveResult({ status: 502 }));
            response.once("aborted", () => resolveResult({ status: 502 }));
            response.once("close", () => resolveResult({ status: 502 }));
          },
        );
        outbound.on("timeout", () => outbound.destroy());
        outbound.on("error", () => resolveResult({ status: 503 }));
        outbound.end(payload);
      });
    } catch {
      return { status: 503 };
    }
  }

  private async callBroker(
    runtime: NativeCodexRuntime,
    path: "/restore" | "/resume" | "/resume-beside" | "/new-beside" | "/focus" | "/release" | "/theme",
    body: object,
    successField: "restored" | "opened" | "focused" | "released" | "applied",
    instanceId?: string,
  ): Promise<{ status: number; column?: number }> {
    try {
      if (instanceId && (!runtime.runtimeRoot || !UUID.test(instanceId))) return { status: 503 };
      const auth = await readBoundedJson(
        instanceId ? join(runtime.runtimeRoot!, `companion-session-${instanceId}.json`) : runtime.brokerAuthFile!,
        MAX_BROKER_AUTH_BYTES,
        true,
      );
      if (
        (instanceId ? auth.instanceId !== instanceId : auth.port !== runtime.brokerPort) ||
        !Number.isInteger(auth.port) || (auth.port as number) < 1024 || (auth.port as number) > 65535 ||
        typeof auth.token !== "string" ||
        !/^[0-9a-f]{64}$/.test(auth.token)
      )
        return { status: 503 };
      const payload = JSON.stringify(body);
      return await new Promise<{ status: number; column?: number }>((resolveStatus) => {
        const outbound = request(
          {
            hostname: "127.0.0.1",
            port: auth.port as number,
            path,
            method: "POST",
            timeout: 25_000,
            headers: {
              authorization: `Bearer ${auth.token}`,
              "content-type": "application/json",
              "content-length": Buffer.byteLength(payload),
            },
          },
          (response) => {
            let responseBody = "";
            let size = 0;
            response.on("data", (chunk: Buffer) => {
              size += chunk.length;
              if (size <= MAX_BROKER_AUTH_BYTES)
                responseBody += chunk.toString("utf8");
              else {
                resolveStatus({ status: 503 });
                response.destroy();
              }
            });
            response.on("end", () => {
              if (response.statusCode !== 200 || size > MAX_BROKER_AUTH_BYTES) {
                resolveStatus({ status:
                  response.statusCode === 400 || response.statusCode === 409
                    ? 409
                    : response.statusCode === 504
                      ? 504
                      : 503,
                });
                return;
              }
              try {
                const result: unknown = JSON.parse(responseBody);
                const success = result &&
                    typeof result === "object" &&
                    (result as Record<string, unknown>)[successField] === true;
                const column = (result as { column?: unknown })?.column;
                resolveStatus(success
                  ? { status: 202, ...(Number.isInteger(column) && (column as number) >= 1 ? { column: column as number } : {}) }
                  : { status: 503 });
              } catch {
                resolveStatus({ status: 503 });
              }
            });
            response.on("error", () => resolveStatus({ status: 503 }));
            response.once("aborted", () => resolveStatus({ status: 503 }));
            response.once("close", () => resolveStatus({ status: 503 }));
          },
        );
        outbound.on("timeout", () => { resolveStatus({ status: 504 }); outbound.destroy(); });
        outbound.on("error", () => resolveStatus({ status: 503 }));
        outbound.end(payload);
      });
    } catch {
      return { status: 503 };
    }
  }
}
