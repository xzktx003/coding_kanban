import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";
import { Script, createContext } from "node:vm";

// This exact original discovery/parser member is byte-identical in the reviewed
// Mac and Linux archives. No original SSH resolver, process launcher or transport
// is evaluated here: ssh -G can run Match exec even without a remote connection.
const ORIGINAL = "c23f63f8ff156b2a92a81ee2870d80ab959ced6ce6232d6fe7e54bbefe11d333";
const PREFIX = "99d47467174da5c6219daf9add6ac97da844f2643b1f4d1ac47909ad806d0438";
const VALUES = "fb4b9027977797421ca043503fd3613fed39200cc64a7ed0dbbb7b6e5959bab8";
const MAX_SOURCE_BYTES = 6 * 1024 * 1024;
const MAX_CONFIG_BYTES = 256 * 1024;
const MAX_READ_BYTES = 2 * 1024 * 1024;
const MAX_FILES = 32;
const MAX_GLOB_MATCHES = 512;
const MAX_GLOB_VISITS = 4096;
const MAX_ALIASES = 512;
const MAX_RESPONSE_BYTES = 64 * 1024;
const hash = (body: Uint8Array) => createHash("sha256").update(body).digest("hex");

export interface ChatGptSshAliasDiscoveryOptions {
  /** Fixed server-owned paths; never populate these from HTTP input. */
  configPath: string;
  nativeMainChunkFile: string;
  homeDirectory?: string;
}
export type ChatGptSshAliasDiscoveryReason = "SSH_DISCOVERY_VERSION_UNAVAILABLE" | "SSH_CONFIG_UNSAFE" | "SSH_CONFIG_LIMIT" | "SSH_CONFIG_CHANGED" | "SSH_DISCOVERY_FAILED";
export interface ChatGptSshAliasDiscovery {
  discover(): { sshAliases: readonly string[]; configState: "ready" | "missing" };
}

function failure(code: ChatGptSshAliasDiscoveryReason) {
  return Object.assign(new Error("SSH alias discovery unavailable"), { code });
}
function absoluteFile(value: unknown): value is string { return typeof value === "string" && value.length > 1 && value.length <= 4096 && path.isAbsolute(value) && !/[\x00-\x1f\x7f]/.test(value); }
function canonical(value: unknown): value is string { return absoluteFile(value) && path.resolve(value) === value; }
function same(a: fs.BigIntStats, b: fs.BigIntStats) {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs && a.mode === b.mode && a.uid === b.uid;
}
function safeStat(stat: fs.BigIntStats) {
  // Root-owned system includes are allowed; no key or config body leaves this
  // reader. Reading a file does not authorize an SSH connection or command.
  return stat.isFile() && (stat.uid === BigInt(process.getuid!()) || stat.uid === 0n) && (stat.mode & 0o002n) === 0n;
}
function readBounded(file: string, limit: number, code: ChatGptSshAliasDiscoveryReason) {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
    const before = fs.fstatSync(fd, { bigint: true });
    if (!safeStat(before)) throw failure("SSH_CONFIG_UNSAFE");
    if (before.size > BigInt(limit)) throw failure(code);
    const body = Buffer.alloc(Number(before.size) + 1);
    let size = 0;
    while (size < body.length) { const count = fs.readSync(fd, body, size, body.length - size, size); if (!count) break; size += count; }
    const after = fs.fstatSync(fd, { bigint: true });
    if (!same(before, after) || BigInt(size) !== before.size) throw failure("SSH_CONFIG_CHANGED");
    return body.subarray(0, size);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && String(error.code).startsWith("SSH_")) throw error;
    if (code === "SSH_DISCOVERY_VERSION_UNAVAILABLE") throw failure(code);
    const cause = (error as NodeJS.ErrnoException)?.code;
    throw failure(cause === "ENOENT" ? "SSH_CONFIG_CHANGED" : ["EACCES", "EPERM", "ENOTDIR", "ELOOP"].includes(cause ?? "") ? "SSH_CONFIG_UNSAFE" : "SSH_DISCOVERY_FAILED");
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}

/** Read-only server adapter, opt-in at construction. Unknown versions fail closed. */
export function createChatGptSshAliasDiscovery(options: ChatGptSshAliasDiscoveryOptions): ChatGptSshAliasDiscovery {
  if (!options || typeof options !== "object" || Array.isArray(options) || Object.keys(options).some(key => !["configPath", "nativeMainChunkFile", "homeDirectory"].includes(key)) ||
      !canonical(options.configPath) || !canonical(options.nativeMainChunkFile) || (options.homeDirectory !== undefined && !canonical(options.homeDirectory)))
    throw new Error("Invalid fixed SSH alias discovery configuration");
  if (typeof fs.globSync !== "function") throw failure("SSH_DISCOVERY_VERSION_UNAVAILABLE");
  const sourceBytes = readBounded(options.nativeMainChunkFile, MAX_SOURCE_BYTES, "SSH_DISCOVERY_VERSION_UNAVAILABLE");
  if (hash(sourceBytes) !== ORIGINAL) throw failure("SSH_DISCOVERY_VERSION_UNAVAILABLE");
  const source = new TextDecoder("utf-8", { fatal: true }).decode(sourceBytes);
  const begin = source.indexOf("function egM("), middle = source.indexOf("async function egZ(", begin), valueBegin = source.indexOf("function egX(", middle), end = source.indexOf("let eg0=", valueBegin);
  if (begin < 0 || middle <= begin || valueBegin <= middle || end <= valueBegin) throw failure("SSH_DISCOVERY_VERSION_UNAVAILABLE");
  const prefix = source.slice(begin, middle), values = source.slice(valueBegin, end);
  if (hash(Buffer.from(prefix)) !== PREFIX || hash(Buffer.from(values)) !== VALUES) throw failure("SSH_DISCOVERY_VERSION_UNAVAILABLE");
  const configPath = options.configPath, serverHome = options.homeDirectory ?? homedir();
  let run: { bytes: number; files: number; globMatches: number; globVisits: number; entryPresent?: boolean; failure?: ChatGptSshAliasDiscoveryReason } | undefined;
  const bad = (code: ChatGptSshAliasDiscoveryReason): never => { if (run) run.failure = code; throw failure(code); };
  const read = (file: string, encoding: string) => {
    if (!run || !absoluteFile(file) || encoding !== "utf8") return bad("SSH_CONFIG_UNSAFE");
    if (++run.files > MAX_FILES) return bad("SSH_CONFIG_LIMIT");
    let body: Buffer;
    try { body = readBounded(file, MAX_CONFIG_BYTES, "SSH_CONFIG_LIMIT"); }
    catch (error) { return bad((error as { code: ChatGptSshAliasDiscoveryReason }).code); }
    if ((run.bytes += body.length) > MAX_READ_BYTES) return bad("SSH_CONFIG_LIMIT");
    return body.toString("utf8"); // Original readFileSync(..., "utf8") semantics.
  };
  const exists = (file: string) => {
    if (!run || !absoluteFile(file)) return bad("SSH_CONFIG_UNSAFE");
    try { const stat = fs.statSync(file, { bigint: true }); if (!safeStat(stat)) return bad("SSH_CONFIG_UNSAFE"); if (file === configPath) run.entryPresent = true; return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") { if (file === configPath) run.entryPresent = false; return false; } return bad("SSH_CONFIG_UNSAFE"); }
  };
  const readonlyFs = Object.freeze({
    existsSync: exists,
    readFileSync: read,
    globSync(pattern: string) {
      if (!run || !absoluteFile(pattern)) return bad("SSH_CONFIG_UNSAFE");
      const results = fs.globSync(pattern, { exclude: () => { if (!run || ++run.globVisits > MAX_GLOB_VISITS) return bad("SSH_CONFIG_LIMIT"); return false; } });
      if ((run.globMatches += results.length) > MAX_GLOB_MATCHES) return bad("SSH_CONFIG_LIMIT");
      return results;
    },
    statSync(file: string) {
      if (!run || !absoluteFile(file)) return bad("SSH_CONFIG_UNSAFE");
      try { const stat = fs.statSync(file, { bigint: true }); if (stat.isFile() && !safeStat(stat)) return bad("SSH_CONFIG_UNSAFE"); return { isFile: () => stat.isFile() }; }
      catch { return bad("SSH_CONFIG_UNSAFE"); }
    },
  });
  const logger = Object.freeze({ info() {}, warning() {} });
  const context = createContext({ eb: () => readonlyFs, ei: () => path, ef: () => Object.freeze({ homedir: () => serverHome }), em: Object.freeze({ vB9: () => () => logger }) }, { codeGeneration: { strings: false, wasm: false } });
  // The original resolver egZ (ssh -G) is deliberately omitted, not stubbed.
  // No process, require, shell, IPC or network capability enters this context.
  const discoverOriginal = new Script(`let G,A;${prefix}${values};egY`, { filename: "versioned-original-ssh-discovery.js" }).runInContext(context, { timeout: 1000 }) as (file: string) => unknown;
  return Object.freeze({
    discover() {
      if (run) throw failure("SSH_DISCOVERY_FAILED");
      run = { bytes: 0, files: 0, globMatches: 0, globVisits: 0 };
      try {
        const value = discoverOriginal(configPath);
        if (run.failure) throw failure(run.failure);
        if (typeof run.entryPresent !== "boolean") throw failure("SSH_DISCOVERY_FAILED");
        if (!Array.isArray(value) || value.length > MAX_ALIASES || value.some(alias => typeof alias !== "string" || !alias.length)) throw failure("SSH_CONFIG_LIMIT");
        const sshAliases = Array.from(value) as string[];
        if (Buffer.byteLength(JSON.stringify({ sshAliases })) > MAX_RESPONSE_BYTES) throw failure("SSH_CONFIG_LIMIT");
        return Object.freeze({ sshAliases: Object.freeze(sshAliases), configState: run.entryPresent ? "ready" as const : "missing" as const });
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
        throw failure(run.failure ?? (code === "SSH_CONFIG_LIMIT" ? code : "SSH_DISCOVERY_FAILED"));
      }
      finally { run = undefined; }
    },
  });
}
